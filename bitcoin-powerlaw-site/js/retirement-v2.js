// Bitcoin Retirement Calculator V2 — Bridge/Forever Framework
// Splits stack into Bridge Half (active decumulation) and Forever Half (power law growth)
// Depends on: window.PowerLaw (PL), window.Retirement (R)

(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;

  // ── Default Parameters ──────────────────────────────────────
  const DEFAULTS = {
    // Stack
    totalBTC: 1.0,
    bridgeSplitPct: 0.50,        // 50% bridge, 50% forever

    // Mode
    mode: 'freedom_now',          // 'freedom_now' | 'end_result'

    // Spending (Freedom Now)
    annualBurnUSD: 50000,
    spendingGrowthRate: 0.065,    // 6.5% annual
    floorMonthlyUSD: 2000,        // minimum monthly income floor

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

    // Dynamic SWR thresholds
    swrHighMultiple: 2.0,         // above: withdraw more
    swrLowMultiple: 0.5,          // below: withdraw less
    swrNormalRate: 0.04,          // 4% base
    swrHighRate: 0.06,            // 6% in euphoria
    swrLowRate: 0.01,             // 1% in deep bear

    // Kelly Criterion (Phase 2)
    kellyEnabled: false,
    kellyFraction: 0.5,
    goldReturnRate: 0.075,        // 7.5% expected gold return
    goldVolatility: 0.15,
    initialGoldPct: 0.30,         // 30% of bridge in gold initially

    // Loan Facility (Phase 2)
    loansEnabled: false,
    loanLTV: 0.30,
    loanInterestRate: 0.08,

    // Storm period
    stormThreshold: 0.01,         // inexhaustible when burn < 1% of forever value
  };


  // ── Storm Period Calculation ────────────────────────────────
  // Find the year when the Forever Half becomes "inexhaustible":
  // annualBurn / foreverValue < stormThreshold
  function computeStormPeriod(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear, stormThreshold,
      maxProjectionYears, initialK
    } = params;

    const foreverBTC = totalBTC * (1 - bridgeSplitPct);

    if (foreverBTC <= 0) {
      return { stormYears: Infinity, stormEndYear: null, foreverValueAtEnd: 0 };
    }

    for (let i = 0; i <= maxProjectionYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1); // mid-year
      const effectiveK = R.resolveScenarioK(scenarioMode, i, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const foreverValue = foreverBTC * price;
      const inflatedBurn = annualBurnUSD * Math.pow(1 + spendingGrowthRate, i);
      const ratio = inflatedBurn / foreverValue;

      if (ratio < stormThreshold) {
        return {
          stormYears: i,
          stormEndYear: year,
          foreverValueAtEnd: foreverValue,
          burnAtEnd: inflatedBurn,
          ratioAtEnd: ratio
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


  // ── Kelly Criterion Allocation (Phase 2) ────────────────────
  // Compute optimal BTC/Gold split for bridge half
  function kellyAllocation(yearIndex, params) {
    const {
      model, retirementYear, kellyFraction,
      goldReturnRate, goldVolatility, sigma
    } = params;

    const date = new Date(retirementYear + yearIndex, 0, 1);
    const btcExpectedReturn = R.instantaneousCAGR(model, date);

    // BTC volatility from sigma (annualized log-scale → linear approx)
    // sigma ≈ 0.3 in log10 space → convert to natural log → annualized
    const btcVolatility = sigma * Math.log(10); // ~0.69

    const riskFree = 0.04; // rough risk-free rate

    // Kelly fraction for BTC: f* = (E[r] - rf) / σ²
    const rawKellyBTC = (btcExpectedReturn - riskFree) / (btcVolatility * btcVolatility);
    const kellyBTC = Math.max(0, Math.min(1, rawKellyBTC * kellyFraction));

    // Kelly fraction for gold
    const rawKellyGold = (goldReturnRate - riskFree) / (goldVolatility * goldVolatility);
    const kellyGold = Math.max(0, Math.min(1, rawKellyGold * kellyFraction));

    // Normalize so they sum to 1
    const total = kellyBTC + kellyGold;
    if (total <= 0) return { btcPct: 0.5, goldPct: 0.5 };

    return {
      btcPct: kellyBTC / total,
      goldPct: kellyGold / total
    };
  }


  // ── Bridge Half Simulation ─────────────────────────────────
  // Year-by-year simulation of the Bridge Half with dynamic SWR
  // Phase 1: BTC only with dynamic SWR
  // Phase 2: + Gold allocation (Kelly) + Loan facility
  function simulateBridge(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      floorMonthlyUSD, model, sigma, scenarioMode, retirementYear,
      maxProjectionYears, initialK,
      kellyEnabled, initialGoldPct, goldReturnRate,
      loansEnabled, loanLTV, loanInterestRate
    } = params;

    let bridgeBTC = totalBTC * bridgeSplitPct;
    let bridgeGoldUSD = 0;
    let loanBalance = 0;
    let totalInterestPaid = 0;
    let annualBurn = annualBurnUSD;
    const floorAnnual = floorMonthlyUSD * 12;

    // Phase 2: Initialize gold allocation from bridge value
    if (kellyEnabled && initialGoldPct > 0) {
      const startDate = new Date(retirementYear, 6, 1);
      const effectiveK0 = R.resolveScenarioK(scenarioMode, 0, initialK);
      const startPrice = R.scenarioPrice(model, startDate, sigma, effectiveK0);
      const bridgeValueUSD = bridgeBTC * startPrice;
      const goldValueTarget = bridgeValueUSD * initialGoldPct;
      // Sell some BTC to buy gold
      const btcToSell = goldValueTarget / startPrice;
      if (btcToSell < bridgeBTC) {
        bridgeBTC -= btcToSell;
        bridgeGoldUSD = goldValueTarget;
      }
    }

    const storm = computeStormPeriod(params);
    const simYears = storm.stormYears === Infinity
      ? maxProjectionYears
      : Math.max(storm.stormYears + 5, 30); // simulate past storm + 5 year buffer

    const results = [];
    let ruinYear = null;

    for (let i = 0; i < simYears; i++) {
      const year = retirementYear + i;
      const date = new Date(year, 6, 1);
      const effectiveK = R.resolveScenarioK(scenarioMode, i, initialK);
      const price = R.scenarioPrice(model, date, sigma, effectiveK);
      const trend = PL.trendPrice(model, date);
      const multiple = price / trend;

      // Phase 2: Grow gold balance
      if (kellyEnabled && bridgeGoldUSD > 0) {
        bridgeGoldUSD *= (1 + goldReturnRate);
      }

      // Phase 2: Accrue loan interest
      if (loansEnabled && loanBalance > 0) {
        const interest = loanBalance * loanInterestRate;
        loanBalance += interest;
        totalInterestPaid += interest;
      }

      // Dynamic SWR on total bridge value
      const btcValueUSD = bridgeBTC * price;
      const totalBridgeValue = btcValueUSD + bridgeGoldUSD - loanBalance;
      const swrRate = dynamicSWR(price, trend, params);
      let targetWithdrawal = Math.max(totalBridgeValue * swrRate, floorAnnual);
      // Don't withdraw more than the burn
      targetWithdrawal = Math.min(targetWithdrawal, annualBurn);
      // But ensure at least the floor
      targetWithdrawal = Math.max(targetWithdrawal, Math.min(floorAnnual, annualBurn));

      let actualWithdrawal = 0;
      let btcSold = 0;
      let goldSold = 0;
      let borrowed = 0;
      let yearStatus = 'OK';

      // Withdrawal logic:
      // 1. If Kelly enabled and gold available: sell gold first when BTC is undervalued
      // 2. If loans enabled and BTC undervalued: borrow instead of selling BTC
      // 3. Otherwise: sell BTC

      const remaining = targetWithdrawal;

      if (kellyEnabled && bridgeGoldUSD > 0 && multiple < 1.0) {
        // BTC undervalued: sell gold first
        const goldToSell = Math.min(bridgeGoldUSD, remaining);
        bridgeGoldUSD -= goldToSell;
        goldSold = goldToSell;
        actualWithdrawal += goldToSell;
      }

      if (actualWithdrawal < targetWithdrawal && loansEnabled && multiple < 1.0) {
        // Still need more, try to borrow
        const cashNeeded = targetWithdrawal - actualWithdrawal;
        const maxBorrow = Math.max(0, (bridgeBTC * price * loanLTV) - loanBalance);
        const toBorrow = Math.min(cashNeeded, maxBorrow);
        if (toBorrow > 0) {
          loanBalance += toBorrow;
          borrowed = toBorrow;
          actualWithdrawal += toBorrow;
          yearStatus = 'BORROWING';
        }
      }

      if (actualWithdrawal < targetWithdrawal) {
        // Sell BTC for the rest
        const cashNeeded = targetWithdrawal - actualWithdrawal;
        const btcNeeded = cashNeeded / price;

        if (btcNeeded >= bridgeBTC) {
          // Ruin
          btcSold = bridgeBTC;
          actualWithdrawal += bridgeBTC * price;
          bridgeBTC = 0;
          ruinYear = year;
          yearStatus = 'RUIN';
        } else {
          btcSold = btcNeeded;
          bridgeBTC -= btcNeeded;
          actualWithdrawal += cashNeeded;
          if (yearStatus === 'OK') {
            yearStatus = multiple >= 1.0 ? 'SELLING' : 'FORCED_SELL';
          }
        }
      }

      // Phase 2: Repay loans when overvalued and have surplus
      if (loansEnabled && loanBalance > 0 && multiple > 1.5 && bridgeBTC > 0) {
        const surplusForRepay = btcValueUSD * 0.1; // repay with 10% of BTC value
        const repayAmount = Math.min(loanBalance, surplusForRepay);
        const btcForRepay = repayAmount / price;
        if (btcForRepay < bridgeBTC) {
          bridgeBTC -= btcForRepay;
          loanBalance -= repayAmount;
          yearStatus = 'SELL_AND_REPAY';
        }
      }

      // Phase 2: Kelly rebalance (annually)
      if (kellyEnabled && bridgeBTC > 0 && !ruinYear) {
        const kelly = kellyAllocation(i, params);
        const currentBTCValue = bridgeBTC * price;
        const currentTotal = currentBTCValue + bridgeGoldUSD;
        if (currentTotal > 0) {
          const targetBTCValue = currentTotal * kelly.btcPct;
          const targetGoldValue = currentTotal * kelly.goldPct;
          const diff = targetBTCValue - currentBTCValue;
          // Only rebalance if off by more than 10%
          if (Math.abs(diff) > currentTotal * 0.10) {
            if (diff > 0 && bridgeGoldUSD > 0) {
              // Buy BTC, sell gold
              const transfer = Math.min(diff, bridgeGoldUSD);
              bridgeGoldUSD -= transfer;
              bridgeBTC += transfer / price;
            } else if (diff < 0 && bridgeBTC > 0) {
              // Sell BTC, buy gold
              const transfer = Math.min(-diff, currentBTCValue * 0.5); // cap at 50% of BTC
              bridgeBTC -= transfer / price;
              bridgeGoldUSD += transfer;
            }
          }
        }
      }

      // Liquidation check
      let liquidationPrice = 0;
      let isLiquidationRisk = false;
      if (loanBalance > 0 && bridgeBTC > 0) {
        liquidationPrice = loanBalance / (bridgeBTC * loanLTV);
        isLiquidationRisk = price < liquidationPrice * 1.2;
      }

      const portfolioValue = (bridgeBTC * price) + bridgeGoldUSD - loanBalance;

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
        goldSold,
        borrowed,
        loanBalance,
        liquidationPrice,
        isLiquidationRisk,
        bridgeBTC,
        bridgeGoldUSD,
        bridgeValueUSD: portfolioValue,
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
            actualWithdrawal: 0, btcSold: 0, goldSold: 0,
            borrowed: 0, loanBalance: 0, liquidationPrice: 0,
            isLiquidationRisk: false, bridgeBTC: 0,
            bridgeGoldUSD: 0, bridgeValueUSD: 0, status: 'RUIN'
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
      totalInterestPaid,
      bridgeSurvivesStorm: !ruinYear || ruinYear > (storm.stormEndYear || Infinity)
    };
  }


  // ── Forever Half Projection ────────────────────────────────
  // Simple projection showing forever half value vs annual burn
  function simulateForever(params) {
    const {
      totalBTC, bridgeSplitPct, annualBurnUSD, spendingGrowthRate,
      model, sigma, scenarioMode, retirementYear, maxProjectionYears,
      stormThreshold, initialK
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
      const ratio = inflatedBurn / foreverValue;
      const safeWithdrawal = foreverValue * stormThreshold;

      if (ratio < stormThreshold && inexhaustibleYear === null) {
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
        isInexhaustible: ratio < stormThreshold
      });
    }

    return { results, inexhaustibleYear, foreverBTC };
  }


  // ── End Result Mode: Accumulation Simulation ───────────────
  // Stack more BTC for N years, then compute Bridge/Forever outcome
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

    // Now run Bridge/Forever from retirement year
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
  // Binary search: smallest totalBTC where bridge survives storm
  function findMinimumTotal(baseParams) {
    let lo = 0.001;
    let hi = 100;

    // Quick check if even 100 BTC isn't enough
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
  // Binary search: highest annual burn where bridge survives storm
  function findMaxBurn(baseParams) {
    let lo = 1000;
    let hi = baseParams.annualBurnUSD;

    // Quick check if current burn already works
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


  // ── Bridge Summary Stats ───────────────────────────────────
  function bridgeSummary(bridgeResult) {
    const r = bridgeResult.results.filter(y => y.status !== 'RUIN');
    if (r.length === 0) return null;

    const totalBTCSold = r.reduce((s, y) => s + y.btcSold, 0);
    const totalGoldSold = r.reduce((s, y) => s + y.goldSold, 0);
    const totalBorrowed = r.reduce((s, y) => s + y.borrowed, 0);
    const totalWithdrawn = r.reduce((s, y) => s + y.actualWithdrawal, 0);
    const avgSWR = r.reduce((s, y) => s + y.swrRate, 0) / r.length;
    const borrowYears = r.filter(y => y.status === 'BORROWING').length;

    return {
      yearsBeforeRuin: r.length,
      totalBTCSold,
      totalGoldSold,
      totalBorrowed,
      totalWithdrawn,
      avgSWR,
      borrowYears,
      totalInterestPaid: bridgeResult.totalInterestPaid,
      finalBridgeBTC: r[r.length - 1].bridgeBTC,
      finalBridgeValue: r[r.length - 1].bridgeValueUSD,
      finalGoldUSD: r[r.length - 1].bridgeGoldUSD,
      finalLoanBalance: r[r.length - 1].loanBalance,
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

    // Compare at same future date (retirementYear + 30 years for Freedom, endResult retirement + 30 for End Result)
    const freedomForeverAt30 = freedomForever.results.find(r => r.yearIndex === 30) || freedomForever.results[freedomForever.results.length - 1];
    const endForeverAt30 = endResult.foreverResult.results.find(r => r.yearIndex === 30) || endResult.foreverResult.results[endResult.foreverResult.results.length - 1];

    return {
      freedom: {
        totalBTC: freedomParams.totalBTC,
        retirementYear: freedomParams.retirementYear,
        stormYears: freedomStorm.stormYears,
        bridgeSurvives: freedomBridge.bridgeSurvivesStorm,
        ruinYear: freedomBridge.ruinYear,
        yearsOfFreedom: baseParams.additionalYears, // extra years of freedom vs End Result
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
  // Returns percentile bands (10th, 25th, 50th, 75th, 90th) for bridge survival
  function monteCarloSurvival(baseParams, numSims) {
    numSims = numSims || 200;
    const years = baseParams.maxProjectionYears || 50;
    const results = [];

    for (let sim = 0; sim < numSims; sim++) {
      // Generate a random scenario: perturbation around the power law trend
      // Use log-normal noise with historical volatility (~0.3 in log10 space)
      let bridgeBTC = baseParams.totalBTC * baseParams.bridgeSplitPct;
      let bridgeGoldUSD = 0;
      let loanBalance = 0;
      let annualBurn = baseParams.annualBurnUSD;
      const floorAnnual = baseParams.floorMonthlyUSD * 12;
      let ruinYear = null;

      // Initialize gold if Kelly enabled
      if (baseParams.kellyEnabled && baseParams.initialGoldPct > 0) {
        const startDate = new Date(baseParams.retirementYear, 6, 1);
        const startPrice = PL.trendPrice(baseParams.model, startDate);
        const bridgeValue = bridgeBTC * startPrice;
        const goldTarget = bridgeValue * baseParams.initialGoldPct;
        const btcToSell = goldTarget / startPrice;
        if (btcToSell < bridgeBTC) {
          bridgeBTC -= btcToSell;
          bridgeGoldUSD = goldTarget;
        }
      }

      const yearlyBTC = [];

      for (let i = 0; i < years; i++) {
        if (ruinYear) { yearlyBTC.push(0); continue; }

        const year = baseParams.retirementYear + i;
        const date = new Date(year, 6, 1);
        const trend = PL.trendPrice(baseParams.model, date);

        // Random log-normal perturbation: log10(price) = log10(trend) + N(0, sigma)
        const logNoise = gaussianRandom() * baseParams.sigma;
        const price = trend * Math.pow(10, logNoise);

        const multiple = price / trend;

        // Grow gold
        if (baseParams.kellyEnabled && bridgeGoldUSD > 0) {
          bridgeGoldUSD *= (1 + baseParams.goldReturnRate);
        }

        // Accrue loan interest
        if (baseParams.loansEnabled && loanBalance > 0) {
          loanBalance += loanBalance * baseParams.loanInterestRate;
        }

        // Dynamic SWR
        const btcValue = bridgeBTC * price;
        const totalBridgeValue = btcValue + bridgeGoldUSD - loanBalance;
        const swrRate = dynamicSWR(price, trend, baseParams);
        let target = Math.max(totalBridgeValue * swrRate, floorAnnual);
        target = Math.min(target, annualBurn);
        target = Math.max(target, Math.min(floorAnnual, annualBurn));

        let actual = 0;

        // Sell gold first in bear
        if (baseParams.kellyEnabled && bridgeGoldUSD > 0 && multiple < 1.0) {
          const goldToSell = Math.min(bridgeGoldUSD, target);
          bridgeGoldUSD -= goldToSell;
          actual += goldToSell;
        }

        // Borrow if needed
        if (actual < target && baseParams.loansEnabled && multiple < 1.0) {
          const needed = target - actual;
          const maxBorrow = Math.max(0, bridgeBTC * price * baseParams.loanLTV - loanBalance);
          const toBorrow = Math.min(needed, maxBorrow);
          if (toBorrow > 0) {
            loanBalance += toBorrow;
            actual += toBorrow;
          }
        }

        // Sell BTC for remainder
        if (actual < target) {
          const needed = target - actual;
          const btcNeeded = needed / price;
          if (btcNeeded >= bridgeBTC) {
            actual += bridgeBTC * price;
            bridgeBTC = 0;
            ruinYear = year;
          } else {
            bridgeBTC -= btcNeeded;
            actual += needed;
          }
        }

        // Repay loans in bull
        if (baseParams.loansEnabled && loanBalance > 0 && multiple > 1.5 && bridgeBTC > 0) {
          const repay = Math.min(loanBalance, btcValue * 0.1);
          const btcForRepay = repay / price;
          if (btcForRepay < bridgeBTC) {
            bridgeBTC -= btcForRepay;
            loanBalance -= repay;
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

    // Bridge BTC percentiles at each year
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


  // ── Geographic Arbitrage ──────────────────────────────────
  // Cost-of-living multipliers relative to US average
  var GEO_MULTIPLIERS = {
    'us': { label: 'United States', multiplier: 1.00 },
    'uk': { label: 'United Kingdom', multiplier: 0.95 },
    'nl': { label: 'Netherlands', multiplier: 0.90 },
    'de': { label: 'Germany', multiplier: 0.85 },
    'es': { label: 'Spain', multiplier: 0.70 },
    'pt': { label: 'Portugal', multiplier: 0.65 },
    'cz': { label: 'Czech Republic', multiplier: 0.55 },
    'mx': { label: 'Mexico', multiplier: 0.45 },
    'th': { label: 'Thailand', multiplier: 0.40 },
    'vn': { label: 'Vietnam', multiplier: 0.35 },
    'co': { label: 'Colombia', multiplier: 0.40 },
    'id': { label: 'Indonesia', multiplier: 0.35 },
    'custom': { label: 'Custom', multiplier: 1.00 }
  };


  // ── Export ───────────────────────────────────────────────────
  window.RetirementV2 = {
    DEFAULTS,
    computeStormPeriod,
    dynamicSWR,
    kellyAllocation,
    simulateBridge,
    simulateForever,
    simulateEndResult,
    findMinimumTotal,
    findMaxBurn,
    bridgeSummary,
    compareScenarios,
    sideBySide,
    monteCarloSurvival,
    GEO_MULTIPLIERS
  };

})();
