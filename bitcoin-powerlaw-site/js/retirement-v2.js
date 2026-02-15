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
    sigma: PL.MODELS['santostasi'].sigma,
    scenarioMode: 'cyclical',

    // Dynamic SWR thresholds (for Navigation Fund active drawdown)
    swrHighMultiple: 2.0,         // above: withdraw more
    swrLowMultiple: 0.5,          // below: withdraw less
    swrNormalRate: 0.04,          // 4% base
    swrHighRate: 0.06,            // 6% in euphoria
    swrLowRate: 0.01,             // 1% in deep bear

    // BTC-backed loans (active when price < trend)
    loanLTV: 0.50,                // max 50% loan-to-value ratio
    loanInterestRate: 0.05,       // 5% annual interest on outstanding debt

    // Monte Carlo power law support floor
    supportFloorMultiple: 0.45,   // price never drops below 0.45× trend (power law support)
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
  // Year-by-year simulation with dynamic SWR + BTC-backed loans
  // Below trend (multiple < 1.0): borrow against BTC instead of selling at a loss
  // Above trend (multiple ≥ 1.0): sell BTC for expenses + repay outstanding debt
  function simulateBridge(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear,
      maxProjectionYears, initialK, loanLTV, loanInterestRate
    } = params;

    let bridgeBTC = totalBTC * bridgeSplitPct;
    let annualBurn = annualBurnUSD;
    let debt = 0;  // outstanding loan balance

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

      const bridgeValue = bridgeBTC * price;
      const swrRate = dynamicSWR(price, trend, params);

      // 1. Accrue interest on existing debt
      debt *= (1 + loanInterestRate);

      // 2. Check liquidation: debt exceeds collateral capacity
      if (debt > bridgeValue * loanLTV && bridgeBTC > 0) {
        // Liquidation — all BTC seized
        results.push({
          year, yearIndex: i, price, trend, multiple, effectiveK, swrRate,
          annualBurn, targetWithdrawal: 0, actualWithdrawal: 0,
          btcSold: bridgeBTC, bridgeBTC: 0, bridgeValueUSD: 0,
          debt: debt, loanThisYear: 0, repaidThisYear: 0, status: 'RUIN'
        });
        bridgeBTC = 0;
        ruinYear = year;
        // Fill remaining years
        for (let j = i + 1; j < simYears; j++) {
          results.push({
            year: retirementYear + j, yearIndex: j,
            price: 0, trend: 0, multiple: 0, effectiveK: 0,
            swrRate: 0, annualBurn: 0, targetWithdrawal: 0,
            actualWithdrawal: 0, btcSold: 0,
            bridgeBTC: 0, bridgeValueUSD: 0,
            debt: 0, loanThisYear: 0, repaidThisYear: 0, status: 'RUIN'
          });
        }
        break;
      }

      let btcSold = 0;
      let actualWithdrawal = 0;
      let loanThisYear = 0;
      let repaidThisYear = 0;
      let yearStatus = 'OK';

      if (bridgeBTC <= 0) {
        ruinYear = year;
        yearStatus = 'RUIN';
      } else if (multiple < 1.0) {
        // ── BELOW TREND: Borrow instead of sell ──
        const maxLoanCapacity = bridgeValue * loanLTV - debt;

        if (annualBurn <= maxLoanCapacity) {
          // Can borrow — take loan for living expenses
          debt += annualBurn;
          loanThisYear = annualBurn;
          actualWithdrawal = annualBurn;
          yearStatus = 'BORROW';
        } else {
          // Loan capacity exceeded — forced sell
          const targetWithdrawal = Math.max(bridgeValue * swrRate, annualBurn);
          const btcNeeded = targetWithdrawal / price;
          if (btcNeeded >= bridgeBTC) {
            btcSold = bridgeBTC;
            actualWithdrawal = bridgeBTC * price;
            bridgeBTC = 0;
            ruinYear = year;
            yearStatus = 'RUIN';
          } else {
            btcSold = btcNeeded;
            bridgeBTC -= btcNeeded;
            actualWithdrawal = targetWithdrawal;
            yearStatus = 'FORCED_SELL';
          }
        }
      } else {
        // ── ABOVE TREND: Sell BTC + repay debt ──
        const targetWithdrawal = Math.max(bridgeValue * swrRate, annualBurn);
        const btcForExpenses = targetWithdrawal / price;

        if (btcForExpenses >= bridgeBTC) {
          btcSold = bridgeBTC;
          actualWithdrawal = bridgeBTC * price;
          bridgeBTC = 0;
          ruinYear = year;
          yearStatus = 'RUIN';
        } else {
          btcSold = btcForExpenses;
          bridgeBTC -= btcForExpenses;
          actualWithdrawal = targetWithdrawal;

          // Repay outstanding debt with additional BTC sales
          if (debt > 0) {
            const btcForDebt = debt / price;
            const availableForDebt = bridgeBTC * 0.5; // don't sell more than half remaining
            const btcRepay = Math.min(btcForDebt, availableForDebt);
            repaidThisYear = btcRepay * price;
            debt -= repaidThisYear;
            if (debt < 0.01) debt = 0; // clean up rounding
            btcSold += btcRepay;
            bridgeBTC -= btcRepay;
            yearStatus = 'REPAYING';
          } else {
            yearStatus = 'SELLING';
          }
        }
      }

      results.push({
        year, yearIndex: i, price, trend, multiple, effectiveK, swrRate,
        annualBurn,
        targetWithdrawal: actualWithdrawal,
        actualWithdrawal,
        btcSold,
        bridgeBTC,
        bridgeValueUSD: bridgeBTC * price,
        debt,
        loanThisYear,
        repaidThisYear,
        status: yearStatus
      });

      if (ruinYear) {
        // Fill remaining years
        for (let j = i + 1; j < simYears; j++) {
          results.push({
            year: retirementYear + j, yearIndex: j,
            price: 0, trend: 0, multiple: 0, effectiveK: 0,
            swrRate: 0, annualBurn: 0, targetWithdrawal: 0,
            actualWithdrawal: 0, btcSold: 0,
            bridgeBTC: 0, bridgeValueUSD: 0,
            debt: 0, loanThisYear: 0, repaidThisYear: 0, status: 'RUIN'
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


  // ── Find Optimal Split ──────────────────────────────────────
  // Grid search: which bridgeSplitPct gives shortest storm while surviving?
  function findOptimalSplit(baseParams) {
    let bestSplit = null;
    let bestStorm = Infinity;
    const allResults = [];

    for (let pct = 10; pct <= 90; pct += 5) {
      const splitPct = pct / 100;
      const p = { ...baseParams, bridgeSplitPct: splitPct };
      const result = simulateBridge(p);
      const entry = {
        splitPct,
        survives: result.bridgeSurvivesStorm,
        stormYears: result.stormPeriod.stormYears,
        ruinYear: result.ruinYear
      };
      allResults.push(entry);

      if (result.bridgeSurvivesStorm && result.stormPeriod.stormYears < bestStorm) {
        bestStorm = result.stormPeriod.stormYears;
        bestSplit = splitPct;
      }
    }

    return { bestSplit, bestStormYears: bestStorm, allResults };
  }


  // ── Find Earliest Viable Retirement Year ────────────────────
  // Binary search: what's the earliest year where ANY split survives?
  function findEarliestRetirement(baseParams) {
    const currentYear = new Date().getFullYear();
    let lo = currentYear;
    let hi = currentYear + 30;

    // Check if even the latest year works
    const latestResult = findOptimalSplit({ ...baseParams, retirementYear: hi });
    if (!latestResult.bestSplit) {
      return { year: null, impossible: true };
    }

    // Binary search
    for (let iter = 0; iter < 20; iter++) {
      const mid = Math.round((lo + hi) / 2);
      const result = findOptimalSplit({ ...baseParams, retirementYear: mid });
      if (result.bestSplit) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
      if (lo >= hi) break;
    }

    return { year: hi, impossible: false };
  }


  // ── Auto-Optimize Plan ──────────────────────────────────────
  // Main entry point: given BTC + burn + year, find best plan or give fixes
  function optimizePlan(baseParams) {
    const optimal = findOptimalSplit(baseParams);

    if (optimal.bestSplit) {
      // SUCCESS: found a surviving split
      const bestParams = { ...baseParams, bridgeSplitPct: optimal.bestSplit };
      const bridgeResult = simulateBridge(bestParams);
      const foreverResult = simulateForever(bestParams);
      return {
        status: 'OK',
        bestSplit: optimal.bestSplit,
        stormYears: optimal.bestStormYears,
        params: bestParams,
        bridgeResult,
        foreverResult,
        allSplits: optimal.allResults
      };
    }

    // BUST: no split survives — compute fixes
    // Use split=50% as baseline for fix calculations
    const fixParams = { ...baseParams, bridgeSplitPct: 0.50 };
    const minStack = findMinimumTotal(fixParams);
    const maxBurn = findMaxBurn(fixParams);
    const earliestYear = findEarliestRetirement(baseParams);

    // Also run the simulation at 50% so we can still show charts
    const fallbackResult = simulateBridge(fixParams);
    const fallbackForever = simulateForever(fixParams);

    return {
      status: 'BUST',
      bestSplit: 0.50,
      params: fixParams,
      bridgeResult: fallbackResult,
      foreverResult: fallbackForever,
      allSplits: optimal.allResults,
      fixes: {
        minTotalBTC: minStack.minTotal,
        additionalBTC: minStack.minTotal - baseParams.totalBTC,
        maxBurnUSD: maxBurn.maxBurn,
        earliestYear: earliestYear.year,
        yearDelay: earliestYear.year ? earliestYear.year - baseParams.retirementYear : null
      }
    };
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
    const scenarios = PL.SCENARIO_MODES;

    return scenarios.map(s => {
      const p = { ...baseParams, scenarioMode: s.id };
      const storm = computeStormPeriod(p);
      const bridge = simulateBridge(p);
      const summary = bridgeSummary(bridge);
      const min = findMinimumTotal(p);

      return {
        scenario: s.label,
        mode: s.id,
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
  // Includes BTC-backed loan logic: borrow below trend, sell+repay above trend
  // Returns percentile bands for navigation fund survival
  function monteCarloSurvival(baseParams, numSims) {
    numSims = numSims || 200;
    const years = baseParams.maxProjectionYears || 50;
    const results = [];
    const sigma = baseParams.sigma;
    const ltv = baseParams.loanLTV;
    const loanRate = baseParams.loanInterestRate;

    for (let sim = 0; sim < numSims; sim++) {
      let bridgeBTC = baseParams.totalBTC * baseParams.bridgeSplitPct;
      let annualBurn = baseParams.annualBurnUSD;
      let debt = 0;
      let ruinYear = null;

      const yearlyBTC = [];

      for (let i = 0; i < years; i++) {
        if (ruinYear) { yearlyBTC.push(0); continue; }

        const year = baseParams.retirementYear + i;
        const date = new Date(year, 6, 1);
        const trend = PL.trendPrice(baseParams.model, date);

        // Random log-normal perturbation: log10(price) = log10(trend) + N(0, σ)
        // Floor at supportFloorMultiple × trend (power law support — never breached in BTC history)
        var logNoise = gaussianRandom() * sigma;
        const rawPrice = trend * Math.pow(10, logNoise);
        const price = Math.max(rawPrice, trend * baseParams.supportFloorMultiple);

        const btcValue = bridgeBTC * price;
        const multiple = price / trend;
        const swrRate = dynamicSWR(price, trend, baseParams);

        // Accrue interest on existing debt
        debt *= (1 + loanRate);

        // Check liquidation
        if (debt > btcValue * ltv && bridgeBTC > 0) {
          bridgeBTC = 0;
          ruinYear = year;
          yearlyBTC.push(0);
          annualBurn *= (1 + baseParams.spendingGrowthRate);
          continue;
        }

        if (bridgeBTC <= 0) {
          ruinYear = year;
          yearlyBTC.push(0);
          continue;
        }

        if (multiple < 1.0) {
          // Below trend: borrow
          const maxCapacity = btcValue * ltv - debt;
          if (annualBurn <= maxCapacity) {
            debt += annualBurn;
          } else {
            // Forced sell
            const target = Math.max(btcValue * swrRate, annualBurn);
            const btcNeeded = target / price;
            if (btcNeeded >= bridgeBTC) {
              bridgeBTC = 0;
              ruinYear = year;
            } else {
              bridgeBTC -= btcNeeded;
            }
          }
        } else {
          // Above trend: sell + repay
          const target = Math.max(btcValue * swrRate, annualBurn);
          const btcForExpenses = target / price;
          if (btcForExpenses >= bridgeBTC) {
            bridgeBTC = 0;
            ruinYear = year;
          } else {
            bridgeBTC -= btcForExpenses;
            // Repay debt
            if (debt > 0) {
              const btcForDebt = debt / price;
              const availableForDebt = bridgeBTC * 0.5;
              const btcRepay = Math.min(btcForDebt, availableForDebt);
              debt -= btcRepay * price;
              if (debt < 0.01) debt = 0;
              bridgeBTC -= btcRepay;
            }
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


  // ── Lifetime BTC Need ──────────────────────────────────────
  // Core calculation for the redesigned retirement page.
  // For each year from retirement to death:
  //   btcNeeded(i) = inflatedBurn(i) / scenarioPrice(year + i)
  // Groups results into 5-year chunks and classifies storm vs forever.
  function computeLifetimeBTC(params) {
    const {
      currentAge, lifeExpectancy, annualBurn, burnGrowth,
      myStack, model, sigma, scenarioMode, initialK
    } = params;

    const retirementAge = params.retirementAge || currentAge;
    const currentYear = new Date().getFullYear();
    const yearsUntilRetirement = retirementAge - currentAge;
    const totalYears = lifeExpectancy - retirementAge;
    if (totalYears <= 0) return null;

    const annualData = [];
    let stormEndAge = null;

    for (let i = 0; i < totalYears; i++) {
      const age = retirementAge + i;
      // Year offset from today — prices advance into the future
      const yearOffset = yearsUntilRetirement + i;
      const year = currentYear + yearOffset;
      const date = new Date(year, 6, 1);
      const effectiveK = R.resolveScenarioK(scenarioMode, yearOffset, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const trend = PL.trendPrice(model, date);
      // Burn inflates from today, not from retirement
      const burn = annualBurn * Math.pow(1 + burnGrowth, yearOffset);
      const btcNeeded = burn / price;

      // Storm/forever classification: does the user's stack cover remaining needs
      // while keeping withdrawal below the forever SWR threshold?
      const swr = foreverSWR(year);
      const stackValue = myStack * price;
      const ratio = burn / stackValue;
      const isForever = stackValue > 0 && ratio < swr;

      if (isForever && stormEndAge === null) {
        stormEndAge = age;
      }

      annualData.push({
        year, age, burn, price, trend, btcNeeded,
        effectiveK, swr, ratio, isForever
      });
    }

    // Snap stormEndAge to the next 5-year chunk boundary so bars are cleanly
    // storm or forever — no confusing "transition" chunks for the user.
    if (stormEndAge !== null) {
      const yearsIntoRetirement = stormEndAge - retirementAge;
      const snapped = Math.ceil(yearsIntoRetirement / 5) * 5;
      stormEndAge = retirementAge + snapped;
      if (stormEndAge > lifeExpectancy) stormEndAge = lifeExpectancy;
      // Re-classify annual data to match snapped boundary
      annualData.forEach(d => { d.isForever = d.age >= stormEndAge; });
    }

    // Group into 5-year chunks
    const fiveYearData = [];
    for (let i = 0; i < totalYears; i += 5) {
      const chunk = annualData.slice(i, Math.min(i + 5, totalYears));
      const btcNeeded = chunk.reduce((sum, d) => sum + d.btcNeeded, 0);
      const avgBurn = chunk.reduce((sum, d) => sum + d.burn, 0) / chunk.length;
      const startAge = chunk[0].age;
      const endAge = chunk[chunk.length - 1].age;

      // After snapping, chunks are cleanly storm or forever
      const allForever = chunk.every(d => d.isForever);
      const phase = allForever ? 'forever' : 'storm';

      fiveYearData.push({
        startAge, endAge, btcNeeded, avgBurn, phase,
        startYear: chunk[0].year, endYear: chunk[chunk.length - 1].year
      });
    }

    const totalBTC = annualData.reduce((sum, d) => sum + d.btcNeeded, 0);
    const stormData = annualData.filter(d => !d.isForever);
    const foreverData = annualData.filter(d => d.isForever);
    const stormBTC = stormData.reduce((sum, d) => sum + d.btcNeeded, 0);
    const foreverBTC = foreverData.reduce((sum, d) => sum + d.btcNeeded, 0);
    const stormYears = stormEndAge !== null ? stormEndAge - retirementAge : totalYears;

    // Find earliest retirement age: smallest age where stack >= totalBTC(from that age onward)
    let earliestRetirementAge = null;
    for (let startIdx = 0; startIdx < totalYears; startIdx++) {
      const remaining = annualData.slice(startIdx);
      const neededFromHere = remaining.reduce((sum, d) => sum + d.btcNeeded, 0);
      if (myStack >= neededFromHere) {
        earliestRetirementAge = retirementAge + startIdx;
        break;
      }
    }

    // USD value at today's trend price
    const todayTrend = PL.trendPrice(model, new Date());

    return {
      annualData,
      fiveYearData,
      totalBTC,
      stormBTC,
      foreverBTC,
      stormEndAge,
      stormYears,
      earliestRetirementAge,
      todayTrendPrice: todayTrend,
      totalUSDAtTrend: totalBTC * todayTrend,
      canRetireNow: myStack >= totalBTC,
      surplus: myStack - totalBTC
    };
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
    findOptimalSplit,
    findEarliestRetirement,
    optimizePlan,
    bridgeSummary,
    compareScenarios,
    sideBySide,
    monteCarloSurvival,
    computeLifetimeBTC
  };

})();
