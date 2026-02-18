// Bitcoin Pensioenrekentool — Herontworpen UI (NL)
// Reactieve autoberekening met puur DOM staafdiagram
(function() {
  'use strict';

  var PL = window.PowerLaw;
  var R = window.Retirement;
  var V2 = window.RetirementV2;

  var currentModel = 'santostasi';
  var historicalData = [];
  var calculatedSigma = 0.2;
  var livePrice = null;
  var advancedVisible = false;
  var currency = 'USD';
  var eurRate = null;

  var STORAGE_KEY = 'btcRetirement_v3_settings_nl';

  // ── DOM Helpers ─────────────────────────────────────────────
  var $ = function(id) { return document.getElementById(id); };
  var show = function(id) { var el = $(id); if (el) el.classList.remove('hidden'); };
  var hide = function(id) { var el = $(id); if (el) el.classList.add('hidden'); };

  function fmtBTC(btc) {
    if (btc >= 100) return btc.toFixed(1);
    if (btc >= 10) return btc.toFixed(2);
    if (btc >= 1) return btc.toFixed(3);
    if (btc >= 0.01) return btc.toFixed(4);
    return btc.toFixed(6);
  }

  function getRate() { return currency === 'EUR' && eurRate ? eurRate : 1; }
  function getCurrencySym() { return currency === 'EUR' ? '\u20AC' : '$'; }

  function fmtMoney(usdVal) {
    var val = usdVal * getRate();
    var sym = getCurrencySym();
    if (val >= 1e9) return sym + (val / 1e9).toFixed(1) + 'B';
    if (val >= 1e6) return sym + (val / 1e6).toFixed(1) + 'M';
    if (val >= 1e3) return sym + Math.round(val).toLocaleString('nl-NL');
    return sym + val.toFixed(0);
  }

  // Create a text element (span, div, etc.) safely
  function el(tag, text, className) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (className) e.className = className;
    return e;
  }


  // ── Segmentation Logic ────────────────────────────────────
  // Pure functions: derive user segment from calculator results

  function btcGoalSegment(myStack, totalBTC) {
    if (totalBTC <= 0) return { id: 5, label: 'Je Kunt met Pensioen', pct: 100 };
    var pct = (myStack / totalBTC) * 100;
    if (pct <= 0)   return { id: 1, label: 'Net Begonnen',     pct: 0 };
    if (pct < 50)   return { id: 2, label: 'Vroege Fase',      pct: pct };
    if (pct < 75)   return { id: 3, label: 'Halverwege',       pct: pct };
    if (pct < 100)  return { id: 4, label: 'Bijna Daar',       pct: pct };
    return { id: 5, label: 'Je Kunt met Pensioen', pct: pct };
  }

  function ageSegment(age) {
    if (age <= 35) return { id: 'young', label: 'Hoog verdienpotentieel' };
    if (age <= 50) return { id: 'mid',   label: 'Piek verdientijd' };
    return { id: 'late',  label: 'Transitieplanning' };
  }

  function segmentedMessage(ageSeg, goalSeg) {
    var messages = {
      'young_1': 'De tijd is aan jouw kant. Focus op inkomensgroei en consistent stacken.',
      'young_2': 'Je bouwt momentum op. Houd je DCA consistent \u2014 de machtswet beloont geduld.',
      'young_3': 'Je loopt voor op schema. Overweeg coast FI \u2014 laat de machtswet het zware werk doen.',
      'young_4': 'Je bent er bijna en je bent jong. Een paar kleine stappen kunnen alles veranderen.',
      'young_5': 'Je hebt de code vroeg gekraakt. Financi\u00eble vrijheid is van jou.',
      'mid_1':   'Je beste verdientijd is nu. Strategisch handelen maakt nu het grootste verschil.',
      'mid_2':   'Je boekt vooruitgang. Gerichte inspanning in je beste verdientijd sluit het gat.',
      'mid_3':   'Je zit in een goede positie. Nog een paar jaar gerichte inspanning kan alles veranderen.',
      'mid_4':   'Je bent in de eindsprint. Fijnafstemming van je plan betaalt zich nu het meest uit.',
      'mid_5':   'Je hebt genoeg. Overweeg je exitstrategie te optimaliseren.',
      'late_1':  'Tijd is je belangrijkste beperking. Combineer strategie\u00ebn of verleng je tijdlijn voor het sterkste resultaat.',
      'late_2':  'Elk beetje telt. Je bestaande vermogen (AOW, pensioen) zijn echte fundamenten \u2014 Bitcoin voegt een krachtige laag toe.',
      'late_3':  'Deeltijdtransitie is beschikbaar voor je. Je bent dichterbij dan je denkt.',
      'late_4':  'Je bent er bijna. Een persoonlijk consult kan de laatste details optimaliseren.',
      'late_5':  'Je hebt genoeg. Je plan kan baat hebben bij een precieze exitstrategie.'
    };
    var key = ageSeg.id + '_' + goalSeg.id;
    return messages[key] || '';
  }

  function ctaTone(ageSeg, goalSeg) {
    if (goalSeg.id >= 4) return 'precision';
    if (ageSeg.id === 'young') return 'encouraging';
    if (ageSeg.id === 'mid')   return 'strategic';
    return 'warm';
  }


  // ── Lever State ──────────────────────────────────────────
  var leverState = {
    extraMonthlyDCA: 0,
    lumpSum: 0,
    spendingReduction: 0,
    retireAgeOverride: null
  };

  function applyLevers(params, levers) {
    var adjusted = {};
    Object.keys(params).forEach(function(k) { adjusted[k] = params[k]; });

    // Lever 2: reduce annual burn
    if (levers.spendingReduction > 0) {
      adjusted.annualBurn = params.annualBurn * (1 - levers.spendingReduction / 100);
    }

    // Lever 3: retirement age override
    if (levers.retireAgeOverride !== null) {
      adjusted.retirementAge = levers.retireAgeOverride;
    }

    // Lever 1: additional BTC from DCA/lump sum
    if (levers.extraMonthlyDCA > 0 || levers.lumpSum > 0) {
      var extraBTC = estimateExtraBTC(params, levers);
      adjusted.myStack = params.myStack + extraBTC;
    }

    return adjusted;
  }

  function estimateExtraBTC(params, levers) {
    var currentYear = new Date().getFullYear();
    var retireAge = levers.retireAgeOverride || params.retirementAge || params.currentAge;
    var yearsToRetirement = retireAge - params.currentAge;
    if (yearsToRetirement <= 0) yearsToRetirement = 1;
    var totalMonths = yearsToRetirement * 12;

    var extraBTC = 0;

    // Lump sum: buy at today's price
    if (levers.lumpSum > 0) {
      var todayPrice = livePrice || PL.trendPrice(params.model, new Date());
      extraBTC += (levers.lumpSum / getRate()) / todayPrice;
    }

    // Monthly DCA: buy each month at projected price
    if (levers.extraMonthlyDCA > 0) {
      var monthlyUSD = levers.extraMonthlyDCA / getRate();
      for (var m = 0; m < totalMonths; m++) {
        var date = new Date(currentYear, new Date().getMonth() + m, 15);
        var yearOffset = m / 12;
        var effectiveK = R.resolveScenarioK(params.scenarioMode, yearOffset, params.initialK);
        var price = R.scenarioPrice(params.model, date, params.sigma, effectiveK);
        if (price > 0) extraBTC += monthlyUSD / price;
      }
    }

    return extraBTC;
  }


  // ── Gather Parameters ──────────────────────────────────────
  function getParams() {
    var scenarioMode = $('ret-scenario').value;
    var initialK = null;
    if (livePrice && (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    var currentAge = parseInt($('ret-age').value) || 40;
    var retireAge = parseInt($('ret-retire-age').value) || currentAge;
    if (retireAge < currentAge) retireAge = currentAge;

    return {
      currentAge: currentAge,
      retirementAge: retireAge,
      lifeExpectancy: parseInt($('ret-life').value) || 100,
      annualBurn: (parseFloat($('ret-burn').value) || 100000) / getRate(),
      burnGrowth: (parseFloat($('ret-growth').value) || 6) / 100,
      myStack: parseFloat($('ret-stack').value) || 0,
      model: currentModel,
      sigma: calculatedSigma,
      scenarioMode: scenarioMode,
      initialK: initialK
    };
  }


  // ── Main Calculation ──────────────────────────────────────
  var debounceTimer = null;

  function scheduleCalculation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalculation, 150);
  }

  function runCalculation() {
    var params = getParams();
    if (params.retirementAge >= params.lifeExpectancy) return;

    // Base result (for segmentation — always from raw inputs)
    var baseResult = V2.computeLifetimeBTC(params);
    if (!baseResult) return;

    // Apply levers and recalculate
    var adjustedParams = applyLevers(params, leverState);
    var result = V2.computeLifetimeBTC(adjustedParams);
    if (!result) result = baseResult;

    // Segmentation (always from base, not adjusted)
    var goalSeg = btcGoalSegment(params.myStack, baseResult.totalBTC);
    var ageSeg = ageSegment(params.currentAge);

    renderVerdict(result, adjustedParams, goalSeg, ageSeg, baseResult);
    renderBarChart(result, adjustedParams);
    renderLevers(baseResult, params, goalSeg);
    renderCoastFI(baseResult, params);
    renderCTA(ageSeg, goalSeg);
    renderSummaryBoxes(result, adjustedParams);
    renderInsight(result, adjustedParams);

    if (advancedVisible) {
      renderYearlyTable(result);
      renderScenarioComparison(adjustedParams);
    }

    saveSettings();
  }


  // ── Bar Chart ─────────────────────────────────────────────
  function renderBarChart(result, params) {
    var chart = $('ret-chart');
    var axis = $('ret-age-axis');
    var title = $('ret-chart-title');
    chart.textContent = '';
    axis.textContent = '';

    title.textContent = 'BTC Nodig Per 5-Jaarsperiode \u2014 Leeftijd ' + params.retirementAge + ' tot ' + params.lifeExpectancy;

    var data = result.fiveYearData;
    var maxBtc = Math.max.apply(null, data.map(function(d) { return d.btcNeeded; }));

    data.forEach(function(d) {
      // Bar wrapper
      var wrapper = document.createElement('div');
      wrapper.className = 'ret-bar-wrapper';

      // Tooltip (built with safe DOM methods)
      var tooltip = document.createElement('div');
      tooltip.className = 'ret-tooltip';
      tooltip.appendChild(el('div', 'Leeftijd ' + d.startAge + '\u2013' + d.endAge, 'ret-tt-year'));

      var btcRow = el('div', 'Totaal BTC: ', 'ret-tt-row');
      btcRow.appendChild(el('span', d.btcNeeded.toFixed(4), 'ret-tt-val'));
      tooltip.appendChild(btcRow);

      tooltip.appendChild(el('div', 'Gem. Uitgaven: ' + fmtMoney(d.avgBurn) + '/jr', 'ret-tt-row'));

      // Label above bar (2 decimal places for readability)
      var labelText = d.btcNeeded >= 0.01 ? d.btcNeeded.toFixed(2) : '<0,01';
      var heightPct = maxBtc > 0 ? (d.btcNeeded / maxBtc) * 100 : 0;
      var labelClass = 'ret-bar-label' + (heightPct < 5 ? ' ret-label-tiny' : '');
      var label = el('div', labelText, labelClass);

      // The bar itself
      var bar = document.createElement('div');
      bar.className = 'ret-bar ' + d.phase;
      bar.style.height = Math.max(heightPct, 0.5) + '%';

      wrapper.appendChild(tooltip);
      wrapper.appendChild(label);
      wrapper.appendChild(bar);
      chart.appendChild(wrapper);

      // Age axis tick
      axis.appendChild(el('div', d.startAge + '\u2013' + d.endAge, 'ret-tick'));
    });
  }


  // ── Summary Boxes ─────────────────────────────────────────
  function renderSummaryBoxes(result, params) {
    // Storm box
    var stormNum = $('ret-storm-btc');
    stormNum.textContent = '';
    stormNum.appendChild(document.createTextNode(fmtBTC(result.stormBTC) + ' '));
    stormNum.appendChild(el('span', 'BTC'));

    var stormFiat = $('ret-storm-fiat');
    if (stormFiat) {
      var stormPrice = livePrice || result.todayTrendPrice;
      stormFiat.textContent = '\u2248 ' + fmtMoney(result.stormBTC * stormPrice) + ' vandaag';
    }

    var stormEndAge = result.stormEndAge || params.lifeExpectancy;
    $('ret-storm-detail').textContent = 'Leeftijd ' + params.retirementAge + '\u2013' + stormEndAge + ' \u00b7 Eerste ' + result.stormYears + ' jaar';

    // Forever box
    var foreverNum = $('ret-forever-btc');
    foreverNum.textContent = '';
    foreverNum.appendChild(document.createTextNode(fmtBTC(result.foreverBTC) + ' '));
    foreverNum.appendChild(el('span', 'BTC'));

    var foreverFiat = $('ret-forever-fiat');
    if (foreverFiat) {
      var foreverPrice = livePrice || result.todayTrendPrice;
      foreverFiat.textContent = '\u2248 ' + fmtMoney(result.foreverBTC * foreverPrice) + ' vandaag';
    }

    var foreverYears = params.lifeExpectancy - stormEndAge;
    if (result.stormEndAge) {
      $('ret-forever-detail').textContent = 'Leeftijd ' + stormEndAge + '\u2013' + params.lifeExpectancy + ' \u00b7 Volgende ' + foreverYears + ' jaar';
    } else {
      $('ret-forever-detail').textContent = 'Eeuwigheidsdrempel niet bereikt in dit scenario';
    }
  }


  // ── Find Maximum Safe Burn ──────────────────────────────────
  // Binary search: highest annual burn where myStack >= totalBTC
  function findMaxSafeBurn(params) {
    var lo = 1000;
    var hi = params.annualBurn;
    if (hi <= lo) return lo;

    for (var iter = 0; iter < 30; iter++) {
      var mid = Math.round((lo + hi) / 2);
      var testParams = {};
      Object.keys(params).forEach(function(k) { testParams[k] = params[k]; });
      testParams.annualBurn = mid;
      var testResult = V2.computeLifetimeBTC(testParams);
      if (testResult && testParams.myStack >= testResult.totalBTC) {
        lo = mid;
      } else {
        hi = mid;
      }
      if (hi - lo <= 500) break;
    }
    return lo;
  }


  // ── Verdict ───────────────────────────────────────────────
  function renderVerdict(result, params, goalSeg, ageSeg, baseResult) {
    var container = $('ret-verdict-text');
    container.textContent = '';

    if (params.myStack <= 0) {
      container.textContent = 'Vul hierboven je BTC-stack in om je pad te zien.';
      return;
    }

    // Segment badge
    var badge = el('span', goalSeg.label, 'ret-segment-badge seg-' + goalSeg.id);
    container.appendChild(badge);

    // Progress bar
    var progressWrap = document.createElement('div');
    progressWrap.className = 'ret-progress-bar';
    var progressFill = document.createElement('div');
    progressFill.className = 'ret-progress-fill' + (goalSeg.pct >= 100 ? ' ret-progress-complete' : '');
    progressFill.style.width = Math.min(goalSeg.pct, 100) + '%';
    progressWrap.appendChild(progressFill);
    container.appendChild(progressWrap);

    var pctText = el('div', Math.round(goalSeg.pct) + '% van je Bitcoin-doel', 'ret-verdict-pct');
    container.appendChild(pctText);

    // Primary message — lead positive
    if (result.canRetireNow) {
      if (params.retirementAge > params.currentAge) {
        var retireYear = new Date().getFullYear() + (params.retirementAge - params.currentAge);
        container.appendChild(el('div', 'Je kunt met pensioen op leeftijd ' + params.retirementAge + ' (' + retireYear + ')', 'ret-verdict-headline ret-highlight-green'));
      } else {
        container.appendChild(el('div', 'Je kunt vandaag stoppen met werken', 'ret-verdict-headline ret-highlight-green'));
      }
      if (result.surplus > 0.001) {
        container.appendChild(el('div', 'Overschot: ' + fmtBTC(result.surplus) + ' BTC', 'ret-verdict-sub'));
      }
    } else {
      // Show earliest viable retirement age first (positive framing)
      var earliestAge = result.earliestRetirementAge || baseResult.earliestRetirementAge;
      if (earliestAge) {
        var retYear = new Date().getFullYear() + (earliestAge - params.currentAge);
        container.appendChild(el('div', 'Je kunt met pensioen op leeftijd ' + earliestAge + ' (' + retYear + ')', 'ret-verdict-headline ret-highlight-green'));
      } else {
        container.appendChild(el('div', 'Je hebt nog ' + fmtBTC(-result.surplus) + ' BTC nodig', 'ret-verdict-headline'));
      }

      // Stack info
      var stackLine = document.createElement('div');
      stackLine.className = 'ret-verdict-sub';
      stackLine.appendChild(document.createTextNode('Je hebt '));
      stackLine.appendChild(el('span', fmtBTC(params.myStack) + ' BTC', 'ret-btc'));
      stackLine.appendChild(document.createTextNode(' \u2014 je hebt '));
      stackLine.appendChild(el('span', fmtBTC(result.totalBTC) + ' BTC', 'ret-btc'));
      stackLine.appendChild(document.createTextNode(' nodig'));
      container.appendChild(stackLine);
    }

    // Traditional retirement contrast
    var earliestBtc = result.earliestRetirementAge || baseResult.earliestRetirementAge || null;
    if (earliestBtc && earliestBtc < 65) {
      var contrast = document.createElement('div');
      contrast.className = 'ret-contrast';

      var trad = document.createElement('div');
      trad.className = 'ret-contrast-item';
      trad.appendChild(el('div', 'Traditioneel', 'ret-contrast-label'));
      trad.appendChild(el('div', '65', 'ret-contrast-value'));
      contrast.appendChild(trad);

      var btcRetire = document.createElement('div');
      btcRetire.className = 'ret-contrast-item';
      btcRetire.appendChild(el('div', 'Bitcoin', 'ret-contrast-label'));
      btcRetire.appendChild(el('div', '' + earliestBtc, 'ret-contrast-value ret-highlight-green'));
      contrast.appendChild(btcRetire);

      var saved = document.createElement('div');
      saved.className = 'ret-contrast-item';
      saved.appendChild(el('div', 'Jaren bespaard', 'ret-contrast-label'));
      saved.appendChild(el('div', '' + (65 - earliestBtc), 'ret-contrast-value ret-contrast-saved'));
      contrast.appendChild(saved);

      container.appendChild(contrast);
    }

    // Segmented guidance message
    var guidance = segmentedMessage(ageSeg, goalSeg);
    if (guidance) {
      container.appendChild(el('div', guidance, 'ret-verdict-guidance'));
    }
  }


  // ── Insight Text ──────────────────────────────────────────
  function renderInsight(result, params) {
    var insightEl = $('ret-insight');
    if (!insightEl) return;

    if (result.totalBTC > 0 && result.annualData && result.annualData.length > 0) {
      var windowYears = Math.min(10, result.annualData.length);
      var windowBTC = 0;
      for (var i = 0; i < windowYears; i++) {
        windowBTC += result.annualData[i].btcNeeded;
      }
      var windowPct = ((windowBTC / result.totalBTC) * 100).toFixed(0);
      var remainingYears = result.annualData.length - windowYears;
      var remainingBTC = result.totalBTC - windowBTC;

      insightEl.textContent = windowPct + '% van alle Bitcoin die je ooit nodig hebt wordt uitgegeven in de eerste ' +
        windowYears + ' jaar. Daarna maakt de machtswet je jaarlijkse kosten verwaarloosbaar \u2014 ' +
        'je resterende ' + remainingYears + ' jaar kosten slechts ' + fmtBTC(remainingBTC) + ' BTC totaal.';
    } else if (!result.stormEndAge) {
      insightEl.textContent = 'Onder dit prijsscenario wordt de eeuwigheidsdrempel nooit bereikt. ' +
        'Je uitgavengroei is sneller dan de machtswet waardeert. Overweeg lagere uitgavengroei of probeer een ander scenario.';
    }
  }


  // ── Three Levers ────────────────────────────────────────
  function renderLevers(baseResult, params, goalSeg) {
    var leversSection = $('ret-levers');
    if (!leversSection) return;

    // Show/hide levers based on whether user already has enough
    if (goalSeg.id >= 5 && leverState.extraMonthlyDCA === 0 && leverState.lumpSum === 0 &&
        leverState.spendingReduction === 0 && leverState.retireAgeOverride === null) {
      leversSection.classList.add('ret-levers-done');
    } else {
      leversSection.classList.remove('ret-levers-done');
    }

    // Update currency symbols
    var syms = document.querySelectorAll('.ret-lever-sym');
    for (var i = 0; i < syms.length; i++) syms[i].textContent = getCurrencySym();

    // Lever 1: BTC gap
    var gapEl = $('ret-lever1-gap');
    if (gapEl) {
      if (baseResult.surplus < 0) {
        var deficit = -baseResult.surplus;
        var deficitFiat = deficit * (livePrice || baseResult.todayTrendPrice);
        gapEl.textContent = 'Je hebt nog ' + fmtBTC(deficit) + ' BTC nodig (\u2248 ' + fmtMoney(deficitFiat) + ' vandaag)';
      } else {
        gapEl.textContent = 'Je hebt al genoeg BTC';
        gapEl.style.color = 'var(--green)';
      }
    }

    // Lever 1: impact text
    var impact1 = $('ret-lever1-impact');
    if (impact1) {
      if (leverState.extraMonthlyDCA > 0 || leverState.lumpSum > 0) {
        var extraBTC = estimateExtraBTC(params, leverState);
        impact1.textContent = '+' + fmtBTC(extraBTC) + ' BTC door extra inleg';
      } else {
        impact1.textContent = '';
      }
    }

    // Lever 2: spending reduction
    var detail2 = $('ret-lever2-detail');
    var lever2Card = $('ret-lever2');
    if (detail2 && lever2Card) {
      if (baseResult.canRetireNow) {
        lever2Card.classList.add('ret-lever-disabled');
        detail2.textContent = 'Je kunt al met pensioen bij dit uitgavenniveau.';
      } else {
        var maxBurn = findMaxSafeBurn(params);
        var maxReductionPct = Math.round((1 - maxBurn / params.annualBurn) * 100);
        if (maxReductionPct > 15 || maxReductionPct < 0) {
          lever2Card.classList.add('ret-lever-disabled');
          detail2.textContent = 'Alleen uitgaven verlagen is niet genoeg.';
        } else {
          lever2Card.classList.remove('ret-lever-disabled');
          var reducedBurn = params.annualBurn * (1 - leverState.spendingReduction / 100);
          detail2.textContent = 'Verlaag met ' + leverState.spendingReduction +
            '% naar ' + fmtMoney(reducedBurn) + '/jaar';
        }
      }
    }

    // Lever 2: label
    var spendLabel = $('ret-lever-spend-label');
    if (spendLabel) spendLabel.textContent = leverState.spendingReduction + '%';

    // Lever 3: retirement age slider
    var ageSlider = $('ret-lever-age');
    var ageLabel = $('ret-lever-age-label');
    if (ageSlider) {
      ageSlider.min = params.currentAge;
      ageSlider.max = params.lifeExpectancy - 1;
      if (leverState.retireAgeOverride === null) {
        var defaultAge = baseResult.earliestRetirementAge || params.currentAge;
        ageSlider.value = defaultAge;
        if (ageLabel) ageLabel.textContent = defaultAge;
      } else {
        if (ageLabel) ageLabel.textContent = leverState.retireAgeOverride;
      }
    }

    // Lever 3: detail
    var detail3 = $('ret-lever3-detail');
    if (detail3) {
      var sliderAge = leverState.retireAgeOverride || baseResult.earliestRetirementAge || params.currentAge;
      if (sliderAge !== params.retirementAge) {
        var laterParams = {};
        Object.keys(params).forEach(function(k) { laterParams[k] = params[k]; });
        laterParams.retirementAge = sliderAge;
        var laterResult = V2.computeLifetimeBTC(laterParams);
        if (laterResult) {
          detail3.textContent = 'Op leeftijd ' + sliderAge + ': ' + fmtBTC(laterResult.totalBTC) +
            ' BTC nodig (vs ' + fmtBTC(baseResult.totalBTC) + ' nu)';
        }
      } else {
        detail3.textContent = 'Verschuif om andere pensioenleeftijden te verkennen';
      }
    }
  }


  // ── Coast FI Panel ─────────────────────────────────────
  function renderCoastFI(result, params) {
    var textEl = $('ret-coast-text');
    if (!textEl) return;

    if (params.myStack <= 0) {
      textEl.textContent = 'Vul je BTC-stack in om je Coast FI-status te zien.';
      return;
    }

    var currentYear = new Date().getFullYear();
    var swr = V2.foreverSWR(currentYear);
    var stackValue = params.myStack * (livePrice || result.todayTrendPrice);
    var safeWithdrawal = stackValue * swr;
    var coveragePct = Math.min((safeWithdrawal / params.annualBurn) * 100, 100);

    textEl.textContent = 'Je ' + fmtBTC(params.myStack) + ' BTC dekt al ' +
      coveragePct.toFixed(0) + '% van je ' + fmtMoney(params.annualBurn) +
      ' jaarlijkse uitgaven bij het huidige veilige opnamepercentage. ' +
      (coveragePct >= 50
        ? 'Je zou je werkdruk proportioneel kunnen verminderen en Bitcoin de rest laten doen.'
        : 'Blijf stacken \u2014 elke sat brengt je dichterbij.');
  }


  // ── Consultation CTA ──────────────────────────────────
  function renderCTA(ageSeg, goalSeg) {
    var textEl = $('ret-cta-text');
    if (!textEl) return;

    var tone = ctaTone(ageSeg, goalSeg);
    var messages = {
      'encouraging': 'De tijd is aan jouw kant. Voor een complete analyse inclusief je AOW, pensioen, hypotheek en volledig vermogensoverzicht \u2014 boek een persoonlijk consult om je pad uit te stippelen.',
      'strategic':   'Strategische planning levert nu het meeste op. Voor een complete analyse inclusief je AOW, pensioen, hypotheek en volledig vermogensoverzicht \u2014 boek een persoonlijk consult.',
      'warm':        'Je bent dichterbij dan je denkt. Voor een complete analyse inclusief je AOW, pensioen, hypotheek en volledig vermogensoverzicht \u2014 boek een persoonlijk consult. Kleine stappen maken nu het grootste verschil.',
      'precision':   'Je bent in de eindfase. Voor een precies exitplan inclusief je AOW, pensioen, hypotheek en volledig vermogensoverzicht \u2014 boek een persoonlijk consult om de laatste details te optimaliseren.'
    };

    textEl.textContent = messages[tone] || messages['strategic'];
  }


  // ── Year-by-Year Table ────────────────────────────────────
  function renderYearlyTable(result) {
    var tbody = $('ret-yearly-body');
    if (!tbody) return;
    tbody.textContent = '';

    var cumulative = 0;
    result.annualData.forEach(function(d) {
      cumulative += d.btcNeeded;

      var tr = document.createElement('tr');
      var phaseClass = d.isForever ? 'ret-phase-forever' : 'ret-phase-storm';
      var phaseText = d.isForever ? 'Eeuwig' : 'Storm';

      var cells = [
        { text: '' + d.age, bold: true },
        { text: '' + d.year },
        { text: fmtMoney(d.price) },
        { text: fmtMoney(d.burn) },
        { text: d.btcNeeded.toFixed(6) },
        { text: cumulative.toFixed(4) },
        { text: phaseText, className: phaseClass }
      ];

      cells.forEach(function(c) {
        var td = document.createElement('td');
        if (c.bold) {
          var strong = document.createElement('strong');
          strong.textContent = c.text;
          td.appendChild(strong);
        } else {
          td.textContent = c.text;
        }
        if (c.className) td.className = c.className;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }


  // ── Scenario Comparison ───────────────────────────────────
  function renderScenarioComparison(params) {
    var tbody = $('ret-scenario-body');
    if (!tbody) return;
    tbody.textContent = '';

    var nlLabels = {
      'smooth_trend': 'Vlakke Trend',
      'smooth_bear': 'Bear (\u22121\u03c3)',
      'smooth_deep_bear': 'Diepe Bear (\u22122\u03c3)',
      'cyclical': 'Cyclisch (\u00b11\u03c3)',
      'cyclical_bear': 'Bear Bias Cycli'
    };
    var scenarios = PowerLaw.SCENARIO_MODES.map(function(s) {
      return { label: nlLabels[s.id] || s.label, mode: s.id };
    });

    scenarios.forEach(function(s) {
      var p = {};
      Object.keys(params).forEach(function(k) { p[k] = params[k]; });
      p.scenarioMode = s.mode;
      var result = V2.computeLifetimeBTC(p);
      if (!result) return;

      var tr = document.createElement('tr');

      var td1 = document.createElement('td');
      var strong = document.createElement('strong');
      strong.textContent = s.label;
      td1.appendChild(strong);
      tr.appendChild(td1);

      var td2 = document.createElement('td');
      td2.textContent = fmtBTC(result.totalBTC) + ' BTC';
      tr.appendChild(td2);

      var td3 = document.createElement('td');
      td3.textContent = fmtBTC(result.stormBTC) + ' BTC';
      tr.appendChild(td3);

      var td4 = document.createElement('td');
      td4.textContent = result.stormEndAge ? result.stormYears + ' jaar' : 'Nooit';
      tr.appendChild(td4);

      var td5 = document.createElement('td');
      td5.textContent = result.canRetireNow ? 'Ja' : 'Nee';
      td5.style.color = result.canRetireNow ? 'var(--green)' : 'var(--red)';
      td5.style.fontWeight = '600';
      tr.appendChild(td5);

      tbody.appendChild(tr);
    });
  }


  // ── Input Extras Toggle ──────────────────────────────────
  function setupInputExtrasToggle() {
    var btn = $('ret-input-extra-btn');
    var fields = $('ret-input-extra-fields');
    if (!btn || !fields) return;
    var visible = false;
    btn.addEventListener('click', function() {
      visible = !visible;
      if (visible) {
        fields.classList.remove('hidden');
        btn.textContent = 'Minder opties';
      } else {
        fields.classList.add('hidden');
        btn.textContent = 'Meer opties';
        var ageEl = $('ret-age');
        var retireEl = $('ret-retire-age');
        if (ageEl && retireEl) retireEl.value = ageEl.value;
        scheduleCalculation();
      }
    });
  }


  // ── Advanced Toggle ───────────────────────────────────────
  function setupAdvancedToggle() {
    var btn = $('ret-advanced-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      advancedVisible = !advancedVisible;
      if (advancedVisible) {
        show('ret-advanced');
        btn.textContent = 'Verberg Geavanceerde Analyse';
        var params = getParams();
        var result = V2.computeLifetimeBTC(params);
        if (result) {
          renderYearlyTable(result);
          renderScenarioComparison(params);
        }
      } else {
        hide('ret-advanced');
        btn.textContent = 'Toon Geavanceerde Analyse';
      }
    });
  }


  // ── Settings Persistence ──────────────────────────────────
  function saveSettings() {
    var data = {
      version: 1,
      savedAt: new Date().toISOString(),
      inputs: {}
    };

    var inputIds = ['ret-age', 'ret-retire-age', 'ret-life', 'ret-burn', 'ret-growth', 'ret-stack', 'ret-scenario', 'ret-currency'];
    inputIds.forEach(function(id) {
      var elRef = $(id);
      if (elRef) data.inputs[id] = elRef.value;
    });

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || !data.inputs) return;

      Object.keys(data.inputs).forEach(function(id) {
        var elRef = $(id);
        if (elRef) elRef.value = data.inputs[id];
      });

      // Restore currency state
      if (data.inputs['ret-currency']) {
        currency = data.inputs['ret-currency'];
        var symEl = $('ret-currency-sym');
        if (symEl) symEl.textContent = getCurrencySym();
      }
    } catch (e) { /* ignore */ }
  }


  // ── Lever Listeners ─────────────────────────────────────
  function setupLeverListeners() {
    // Lever 1: DCA
    var dcaInput = $('ret-lever-dca');
    if (dcaInput) {
      dcaInput.addEventListener('input', function() {
        leverState.extraMonthlyDCA = parseFloat(dcaInput.value) || 0;
        scheduleCalculation();
      });
    }

    // Lever 1: Lump sum
    var lumpInput = $('ret-lever-lump');
    if (lumpInput) {
      lumpInput.addEventListener('input', function() {
        leverState.lumpSum = parseFloat(lumpInput.value) || 0;
        scheduleCalculation();
      });
    }

    // Lever 2: Spending reduction slider
    var spendSlider = $('ret-lever-spend');
    if (spendSlider) {
      spendSlider.addEventListener('input', function() {
        leverState.spendingReduction = parseFloat(spendSlider.value) || 0;
        scheduleCalculation();
      });
    }

    // Lever 3: Retirement age slider
    var ageSlider = $('ret-lever-age');
    if (ageSlider) {
      ageSlider.addEventListener('input', function() {
        leverState.retireAgeOverride = parseInt(ageSlider.value) || null;
        var label = $('ret-lever-age-label');
        if (label) label.textContent = ageSlider.value;
        scheduleCalculation();
      });
    }
  }


  // ── Initialize ────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData();
    loadSettings();
    setupInputListeners();
    setupLeverListeners();
    setupInputExtrasToggle();
    setupAdvancedToggle();
    runCalculation();
  }

  async function loadHistoricalData() {
    try {
      var response = await fetch('../../datasets/btc_historical.json');
      historicalData = await response.json();
      PL.calculateSigma(historicalData, currentModel); // validates data
      calculatedSigma = PL.MODELS[currentModel].sigma;
    } catch (e) {
      console.error('Historische data laden mislukt:', e);
    }
  }

  async function fetchLiveData() {
    try {
      var res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      var data = await res.json();
      if (data.bitcoin) {
        if (data.bitcoin.usd) livePrice = data.bitcoin.usd;
        if (data.bitcoin.usd && data.bitcoin.eur) eurRate = data.bitcoin.eur / data.bitcoin.usd;
        runCalculation();
      }
    } catch (e) {
      console.warn('Live prijs ophalen mislukt', e);
      eurRate = 0.92;
    }
  }

  function setupInputListeners() {
    var inputIds = ['ret-age', 'ret-retire-age', 'ret-life', 'ret-burn', 'ret-growth', 'ret-stack', 'ret-scenario', 'ret-currency'];
    inputIds.forEach(function(id) {
      var elRef = $(id);
      if (!elRef) return;
      elRef.addEventListener('input', scheduleCalculation);
      elRef.addEventListener('change', scheduleCalculation);
    });

    // When current age changes, keep retirement age >= current age
    $('ret-age').addEventListener('input', function() {
      var age = parseInt($('ret-age').value) || 40;
      var retireEl = $('ret-retire-age');
      var extraFields = $('ret-input-extra-fields');
      if (extraFields && extraFields.classList.contains('hidden')) {
        retireEl.value = age;
      } else {
        var retireAge = parseInt(retireEl.value) || age;
        if (retireAge < age) retireEl.value = age;
      }
    });

    // Currency toggle
    $('ret-currency').addEventListener('change', function() {
      currency = $('ret-currency').value;
      var symEl = $('ret-currency-sym');
      if (symEl) symEl.textContent = getCurrencySym();
    });
  }


  // ── Start ─────────────────────────────────────────────────
  init();

})();
