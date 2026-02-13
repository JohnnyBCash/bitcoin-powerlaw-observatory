// Bitcoin Retirement Calculator V2 — Navigation Fund / Forever Half Framework
// Splits stack into Navigation Fund (active decumulation through storm) and Forever Half (power law growth)
// Forever Half SWR derived from power law math: 25% × E[return] where E[return] = β / (t × ln10)
// Depends on: window.PowerLaw (PL), window.Retirement (R)

(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;

  // ── Default Parameters ──────────────────────────────────────
  const DEFAULTS = {
    // Stack
    totalBTC: 1.0,
    bridgeSplitPct: 0.50,        // 50% navigation fund, 50% forever

    // Mode
    mode: 'freedom_now',          // 'freedom_now' | 'end_result'

    // Spending (Freedom Now)
    annualBurnUSD: 50000,
    spendingGrowthRate: 0.065,    // 6.5% annual

    // Accumulation (End Result)
    additionalYears: 5,
    monthlyDCAUSD: 500,
    incomeGrowthRate: 0.03,       // 3% annual income growth

    // Time & Model
    retirementYear: 2030,
    maxProjectionYears: 50,       // max years to project forward
    model: 'santostasi',
    sigma: 0.3,
    scenarioMode: 'cyclical',

    // Dynamic SWR thresholds (for Navigation Fund active drawdown)
    swrHighMultiple: 2.0,         // above: withdraw more
    swrLowMultiple: 0.5,          // below: withdraw less
    swrNormalRate: 0.04,          // 4% base
    swrHighRate: 0.06,            // 6% in euphoria
    swrLowRate: 0.01,             // 1% in deep bear
  };


  // ── Forever Half Safe Withdrawal Rate ───────────────────────
  // SWR = 25% × E[return], where E[return] = β / (t_years × ln(10))
  // t_years = years since Bitcoin genesis (Jan 3, 2009)
  // This rate naturally decreases as BTC matures:
  //   2030 (t≈21.5): SWR ≈ 2.87%
  //   2040 (t≈31.5): SWR ≈ 1.96%
  //   2050 (t≈41.5): SWR ≈ 1.49%
  function foreverSWR(year) {
    var date = new Date(year, 6, 1); // mid-year
    var tYears = PL.yearsSinceGenesis(date);
    if (tYears <= 0) return 0.03; // safety guard
    var beta = PL.MODELS['santostasi'].beta; // 5.688
    var expectedReturn = beta / (tYears * Math.LN10);
    return 0.25 * expectedReturn;
  }


  // ── Storm Period Calculation ────────────────────────────────
  // Find the year when the Forever Half becomes "inexhaustible":
  // annualBurn / foreverValue < foreverSWR(year)
  // The threshold is dynamic — derived from the power law expected return
  function computeStormPeriod(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear,
      maxProjectionYears, initialK
    } = params;

    const foreverBTC = totalBTC * (1 - bridgeSplitPct);

    if (foreverBTC <= 0) {
      return { stormYears: Infinity, stormEndYear: null, foreverValueAtEnd: 0 };
    }

    for (let i = 0; i <= maxProjectionYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1);
      const effectiveK = R.resolveScenarioK(scenarioMode, i, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const foreverValue = foreverBTC * price;
      const inflatedBurn = annualBurnUSD * Math.pow(1 + spendingGrowthRate, i);
      const threshold = foreverSWR(year);
      const ratio = inflatedBurn / foreverValue;

      if (ratio < threshold) {
        return {
          stormYears: i,
          stormEndYear: year,
          foreverValueAtEnd: foreverValue,
          burnAtEnd: inflatedBurn,
          ratioAtEnd: ratio,
          swrAtEnd: threshold
        };
      }
    }

    return {
      stormYears: Infinity,
      stormEndYear: null,
      foreverValueAtEnd: 0,
      burnAtEnd: 0,
      ratioAtEnd: 1
    };
  }


  // ── Dynamic Safe Withdrawal Rate ───────────────────────────
  // Returns withdrawal rate based on price vs. trend
  // Three zones with linear interpolation between them
  function dynamicSWR(price, trendPrice, params) {
    const {
      swrHighMultiple, swrLowMultiple,
      swrNormalRate, swrHighRate, swrLowRate
    } = params;

    if (trendPrice <= 0) return swrNormalRate;
    const multiple = price / trendPrice;

    if (multiple >= swrHighMultiple) {
      return swrHighRate;
    }
    if (multiple <= swrLowMultiple) {
      return swrLowRate;
    }

    // Linear interpolation in two segments
    if (multiple >= 1.0) {
      // Between fair value (1.0) and high multiple
      const t = (multiple - 1.0) / (swrHighMultiple - 1.0);
      return swrNormalRate + t * (swrHighRate - swrNormalRate);
    } else {
      // Between low multiple and fair value (1.0)
      const t = (multiple - swrLowMultiple) / (1.0 - swrLowMultiple);
      return swrLowRate + t * (swrNormalRate - swrLowRate);
    }
  }


  // ── Navigation Fund Simulation ──────────────────────────────
  // Year-by-year simulation of the Navigation Fund with dynamic SWR
  // Pure BTC drawdown — sell to meet living expenses, survive the storm
  function simulateBridge(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear,
      maxProjectionYears, initialK
    } = params;

    let bridgeBTC = totalBTC * bridgeSplitPct;
    let annualBurn = annualBurnUSD;

    const storm = computeStormPeriod(params);
    const simYears = storm.stormYears === Infinity
      ? maxProjectionYears
      : Math.max(storm.stormYears + 5, 30);

    const results = [];
    let ruinYear = null;

    for (let i = 0; i < simYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1);
      const effectiveK = R.resolveScenarioK(scenarioMode, i, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const trend = PL.trendPrice(model, date);
      const multiple = price / trend;

      // Dynamic SWR on navigation fund value
      const bridgeValue = bridgeBTC * price;
      const swrRate = dynamicSWR(price, trend, params);
      const targetWithdrawal = Math.min(bridgeValue * swrRate, annualBurn);

      let btcSold = 0;
      let actualWithdrawal = 0;
      let yearStatus = 'OK';

      if (targetWithdrawal > 0 && bridgeBTC > 0) {
        const btcNeeded = targetWithdrawal / price;

        if (btcNeeded >= bridgeBTC) {
          // Ruin — not enough BTC
          btcSold = bridgeBTC;
          actualWithdrawal = bridgeBTC * price;
          bridgeBTC = 0;
          ruinYear = year;
          yearStatus = 'RUIN';
        } else {
          btcSold = btcNeeded;
          bridgeBTC -= btcNeeded;
          actualWithdrawal = targetWithdrawal;
          yearStatus = multiple >= 1.0 ? 'SELLING' : 'FORCED_SELL';
        }
      }

      results.push({
        year,
        yearIndex: i,
        price,
        trend,
        multiple,
        effectiveK,
        swrRate,
        annualBurn,
        targetWithdrawal,
        actualWithdrawal,
        btcSold,
        bridgeBTC,
        bridgeValueUSD: bridgeBTC * price,
        status: yearStatus
      });

      if (ruinYear) {
        // Fill remaining years
        for (let j = i + 1; j < simYears; j++) {
          results.push({
            year: retirementYear + j,
            yearIndex: j,
            price: 0, trend: 0, multiple: 0, effectiveK: 0,
            swrRate: 0, annualBurn: 0, targetWithdrawal: 0,
            actualWithdrawal: 0, btcSold: 0,
            bridgeBTC: 0, bridgeValueUSD: 0, status: 'RUIN'
          });
        }
        break;
      }

      // Inflate burn for next year
      annualBurn *= (1 + spendingGrowthRate);
    }

    return {
      results,
      ruinYear,
      stormPeriod: storm,
      bridgeSurvivesStorm: !ruinYear || ruinYear > (storm.stormEndYear || Infinity)
    };
  }


  // ── Forever Half Projection ────────────────────────────────
  // Simple projection showing forever half value vs annual burn
  // Uses foreverSWR(year) for the inexhaustibility threshold
  function simulateForever(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear, maxProjectionYears,
      initialK
    } = params;

    const foreverBTC = totalBTC * (1 - bridgeSplitPct);
    const results = [];
    let inexhaustibleYear = null;

    for (let i = 0; i <= maxProjectionYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1);
      const effectiveK = R.resolveScenarioK(scenarioMode, i, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const foreverValue = foreverBTC * price;
      const inflatedBurn = annualBurnUSD * Math.pow(1 + spendingGrowthRate, i);
      const threshold = foreverSWR(year);
      const ratio = inflatedBurn / foreverValue;
      const safeWithdrawal = foreverValue * threshold;

      if (ratio < threshold && inexhaustibleYear === null) {
        inexhaustibleYear = year;
      }

      results.push({
        year,
        yearIndex: i,
        price,
        foreverBTC,
        foreverValueUSD: foreverValue,
        annualBurn: inflatedBurn,
        burnToValueRatio: ratio,
        safeWithdrawal,
        foreverSWRRate: threshold,
        isInexhaustible: ratio < threshold
      });
    }

    return { results, inexhaustibleYear, foreverBTC };
  }


  // ── End Result Mode: Accumulation Simulation ───────────────
  // Stack more BTC for N years, then compute Navigation/Forever outcome
  function simulateEndResult(params) {
    const {
      totalBTC, monthlyDCAUSD, additionalYears, incomeGrowthRate,
      model, sigma, scenarioMode, initialK
    } = params;

    const currentYear = new Date().getFullYear();
    let accumulatedBTC = totalBTC;
    let monthlyDCA = monthlyDCAUSD;
    const accumResults = [];

    for (let i = 0; i < additionalYears; i++) {
      const year = currentYear + i;

      for (let m = 0; m < 12; m++) {
        const date = new Date(year, m, 15);
        const yearFrac = i + m / 12;
        const effectiveK = R.resolveScenarioK(scenarioMode, yearFrac, initialK);
        const price = R.scenarioPrice(model, date, sigma, effectiveK);

        if (price > 0) {
          const btcBought = monthlyDCA / price;
          accumulatedBTC += btcBought;
        }
      }

      const yearEndDate = new Date(year, 11, 31);
      const yearEndK = R.resolveScenarioK(scenarioMode, i + 1, initialK);
      const yearEndPrice = R.scenarioPrice(model, yearEndDate, sigma, yearEndK);

      accumResults.push({
        year,
        yearIndex: i,
        totalBTC: accumulatedBTC,
        btcPrice: yearEndPrice,
        portfolioValueUSD: accumulatedBTC * yearEndPrice,
        monthlyDCA
      });

      // Income growth → DCA growth
      monthlyDCA *= (1 + incomeGrowthRate);
    }

    // Now run Navigation/Forever from retirement year
    const retirementYear = currentYear + additionalYears;
    const retirementParams = {
      ...params,
      totalBTC: accumulatedBTC,
      retirementYear
    };

    const bridgeResult = simulateBridge(retirementParams);
    const foreverResult = simulateForever(retirementParams);

    return {
      accumulationPhase: accumResults,
      finalBTC: accumulatedBTC,
      retirementYear,
      bridgeResult,
      foreverResult
    };
  }


  // ── Find Minimum Total BTC ─────────────────────────────────
  // Binary search: smallest totalBTC where navigation fund survives storm
  function findMinimumTotal(baseParams) {
    let lo = 0.001;
    let hi = 100;

    const testHigh = simulateBridge({ ...baseParams, totalBTC: hi });
    if (!testHigh.bridgeSurvivesStorm) {
      hi = 1000;
      const testHigher = simulateBridge({ ...baseParams, totalBTC: hi });
      if (!testHigher.bridgeSurvivesStorm) {
        return { minTotal: Infinity, minBridge: Infinity, minForever: Infinity };
      }
    }

    let iterations = 0;
    while (hi - lo > 0.001 && iterations < 50) {
      const mid = (lo + hi) / 2;
      const result = simulateBridge({ ...baseParams, totalBTC: mid });
      if (!result.bridgeSurvivesStorm) {
        lo = mid;
      } else {
        hi = mid;
      }
      iterations++;
    }

    return {
      minTotal: hi,
      minBridge: hi * baseParams.bridgeSplitPct,
      minForever: hi * (1 - baseParams.bridgeSplitPct)
    };
  }


  // ── Find Maximum Safe Burn ─────────────────────────────────
  // Binary search: highest annual burn where navigation fund survives storm
  function findMaxBurn(baseParams) {
    let lo = 1000;
    let hi = baseParams.annualBurnUSD;

    const testCurrent = simulateBridge(baseParams);
    if (testCurrent.bridgeSurvivesStorm) {
      return { maxBurn: hi, alreadySafe: true };
    }

    let iterations = 0;
    while (hi - lo > 500 && iterations < 30) {
      const mid = Math.round((lo + hi) / 2);
      const result = simulateBridge({ ...baseParams, annualBurnUSD: mid });
      if (result.bridgeSurvivesStorm) {
        lo = mid;
      } else {
        hi = mid;
      }
      iterations++;
    }

    return { maxBurn: lo, alreadySafe: false };
  }


  // ── Navigation Fund Summary Stats ───────────────────────────
  function bridgeSummary(bridgeResult) {
    const r = bridgeResult.results.filter(y => y.status !== 'RUIN');
    if (r.length === 0) return null;

    const totalBTCSold = r.reduce((s, y) => s + y.btcSold, 0);
    const totalWithdrawn = r.reduce((s, y) => s + y.actualWithdrawal, 0);
    const avgSWR = r.reduce((s, y) => s + y.swrRate, 0) / r.length;

    return {
      yearsBeforeRuin: r.length,
      totalBTCSold,
      totalWithdrawn,
      avgSWR,
      finalBridgeBTC: r[r.length - 1].bridgeBTC,
      finalBridgeValue: r[r.length - 1].bridgeValueUSD,
      bridgeSurvivesStorm: bridgeResult.bridgeSurvivesStorm
    };
  }


  // ── Compare All Scenarios ──────────────────────────────────
  function compareScenarios(baseParams) {
    const scenarios = [
      { label: 'Smooth Trend', mode: 'smooth_trend' },
      { label: 'Bear (flat −1σ)', mode: 'smooth_bear' },
      { label: 'Deep Bear (flat −2σ)', mode: 'smooth_deep_bear' },
      { label: 'Cyclical (±1σ)', mode: 'cyclical' },
      { label: 'Bear Bias Cycles', mode: 'cyclical_bear' }
    ];

    return scenarios.map(s => {
      const p = { ...baseParams, scenarioMode: s.mode };
      const storm = computeStormPeriod(p);
      const bridge = simulateBridge(p);
      const summary = bridgeSummary(bridge);
      const min = findMinimumTotal(p);

      return {
        scenario: s.label,
        mode: s.mode,
        stormYears: storm.stormYears,
        bridgeSurvives: bridge.bridgeSurvivesStorm,
        ruinYear: bridge.ruinYear,
        minTotal: min.minTotal,
        summary
      };
    });
  }


  // ── Side-by-Side: Freedom Now vs End Result ────────────────
  // Compare retiring now vs stacking X more years
  function sideBySide(baseParams) {
    // Freedom Now: retire immediately
    const freedomParams = { ...baseParams, mode: 'freedom_now' };
    const freedomBridge = simulateBridge(freedomParams);
    const freedomForever = simulateForever(freedomParams);
    const freedomSummary = bridgeSummary(freedomBridge);
    const freedomStorm = computeStormPeriod(freedomParams);

    // End Result: stack for additionalYears, then retire
    const endResultParams = { ...baseParams, mode: 'end_result' };
    const endResult = simulateEndResult(endResultParams);
    const endSummary = bridgeSummary(endResult.bridgeResult);
    const endStorm = endResult.bridgeResult.stormPeriod;

    // Compare at year 30 into retirement for both paths
    const freedomForeverAt30 = freedomForever.results.find(r => r.yearIndex === 30) || freedomForever.results[freedomForever.results.length - 1];
    const endForeverAt30 = endResult.foreverResult.results.find(r => r.yearIndex === 30) || endResult.foreverResult.results[endResult.foreverResult.results.length - 1];

    return {
      freedom: {
        totalBTC: freedomParams.totalBTC,
        retirementYear: freedomParams.retirementYear,
        stormYears: freedomStorm.stormYears,
        bridgeSurvives: freedomBridge.bridgeSurvivesStorm,
        ruinYear: freedomBridge.ruinYear,
        yearsOfFreedom: baseParams.additionalYears,
        totalWithdrawn: freedomSummary ? freedomSummary.totalWithdrawn : 0,
        foreverValueAt30: freedomForeverAt30 ? freedomForeverAt30.foreverValueUSD : 0,
        avgSWR: freedomSummary ? freedomSummary.avgSWR : 0
      },
      endResult: {
        totalBTC: endResult.finalBTC,
        retirementYear: endResult.retirementYear,
        stormYears: endStorm.stormYears,
        bridgeSurvives: endResult.bridgeResult.bridgeSurvivesStorm,
        ruinYear: endResult.bridgeResult.ruinYear,
        yearsWorking: baseParams.additionalYears,
        totalWithdrawn: endSummary ? endSummary.totalWithdrawn : 0,
        foreverValueAt30: endForeverAt30 ? endForeverAt30.foreverValueUSD : 0,
        avgSWR: endSummary ? endSummary.avgSWR : 0
      },
      additionalBTC: endResult.finalBTC - freedomParams.totalBTC,
      freedomYearsGained: baseParams.additionalYears
    };
  }


  // ── Monte Carlo Simulation ────────────────────────────────
  // Run N random simulations with log-normal returns around the power law trend
  // Prices clamped at -2σ (power law absolute floor — never breached historically)
  // Returns percentile bands for navigation fund survival
  function monteCarloSurvival(baseParams, numSims) {
    numSims = numSims || 200;
    const years = baseParams.maxProjectionYears || 50;
    const results = [];
    const sigma = baseParams.sigma;

    for (let sim = 0; sim < numSims; sim++) {
      let bridgeBTC = baseParams.totalBTC * baseParams.bridgeSplitPct;
      let annualBurn = baseParams.annualBurnUSD;
      let ruinYear = null;

      const yearlyBTC = [];

      for (let i = 0; i < years; i++) {
        if (ruinYear) { yearlyBTC.push(0); continue; }

        const year = baseParams.retirementYear + i;
        const date = new Date(year, 6, 1);
        const trend = PL.trendPrice(baseParams.model, date);

        // Random log-normal perturbation: log10(price) = log10(trend) + N(0, σ)
        // Clamped at -2σ: the power law absolute floor (never breached in BTC history)
        var logNoise = gaussianRandom() * sigma;
        logNoise = Math.max(logNoise, -2 * sigma);
        const price = trend * Math.pow(10, logNoise);

        // Dynamic SWR
        const btcValue = bridgeBTC * price;
        const swrRate = dynamicSWR(price, trend, baseParams);
        const target = Math.min(btcValue * swrRate, annualBurn);

        // Sell BTC to meet target
        if (target > 0 && bridgeBTC > 0) {
          const btcNeeded = target / price;
          if (btcNeeded >= bridgeBTC) {
            bridgeBTC = 0;
            ruinYear = year;
          } else {
            bridgeBTC -= btcNeeded;
          }
        }

        yearlyBTC.push(bridgeBTC);
        annualBurn *= (1 + baseParams.spendingGrowthRate);
      }

      results.push({
        ruinYear,
        yearlyBTC,
        survived: !ruinYear || ruinYear >= baseParams.retirementYear + years
      });
    }

    // Compute survival probability and percentile bands
    const stormPeriod = computeStormPeriod(baseParams);
    const stormYears = stormPeriod.stormYears === Infinity ? years : stormPeriod.stormYears;

    const survivalCount = results.filter(r =>
      !r.ruinYear || r.ruinYear > baseParams.retirementYear + stormYears
    ).length;

    // Navigation fund BTC percentiles at each year
    const percentileBands = [];
    for (let i = 0; i < years; i++) {
      const vals = results.map(r => r.yearlyBTC[i]).sort((a, b) => a - b);
      percentileBands.push({
        year: baseParams.retirementYear + i,
        p10: vals[Math.floor(numSims * 0.10)] || 0,
        p25: vals[Math.floor(numSims * 0.25)] || 0,
        p50: vals[Math.floor(numSims * 0.50)] || 0,
        p75: vals[Math.floor(numSims * 0.75)] || 0,
        p90: vals[Math.floor(numSims * 0.90)] || 0
      });
    }

    // Ruin year distribution
    const ruinYears = results.filter(r => r.ruinYear).map(r => r.ruinYear);
    const medianRuin = ruinYears.length > 0
      ? ruinYears.sort((a, b) => a - b)[Math.floor(ruinYears.length / 2)]
      : null;

    return {
      numSims,
      survivalProbability: survivalCount / numSims,
      stormYears,
      percentileBands,
      medianRuinYear: medianRuin,
      ruinCount: ruinYears.length,
      survivalCount
    };
  }

  // Box-Muller transform for gaussian random numbers
  function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }


  // ── Export ───────────────────────────────────────────────────
  window.RetirementV2 = {
    DEFAULTS,
    foreverSWR,
    computeStormPeriod,
    dynamicSWR,
    simulateBridge,
    simulateForever,
    simulateEndResult,
    findMinimumTotal,
    findMaxBurn,
    bridgeSummary,
    compareScenarios,
    sideBySide,
    monteCarloSurvival
  };

})();
