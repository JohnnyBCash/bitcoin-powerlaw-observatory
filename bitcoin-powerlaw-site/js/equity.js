// Home Equity Bitcoin Calculator - Calculation Engine
// Pure calculation logic — no DOM access.
// Depends on window.PowerLaw and window.Retirement
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;

  const DEFAULTS = {
    loanAmount:         50000,
    loanDurationYears:  10,
    loanInterestRate:   0.045,
    interestOnly:       false,

    homeValue:          500000,
    mortgageBalance:    300000,
    mortgageRate:       0.035,

    buyNow:             true,
    futureBuyYear:      null,
    futureBuyMonth:     null,

    model:              'santostasi',
    sigma:              0.3,
    scenarioMode:       'cyclical',
    initialK:           null
  };

  // ── Equity & LTV helpers ─────────────────────────────────

  function computeEquityMetrics(params) {
    const { homeValue, mortgageBalance, loanAmount } = params;
    const homeEquity  = homeValue - mortgageBalance;
    const existingLTV = homeValue > 0 ? mortgageBalance / homeValue : 0;
    const totalLTV    = homeValue > 0 ? (mortgageBalance + loanAmount) / homeValue : 0;
    return {
      homeEquity,
      existingLTV,
      totalLTV,
      ltvWarning: totalLTV > 0.80
    };
  }

  // ── Loan math ────────────────────────────────────────────

  function monthlyPayment(principal, annualRate, durationYears, interestOnly) {
    const r = annualRate / 12;
    const n = durationYears * 12;
    if (interestOnly || r === 0) return principal * r;               // interest only
    return principal * r / (1 - Math.pow(1 + r, -n));                // annuity
  }

  // ── Main simulation ──────────────────────────────────────

  function simulateEquityLoan(params, livePriceUSD) {
    const {
      loanAmount, loanDurationYears, loanInterestRate, interestOnly,
      homeValue, mortgageBalance,
      buyNow, futureBuyYear, futureBuyMonth,
      model, sigma, scenarioMode, initialK
    } = params;

    const totalMonths = loanDurationYears * 12;
    const r           = loanInterestRate / 12;
    const pmt         = monthlyPayment(loanAmount, loanInterestRate, loanDurationYears, interestOnly);

    // ── Determine purchase price & BTC amount ──────────────
    const now = new Date();
    let purchasePrice, purchaseDate;

    if (buyNow && livePriceUSD) {
      purchasePrice = livePriceUSD;
      purchaseDate  = now;
    } else if (futureBuyYear && futureBuyMonth) {
      purchaseDate  = new Date(futureBuyYear, futureBuyMonth - 1, 15);
      const yrsAhead = (purchaseDate - now) / (365.25 * 24 * 3600 * 1000);
      const futureK  = R.resolveScenarioK(scenarioMode, yrsAhead, initialK);
      purchasePrice  = R.scenarioPrice(model, purchaseDate, sigma, futureK);
    } else {
      // fallback: use trend price today
      purchasePrice = PL.trendPrice(model, now);
      purchaseDate  = now;
    }

    const btcAmount = loanAmount / purchasePrice;

    // ── Month-by-month loop ────────────────────────────────
    const months         = [];
    let remainingBalance = loanAmount;
    let cumPayments      = 0;
    let cumInterest      = 0;
    let breakEvenMonth   = null;

    for (let i = 0; i <= totalMonths; i++) {
      const simDate   = new Date(now.getFullYear(), now.getMonth() + i, 15);
      const yearIndex = i / 12;
      const effectiveK = R.resolveScenarioK(scenarioMode, yearIndex, initialK);
      const btcPrice   = R.scenarioPrice(model, simDate, sigma, effectiveK);
      const trendPrice = PL.trendPrice(model, simDate);

      // Loan mechanics (skip month 0 — purchase month, no payment yet)
      let interestThisMonth  = 0;
      let principalThisMonth = 0;
      let paymentThisMonth   = 0;

      if (i > 0 && remainingBalance > 0) {
        interestThisMonth = remainingBalance * r;

        if (interestOnly) {
          principalThisMonth = (i === totalMonths) ? remainingBalance : 0;
          paymentThisMonth   = (i === totalMonths) ? interestThisMonth + remainingBalance : pmt;
        } else {
          principalThisMonth = pmt - interestThisMonth;
          paymentThisMonth   = pmt;
        }

        remainingBalance = Math.max(0, remainingBalance - principalThisMonth);
        cumPayments  += paymentThisMonth;
        cumInterest  += interestThisMonth;
      }

      const btcValueUSD = btcAmount * btcPrice;
      const netPosition = btcValueUSD - remainingBalance - cumInterest;
      const totalLTV    = homeValue > 0 ? (mortgageBalance + remainingBalance) / homeValue : 0;

      if (breakEvenMonth === null && i > 0 && btcValueUSD >= cumPayments) {
        breakEvenMonth = i;
      }

      months.push({
        monthIndex:          i,
        date:                simDate,
        year:                simDate.getFullYear(),
        month:               simDate.getMonth() + 1,
        yearIndex,
        effectiveK,
        btcPrice,
        trendPrice,
        monthlyPayment:      paymentThisMonth,
        principalPaid:       principalThisMonth,
        interestPaid:        interestThisMonth,
        cumulativePayments:  cumPayments,
        cumulativeInterest:  cumInterest,
        remainingLoanBalance: remainingBalance,
        btcAmount,
        btcValueUSD,
        netPosition,
        totalLTV,
        roi: cumPayments > 0 ? ((btcValueUSD - cumPayments) / cumPayments) * 100 : 0
      });
    }

    return {
      months,
      breakEvenMonth,
      purchasePrice,
      btcAmount,
      params
    };
  }

  // ── Summary statistics ───────────────────────────────────

  function simulationSummary(result) {
    const { months, breakEvenMonth, purchasePrice, btcAmount } = result;
    const last = months[months.length - 1];
    const pmt  = result.params.interestOnly
      ? result.params.loanAmount * (result.params.loanInterestRate / 12)
      : monthlyPayment(result.params.loanAmount, result.params.loanInterestRate,
                        result.params.loanDurationYears, false);

    // Max LTV during simulation
    let maxLTV = 0;
    for (const m of months) {
      if (m.totalLTV > maxLTV) maxLTV = m.totalLTV;
    }

    const totalCost      = last.cumulativePayments;
    const totalInterest  = last.cumulativeInterest;
    const finalBtcValue  = last.btcValueUSD;
    const netGainLoss    = finalBtcValue - totalCost;
    const roiPct         = totalCost > 0 ? (netGainLoss / totalCost) * 100 : 0;

    return {
      totalCost,
      totalInterest,
      btcAmount,
      buyPrice:       purchasePrice,
      finalBtcPrice:  last.btcPrice,
      finalBtcValue,
      netGainLoss,
      roiPct,
      breakEvenMonth,
      breakEvenDate:  breakEvenMonth !== null ? months[breakEvenMonth].date : null,
      monthlyPayment: pmt,
      maxLTV,
      finalLTV:       last.totalLTV,
      remainingBalance: last.remainingLoanBalance
    };
  }

  // ── Scenario comparison ──────────────────────────────────

  function compareScenarios(params, livePriceUSD) {
    const modes = ['smooth_trend', 'smooth_bear', 'smooth_deep_bear', 'cyclical', 'cyclical_bear'];
    return modes.map(mode => {
      const p = Object.assign({}, params, { scenarioMode: mode });
      const result  = simulateEquityLoan(p, livePriceUSD);
      const summary = simulationSummary(result);
      return {
        scenarioMode: mode,
        label:        R.scenarioLabel(mode),
        summary,
        months:       result.months
      };
    });
  }

  // ── Export ────────────────────────────────────────────────

  window.Equity = {
    DEFAULTS,
    computeEquityMetrics,
    monthlyPayment,
    simulateEquityLoan,
    simulationSummary,
    compareScenarios
  };
})();
