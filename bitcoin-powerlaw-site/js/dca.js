// ── DCA Simulation Engine ─────────────────────────────────────────
// Pure calculation logic — no DOM access.
// Depends on window.PowerLaw (powerlaw.js) and window.Retirement (retirement.js)
// for scenario pricing and power law model functions.
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;

  const DEFAULTS = {
    lumpSumUSD:       10000,
    monthlyDCAUSD:    500,
    startYear:        2025,
    startMonth:       1,        // 1-12
    timeHorizonYears: 10,
    model:            'santostasi',
    sigma:            0.2,
    scenarioMode:     'cyclical',
    initialK:         null
  };

  // ── Core DCA Simulation ────────────────────────────────────────
  // Runs month-by-month: month 0 gets lump sum + first DCA,
  // subsequent months get DCA only.
  function simulateDCA(params) {
    const {
      lumpSumUSD, monthlyDCAUSD, startYear, startMonth,
      timeHorizonYears, model, sigma, scenarioMode, initialK
    } = params;

    const totalMonths = timeHorizonYears * 12;
    const months = [];
    let cumulativeBTC = 0;
    let cumulativeInvestedUSD = 0;

    for (let i = 0; i <= totalMonths; i++) {
      const year  = startYear + Math.floor((startMonth - 1 + i) / 12);
      const month = ((startMonth - 1 + i) % 12);   // 0-indexed for Date()
      const date  = new Date(year, month, 15);       // mid-month

      // Fractional years from start for scenario engine
      const yearIndex = i / 12;
      const effectiveK = R.resolveScenarioK(scenarioMode, yearIndex, initialK);
      const price      = R.scenarioPrice(model, date, sigma, effectiveK);
      const trendPrice = PL.trendPrice(model, date);

      // Fiat spent and BTC bought this month
      let btcBought = 0;
      let fiatSpent = 0;

      // Month 0: lump sum purchase
      if (i === 0 && lumpSumUSD > 0) {
        btcBought += lumpSumUSD / price;
        fiatSpent += lumpSumUSD;
      }

      // Every month: recurring DCA
      if (monthlyDCAUSD > 0) {
        btcBought += monthlyDCAUSD / price;
        fiatSpent += monthlyDCAUSD;
      }

      cumulativeBTC         += btcBought;
      cumulativeInvestedUSD += fiatSpent;

      const portfolioValueUSD = cumulativeBTC * price;
      const roiPct = cumulativeInvestedUSD > 0
        ? ((portfolioValueUSD - cumulativeInvestedUSD) / cumulativeInvestedUSD) * 100
        : 0;
      const avgCostBasis = cumulativeBTC > 0
        ? cumulativeInvestedUSD / cumulativeBTC
        : 0;

      months.push({
        index: i,
        date,
        year,
        month: month + 1,            // 1-indexed for display
        yearIndex,
        effectiveK,
        price,
        trendPrice,
        btcBought,
        fiatSpent,
        cumulativeBTC,
        cumulativeInvestedUSD,
        portfolioValueUSD,
        roiPct,
        avgCostBasis
      });
    }

    return { months, params };
  }

  // ── Comparison: Lump Sum vs DCA vs Combined ────────────────────
  function simulateComparison(params) {
    const lumpOnly = simulateDCA({ ...params, monthlyDCAUSD: 0 });
    const dcaOnly  = simulateDCA({ ...params, lumpSumUSD: 0 });
    const combined = simulateDCA(params);
    return { lumpOnly, dcaOnly, combined };
  }

  // ── Summary Statistics ─────────────────────────────────────────
  function simulationSummary(simResult) {
    const { months } = simResult;
    const last  = months[months.length - 1];
    const first = months[0];

    return {
      totalInvestedUSD:  last.cumulativeInvestedUSD,
      totalBTC:          last.cumulativeBTC,
      finalValueUSD:     last.portfolioValueUSD,
      finalPrice:        last.price,
      roiPct:            last.roiPct,
      avgCostBasis:      last.avgCostBasis,
      gainUSD:           last.portfolioValueUSD - last.cumulativeInvestedUSD,
      totalMonths:       months.length,
      startDate:         first.date,
      endDate:           last.date,
      costBasisVsFinal:  last.avgCostBasis > 0 ? last.price / last.avgCostBasis : 0,
      highestPrice:      Math.max(...months.map(m => m.price)),
      lowestPrice:       Math.min(...months.map(m => m.price))
    };
  }

  // ── Export ─────────────────────────────────────────────────────
  window.DCA = {
    DEFAULTS,
    simulateDCA,
    simulateComparison,
    simulationSummary
  };

})();
