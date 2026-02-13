// Bitcoin Retirement Calculator V2 - UI Handler
// Navigation Fund / Forever Half Framework with Freedom Now & End Result modes
(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;
  const V2 = window.RetirementV2;

  let currentModel = 'santostasi';
  let bridgeChart = null;
  let foreverChart = null;
  let accumChart = null;
  let historicalData = [];
  let calculatedSigma = 0.3;
  let livePrice = null;
  let currentMode = 'freedom_now';

  const STORAGE_KEY = 'btcRetirement_v2_settings';

  // ── Currency Support ──────────────────────────────────────
  let currency = 'USD';
  let eurRate = null;

  function getCurrencySymbol() { return currency === 'EUR' ? '€' : '$'; }
  function getRate() { return currency === 'EUR' && eurRate ? eurRate : 1; }
  function toDisplay(usd) { return usd * getRate(); }
  function toUSD(displayAmount) { return displayAmount / getRate(); }

  function fmtCurrency(usd) {
    const val = toDisplay(usd);
    const sym = getCurrencySymbol();
    if (val >= 1e9) return sym + (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return sym + (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return sym + Math.round(val).toLocaleString('en-US');
    if (val >= 1) return sym + val.toFixed(2);
    return sym + val.toFixed(4);
  }

  function fmtBTC(btc) {
    if (btc >= 100) return btc.toFixed(2);
    if (btc >= 1) return btc.toFixed(4);
    return btc.toFixed(6);
  }

  async function fetchLiveData() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      const data = await res.json();
      if (data.bitcoin) {
        if (data.bitcoin.usd) livePrice = data.bitcoin.usd;
        if (data.bitcoin.usd && data.bitcoin.eur) {
          eurRate = data.bitcoin.eur / data.bitcoin.usd;
        }
      }
    } catch (e) {
      console.warn('Live data fetch failed, using fallbacks', e);
      eurRate = 0.92;
    }
  }

  // ── DOM Helpers ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
  const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

  // ── Gather Parameters ──────────────────────────────────────
  function getParams() {
    const scenarioMode = $('v2-price-scenario').value;

    let initialK = null;
    const retYear = parseInt($('v2-retirement-year')?.value) || 2030;
    if (livePrice && retYear <= new Date().getFullYear() + 1 &&
        (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    const params = {
      ...V2.DEFAULTS,
      totalBTC: parseFloat($('v2-total-btc').value) || 1.0,
      bridgeSplitPct: parseFloat($('v2-bridge-split').value) / 100,
      mode: currentMode,
      model: currentModel,
      sigma: calculatedSigma,
      scenarioMode,
      initialK,
      annualBurnUSD: toUSD(parseFloat($('v2-annual-burn').value) || 50000),
      spendingGrowthRate: parseFloat($('v2-spending-growth').value) / 100,
      retirementYear: retYear,
      additionalYears: parseInt($('v2-additional-years')?.value) || 5,
      monthlyDCAUSD: toUSD(parseFloat($('v2-monthly-dca')?.value) || 500),
      incomeGrowthRate: parseFloat($('v2-income-growth')?.value) / 100 || 0.03,
      swrNormalRate: parseFloat($('v2-swr-normal')?.value) / 100 || 0.04,
    };

    return params;
  }

  // ── Initialize ──────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData();
    loadSettings();
    setupModeToggle();
    setupSliders();
    setupCurrencyToggle();
    setupStartNow();
    setupButtons();
    setupForeverSWRDisplay();
    updateModeVisibility();
  }

  async function loadHistoricalData() {
    try {
      const response = await fetch('../datasets/btc_historical.json');
      historicalData = await response.json();
      const sigmaData = PL.calculateSigma(historicalData, currentModel);
      calculatedSigma = sigmaData.sigma;
    } catch (e) {
      console.error('Failed to load historical data:', e);
    }
  }

  // ── Mode Toggle ─────────────────────────────────────────────
  function setupModeToggle() {
    document.querySelectorAll('#v2-mode-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#v2-mode-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        updateModeVisibility();
      });
    });
  }

  function updateModeVisibility() {
    if (currentMode === 'freedom_now') {
      show('v2-freedom-inputs');
      hide('v2-endresult-inputs');
    } else {
      hide('v2-freedom-inputs');
      show('v2-endresult-inputs');
    }
  }

  // ── Setup Functions ─────────────────────────────────────────
  function setupSliders() {
    const sliders = [
      { input: 'v2-bridge-split', update: (val) => {
          const d = $('v2-split-bridge-value');
          const d2 = $('v2-split-forever-value');
          if (d) d.textContent = val;
          if (d2) d2.textContent = 100 - parseFloat(val);
        }
      },
      { input: 'v2-spending-growth', display: 'v2-spending-growth-value' },
      { input: 'v2-swr-normal', display: 'v2-swr-value' },
      { input: 'v2-income-growth', display: 'v2-income-growth-value' }
    ];

    sliders.forEach(s => {
      const el = $(s.input);
      if (!el) return;
      el.addEventListener('input', () => {
        if (s.update) {
          s.update(el.value);
        } else {
          const display = $(s.display);
          if (display) display.textContent = el.value;
        }
      });
    });
  }

  function setupCurrencyToggle() {
    const sel = $('v2-currency');
    if (!sel) return;
    sel.addEventListener('change', () => {
      currency = sel.value;
      document.querySelectorAll('.v2-currency-label').forEach(el => {
        el.textContent = getCurrencySymbol();
      });
    });
  }

  function setupStartNow() {
    const btn = $('v2-start-now-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const yearInput = $('v2-retirement-year');
      if (yearInput) {
        yearInput.value = new Date().getFullYear();
        updateForeverSWRDisplay();
      }
    });
  }

  function setupButtons() {
    const calcBtn = $('v2-calculate-btn');
    if (calcBtn) calcBtn.addEventListener('click', runCalculation);

    const compareBtn = $('v2-compare-btn');
    if (compareBtn) compareBtn.addEventListener('click', runComparison);

    const sideBySideBtn = $('v2-sidebyside-btn');
    if (sideBySideBtn) sideBySideBtn.addEventListener('click', runSideBySide);

    const monteCarloBtn = $('v2-montecarlo-btn');
    if (monteCarloBtn) monteCarloBtn.addEventListener('click', runMonteCarlo);

    const resetBtn = $('v2-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', resetDefaults);

    const pdfBtn = $('v2-export-pdf-btn');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);
  }

  // ── Forever SWR Display ─────────────────────────────────────
  function setupForeverSWRDisplay() {
    const yearInput = $('v2-retirement-year');
    if (!yearInput) return;
    yearInput.addEventListener('input', updateForeverSWRDisplay);
    updateForeverSWRDisplay();
  }

  function updateForeverSWRDisplay() {
    const display = $('v2-forever-swr-display');
    if (!display) return;
    const year = parseInt($('v2-retirement-year')?.value) || 2030;
    const swr = V2.foreverSWR(year);
    display.textContent = (swr * 100).toFixed(2) + '%';
  }

  // ── Main Calculation ────────────────────────────────────────
  function runCalculation() {
    saveSettings();
    const params = getParams();

    if (currentMode === 'freedom_now') {
      runFreedomNow(params);
    } else {
      runEndResult(params);
    }
  }

  function runFreedomNow(params) {
    // Auto-optimizer: find the best split% across 10-90%
    const plan = V2.optimizePlan(params);

    // Auto-update split slider to optimizer recommendation
    const splitSlider = $('v2-bridge-split');
    if (splitSlider) {
      const pctVal = Math.round(plan.bestSplit * 100);
      splitSlider.value = pctVal;
      const d = $('v2-split-bridge-value');
      const d2 = $('v2-split-forever-value');
      if (d) d.textContent = pctVal;
      if (d2) d2.textContent = 100 - pctVal;
    }

    const usedParams = plan.params;
    const bridgeResult = plan.bridgeResult;
    const foreverResult = plan.foreverResult;
    const summary = V2.bridgeSummary(bridgeResult);

    renderStatusBanner(usedParams, bridgeResult, summary, plan);
    renderStormSection(bridgeResult.stormPeriod, usedParams);
    renderBridgeChart(bridgeResult, usedParams);
    renderForeverChart(foreverResult, usedParams);
    renderSummaryCards(usedParams, bridgeResult, foreverResult, summary);
    renderYearlyTable(bridgeResult, usedParams);
    renderInsight(usedParams, bridgeResult, foreverResult, summary);

    show('v2-status-banner');
    show('v2-storm-section');
    show('v2-bridge-chart-section');
    show('v2-forever-chart-section');
    show('v2-results-section');
    show('v2-table-section');
    show('v2-insight-section');
    hide('v2-comparison-section');
    hide('v2-accum-chart-section');
    show('v2-action-buttons');

    $('v2-storm-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function runEndResult(params) {
    const result = V2.simulateEndResult(params);
    const summary = V2.bridgeSummary(result.bridgeResult);

    renderEndResultStatus(params, result);
    renderAccumulationChart(result, params);

    const retParams = { ...params, totalBTC: result.finalBTC, retirementYear: result.retirementYear };
    renderStormSection(result.bridgeResult.stormPeriod, retParams);
    renderBridgeChart(result.bridgeResult, retParams);
    renderForeverChart(result.foreverResult, retParams);
    renderSummaryCards(retParams, result.bridgeResult, result.foreverResult, summary);

    show('v2-status-banner');
    show('v2-accum-chart-section');
    show('v2-storm-section');
    show('v2-bridge-chart-section');
    show('v2-forever-chart-section');
    show('v2-results-section');
    hide('v2-table-section');
    hide('v2-comparison-section');
    show('v2-insight-section');
    show('v2-action-buttons');

    $('v2-status-banner').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Comparison Mode ─────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();
    const comparison = V2.compareScenarios(params);

    const tbody = $('v2-comparison-body');
    if (!tbody) return;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

    comparison.forEach(row => {
      const tr = document.createElement('tr');
      const stormText = row.stormYears === Infinity ? 'Never' : row.stormYears + ' years';
      const surviveClass = row.bridgeSurvives ? 'status-ok' : 'status-ruin';
      const surviveText = row.bridgeSurvives ? 'Survives' : (row.ruinYear ? 'Ruin ' + row.ruinYear : 'Fails');
      const minText = row.minTotal === Infinity ? 'Impossible' : row.minTotal.toFixed(3) + ' BTC';

      const td1 = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = row.scenario;
      td1.appendChild(strong);
      tr.appendChild(td1);

      const td2 = document.createElement('td');
      td2.textContent = stormText;
      tr.appendChild(td2);

      const td3 = document.createElement('td');
      td3.className = surviveClass;
      td3.textContent = surviveText;
      tr.appendChild(td3);

      const td4 = document.createElement('td');
      td4.textContent = minText;
      tr.appendChild(td4);

      const td5 = document.createElement('td');
      td5.textContent = row.summary && row.summary.avgSWR ? (row.summary.avgSWR * 100).toFixed(1) + '%' : '—';
      tr.appendChild(td5);

      tbody.appendChild(tr);
    });

    show('v2-comparison-section');
    hide('v2-bridge-chart-section');
    hide('v2-forever-chart-section');
    hide('v2-results-section');
    hide('v2-table-section');
    hide('v2-accum-chart-section');
    show('v2-action-buttons');

    $('v2-comparison-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Status Banner ───────────────────────────────────────────
  function renderStatusBanner(params, bridgeResult, summary, plan) {
    const banner = $('v2-status-banner');
    const icon = $('v2-status-icon');
    const headline = $('v2-status-headline');
    const detail = $('v2-status-detail');

    banner.classList.remove('status-green', 'status-amber', 'status-red');

    const storm = bridgeResult.stormPeriod;

    if (plan && plan.status === 'OK') {
      // Optimizer found a surviving split
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      const splitPct = Math.round(plan.bestSplit * 100);
      headline.textContent = 'Optimal plan found. Storm period: ' + storm.stormYears + ' years.';
      const fundBTC = (params.totalBTC * plan.bestSplit).toFixed(4);
      const foreverBTC = (params.totalBTC * (1 - plan.bestSplit)).toFixed(4);
      detail.textContent = 'Recommended split: ' + splitPct + '% Navigation Fund / ' + (100 - splitPct) + '% Forever Half. '
        + 'Navigation Fund (' + fundBTC + ' BTC) sustains you through the storm. '
        + 'Forever Half (' + foreverBTC + ' BTC) becomes inexhaustible by ' + storm.stormEndYear + '.';
    } else if (plan && plan.status === 'BUST') {
      // Optimizer: no split survives
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = 'No split survives the storm.';

      // Build fix lines
      const fixes = plan.fixes;
      const lines = [];
      if (fixes.additionalBTC !== undefined && fixes.minTotalBTC !== Infinity) {
        lines.push('\u2022 Stack ' + fixes.additionalBTC.toFixed(3) + ' more BTC (total ' + fixes.minTotalBTC.toFixed(3) + ' BTC)');
      }
      if (fixes.maxBurnUSD && fixes.maxBurnUSD >= 1000) {
        lines.push('\u2022 OR reduce spending to ' + fmtCurrency(fixes.maxBurnUSD) + '/year');
      }
      if (fixes.earliestYear) {
        lines.push('\u2022 OR delay retirement to ' + fixes.earliestYear + ' (+' + fixes.yearDelay + ' years)');
      }
      detail.textContent = lines.join('  ') || 'Insufficient BTC for this scenario.';
    } else if (bridgeResult.bridgeSurvivesStorm && storm.stormYears !== Infinity) {
      // Non-optimizer path (e.g. End Result mode)
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      headline.textContent = 'You can retire. Storm period: ' + storm.stormYears + ' years.';
      const fundBTC = (params.totalBTC * params.bridgeSplitPct).toFixed(4);
      const foreverBTC = (params.totalBTC * (1 - params.bridgeSplitPct)).toFixed(4);
      detail.textContent = 'Your Navigation Fund (' + fundBTC + ' BTC) sustains you through the storm. Your Forever Half (' + foreverBTC + ' BTC) becomes inexhaustible by ' + storm.stormEndYear + '.';
    } else if (bridgeResult.ruinYear) {
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = 'Navigation Fund depleted in ' + bridgeResult.ruinYear;
      const minResult = V2.findMinimumTotal(params);
      const burnResult = V2.findMaxBurn(params);
      let fixText = '';
      if (minResult.minTotal !== Infinity) {
        const additional = minResult.minTotal - params.totalBTC;
        fixText += 'Need ' + additional.toFixed(3) + ' more BTC (total ' + minResult.minTotal.toFixed(3) + ' BTC)';
      }
      if (!burnResult.alreadySafe && burnResult.maxBurn >= 1000) {
        if (fixText) fixText += ', or ';
        fixText += 'reduce spending to ' + fmtCurrency(burnResult.maxBurn) + '/year';
      }
      detail.textContent = fixText || 'Insufficient BTC for this scenario.';
    } else {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'Forever Half never becomes inexhaustible';
      detail.textContent = 'Your burn rate grows faster than the Forever Half appreciates in this scenario. Consider increasing your stack or reducing spending.';
    }

    banner.classList.remove('hidden');
    banner.style.animation = 'none';
    banner.offsetHeight;
    banner.style.animation = '';
  }

  function renderEndResultStatus(params, result) {
    const banner = $('v2-status-banner');
    const icon = $('v2-status-icon');
    const headline = $('v2-status-headline');
    const detail = $('v2-status-detail');

    banner.classList.remove('status-green', 'status-amber', 'status-red');

    const storm = result.bridgeResult.stormPeriod;
    const survives = result.bridgeResult.bridgeSurvivesStorm;

    if (survives && storm.stormYears !== Infinity) {
      banner.classList.add('status-green');
      icon.textContent = '\uD83D\uDCCA';
      headline.textContent = 'After ' + params.additionalYears + ' more years: ' + result.finalBTC.toFixed(4) + ' BTC';
      detail.textContent = 'At retirement (' + result.retirementYear + '), your storm period is ' + storm.stormYears + ' years. Your Navigation Fund survives and your Forever Half becomes inexhaustible.';
    } else {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'After ' + params.additionalYears + ' more years: ' + result.finalBTC.toFixed(4) + ' BTC';
      detail.textContent = 'At retirement (' + result.retirementYear + ') you would have ' + result.finalBTC.toFixed(4) + ' BTC, but the Navigation Fund may not survive the storm. Consider stacking longer.';
    }

    banner.classList.remove('hidden');
  }

  // ── Storm Period Section ────────────────────────────────────
  function renderStormSection(storm, params) {
    const content = $('v2-storm-content');
    if (!content) return;

    const fundBTC = params.totalBTC * params.bridgeSplitPct;
    const foreverBTC = params.totalBTC * (1 - params.bridgeSplitPct);

    content.textContent = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'storm-summary';

    if (storm.stormYears === Infinity) {
      const metric = document.createElement('div');
      metric.className = 'storm-metric';
      const label = document.createElement('span');
      label.className = 'storm-label';
      label.textContent = 'Storm Period';
      const value = document.createElement('span');
      value.className = 'storm-value';
      value.style.color = 'var(--red)';
      value.textContent = 'Indefinite';
      metric.appendChild(label);
      metric.appendChild(value);
      wrapper.appendChild(metric);

      const p = document.createElement('p');
      p.style.color = 'var(--gray)';
      p.textContent = 'Your Forever Half of ' + foreverBTC.toFixed(4) + ' BTC does not grow fast enough to outpace your burn rate in this scenario.';
      wrapper.appendChild(p);
    } else {
      const row = document.createElement('div');
      row.className = 'storm-metrics-row';

      // Compute the SWR at storm end for display
      const swrAtEnd = storm.swrAtEnd || V2.foreverSWR(storm.stormEndYear);
      const swrPct = (swrAtEnd * 100).toFixed(2);

      const metrics = [
        { label: 'Storm Period', value: storm.stormYears + ' years' },
        { label: 'Storm Ends', value: '' + storm.stormEndYear },
        { label: 'Navigation Fund', value: fundBTC.toFixed(4) + ' BTC' },
        { label: 'Forever Half', value: foreverBTC.toFixed(4) + ' BTC' }
      ];

      metrics.forEach(m => {
        const metric = document.createElement('div');
        metric.className = 'storm-metric';
        const label = document.createElement('span');
        label.className = 'storm-label';
        label.textContent = m.label;
        const val = document.createElement('span');
        val.className = 'storm-value';
        val.textContent = m.value;
        metric.appendChild(label);
        metric.appendChild(val);
        row.appendChild(metric);
      });

      wrapper.appendChild(row);

      const p = document.createElement('p');
      p.style.cssText = 'color: var(--gray); margin-top: var(--spacing-md);';
      p.textContent = 'Survive the storm, and your Forever Half becomes practically inexhaustible. By ' + storm.stormEndYear + ', your annual burn is less than ' + swrPct + '% of your Forever Half value — the sustainable withdrawal rate for that year.';
      wrapper.appendChild(p);
    }

    content.appendChild(wrapper);
  }

  // ── Navigation Fund Chart ─────────────────────────────────
  function renderBridgeChart(bridgeResult, params) {
    const ctx = $('v2-bridge-chart');
    if (!ctx) return;
    if (bridgeChart) bridgeChart.destroy();

    const data = bridgeResult.results;
    const years = data.map(r => r.year);
    const sym = getCurrencySymbol();
    const rate = getRate();

    const datasets = [
      {
        label: 'Navigation Fund BTC',
        data: data.map(r => r.bridgeBTC),
        borderColor: '#F7931A',
        backgroundColor: 'rgba(247, 147, 26, 0.1)',
        fill: true,
        borderWidth: 2,
        pointRadius: 1,
        tension: 0.2,
        yAxisID: 'yBTC'
      },
      {
        label: 'Annual Withdrawal (' + currency + ')',
        data: data.map(r => r.actualWithdrawal * rate),
        borderColor: '#FF1744',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yVal'
      },
      {
        label: 'Fund Value (' + currency + ')',
        data: data.map(r => Math.max(0, r.bridgeValueUSD) * rate),
        borderColor: '#00C853',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yVal'
      }
    ];

    bridgeChart = new Chart(ctx, {
      type: 'line',
      data: { labels: years, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const val = ctx.raw;
                if (ctx.dataset.yAxisID === 'yBTC') return ctx.dataset.label + ': ' + fmtBTC(val) + ' BTC';
                return ctx.dataset.label + ': ' + sym + Math.round(val).toLocaleString();
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 15 } },
          yBTC: {
            type: 'linear', position: 'left', beginAtZero: true,
            title: { display: true, text: 'Navigation Fund BTC' },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { callback: v => v.toFixed(3) }
          },
          yVal: {
            type: 'logarithmic', position: 'right',
            title: { display: true, text: currency + ' Value' },
            grid: { display: false },
            ticks: {
              callback: v => {
                if (v >= 1e9) return sym + (v / 1e9).toFixed(0) + 'B';
                if (v >= 1e6) return sym + (v / 1e6).toFixed(0) + 'M';
                if (v >= 1e3) return sym + (v / 1e3).toFixed(0) + 'K';
                return sym + v;
              }
            }
          }
        }
      }
    });
  }

  // ── Forever Half Chart ──────────────────────────────────────
  function renderForeverChart(foreverResult, params) {
    const ctx = $('v2-forever-chart');
    if (!ctx) return;
    if (foreverChart) foreverChart.destroy();

    const data = foreverResult.results;
    const years = data.map(r => r.year);
    const sym = getCurrencySymbol();
    const rate = getRate();

    foreverChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Forever Half Value (' + currency + ')',
            data: data.map(r => r.foreverValueUSD * rate),
            borderColor: '#00C853',
            backgroundColor: 'rgba(0, 200, 83, 0.05)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Annual Burn (' + currency + ')',
            data: data.map(r => r.annualBurn * rate),
            borderColor: '#FF1744',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Forever SWR (' + currency + ')',
            data: data.map(r => r.safeWithdrawal * rate),
            borderColor: '#F7931A',
            borderWidth: 1,
            borderDash: [2, 4],
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + sym + Math.round(ctx.raw).toLocaleString();
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 15 } },
          y: {
            type: 'logarithmic',
            title: { display: true, text: currency },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              callback: v => {
                if (v >= 1e9) return sym + (v / 1e9).toFixed(0) + 'B';
                if (v >= 1e6) return sym + (v / 1e6).toFixed(0) + 'M';
                if (v >= 1e3) return sym + (v / 1e3).toFixed(0) + 'K';
                return sym + v;
              }
            }
          }
        }
      }
    });
  }

  // ── Accumulation Chart (End Result Mode) ────────────────────
  function renderAccumulationChart(result, params) {
    const ctx = $('v2-accum-chart');
    if (!ctx) return;
    if (accumChart) accumChart.destroy();

    const data = result.accumulationPhase;
    const years = data.map(r => r.year);
    const sym = getCurrencySymbol();
    const rate = getRate();

    accumChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Total BTC Stack',
            data: data.map(r => r.totalBTC),
            borderColor: '#F7931A',
            backgroundColor: 'rgba(247, 147, 26, 0.1)',
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.2,
            yAxisID: 'yBTC'
          },
          {
            label: 'Portfolio Value (' + currency + ')',
            data: data.map(r => r.portfolioValueUSD * rate),
            borderColor: '#00C853',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.2,
            yAxisID: 'yVal'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.yAxisID === 'yBTC') return ctx.dataset.label + ': ' + ctx.raw.toFixed(4) + ' BTC';
                return ctx.dataset.label + ': ' + sym + Math.round(ctx.raw).toLocaleString();
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          yBTC: {
            type: 'linear', position: 'left',
            title: { display: true, text: 'BTC Stack' },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          yVal: {
            type: 'logarithmic', position: 'right',
            title: { display: true, text: currency + ' Value' },
            grid: { display: false },
            ticks: {
              callback: v => {
                if (v >= 1e9) return sym + (v / 1e9).toFixed(0) + 'B';
                if (v >= 1e6) return sym + (v / 1e6).toFixed(0) + 'M';
                if (v >= 1e3) return sym + (v / 1e3).toFixed(0) + 'K';
                return sym + v;
              }
            }
          }
        }
      }
    });
  }

  // ── Summary Cards ───────────────────────────────────────────
  function renderSummaryCards(params, bridgeResult, foreverResult, summary) {
    const container = $('v2-summary-cards');
    if (!container) return;

    container.textContent = '';

    const storm = bridgeResult.stormPeriod;
    const fundBTC = params.totalBTC * params.bridgeSplitPct;
    const foreverBTC = params.totalBTC * (1 - params.bridgeSplitPct);

    if (!summary) {
      const card = buildCard('Result', 'RUIN', 'Navigation Fund depleted in year ' + bridgeResult.ruinYear, 'var(--red)');
      container.appendChild(card);
      return;
    }

    const stormText = storm.stormYears === Infinity ? 'Indefinite' : storm.stormYears + ' years';
    const stormColor = storm.stormYears === Infinity ? 'var(--red)' : 'var(--green)';

    const cards = [
      buildCard('Storm Period', stormText, storm.stormEndYear ? 'Ends ' + storm.stormEndYear : 'Forever Half never crosses threshold', stormColor, true),
      buildCard('Fund Survives', summary.bridgeSurvivesStorm ? 'Yes' : 'No', summary.yearsBeforeRuin + ' years of income', summary.bridgeSurvivesStorm ? 'var(--green)' : 'var(--red)', true),
      buildCard('Fund Split', fundBTC.toFixed(4) + ' BTC', (params.bridgeSplitPct * 100).toFixed(0) + '% of ' + params.totalBTC.toFixed(4) + ' BTC total'),
      buildCard('Forever Half', foreverBTC.toFixed(4) + ' BTC', storm.stormEndYear ? 'Inexhaustible by ' + storm.stormEndYear : 'Grows along power law'),
      buildCard('Total BTC Sold', summary.totalBTCSold.toFixed(4), 'of ' + fundBTC.toFixed(4) + ' fund BTC'),
      buildCard('Average SWR', (summary.avgSWR * 100).toFixed(2) + '%', 'Dynamic rate'),
      buildCard('Total Withdrawn', fmtCurrency(summary.totalWithdrawn), 'Over ' + summary.yearsBeforeRuin + ' years'),
      buildCard('Final Fund', fmtBTC(summary.finalBridgeBTC) + ' BTC', fmtCurrency(summary.finalBridgeValue) + ' value'),
    ];

    cards.forEach(c => container.appendChild(c));
  }

  function buildCard(label, value, sub, valueColor, isLarge) {
    const card = document.createElement('div');
    card.className = 'card';

    const labelEl = document.createElement('div');
    labelEl.className = 'card-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'card-value' + (isLarge ? ' large' : '');
    if (valueColor) valueEl.style.color = valueColor;
    valueEl.textContent = value;

    const subEl = document.createElement('div');
    subEl.className = 'card-sub';
    subEl.textContent = sub;

    card.appendChild(labelEl);
    card.appendChild(valueEl);
    card.appendChild(subEl);
    return card;
  }

  // ── Year-by-Year Table ──────────────────────────────────────
  function renderYearlyTable(bridgeResult, params) {
    const tbody = $('v2-yearly-table-body');
    if (!tbody) return;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

    // Update table headers
    const thead = tbody.parentElement ? tbody.parentElement.querySelector('thead tr') : null;
    if (thead) {
      while (thead.firstChild) thead.removeChild(thead.firstChild);
      var headers = ['Year', 'BTC Price', 'Multiple', 'SWR', 'Withdrawal', 'BTC Sold', 'Fund BTC', 'Fund Value', 'Debt', 'Status'];
      headers.forEach(function(text) {
        var th = document.createElement('th');
        th.textContent = text;
        thead.appendChild(th);
      });
    }

    bridgeResult.results.forEach(row => {
      const tr = document.createElement('tr');

      let statusClass = 'status-ok';
      let statusText = 'OK';
      switch (row.status) {
        case 'RUIN': statusClass = 'status-ruin'; statusText = 'RUIN'; break;
        case 'SELLING': statusClass = 'status-ok'; statusText = 'Sell'; break;
        case 'BORROW': statusClass = 'status-borrow'; statusText = 'Borrow'; break;
        case 'REPAYING': statusClass = 'status-repay'; statusText = 'Repay'; break;
        case 'FORCED_SELL': statusClass = 'status-ruin'; statusText = 'Forced'; break;
      }

      const cells = [
        { text: '' + row.year, bold: true },
        { text: row.price > 0 ? fmtCurrency(row.price) : '\u2014' },
        { text: row.multiple > 0 ? row.multiple.toFixed(2) + '\u00d7' : '\u2014', className: 'multiple-cell ' + (row.multiple < 1 ? 'under' : row.multiple > 1.5 ? 'over' : 'fair') },
        { text: row.swrRate > 0 ? (row.swrRate * 100).toFixed(1) + '%' : '\u2014' },
        { text: row.actualWithdrawal > 0 ? fmtCurrency(row.actualWithdrawal) : '\u2014' },
        { text: row.btcSold > 0 ? row.btcSold.toFixed(4) : '\u2014' },
        { text: row.bridgeBTC > 0 ? fmtBTC(row.bridgeBTC) : '0' },
        { text: row.bridgeValueUSD > 0 ? fmtCurrency(row.bridgeValueUSD) : '\u2014' },
        { text: row.debt > 0 ? fmtCurrency(row.debt) : '\u2014' },
        { text: statusText, className: statusClass }
      ];

      cells.forEach(c => {
        const td = document.createElement('td');
        if (c.bold) {
          const strong = document.createElement('strong');
          strong.textContent = c.text;
          td.appendChild(strong);
        } else {
          td.textContent = c.text;
        }
        if (c.className) td.className = c.className;
        tr.appendChild(td);
      });

      if (row.status === 'RUIN') tr.style.background = 'rgba(255, 23, 68, 0.05)';
      if (row.status === 'BORROW') tr.style.background = 'rgba(33, 150, 243, 0.05)';
      if (row.status === 'REPAYING') tr.style.background = 'rgba(0, 200, 83, 0.05)';

      tbody.appendChild(tr);
    });
  }

  // ── Insight Text ────────────────────────────────────────────
  function renderInsight(params, bridgeResult, foreverResult, summary) {
    const el = $('v2-insight-text');
    if (!el) return;

    const storm = bridgeResult.stormPeriod;
    const fundBTC = params.totalBTC * params.bridgeSplitPct;
    const foreverBTC = params.totalBTC * (1 - params.bridgeSplitPct);

    el.textContent = '';

    if (storm.stormYears !== Infinity) {
      const swrAtEnd = storm.swrAtEnd || V2.foreverSWR(storm.stormEndYear);
      const swrPct = (swrAtEnd * 100).toFixed(2);

      const p1 = document.createElement('span');
      p1.textContent = 'The Storm Navigation Framework: Your stack of ' + params.totalBTC + ' BTC is split into a Navigation Fund (' + fundBTC.toFixed(4) + ' BTC) that funds your life through the storm period, and a Forever Half (' + foreverBTC.toFixed(4) + ' BTC) that grows until withdrawals become negligible. ';
      el.appendChild(p1);

      const p2 = document.createElement('span');
      p2.textContent = 'Your storm period is ' + storm.stormYears + ' years — that is how long until the power law makes your Forever Half so valuable that your burn rate becomes less than ' + swrPct + '% of its value (the sustainable withdrawal rate for that year). ';
      el.appendChild(p2);

      if (summary && summary.bridgeSurvivesStorm) {
        const p3 = document.createElement('span');
        const survival = summary.yearsBeforeRuin > storm.stormYears ? 'easily survives' : 'just barely survives';
        p3.textContent = 'Your Navigation Fund ' + survival + ' the storm, using a dynamic withdrawal rate that averages ' + (summary.avgSWR * 100).toFixed(1) + '%. After ' + storm.stormEndYear + ', the hard part is over — the power law solves everything.';
        el.appendChild(p3);
      } else {
        const p3 = document.createElement('span');
        p3.textContent = 'However, your Navigation Fund depletes before the storm ends. You need either more BTC, lower spending, or a longer runway.';
        el.appendChild(p3);
      }
    } else {
      el.textContent = 'Under this scenario, your Forever Half never becomes inexhaustible — your spending growth outpaces the power law appreciation. Consider a more optimistic scenario, reducing spending growth, or increasing your stack.';
    }
  }

  // ── Settings Persistence ────────────────────────────────────
  function saveSettings() {
    const data = {
      version: 3,
      savedAt: new Date().toISOString(),
      mode: currentMode,
      inputs: {}
    };

    const inputIds = [
      'v2-total-btc', 'v2-currency', 'v2-price-scenario', 'v2-bridge-split',
      'v2-annual-burn', 'v2-spending-growth', 'v2-retirement-year',
      'v2-swr-normal',
      'v2-additional-years', 'v2-monthly-dca', 'v2-income-growth'
    ];

    inputIds.forEach(id => {
      const el = $(id);
      if (el) data.inputs[id] = el.type === 'checkbox' ? el.checked : el.value;
    });

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { console.warn('Failed to save settings:', e); }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.inputs) return;

      if (data.mode) {
        currentMode = data.mode;
        document.querySelectorAll('#v2-mode-toggle .toggle-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === currentMode);
        });
      }

      Object.entries(data.inputs).forEach(([id, val]) => {
        const el = $(id);
        if (!el) return;
        if (el.type === 'checkbox') {
          el.checked = val;
        } else {
          el.value = val;
        }
      });

      const sliderDisplayMap = {
        'v2-spending-growth': 'v2-spending-growth-value',
        'v2-swr-normal': 'v2-swr-value',
        'v2-income-growth': 'v2-income-growth-value'
      };

      Object.entries(sliderDisplayMap).forEach(([sliderId, displayId]) => {
        const el = $(sliderId);
        const display = $(displayId);
        if (el && display) display.textContent = el.value;
      });

      const splitEl = $('v2-bridge-split');
      if (splitEl) {
        const d = $('v2-split-bridge-value');
        const d2 = $('v2-split-forever-value');
        if (d) d.textContent = splitEl.value;
        if (d2) d2.textContent = 100 - parseFloat(splitEl.value);
      }

      if (data.inputs['v2-currency']) {
        currency = data.inputs['v2-currency'];
        document.querySelectorAll('.v2-currency-label').forEach(el => {
          el.textContent = getCurrencySymbol();
        });
      }

      updateForeverSWRDisplay();
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    $('v2-total-btc').value = 1.0;
    $('v2-currency').value = 'USD';
    $('v2-price-scenario').value = 'cyclical';
    $('v2-bridge-split').value = 50;
    $('v2-annual-burn').value = 50000;
    $('v2-spending-growth').value = 6.5;
    $('v2-retirement-year').value = 2030;
    $('v2-swr-normal').value = 4;

    if ($('v2-additional-years')) $('v2-additional-years').value = 5;
    if ($('v2-monthly-dca')) $('v2-monthly-dca').value = 500;
    if ($('v2-income-growth')) $('v2-income-growth').value = 3;

    const defaults = {
      'v2-split-bridge-value': '50', 'v2-split-forever-value': '50',
      'v2-spending-growth-value': '6.5', 'v2-swr-value': '4',
      'v2-income-growth-value': '3'
    };
    Object.entries(defaults).forEach(([id, val]) => {
      const el = $(id);
      if (el) el.textContent = val;
    });

    currency = 'USD';
    currentMode = 'freedom_now';
    document.querySelectorAll('#v2-mode-toggle .toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === 'freedom_now');
    });
    updateModeVisibility();
    updateForeverSWRDisplay();
  }

  // ── PDF Export ──────────────────────────────────────────────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please check your connection and refresh.');
      return;
    }

    const btn = $('v2-export-pdf-btn');
    const originalHTML = btn.textContent;
    btn.textContent = 'Generating\u2026';
    btn.disabled = true;

    try {
      const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const W = 210, H = 297, M = 8;
      const pw = W - 2 * M;
      let y = M;

      function checkPage(needed) {
        if (y + needed > H - M) { doc.addPage(); y = M; }
        return y;
      }

      doc.setFillColor(247, 147, 26);
      doc.rect(M, y, pw, 0.5, 'F');
      y += 3;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('\u20BF Storm Navigation Retirement Plan', M, y);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), W - M, y, { align: 'right' });
      doc.setTextColor(0);
      y += 4;

      const params = getParams();
      doc.setFillColor(248, 248, 248);
      doc.rect(M, y - 1, pw, 7, 'F');
      doc.setFontSize(5.5);

      const paramPairs = [
        ['Stack:', params.totalBTC + ' BTC'],
        ['Split:', (params.bridgeSplitPct * 100).toFixed(0) + '/' + ((1 - params.bridgeSplitPct) * 100).toFixed(0)],
        ['Burn:', fmtCurrency(params.annualBurnUSD) + '/yr'],
        ['Start:', '' + params.retirementYear],
        ['Scenario:', R.scenarioLabel(params.scenarioMode)],
        ['Mode:', currentMode === 'freedom_now' ? 'Freedom Now' : 'End Result']
      ];

      const pairW = pw / paramPairs.length;
      paramPairs.forEach((p, i) => {
        const x = M + i * pairW + 1;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
        doc.text(p[0], x, y + 2);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
        doc.text(p[1], x + doc.getTextWidth(p[0]) + 0.8, y + 2);
      });
      y += 8;

      const statusText = $('v2-status-headline')?.textContent || '';
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(statusText, M, y + 2);
      y += 5;

      const chartMaxH = 38;
      ['v2-bridge-chart', 'v2-forever-chart'].forEach(canvasId => {
        const canvas = $(canvasId);
        if (!canvas) return;
        try {
          const imgData = canvas.toDataURL('image/png');
          const ratio = canvas.height / canvas.width;
          const imgH = Math.min(pw * ratio, chartMaxH);
          checkPage(imgH + 5);
          doc.addImage(imgData, 'PNG', M, y, pw, imgH);
          y += imgH + 3;
        } catch (e) {}
      });

      checkPage(5);
      doc.setDrawColor(210);
      doc.line(M, y, W - M, y);
      y += 2;
      doc.setFontSize(5);
      doc.setTextColor(160);
      doc.text('Not financial advice. Power law models are educational projections, not guarantees.', W / 2, y, { align: 'center' });

      const filename = 'btc_navigation_forever_' + params.totalBTC + 'btc_' + new Date().toISOString().split('T')[0] + '.pdf';
      doc.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + err.message);
    }

    btn.textContent = originalHTML;
    btn.disabled = false;
  }

  // ── Side-by-Side Comparison ────────────────────────────────
  let sideBySideChart = null;

  function runSideBySide() {
    saveSettings();
    const params = getParams();

    const btn = $('v2-sidebyside-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Computing\u2026'; }

    setTimeout(function() {
      try {
        const result = V2.sideBySide(params);
        renderSideBySide(result, params);
        show('v2-sidebyside-section');
        $('v2-sidebyside-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        console.error('Side-by-side failed:', e);
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Side-by-Side Comparison'; }
    }, 50);
  }

  function renderSideBySide(result, params) {
    const container = $('v2-sidebyside-content');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const f = result.freedom;
    const e = result.endResult;

    const table = document.createElement('table');
    table.style.width = '100%';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Metric', 'Freedom Now', 'End Result (' + e.yearsWorking + 'yr DCA)'].forEach(function(text) {
      const th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const rows = [
      ['Total BTC', f.totalBTC.toFixed(4) + ' BTC', e.totalBTC.toFixed(4) + ' BTC'],
      ['Retirement Year', '' + f.retirementYear, '' + e.retirementYear],
      ['Storm Period', f.stormYears === Infinity ? 'Indefinite' : f.stormYears + ' years', e.stormYears === Infinity ? 'Indefinite' : e.stormYears + ' years'],
      ['Fund Survives', f.bridgeSurvives ? 'Yes' : 'No (' + f.ruinYear + ')', e.bridgeSurvives ? 'Yes' : 'No (' + e.ruinYear + ')'],
      ['Total Withdrawn', fmtCurrency(f.totalWithdrawn), fmtCurrency(e.totalWithdrawn)],
      ['Average SWR', (f.avgSWR * 100).toFixed(1) + '%', (e.avgSWR * 100).toFixed(1) + '%'],
      ['Forever Value @30yr', fmtCurrency(f.foreverValueAt30), fmtCurrency(e.foreverValueAt30)],
      ['Extra Freedom', f.yearsOfFreedom + ' years earlier', 'Working ' + e.yearsWorking + ' more years']
    ];

    rows.forEach(function(r) {
      const tr = document.createElement('tr');
      r.forEach(function(cellText, ci) {
        const td = document.createElement('td');
        if (ci === 0) {
          const strong = document.createElement('strong');
          strong.textContent = cellText;
          td.appendChild(strong);
        } else {
          td.textContent = cellText;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-container';
    wrapper.appendChild(table);
    container.appendChild(wrapper);

    // Verdict
    const verdict = document.createElement('div');
    verdict.className = 'info-box';
    verdict.style.marginTop = 'var(--spacing-md)';
    const verdictP = document.createElement('p');
    if (f.bridgeSurvives && !e.bridgeSurvives) {
      verdictP.textContent = 'Freedom Now wins: you can retire today and your Navigation Fund survives. Stacking longer actually hurts because you miss ' + f.yearsOfFreedom + ' years of freedom.';
    } else if (!f.bridgeSurvives && e.bridgeSurvives) {
      verdictP.textContent = 'End Result wins: stacking ' + e.yearsWorking + ' more years adds ' + result.additionalBTC.toFixed(4) + ' BTC, making the difference between ruin and survival.';
    } else if (f.bridgeSurvives && e.bridgeSurvives) {
      if (f.stormYears <= e.stormYears) {
        verdictP.textContent = 'Both paths survive, but Freedom Now gives you ' + f.yearsOfFreedom + ' extra years of freedom. The additional BTC from stacking shortens the storm but costs you time.';
      } else {
        verdictP.textContent = 'Both paths survive. End Result gives a shorter storm (' + e.stormYears + ' vs ' + f.stormYears + ' years) and ' + result.additionalBTC.toFixed(4) + ' more BTC, at the cost of ' + e.yearsWorking + ' years working.';
      }
    } else {
      verdictP.textContent = 'Neither path survives the storm. You need more BTC, lower spending, or a different scenario to make retirement work.';
    }
    verdict.appendChild(verdictP);
    container.appendChild(verdict);
  }

  // ── Monte Carlo ────────────────────────────────────────────
  let monteCarloChart = null;

  function runMonteCarlo() {
    saveSettings();
    const params = getParams();

    const btn = $('v2-montecarlo-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Simulating\u2026'; }

    setTimeout(function() {
      try {
        const result = V2.monteCarloSurvival(params, 200);
        renderMonteCarloChart(result, params);
        show('v2-montecarlo-section');
        $('v2-montecarlo-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        console.error('Monte Carlo failed:', e);
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Monte Carlo Analysis'; }
    }, 50);
  }

  function renderMonteCarloChart(result, params) {
    const ctx = $('v2-montecarlo-chart');
    if (!ctx) return;
    if (monteCarloChart) monteCarloChart.destroy();

    const bands = result.percentileBands;
    const years = bands.map(function(b) { return b.year; });

    monteCarloChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: '90th percentile',
            data: bands.map(function(b) { return b.p90; }),
            borderColor: 'rgba(0, 200, 83, 0.3)',
            backgroundColor: 'rgba(0, 200, 83, 0.05)',
            fill: '+1',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.3
          },
          {
            label: '75th percentile',
            data: bands.map(function(b) { return b.p75; }),
            borderColor: 'rgba(0, 200, 83, 0.5)',
            backgroundColor: 'rgba(0, 200, 83, 0.08)',
            fill: '+1',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.3
          },
          {
            label: 'Median (50th)',
            data: bands.map(function(b) { return b.p50; }),
            borderColor: '#F7931A',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false
          },
          {
            label: '25th percentile',
            data: bands.map(function(b) { return b.p25; }),
            borderColor: 'rgba(255, 23, 68, 0.5)',
            backgroundColor: 'rgba(255, 23, 68, 0.08)',
            fill: '+1',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.3
          },
          {
            label: '10th percentile',
            data: bands.map(function(b) { return b.p10; }),
            borderColor: 'rgba(255, 23, 68, 0.3)',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.3,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, padding: 12 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + fmtBTC(ctx.raw) + ' BTC';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 15 } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Navigation Fund BTC Remaining' },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { callback: function(v) { return v.toFixed(2); } }
          }
        }
      }
    });

    // Summary text
    const summary = $('v2-montecarlo-summary');
    if (summary) {
      summary.textContent = '';
      const pct = (result.survivalProbability * 100).toFixed(0);
      const color = result.survivalProbability >= 0.8 ? 'var(--green)' : result.survivalProbability >= 0.5 ? 'var(--orange)' : 'var(--red)';

      const headline = document.createElement('span');
      headline.style.cssText = 'font-size: 1.25rem; font-weight: 700; color: ' + color + ';';
      headline.textContent = pct + '% Survival Probability';
      summary.appendChild(headline);

      const detail = document.createElement('span');
      detail.style.color = 'var(--gray)';
      detail.textContent = ' across ' + result.numSims + ' random simulations (storm period: ' + result.stormYears + ' years). ';
      summary.appendChild(detail);

      if (result.medianRuinYear) {
        const ruin = document.createElement('span');
        ruin.style.color = 'var(--gray)';
        ruin.textContent = 'Median ruin year: ' + result.medianRuinYear + ' (in ' + result.ruinCount + ' of ' + result.numSims + ' simulations).';
        summary.appendChild(ruin);
      } else {
        const noRuin = document.createElement('span');
        noRuin.style.color = 'var(--gray)';
        noRuin.textContent = 'No ruin observed in any simulation.';
        summary.appendChild(noRuin);
      }
    }
  }

  // ── Start ───────────────────────────────────────────────────
  init();

})();
