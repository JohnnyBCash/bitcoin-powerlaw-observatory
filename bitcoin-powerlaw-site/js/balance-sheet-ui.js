// ── Balance Sheet Bitcoin Calculator — UI Handler ────────────────────
// Mirrors equity-ui.js IIFE pattern.
// Depends on: window.PowerLaw, window.Retirement, window.BalanceSheet
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;
  const BS = window.BalanceSheet;

  let currentModel    = 'santostasi';
  let valueChart      = null;
  let historicalData  = [];
  let calculatedSigma = 0.3;
  let livePrice       = null;

  const STORAGE_KEY = 'btcBalanceSheet_settings';

  // ── Currency Support ──────────────────────────────────────────
  let currency = 'USD';
  let eurRate  = null;

  function getCurrencySymbol() { return currency === 'EUR' ? '\u20AC' : '$'; }
  function getRate()           { return currency === 'EUR' && eurRate ? eurRate : 1; }
  function toDisplay(usd)      { return usd * getRate(); }
  function toUSD(displayAmt)   { return displayAmt / getRate(); }

  function fmtCurrency(usd) {
    const val = Math.abs(toDisplay(usd));
    const sym = getCurrencySymbol();
    const sign = usd < 0 ? '-' : '';
    if (val >= 1e9) return sign + sym + (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return sign + sym + (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return sign + sym + Math.round(val).toLocaleString('en-US');
    if (val >= 1)   return sign + sym + val.toFixed(2);
    return sign + sym + val.toFixed(4);
  }

  function fmtPct(v) { return (v * 100).toFixed(1) + '%'; }

  async function fetchLiveData() {
    try {
      const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      const data = await res.json();
      if (data.bitcoin) {
        if (data.bitcoin.usd) livePrice = data.bitcoin.usd;
        if (data.bitcoin.usd && data.bitcoin.eur) eurRate = data.bitcoin.eur / data.bitcoin.usd;
      }
    } catch (e) {
      console.warn('Live data fetch failed, using fallback', e);
      eurRate = 0.92;
    }
    updateLivePrice();
  }

  // ── DOM Helpers ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
  const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

  // ── Live Price Display ────────────────────────────────────────
  function updateLivePrice() {
    const el = $('bs-live-price');
    if (!el) return;
    el.textContent = livePrice ? fmtCurrency(livePrice) : 'Unavailable';
  }

  // ── Gather User Inputs ────────────────────────────────────────
  function getParams() {
    const scenarioMode = $('bs-scenario').value;

    let initialK = null;
    if (livePrice && (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      annualRevenue:      toUSD(parseFloat($('bs-annual-revenue').value) || 1000000),
      netMarginPct:       parseFloat($('bs-net-margin').value) / 100,
      allocationStrategy: $('bs-strategy').value,
      allocationPct:      parseFloat($('bs-allocation-pct').value) / 100,
      initialTreasury:    toUSD(parseFloat($('bs-initial-treasury').value) || 0),
      revenueGrowthPct:   parseFloat($('bs-revenue-growth').value) / 100,
      timeHorizonYears:   parseInt($('bs-time-horizon').value) || 10,
      model:              currentModel,
      sigma:              calculatedSigma,
      scenarioMode,
      initialK
    };
  }

  // ── Initialisation ────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData();
    loadSettings();
    setupSliders();
    setupToggles();
    setupButtons();
  }

  async function loadHistoricalData() {
    try {
      const response = await fetch('../datasets/btc_historical.json');
      historicalData = await response.json();
      const sigmaData = PL.calculateSigma(historicalData, currentModel);
      calculatedSigma = sigmaData.sigma;
    } catch (e) {
      console.warn('Failed to load historical data:', e);
    }
  }

  // ── Setup Functions ───────────────────────────────────────────
  function setupSliders() {
    const sliders = [
      { id: 'bs-net-margin',     display: 'bs-net-margin-value' },
      { id: 'bs-revenue-growth', display: 'bs-revenue-growth-value' },
      { id: 'bs-allocation-pct', display: 'bs-allocation-pct-value' },
      { id: 'bs-time-horizon',   display: 'bs-time-horizon-value' }
    ];
    sliders.forEach(({ id, display }) => {
      const slider = $(id);
      if (slider) {
        slider.addEventListener('input', () => {
          const d = $(display);
          if (d) d.textContent = slider.value;
        });
      }
    });
  }

  function setupToggles() {
    // Currency toggle
    const currSel = $('bs-currency');
    if (currSel) {
      currSel.addEventListener('change', () => {
        currency = currSel.value;
        const sym = currency === 'EUR' ? '\u20AC' : '$';
        ['bs-currency-label', 'bs-currency-label2'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = sym;
        });
        updateLivePrice();
      });
    }

    // Strategy toggle — show/hide initial treasury input
    const strategySel = $('bs-strategy');
    if (strategySel) {
      strategySel.addEventListener('change', () => {
        if (strategySel.value === 'initial_plus_monthly') {
          show('bs-initial-section');
        } else {
          hide('bs-initial-section');
        }
      });
    }
  }

  function setupButtons() {
    $('bs-calculate-btn').addEventListener('click', runCalculation);
    $('bs-compare-btn').addEventListener('click', runComparison);
    $('bs-export-pdf-btn').addEventListener('click', exportPDF);
    $('bs-reset-btn').addEventListener('click', resetDefaults);
  }

  // ── Settings Persistence ──────────────────────────────────────
  function saveSettings() {
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      inputs: {
        'bs-annual-revenue':  parseFloat($('bs-annual-revenue').value),
        'bs-currency':        $('bs-currency').value,
        'bs-net-margin':      parseFloat($('bs-net-margin').value),
        'bs-revenue-growth':  parseFloat($('bs-revenue-growth').value),
        'bs-strategy':        $('bs-strategy').value,
        'bs-allocation-pct':  parseFloat($('bs-allocation-pct').value),
        'bs-initial-treasury': parseFloat($('bs-initial-treasury').value),
        'bs-time-horizon':    parseInt($('bs-time-horizon').value),
        'bs-scenario':        $('bs-scenario').value
      }
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { console.warn('Failed to save settings:', e); }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.inputs) return false;
      const inp = data.inputs;

      // Number inputs
      ['bs-annual-revenue', 'bs-initial-treasury'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Sliders + display
      const sliderMap = {
        'bs-net-margin':     'bs-net-margin-value',
        'bs-revenue-growth': 'bs-revenue-growth-value',
        'bs-allocation-pct': 'bs-allocation-pct-value',
        'bs-time-horizon':   'bs-time-horizon-value'
      };
      Object.entries(sliderMap).forEach(([sliderId, displayId]) => {
        if (inp[sliderId] !== undefined) {
          const s = $(sliderId);
          const d = $(displayId);
          if (s) s.value = inp[sliderId];
          if (d) d.textContent = inp[sliderId];
        }
      });

      // Selects
      ['bs-currency', 'bs-strategy', 'bs-scenario'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Currency state
      if (inp['bs-currency']) {
        currency = inp['bs-currency'];
        const sym = currency === 'EUR' ? '\u20AC' : '$';
        ['bs-currency-label', 'bs-currency-label2'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = sym;
        });
      }

      // Strategy visibility
      if (inp['bs-strategy'] === 'initial_plus_monthly') {
        show('bs-initial-section');
      }

      return true;
    } catch (e) {
      console.warn('Failed to load settings:', e);
      return false;
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    $('bs-annual-revenue').value  = 1000000;
    $('bs-currency').value        = 'USD';
    $('bs-net-margin').value      = 10;
    $('bs-revenue-growth').value  = 5;
    $('bs-strategy').value        = 'monthly_profit';
    $('bs-allocation-pct').value  = 20;
    $('bs-initial-treasury').value = 100000;
    $('bs-time-horizon').value    = 10;
    $('bs-scenario').value        = 'cyclical';

    $('bs-net-margin-value').textContent     = '10';
    $('bs-revenue-growth-value').textContent = '5';
    $('bs-allocation-pct-value').textContent = '20';
    $('bs-time-horizon-value').textContent   = '10';

    currency = 'USD';
    ['bs-currency-label', 'bs-currency-label2'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = '$';
    });

    hide('bs-initial-section');
    updateLivePrice();
  }

  // ── Main Calculation ──────────────────────────────────────────
  function runCalculation() {
    saveSettings();
    const params     = getParams();
    const result     = BS.simulateTreasury(params, livePrice);
    const summary    = BS.treasurySummary(result);
    const marginImp  = BS.calculateMarginImpact(result);
    const rdBudget   = BS.calculateRDbudget(result);
    const resilience = BS.calculateResilienceBuffer(result);

    renderStatusBanner(summary);
    renderSummaryCards(summary);
    renderValueChart(result);
    renderInsightCards(marginImp, rdBudget, resilience, params);
    renderYearlyTable(result);
    renderInsight(params, summary);

    show('bs-results-section');
    show('bs-chart-section');
    show('bs-insights-section');
    show('bs-table-section');
    show('bs-insight-section');
    hide('bs-comparison-section');
    show('bs-action-buttons');

    $('bs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Comparison Mode ───────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();

    // Also run single calculation for the main view
    const result     = BS.simulateTreasury(params, livePrice);
    const summary    = BS.treasurySummary(result);
    const marginImp  = BS.calculateMarginImpact(result);
    const rdBudget   = BS.calculateRDbudget(result);
    const resilience = BS.calculateResilienceBuffer(result);

    renderStatusBanner(summary);
    renderSummaryCards(summary);
    renderValueChart(result);
    renderInsightCards(marginImp, rdBudget, resilience, params);
    renderYearlyTable(result);

    const scenarios = BS.compareScenarios(params, livePrice);
    renderComparisonTable(scenarios);

    show('bs-results-section');
    show('bs-chart-section');
    show('bs-insights-section');
    show('bs-table-section');
    show('bs-comparison-section');
    show('bs-insight-section');
    show('bs-action-buttons');

    renderComparisonInsight(scenarios);

    $('bs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Render: Status Banner ─────────────────────────────────────
  function renderStatusBanner(summary) {
    const banner   = $('bs-status-banner');
    const icon     = $('bs-status-icon');
    const headline = $('bs-status-headline');
    const detail   = $('bs-status-detail');

    banner.classList.remove('status-green', 'status-amber', 'status-red', 'hidden');
    banner.style.animation = 'none';
    banner.offsetHeight;
    banner.style.animation = '';

    if (summary.treasuryROI >= 100) {
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      headline.textContent = 'Bitcoin treasury significantly strengthens your balance sheet';
      detail.innerHTML =
        'Your ' + fmtCurrency(summary.totalAllocatedUSD) + ' allocation grew into a treasury worth ' +
        '<strong>' + fmtCurrency(summary.finalTreasuryValue) + '</strong>, a ' +
        '<strong>' + summary.treasuryROI.toFixed(0) + '% return</strong>. ' +
        'This could fund ' + summary.resilienceMonths.toFixed(1) + ' months of operations.';
    } else if (summary.treasuryROI >= 0) {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'Bitcoin treasury adds moderate value: ' + summary.treasuryROI.toFixed(0) + '% ROI';
      detail.innerHTML =
        'Your BTC treasury is worth <strong>' + fmtCurrency(summary.finalTreasuryValue) + '</strong>, ' +
        'a net gain of <strong>' + fmtCurrency(summary.treasuryGainLoss) + '</strong>. ' +
        'A longer horizon may improve returns as the power law compounds.';
    } else {
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = 'In this scenario, BTC allocation underperforms cash';
      detail.innerHTML =
        'You allocated <strong>' + fmtCurrency(summary.totalAllocatedUSD) + '</strong> but the treasury is worth only <strong>' +
        fmtCurrency(summary.finalTreasuryValue) + '</strong>. Net loss: <strong>' +
        fmtCurrency(summary.treasuryGainLoss) + '</strong>. Consider a longer horizon or more favourable scenario.';
    }

    show('bs-status-banner');
  }

  // ── Render: Summary Cards ─────────────────────────────────────
  function renderSummaryCards(summary) {
    const container = $('bs-summary-cards');
    const roiColor  = summary.treasuryROI >= 0 ? 'var(--green)' : 'var(--red)';
    const gainColor = summary.treasuryGainLoss >= 0 ? 'var(--green)' : 'var(--red)';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-label">Total BTC Accumulated</div>' +
        '<div class="card-value" style="color: var(--orange)">' + summary.totalBTC.toFixed(6) + ' BTC</div>' +
        '<div class="card-sub">at ' + fmtCurrency(summary.finalBTCPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Total Allocated</div>' +
        '<div class="card-value">' + fmtCurrency(summary.totalAllocatedUSD) + '</div>' +
        '<div class="card-sub">over ' + summary.totalMonths + ' months</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Final Treasury Value</div>' +
        '<div class="card-value">' + fmtCurrency(summary.finalTreasuryValue) + '</div>' +
        '<div class="card-sub">at ' + fmtCurrency(summary.finalBTCPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Treasury Gain / Loss</div>' +
        '<div class="card-value" style="color: ' + gainColor + '">' +
          (summary.treasuryGainLoss >= 0 ? '+' : '') + fmtCurrency(summary.treasuryGainLoss) +
        '</div>' +
        '<div class="card-sub" style="color: ' + roiColor + '">' +
          (summary.treasuryROI >= 0 ? '+' : '') + summary.treasuryROI.toFixed(1) + '% ROI</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Effective Margin</div>' +
        '<div class="card-value">' + fmtPct(summary.effectiveMargin) + '</div>' +
        '<div class="card-sub">vs ' + fmtPct(summary.originalMargin) + ' without BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Resilience Buffer</div>' +
        '<div class="card-value">' + summary.resilienceMonths.toFixed(1) + ' months</div>' +
        '<div class="card-sub">of operating expenses</div>' +
      '</div>';
  }

  // ── Render: Value Chart ───────────────────────────────────────
  function renderValueChart(result) {
    const ctx = $('bs-value-chart');
    if (valueChart) valueChart.destroy();

    const r = getRate();

    // Sample yearly for clean chart
    const months = result.months;
    const step = months.length > 360 ? 3 : 1;
    const sampled = months.filter((_, i) => i % step === 0 || i === months.length - 1);

    valueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sampled.map(m => m.date),
        datasets: [
          {
            label: 'BTC Treasury Value (' + currency + ')',
            data: sampled.map(m => m.treasuryValueUSD * r),
            borderColor: '#00C853',
            backgroundColor: 'rgba(0, 200, 83, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Cumulative Allocation (' + currency + ')',
            data: sampled.map(m => m.cumulativeAllocatedUSD * r),
            borderColor: '#F7931A',
            backgroundColor: 'rgba(247, 147, 26, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Annual Revenue (' + currency + ')',
            data: sampled.map(m => m.currentAnnualRevenue * r),
            borderColor: '#9E9E9E',
            borderWidth: 1.5,
            borderDash: [5, 5],
            pointRadius: 0,
            tension: 0.2,
            fill: false
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
              title: items => {
                const d = new Date(items[0].parsed.x);
                return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
              },
              label: item => item.dataset.label + ': ' + getCurrencySymbol() + Math.round(item.raw).toLocaleString()
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'year', displayFormats: { year: 'yyyy' } },
            grid: { display: false },
            ticks: { maxTicksLimit: 15 }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => {
                const sym = getCurrencySymbol();
                if (v >= 1e6) return sym + (v / 1e6).toFixed(1) + 'M';
                if (v >= 1e3) return sym + (v / 1e3).toFixed(0) + 'K';
                return sym + v;
              }
            },
            grid: { color: 'rgba(0,0,0,0.05)' }
          }
        }
      }
    });
  }

  // ── Render: Strategic Insight Cards ────────────────────────────
  function renderInsightCards(marginImp, rdBudget, resilience, params) {
    const container = $('bs-insight-cards');

    const lastMargin = marginImp.length > 0 ? marginImp[marginImp.length - 1] : null;
    const lastRD     = rdBudget.length > 0 ? rdBudget[rdBudget.length - 1] : null;
    const lastRes    = resilience.length > 0 ? resilience[resilience.length - 1] : null;

    // Average R&D budget over last 3 years for a smoother number
    const recentRD = rdBudget.slice(-3);
    const avgRD = recentRD.length > 0
      ? recentRD.reduce((s, r) => s + r.appreciation, 0) / recentRD.length
      : 0;

    container.innerHTML =
      // Card 1: Margin Flexibility
      '<div class="card insight-card">' +
        '<h4>Margin Flexibility</h4>' +
        '<div class="insight-metric">' +
          fmtPct(params.netMarginPct) + ' &rarr; ' +
          (lastMargin ? fmtPct(lastMargin.adjustedMargin) : '--') +
        '</div>' +
        '<div class="insight-detail">' +
          'By year ' + (lastMargin ? lastMargin.year : '--') +
          ', BTC treasury gains could allow you to reduce your margin from ' +
          fmtPct(params.netMarginPct) + ' to ' +
          (lastMargin ? fmtPct(lastMargin.adjustedMargin) : '--') +
          ' while maintaining the same total returns. Lower margins make you more competitive.' +
        '</div>' +
      '</div>' +

      // Card 2: R&D / Quality Budget
      '<div class="card insight-card">' +
        '<h4>R&D / Quality Budget</h4>' +
        '<div class="insight-metric">' +
          (avgRD > 0 ? fmtCurrency(avgRD) + '/yr' : '--') +
        '</div>' +
        '<div class="insight-detail">' +
          'BTC appreciation could fund an additional ' +
          (avgRD > 0 ? fmtCurrency(avgRD) : '--') +
          ' per year in R&amp;D or quality improvements' +
          (lastRD && lastRD.pctOfRevenue > 0 ? ', representing ' + fmtPct(lastRD.pctOfRevenue) + ' of revenue' : '') +
          '. This grows as your treasury compounds.' +
        '</div>' +
      '</div>' +

      // Card 3: Resilience Buffer
      '<div class="card insight-card">' +
        '<h4>Resilience Buffer</h4>' +
        '<div class="insight-metric">' +
          (lastRes ? lastRes.runwayMonths.toFixed(1) + ' months' : '--') +
        '</div>' +
        '<div class="insight-detail">' +
          'Your BTC treasury provides ' +
          (lastRes ? lastRes.runwayMonths.toFixed(1) : '--') +
          ' months of operating expenses as a safety net against downturns, ' +
          'inflation, or cash flow gaps.' +
        '</div>' +
      '</div>';
  }

  // ── Render: Yearly Table ──────────────────────────────────────
  function renderYearlyTable(result) {
    const tbody = $('bs-yearly-table-body');
    tbody.innerHTML = '';

    const months = result.months;

    // Show end-of-year snapshots
    for (let y = 0; y <= result.params.timeHorizonYears; y++) {
      const idx = y * 12;
      if (idx >= months.length) break;
      const m = months[idx];

      const tr = document.createElement('tr');
      const roiClass = m.treasuryROI >= 0 ? 'roi-positive' : 'roi-negative';
      const dateStr = m.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

      // Allocated this year
      const prevIdx = Math.max(0, (y - 1) * 12);
      const allocThisYear = y === 0
        ? m.cumulativeAllocatedUSD
        : m.cumulativeAllocatedUSD - months[prevIdx].cumulativeAllocatedUSD;

      tr.innerHTML =
        '<td>' + dateStr + '</td>' +
        '<td>' + fmtCurrency(m.currentAnnualRevenue) + '</td>' +
        '<td>' + fmtCurrency(m.annualProfit) + '</td>' +
        '<td>' + fmtCurrency(allocThisYear) + '</td>' +
        '<td>' + fmtCurrency(m.btcPrice) + '</td>' +
        '<td>' + m.cumulativeBTC.toFixed(6) + '</td>' +
        '<td>' + fmtCurrency(m.treasuryValueUSD) + '</td>' +
        '<td class="' + roiClass + '">' + (m.treasuryROI >= 0 ? '+' : '') + m.treasuryROI.toFixed(1) + '%</td>' +
        '<td>' + fmtPct(m.effectiveMargin) + '</td>';

      tbody.appendChild(tr);
    }
  }

  // ── Render: Comparison Table ──────────────────────────────────
  function renderComparisonTable(scenarios) {
    const tbody = $('bs-comparison-body');
    tbody.innerHTML = '';

    const bestROI = Math.max(...scenarios.map(s => s.summary.treasuryROI));

    scenarios.forEach(s => {
      const tr = document.createElement('tr');
      if (s.summary.treasuryROI === bestROI) tr.classList.add('comparison-winner');

      const roiColor  = s.summary.treasuryROI >= 0 ? 'var(--green)' : 'var(--red)';
      const gainColor = s.summary.treasuryGainLoss >= 0 ? 'var(--green)' : 'var(--red)';
      const lastRes   = s.resilience.length > 0 ? s.resilience[s.resilience.length - 1] : null;

      tr.innerHTML =
        '<td><strong>' + s.label + '</strong></td>' +
        '<td>' + fmtCurrency(s.summary.finalTreasuryValue) + '</td>' +
        '<td>' + fmtCurrency(s.summary.totalAllocatedUSD) + '</td>' +
        '<td style="color: ' + gainColor + '">' + (s.summary.treasuryGainLoss >= 0 ? '+' : '') + fmtCurrency(s.summary.treasuryGainLoss) + '</td>' +
        '<td style="color: ' + roiColor + '">' + (s.summary.treasuryROI >= 0 ? '+' : '') + s.summary.treasuryROI.toFixed(1) + '%</td>' +
        '<td>' + fmtPct(s.summary.effectiveMargin) + '</td>' +
        '<td>' + (lastRes ? lastRes.runwayMonths.toFixed(1) + ' mo' : '--') + '</td>';
      tbody.appendChild(tr);
    });
  }

  // ── Render: Insight ───────────────────────────────────────────
  function renderInsight(params, summary) {
    const el = $('bs-insight-text');
    if (!el) return;

    const scenarioName = R.scenarioLabel(params.scenarioMode);
    const strategyName = {
      'monthly_profit': 'monthly profit allocation',
      'annual_lump': 'annual lump sum',
      'initial_plus_monthly': 'initial investment + monthly allocation'
    }[params.allocationStrategy] || params.allocationStrategy;

    let text = 'Under the <strong>' + scenarioName + '</strong> scenario, allocating <strong>' +
      (params.allocationPct * 100).toFixed(0) + '%</strong> of profits via ' + strategyName +
      ' over <strong>' + params.timeHorizonYears + ' years</strong> builds a treasury of <strong>' +
      summary.totalBTC.toFixed(4) + ' BTC</strong> worth <strong>' +
      fmtCurrency(summary.finalTreasuryValue) + '</strong>.';

    if (summary.treasuryROI >= 100) {
      text += ' That\u2019s a <strong>' + summary.treasuryROI.toFixed(0) + '% return</strong> on allocated capital \u2014 a transformative addition to your balance sheet.';
    } else if (summary.treasuryROI >= 0) {
      text += ' That\u2019s a <strong>' + summary.treasuryROI.toFixed(0) + '% return</strong> on allocated capital.';
    } else {
      text += ' Under this scenario, the BTC treasury <strong>does not</strong> outperform holding cash.';
    }

    text += ' The power law model suggests that longer time horizons increase the probability of favourable returns, ' +
      'though returns decay over time as Bitcoin matures.';

    el.innerHTML = text;
    show('bs-insight-section');
  }

  function renderComparisonInsight(scenarios) {
    const el = $('bs-insight-text');
    if (!el) return;

    const profitable = scenarios.filter(s => s.summary.treasuryROI > 0);
    const losing     = scenarios.filter(s => s.summary.treasuryROI <= 0);

    let text = '<strong>' + profitable.length + ' of ' + scenarios.length + '</strong> scenarios result in a positive ROI. ';

    if (profitable.length === scenarios.length) {
      text += 'The BTC treasury strategy is profitable under every tested scenario. ';
    } else if (losing.length > 0) {
      text += 'Underperformance occurs under: ' +
        losing.map(s => '<strong>' + s.label + '</strong>').join(', ') + '. ';
    }

    const best = scenarios.reduce((a, b) => a.summary.treasuryROI > b.summary.treasuryROI ? a : b);
    text += 'Best case: <strong>' + best.label + '</strong> with ' + best.summary.treasuryROI.toFixed(0) + '% ROI ' +
      'and an effective margin of ' + fmtPct(best.summary.effectiveMargin) + '.';

    el.innerHTML = text;
    show('bs-insight-section');
  }

  // ── PDF Export ────────────────────────────────────────────────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please check your connection and refresh.');
      return;
    }

    const btn = $('bs-export-pdf-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '&#9203; Generating\u2026';
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

      // Title
      doc.setFillColor(247, 147, 26);
      doc.rect(M, y, pw, 0.5, 'F');
      y += 3;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('\u20BF Balance Sheet Bitcoin Plan', M, y);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' \u2014 Power Law Observatory', W - M, y, { align: 'right' });
      doc.setTextColor(0);
      y += 3;

      // Parameters
      const params = getParams();
      const scenarioName = R.scenarioLabel(params.scenarioMode);
      doc.setFillColor(248, 248, 248);
      doc.rect(M, y - 1, pw, 5, 'F');
      doc.setFontSize(5.5);

      const pairs = [
        ['Revenue:', fmtCurrency(params.annualRevenue)],
        ['Margin:', (params.netMarginPct * 100).toFixed(1) + '%'],
        ['Alloc:', (params.allocationPct * 100).toFixed(0) + '%'],
        ['Horizon:', params.timeHorizonYears + 'yr'],
        ['Scenario:', scenarioName],
        ['Currency:', currency]
      ];
      const pairW = pw / pairs.length;
      pairs.forEach((p, i) => {
        const x = M + i * pairW + 1;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
        doc.text(p[0], x, y + 1.5);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
        doc.text(p[1], x + doc.getTextWidth(p[0]) + 0.8, y + 1.5);
      });
      doc.setFont('helvetica', 'normal');
      y += 6;

      // Status
      const statusHeadline = $('bs-status-headline') ? $('bs-status-headline').textContent : '';
      const statusBanner   = $('bs-status-banner');
      let sR = 0, sG = 180, sB = 75;
      if (statusBanner && statusBanner.classList.contains('status-red'))   { sR = 220; sG = 30; sB = 60; }
      if (statusBanner && statusBanner.classList.contains('status-amber')) { sR = 230; sG = 140; sB = 20; }

      doc.setFillColor(sR, sG, sB);
      doc.rect(M, y, 0.8, 4, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(sR, sG, sB);
      doc.text(statusHeadline, M + 2.5, y + 2.8);
      doc.setTextColor(0);
      y += 6;

      // Chart
      const chartCanvas = $('bs-value-chart');
      const chartMaxH = 50;
      if (chartCanvas && !chartCanvas.closest('section').classList.contains('hidden')) {
        checkPage(chartMaxH + 5);
        try {
          const img = chartCanvas.toDataURL('image/png');
          const ratio = chartCanvas.height / chartCanvas.width;
          const imgH = Math.min(pw * ratio, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Balance Sheet Impact', M, y + 2);
          doc.addImage(img, 'PNG', M, y + 3, pw, imgH);
          y += imgH + 5;
        } catch (e) {}
      }

      // Summary cards
      const summaryCards = document.querySelectorAll('#bs-summary-cards .card');
      if (summaryCards.length > 0) {
        checkPage(8);
        doc.setFontSize(5);
        const cardW = pw / Math.min(summaryCards.length, 7);
        summaryCards.forEach((card, i) => {
          if (i >= 7) return;
          const x = M + i * cardW;
          const label = card.querySelector('.card-label');
          const value = card.querySelector('.card-value');
          if (label && value) {
            doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
            doc.text(label.textContent.trim(), x + 1, y + 2);
            doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
            doc.text(value.textContent.trim().substring(0, 16), x + 1, y + 5);
          }
        });
        y += 7;
      }

      // Footer
      checkPage(5);
      doc.setDrawColor(210);
      doc.line(M, y, W - M, y);
      y += 2;
      doc.setFontSize(5);
      doc.setTextColor(160);
      doc.text('Not financial advice. Power law models are educational projections, not guarantees.', W / 2, y, { align: 'center' });

      const filename = 'btc_balance_sheet_' + params.timeHorizonYears + 'yr_' + new Date().toISOString().split('T')[0] + '.pdf';
      doc.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + err.message);
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }

  // ── Start ─────────────────────────────────────────────────────
  init();

})();
