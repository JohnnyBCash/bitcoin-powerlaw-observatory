// Bitcoin Retirement Calculator
// Uses power law model to simulate retirement withdrawals
// Supports two modes: sell-only vs. bitcoin-backed loans

(function() {
  'use strict';

  const PL = window.PowerLaw;

  // ── Default Parameters ──────────────────────────────────────
  const DEFAULTS = {
    btcHoldings: 1.0,
    annualSpendUSD: 50000,
    retirementYear: 2030,
    timeHorizonYears: 30,
    m2GrowthRate: 0.065,       // 6.5% annual M2 inflation
    model: 'krueger',
    sigma: 0.3,                // will be recalculated from data
    // Loan parameters
    useLoans: false,
    loanLTV: 0.40,             // 40% loan-to-value
    loanInterestRate: 0.08,    // 8% annual interest
    loanThreshold: 1.0,        // borrow when price/trend < this multiple
    // Scenarios
    scenarioMode: 'cyclical',  // 'smooth_trend', 'smooth_bear', 'smooth_deep_bear', 'cyclical', 'cyclical_bear'
  };


  // ── CAGR Decay Engine ───────────────────────────────────────
  // Power law CAGR between two dates
  function cagrBetween(model, dateFrom, dateTo) {
    const p1 = PL.trendPrice(model, dateFrom);
    const p2 = PL.trendPrice(model, dateTo);
    const years = (dateTo.getTime() - dateFrom.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years <= 0 || p1 <= 0) return 0;
    return Math.pow(p2 / p1, 1 / years) - 1;
  }

  // Instantaneous CAGR approximation at a given year since genesis
  // For P = A*t^β, one-year CAGR ≈ ((t+1)/t)^β - 1
  function instantaneousCAGR(model, date) {
    const params = PL.MODELS[model];
    const t = params.useYears ? PL.yearsSinceGenesis(date) : PL.daysSinceGenesis(date);
    const dt = params.useYears ? 1 : 365.25;
    return Math.pow((t + dt) / t, params.beta) - 1;
  }

  // Generate CAGR decay table: year-by-year expected returns
  function cagrDecayTable(model, startYear, years) {
    const table = [];
    for (let i = 0; i < years; i++) {
      const date = new Date(startYear + i, 0, 1);
      const dateNext = new Date(startYear + i + 1, 0, 1);
      const cagr = cagrBetween(model, date, dateNext);
      const trend = PL.trendPrice(model, date);
      table.push({
        year: startYear + i,
        date,
        trendPrice: trend,
        cagr,
        cagrPct: (cagr * 100).toFixed(1)
      });
    }
    return table;
  }


  // ── Price Scenario Engine ───────────────────────────────────
  // Returns simulated BTC price for a given date and scenario
  // sigma_k: 0 = trend, -1 = bear (1σ below), -2 = deep bear
  function scenarioPrice(model, date, sigma, sigmaK) {
    const trend = PL.trendPrice(model, date);
    return trend * Math.pow(10, sigmaK * sigma);
  }

  // ── Cyclical Price Model ──────────────────────────────────
  // Dampened sine wave with lengthening cycle periods
  // Returns sigmaK between -1 and +1 for a given year offset
  function cyclicalSigmaK(yearsFromStart, options = {}) {
    const {
      T_base = 4.0,     // initial cycle length (years)
      T_growth = 0.3,   // each cycle grows by this many years
      damping = 0.02,   // amplitude decay rate per year
      bearBias = 0,      // shift wave down (0.309 → 60% below trend)
      amplitude = 1.0
    } = options;

    if (yearsFromStart <= 0) return -amplitude; // start at bottom

    // Walk through cycles via phase accumulation
    let elapsed = 0;
    let cycleIndex = 0;

    while (true) {
      const period = T_base + cycleIndex * T_growth;
      if (elapsed + period > yearsFromStart) {
        // We're inside this cycle
        const positionInCycle = (yearsFromStart - elapsed) / period; // 0..1
        const phase = positionInCycle * 2 * Math.PI;

        // Sine starting at -1 (trough), peaking at mid-cycle
        let sineVal = Math.sin(phase - Math.PI / 2);

        // Apply bear bias (shifts wave downward)
        sineVal -= bearBias;

        // Clamp to [-1, 1]
        sineVal = Math.max(-1, Math.min(1, sineVal));

        // Dampen amplitude over time
        const dampFactor = Math.exp(-damping * yearsFromStart);

        return amplitude * dampFactor * sineVal;
      }
      elapsed += period;
      cycleIndex++;
    }
  }

  // Resolve the effective sigmaK for a given year based on scenario mode
  function resolveScenarioK(scenarioMode, yearIndex) {
    switch (scenarioMode) {
      case 'smooth_trend':      return 0;
      case 'smooth_bear':       return -1;
      case 'smooth_deep_bear':  return -2;
      case 'cyclical':
        return cyclicalSigmaK(yearIndex, { bearBias: 0 });
      case 'cyclical_bear':
        return cyclicalSigmaK(yearIndex, { bearBias: 0.309 });
      default:
        return 0;
    }
  }

  function scenarioLabel(mode) {
    const labels = {
      'smooth_trend': 'Smooth Trend',
      'smooth_bear': 'Bear (flat −1σ)',
      'smooth_deep_bear': 'Deep Bear (flat −2σ)',
      'cyclical': 'Cyclical (±1σ)',
      'cyclical_bear': 'Bear Bias Cycles'
    };
    return labels[mode] || mode;
  }

  // ── Withdrawal Simulation: Sell-Only Mode ───────────────────
  // Each year: sell enough BTC to cover inflation-adjusted spending
  function simulateSellOnly(params) {
    const {
      btcHoldings, annualSpendUSD, retirementYear,
      timeHorizonYears, m2GrowthRate, model, sigma, scenarioMode
    } = params;

    let stack = btcHoldings;
    let annualSpend = annualSpendUSD;
    const results = [];
    let ruinYear = null;

    for (let i = 0; i < timeHorizonYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1); // mid-year
      const effectiveK = resolveScenarioK(scenarioMode, i);
      const price = scenarioPrice(model, date, sigma, effectiveK);
      const trend = PL.trendPrice(model, date);
      const multiple = price / trend;

      // BTC needed to cover this year's spending
      const btcToSell = annualSpend / price;
      const stackBefore = stack;

      // Check ruin
      if (btcToSell >= stack) {
        ruinYear = year;
        results.push({
          year, price, trend, multiple, effectiveK, annualSpend,
          btcSold: stack, btcBorrowed: 0, loanBalance: 0,
          interestPaid: 0, stackAfter: 0,
          portfolioValueUSD: 0,
          swrPct: 100,
          status: 'RUIN'
        });
        // Fill remaining years as ruin
        for (let j = i + 1; j < timeHorizonYears; j++) {
          const ry = retirementYear + j;
          results.push({
            year: ry, price: 0, trend: 0, multiple: 0, effectiveK: 0,
            annualSpend: annualSpend * Math.pow(1 + m2GrowthRate, j - i),
            btcSold: 0, btcBorrowed: 0, loanBalance: 0,
            interestPaid: 0, stackAfter: 0,
            portfolioValueUSD: 0, swrPct: 0, status: 'RUIN'
          });
        }
        break;
      }

      stack -= btcToSell;
      const portfolioValue = stack * price;
      const swrPct = (annualSpend / (stackBefore * price)) * 100;

      results.push({
        year, price, trend, multiple, effectiveK, annualSpend,
        btcSold: btcToSell, btcBorrowed: 0, loanBalance: 0,
        interestPaid: 0, stackAfter: stack,
        portfolioValueUSD: portfolioValue,
        swrPct,
        status: 'OK'
      });

      // Inflate spending for next year
      annualSpend *= (1 + m2GrowthRate);
    }

    return { results, ruinYear, mode: 'sell_only' };
  }


  // ── Withdrawal Simulation: Loan Mode ────────────────────────
  // Below trend: borrow against BTC instead of selling
  // Above trend: sell BTC + repay outstanding loans
  function simulateWithLoans(params) {
    const {
      btcHoldings, annualSpendUSD, retirementYear,
      timeHorizonYears, m2GrowthRate, model, sigma, scenarioMode,
      loanLTV, loanInterestRate, loanThreshold
    } = params;

    let stack = btcHoldings;
    let annualSpend = annualSpendUSD;
    let outstandingLoan = 0;
    let totalInterestPaid = 0;
    const results = [];
    let ruinYear = null;

    for (let i = 0; i < timeHorizonYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1);
      const effectiveK = resolveScenarioK(scenarioMode, i);
      const price = scenarioPrice(model, date, sigma, effectiveK);
      const trend = PL.trendPrice(model, date);
      const multiple = price / trend;

      // Accrue interest on outstanding loan
      const interestThisYear = outstandingLoan * loanInterestRate;
      outstandingLoan += interestThisYear;
      totalInterestPaid += interestThisYear;

      const stackBefore = stack;
      let btcSold = 0;
      let btcBorrowed = 0;
      let yearStatus = 'OK';

      // Total cash needed: spending + any loan repayment strategy
      const cashNeeded = annualSpend;

      if (multiple < loanThreshold) {
        // BELOW TREND → borrow against BTC
        // Max borrowable = stack * price * LTV - outstanding loan
        const maxBorrow = (stack * price * loanLTV) - outstandingLoan;

        if (maxBorrow >= cashNeeded) {
          // Borrow to cover spending
          outstandingLoan += cashNeeded;
          btcBorrowed = cashNeeded;
          yearStatus = 'BORROWING';
        } else if (maxBorrow > 0) {
          // Borrow what we can, sell BTC for the rest
          outstandingLoan += maxBorrow;
          btcBorrowed = maxBorrow;
          const remainder = cashNeeded - maxBorrow;
          btcSold = remainder / price;
          if (btcSold >= stack) {
            ruinYear = year;
            yearStatus = 'RUIN';
          } else {
            stack -= btcSold;
            yearStatus = 'PARTIAL_BORROW';
          }
        } else {
          // LTV maxed out, must sell
          btcSold = cashNeeded / price;
          if (btcSold >= stack) {
            ruinYear = year;
            yearStatus = 'RUIN';
          } else {
            stack -= btcSold;
            yearStatus = 'FORCED_SELL';
          }
        }
      } else {
        // ABOVE TREND → sell BTC, repay loans if any
        const totalNeeded = cashNeeded + outstandingLoan;
        btcSold = totalNeeded / price;

        if (btcSold >= stack) {
          // Try just covering spending without full loan repayment
          btcSold = cashNeeded / price;
          if (btcSold >= stack) {
            ruinYear = year;
            yearStatus = 'RUIN';
          } else {
            stack -= btcSold;
            // Partial loan repayment with remaining capacity
            const excessBTC = stack * 0.1; // repay 10% of stack value
            const repayAmount = Math.min(outstandingLoan, excessBTC * price);
            if (repayAmount > 0) {
              stack -= repayAmount / price;
              outstandingLoan -= repayAmount;
            }
            yearStatus = 'PARTIAL_REPAY';
          }
        } else {
          stack -= btcSold;
          outstandingLoan = 0;
          yearStatus = 'SELL_AND_REPAY';
        }
      }


      // Liquidation check: if loan exceeds LTV on current stack
      const liquidationPrice = outstandingLoan / (stack * loanLTV);
      const isLiquidationRisk = price < liquidationPrice * 1.2; // within 20%

      const portfolioValue = (stack * price) - outstandingLoan;
      const swrPct = stackBefore > 0 ? (annualSpend / (stackBefore * price)) * 100 : 0;

      results.push({
        year, price, trend, multiple, effectiveK, annualSpend,
        btcSold, btcBorrowed, loanBalance: outstandingLoan,
        interestPaid: interestThisYear,
        totalInterestPaid,
        liquidationPrice: outstandingLoan > 0 ? liquidationPrice : 0,
        isLiquidationRisk,
        stackAfter: stack,
        portfolioValueUSD: portfolioValue,
        swrPct,
        status: yearStatus
      });

      if (ruinYear) {
        // Fill remaining years
        for (let j = i + 1; j < timeHorizonYears; j++) {
          results.push({
            year: retirementYear + j, price: 0, trend: 0, multiple: 0,
            effectiveK: 0,
            annualSpend: 0, btcSold: 0, btcBorrowed: 0, loanBalance: 0,
            interestPaid: 0, totalInterestPaid, liquidationPrice: 0,
            isLiquidationRisk: false, stackAfter: 0,
            portfolioValueUSD: 0, swrPct: 0, status: 'RUIN'
          });
        }
        break;
      }

      annualSpend *= (1 + m2GrowthRate);
    }

    return { results, ruinYear, mode: 'with_loans', totalInterestPaid };
  }


  // ── Minimum Stack Calculator ────────────────────────────────
  // Binary search for the minimum BTC needed to survive the full horizon
  function findMinimumStack(baseParams, useLoans) {
    const simulate = useLoans ? simulateWithLoans : simulateSellOnly;
    let lo = 0.001;
    let hi = 100;

    // Quick check if even 100 BTC isn't enough
    const testHigh = simulate({ ...baseParams, btcHoldings: hi });
    if (testHigh.ruinYear !== null) {
      hi = 1000;
      const testHigher = simulate({ ...baseParams, btcHoldings: hi });
      if (testHigher.ruinYear !== null) return { minStack: Infinity, iterations: 0 };
    }

    let iterations = 0;
    while (hi - lo > 0.001 && iterations < 50) {
      const mid = (lo + hi) / 2;
      const result = simulate({ ...baseParams, btcHoldings: mid });
      if (result.ruinYear !== null) {
        lo = mid;
      } else {
        hi = mid;
      }
      iterations++;
    }

    return { minStack: hi, iterations };
  }


  // ── Comparison: Loans vs No Loans ───────────────────────────
  // Run both modes across all scenarios and compare required stacks
  function compareStrategies(baseParams) {
    const scenarios = [
      { label: 'Smooth Trend', mode: 'smooth_trend' },
      { label: 'Bear (flat −1σ)', mode: 'smooth_bear' },
      { label: 'Deep Bear (flat −2σ)', mode: 'smooth_deep_bear' },
      { label: 'Cyclical (±1σ)', mode: 'cyclical' },
      { label: 'Bear Bias Cycles', mode: 'cyclical_bear' }
    ];

    const comparison = scenarios.map(s => {
      const p = { ...baseParams, scenarioMode: s.mode };

      const sellMin = findMinimumStack(p, false);
      const loanMin = findMinimumStack(p, true);

      const sellSim = simulateSellOnly({ ...p, btcHoldings: sellMin.minStack });
      const loanSim = simulateWithLoans({ ...p, btcHoldings: loanMin.minStack });

      const savings = sellMin.minStack - loanMin.minStack;
      const savingsPct = sellMin.minStack > 0 ? (savings / sellMin.minStack) * 100 : 0;

      return {
        scenario: s.label,
        mode: s.mode,
        sellOnly: {
          minStack: sellMin.minStack,
          simulation: sellSim
        },
        withLoans: {
          minStack: loanMin.minStack,
          simulation: loanSim,
          totalInterest: loanSim.totalInterestPaid || 0
        },
        btcSaved: savings,
        savingsPct
      };
    });

    return comparison;
  }

  // ── Summary Stats ───────────────────────────────────────────
  function simulationSummary(simResult) {
    const r = simResult.results.filter(y => y.status !== 'RUIN');
    if (r.length === 0) return null;

    const totalBTCSold = r.reduce((s, y) => s + y.btcSold, 0);
    const totalSpent = r.reduce((s, y) => s + y.annualSpend, 0);
    const avgSWR = r.reduce((s, y) => s + y.swrPct, 0) / r.length;
    const finalStack = r[r.length - 1].stackAfter;
    const finalValue = r[r.length - 1].portfolioValueUSD;
    const borrowYears = r.filter(y =>
      y.status === 'BORROWING' || y.status === 'PARTIAL_BORROW'
    ).length;

    return {
      yearsBeforeRuin: r.length,
      totalBTCSold,
      totalSpent,
      avgSWR,
      finalStack,
      finalValue,
      borrowYears,
      totalInterestPaid: simResult.totalInterestPaid || 0
    };
  }


  // ── Export ───────────────────────────────────────────────────
  window.Retirement = {
    DEFAULTS,
    cagrBetween,
    instantaneousCAGR,
    cagrDecayTable,
    scenarioPrice,
    cyclicalSigmaK,
    resolveScenarioK,
    scenarioLabel,
    simulateSellOnly,
    simulateWithLoans,
    findMinimumStack,
    compareStrategies,
    simulationSummary
  };

})();
