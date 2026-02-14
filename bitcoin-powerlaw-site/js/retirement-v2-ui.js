// Bitcoin Retirement Calculator — Redesigned UI
// Reactive auto-calculation with pure DOM bar chart
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

  var STORAGE_KEY = 'btcRetirement_v3_settings';

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
    if (val >= 1e3) return sym + Math.round(val).toLocaleString('en-US');
    return sym + val.toFixed(0);
  }

  // Create a text element (span, div, etc.) safely
  function el(tag, text, className) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (className) e.className = className;
    return e;
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

    var result = V2.computeLifetimeBTC(params);
    if (!result) return;

    renderBarChart(result, params);
    renderSummaryBoxes(result, params);
    renderVerdict(result, params);
    renderInsight(result, params);

    if (advancedVisible) {
      renderYearlyTable(result);
      renderScenarioComparison(params);
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

    title.textContent = 'BTC Needed Per 5-Year Period \u2014 Age ' + params.retirementAge + ' to ' + params.lifeExpectancy;

    var data = result.fiveYearData;
    var maxBtc = Math.max.apply(null, data.map(function(d) { return d.btcNeeded; }));

    data.forEach(function(d) {
      // Bar wrapper
      var wrapper = document.createElement('div');
      wrapper.className = 'ret-bar-wrapper';

      // Tooltip (built with safe DOM methods)
      var tooltip = document.createElement('div');
      tooltip.className = 'ret-tooltip';
      tooltip.appendChild(el('div', 'Ages ' + d.startAge + '\u2013' + d.endAge, 'ret-tt-year'));

      var btcRow = el('div', 'Total BTC: ', 'ret-tt-row');
      btcRow.appendChild(el('span', d.btcNeeded.toFixed(4), 'ret-tt-val'));
      tooltip.appendChild(btcRow);

      tooltip.appendChild(el('div', 'Avg Burn: ' + fmtMoney(d.avgBurn) + '/yr', 'ret-tt-row'));

      // Label above bar
      var label = el('div', d.btcNeeded >= 0.01 ? fmtBTC(d.btcNeeded) : '<0.01', 'ret-bar-label');

      // The bar itself
      var bar = document.createElement('div');
      bar.className = 'ret-bar ' + d.phase;
      var heightPct = maxBtc > 0 ? (d.btcNeeded / maxBtc) * 100 : 0;
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
      stormFiat.textContent = '\u2248 ' + fmtMoney(result.stormBTC * stormPrice) + ' today';
    }

    var stormEndAge = result.stormEndAge || params.lifeExpectancy;
    $('ret-storm-detail').textContent = 'Ages ' + params.retirementAge + '\u2013' + stormEndAge + ' \u00b7 First ' + result.stormYears + ' years';

    // Forever box
    var foreverNum = $('ret-forever-btc');
    foreverNum.textContent = '';
    foreverNum.appendChild(document.createTextNode(fmtBTC(result.foreverBTC) + ' '));
    foreverNum.appendChild(el('span', 'BTC'));

    var foreverFiat = $('ret-forever-fiat');
    if (foreverFiat) {
      var foreverPrice = livePrice || result.todayTrendPrice;
      foreverFiat.textContent = '\u2248 ' + fmtMoney(result.foreverBTC * foreverPrice) + ' today';
    }

    var foreverYears = params.lifeExpectancy - stormEndAge;
    if (result.stormEndAge) {
      $('ret-forever-detail').textContent = 'Ages ' + stormEndAge + '\u2013' + params.lifeExpectancy + ' \u00b7 Next ' + foreverYears + ' years';
    } else {
      $('ret-forever-detail').textContent = 'No forever threshold reached in this scenario';
    }
  }


  // ── Verdict ───────────────────────────────────────────────
  function renderVerdict(result, params) {
    var container = $('ret-verdict-text');
    container.textContent = '';

    if (params.myStack <= 0) {
      container.textContent = 'Enter your BTC stack above to see your verdict.';
      return;
    }

    // Line 1: "You have X BTC. You need Y BTC."
    container.appendChild(document.createTextNode('You have '));
    container.appendChild(el('span', fmtBTC(params.myStack) + ' BTC', 'ret-btc'));
    container.appendChild(document.createTextNode('. You need '));
    container.appendChild(el('span', fmtBTC(result.totalBTC) + ' BTC', 'ret-btc'));
    container.appendChild(document.createTextNode('.'));
    container.appendChild(document.createElement('br'));

    if (result.canRetireNow) {
      if (params.retirementAge > params.currentAge) {
        var retireYear = new Date().getFullYear() + (params.retirementAge - params.currentAge);
        container.appendChild(el('span', 'You can retire at age ' + params.retirementAge + ' (' + retireYear + ').', 'ret-highlight-green'));
      } else {
        container.appendChild(el('span', 'You can stop working today.', 'ret-highlight-green'));
      }
      if (result.surplus > 0.001) {
        container.appendChild(document.createTextNode(' Surplus: ' + fmtBTC(result.surplus) + ' BTC.'));
      }
    } else {
      var deficit = -result.surplus;
      container.appendChild(el('span', 'You need ' + fmtBTC(deficit) + ' more BTC.', 'ret-highlight-red'));

      if (result.earliestRetirementAge) {
        var retYear = new Date().getFullYear() + (result.earliestRetirementAge - params.currentAge);
        container.appendChild(document.createElement('br'));
        container.appendChild(document.createTextNode('Earliest viable retirement: age '));
        var strong = document.createElement('strong');
        strong.textContent = result.earliestRetirementAge + ' (' + retYear + ')';
        container.appendChild(strong);
      }
    }
  }


  // ── Insight Text ──────────────────────────────────────────
  function renderInsight(result, params) {
    var insightEl = $('ret-insight');
    if (!insightEl) return;

    if (result.stormEndAge) {
      var stormPct = result.totalBTC > 0 ? ((result.stormBTC / result.totalBTC) * 100).toFixed(0) : 0;
      insightEl.textContent = 'Your lifetime BTC need is ' + fmtBTC(result.totalBTC) + ' BTC. Of that, ' +
        stormPct + '% is concentrated in the storm period (ages ' + params.retirementAge + '\u2013' + result.stormEndAge + '). ' +
        'After age ' + result.stormEndAge + ', the power law makes your annual BTC need negligible \u2014 ' +
        'your remaining ' + (params.lifeExpectancy - result.stormEndAge) + ' years cost only ' + fmtBTC(result.foreverBTC) + ' BTC total.';
    } else {
      insightEl.textContent = 'Under this price scenario, the forever threshold is never reached. ' +
        'Your burn rate grows faster than the power law appreciates. Consider reducing spending growth or trying a different scenario.';
    }
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
      var phaseText = d.isForever ? 'Forever' : 'Storm';

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

    var scenarios = [
      { label: 'Smooth Trend', mode: 'smooth_trend' },
      { label: 'Bear (\u22121\u03c3)', mode: 'smooth_bear' },
      { label: 'Deep Bear (\u22122\u03c3)', mode: 'smooth_deep_bear' },
      { label: 'Cyclical (\u00b11\u03c3)', mode: 'cyclical' },
      { label: 'Bear Bias Cycles', mode: 'cyclical_bear' }
    ];

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
      td4.textContent = result.stormEndAge ? result.stormYears + ' years' : 'Never';
      tr.appendChild(td4);

      var td5 = document.createElement('td');
      td5.textContent = result.canRetireNow ? 'Yes' : 'No';
      td5.style.color = result.canRetireNow ? 'var(--green)' : 'var(--red)';
      td5.style.fontWeight = '600';
      tr.appendChild(td5);

      tbody.appendChild(tr);
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
        btn.textContent = 'Hide Advanced Analysis';
        var params = getParams();
        var result = V2.computeLifetimeBTC(params);
        if (result) {
          renderYearlyTable(result);
          renderScenarioComparison(params);
        }
      } else {
        hide('ret-advanced');
        btn.textContent = 'Show Advanced Analysis';
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


  // ── Initialize ────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData();
    loadSettings();
    setupInputListeners();
    setupAdvancedToggle();
    runCalculation();
  }

  async function loadHistoricalData() {
    try {
      var response = await fetch('../datasets/btc_historical.json');
      historicalData = await response.json();
      PL.calculateSigma(historicalData, currentModel); // validates data
      calculatedSigma = PL.MODELS[currentModel].sigma;
    } catch (e) {
      console.error('Failed to load historical data:', e);
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
      console.warn('Live price fetch failed', e);
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
      var retireAge = parseInt(retireEl.value) || age;
      if (retireAge < age) retireEl.value = age;
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
