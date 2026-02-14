// Balance Sheet Bitcoin Calculator - Calculation Engine
// Pure calculation logic — no DOM access.
// Depends on window.PowerLaw and window.Retirement
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;

  const DEFAULTS = {
    annualRevenue:      1000000,
    netMarginPct:       0.10,
    allocationStrategy: 'monthly_profit',   // 'monthly_profit' | 'annual_lump' | 'initial_plus_monthly'
    allocationPct:      0.20,
    initialTreasury:    0,
    revenueGrowthPct:   0.05,
    timeHorizonYears:   10,

    model:              'santostasi',
    sigma:              0.2,
    scenarioMode:       'cyclical',
    initialK:           null
  };

  // ── Main simulation ──────────────────────────────────────

  function simulateTreasury(params, livePriceUSD) {
    const {
      annualRevenue, netMarginPct, allocationStrategy, allocationPct,
      initialTreasury, revenueGrowthPct, timeHorizonYears,
      model, sigma, scenarioMode, initialK
    } = params;

    const totalMonths = timeHorizonYears * 12;
    const now = new Date();
    const startYear  = now.getFullYear();
    const startMonth = now.getMonth();

    let cumulativeBTC          = 0;
    let cumulativeAllocatedUSD = 0;
    const months = [];

    for (let i = 0; i <= totalMonths; i++) {
      const simDate   = new Date(startYear, startMonth + i, 15);
      const yearIndex = i / 12;
      const effectiveK = R.resolveScenarioK(scenarioMode, yearIndex, initialK);
      const btcPrice   = R.scenarioPrice(model, simDate, sigma, effectiveK);
      const trendPrice = PL.trendPrice(model, simDate);

      // Revenue grows annually (step-wise per year)
      const yearsElapsed = Math.floor(i / 12);
      const currentAnnualRevenue = annualRevenue * Math.pow(1 + revenueGrowthPct, yearsElapsed);
      const monthlyRevenue = currentAnnualRevenue / 12;
      const monthlyProfit  = monthlyRevenue * netMarginPct;
      const annualProfit   = currentAnnualRevenue * netMarginPct;

      // ── BTC allocation this month ──────────────────────
      let fiatAllocated = 0;
      let btcBought     = 0;

      if (allocationStrategy === 'monthly_profit') {
        fiatAllocated = monthlyProfit * allocationPct;
        btcBought = fiatAllocated / btcPrice;

      } else if (allocationStrategy === 'annual_lump') {
        if (i % 12 === 0) {
          fiatAllocated = annualProfit * allocationPct;
          btcBought = fiatAllocated / btcPrice;
        }

      } else if (allocationStrategy === 'initial_plus_monthly') {
        if (i === 0 && initialTreasury > 0) {
          const initialPrice = livePriceUSD || btcPrice;
          fiatAllocated += initialTreasury;
          btcBought     += initialTreasury / initialPrice;
        }
        const monthlyAlloc = monthlyProfit * allocationPct;
        fiatAllocated += monthlyAlloc;
        btcBought     += monthlyAlloc / btcPrice;
      }

      cumulativeBTC          += btcBought;
      cumulativeAllocatedUSD += fiatAllocated;

      const treasuryValueUSD = cumulativeBTC * btcPrice;
      const treasuryROI = cumulativeAllocatedUSD > 0
        ? ((treasuryValueUSD - cumulativeAllocatedUSD) / cumulativeAllocatedUSD) * 100
        : 0;

      // Operating costs = revenue × (1 - margin)
      const monthlyOpCost = monthlyRevenue * (1 - netMarginPct);

      // Effective margin: if BTC gains were counted as revenue
      const btcGain = treasuryValueUSD - cumulativeAllocatedUSD;
      const annualizedBTCGain = yearIndex > 0 ? btcGain / yearIndex : 0;
      const effectiveMargin = currentAnnualRevenue > 0
        ? (annualProfit + annualizedBTCGain) / currentAnnualRevenue
        : netMarginPct;

      // Resilience: months of opex covered by treasury
      const resilienceMonths = monthlyOpCost > 0 ? treasuryValueUSD / monthlyOpCost : 0;

      months.push({
        index: i,
        date: simDate,
        yearIndex,
        effectiveK,
        btcPrice,
        trendPrice,
        currentAnnualRevenue,
        monthlyRevenue,
        monthlyProfit,
        annualProfit,
        fiatAllocated,
        btcBought,
        cumulativeBTC,
        cumulativeAllocatedUSD,
        treasuryValueUSD,
        treasuryROI,
        effectiveMargin,
        resilienceMonths,
        monthlyOpCost
      });
    }

    return { months, params };
  }

  // ── Summary statistics ───────────────────────────────────

  function treasurySummary(simResult) {
    const { months, params } = simResult;
    const last  = months[months.length - 1];
    const first = months[0];

    return {
      totalBTC:            last.cumulativeBTC,
      totalAllocatedUSD:   last.cumulativeAllocatedUSD,
      finalTreasuryValue:  last.treasuryValueUSD,
      treasuryGainLoss:    last.treasuryValueUSD - last.cumulativeAllocatedUSD,
      treasuryROI:         last.treasuryROI,
      effectiveMargin:     last.effectiveMargin,
      originalMargin:      params.netMarginPct,
      finalRevenue:        last.currentAnnualRevenue,
      resilienceMonths:    last.resilienceMonths,
      finalBTCPrice:       last.btcPrice,
      startDate:           first.date,
      endDate:             last.date,
      totalMonths:         months.length - 1
    };
  }

  // ── Margin impact (year-by-year) ──────────────────────────

  function calculateMarginImpact(simResult) {
    const { months, params } = simResult;
    const snapshots = [];

    for (let y = 1; y <= params.timeHorizonYears; y++) {
      const idx     = y * 12;
      const prevIdx = (y - 1) * 12;
      if (idx >= months.length) break;

      const m     = months[idx];
      const mPrev = months[prevIdx];

      // BTC gain this year = value change minus new allocations
      const newAlloc = m.cumulativeAllocatedUSD - mPrev.cumulativeAllocatedUSD;
      const valueChange = m.treasuryValueUSD - mPrev.treasuryValueUSD;
      const btcGainThisYear = valueChange - newAlloc;

      // If gains cover part of profit, margin can be lowered
      const requiredProfit = Math.max(0, m.annualProfit - btcGainThisYear);
      const adjustedMargin = m.currentAnnualRevenue > 0
        ? requiredProfit / m.currentAnnualRevenue
        : params.netMarginPct;

      snapshots.push({
        year: y,
        originalMargin: params.netMarginPct,
        adjustedMargin: Math.max(0, adjustedMargin),
        btcGainThisYear,
        marginReduction: params.netMarginPct - Math.max(0, adjustedMargin)
      });
    }

    return snapshots;
  }

  // ── R&D / quality budget from BTC appreciation ────────────

  function calculateRDbudget(simResult) {
    const { months, params } = simResult;
    const budgets = [];

    for (let y = 1; y <= params.timeHorizonYears; y++) {
      const idx     = y * 12;
      const prevIdx = (y - 1) * 12;
      if (idx >= months.length) break;

      const m     = months[idx];
      const mPrev = months[prevIdx];

      const newAlloc = m.cumulativeAllocatedUSD - mPrev.cumulativeAllocatedUSD;
      const valueChange = m.treasuryValueUSD - mPrev.treasuryValueUSD;
      const appreciation = valueChange - newAlloc;

      budgets.push({
        year: y,
        appreciation: Math.max(0, appreciation),
        revenue: m.currentAnnualRevenue,
        pctOfRevenue: m.currentAnnualRevenue > 0 ? Math.max(0, appreciation) / m.currentAnnualRevenue : 0
      });
    }

    return budgets;
  }

  // ── Resilience buffer ─────────────────────────────────────

  function calculateResilienceBuffer(simResult) {
    const { months, params } = simResult;
    const snapshots = [];

    for (let y = 1; y <= params.timeHorizonYears; y++) {
      const idx = y * 12;
      if (idx >= months.length) break;
      const m = months[idx];

      snapshots.push({
        year: y,
        treasuryValue: m.treasuryValueUSD,
        monthlyOpCost: m.monthlyOpCost,
        runwayMonths: m.resilienceMonths
      });
    }

    return snapshots;
  }

  // ── Scenario comparison ───────────────────────────────────

  function compareScenarios(params, livePriceUSD) {
    const modes = ['smooth_trend', 'smooth_bear', 'smooth_deep_bear', 'cyclical', 'cyclical_bear'];
    return modes.map(mode => {
      const p = Object.assign({}, params, { scenarioMode: mode });
      const result     = simulateTreasury(p, livePriceUSD);
      const summary    = treasurySummary(result);
      const margin     = calculateMarginImpact(result);
      const resilience = calculateResilienceBuffer(result);
      return {
        scenarioMode: mode,
        label:        R.scenarioLabel(mode),
        summary,
        marginImpact: margin,
        resilience,
        months:       result.months
      };
    });
  }

  // ── Export ─────────────────────────────────────────────────

  window.BalanceSheet = {
    DEFAULTS,
    simulateTreasury,
    treasurySummary,
    calculateMarginImpact,
    calculateRDbudget,
    calculateResilienceBuffer,
    compareScenarios
  };
})();
