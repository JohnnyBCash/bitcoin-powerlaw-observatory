// ── Home Equity Bitcoin Calculator — UI Handler ────────────────────
// Mirrors dca-ui.js / retirement-ui.js IIFE pattern.
// Depends on: window.PowerLaw, window.Retirement, window.Equity
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;
  const E  = window.Equity;

  let currentModel    = 'santostasi';
  let valueChart      = null;
  let historicalData  = [];
  let calculatedSigma = 0.3;
  let livePrice       = null;

  const STORAGE_KEY = 'btcEquity_settings';

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
    const el = $('eq-live-price');
    if (!el) return;
    if (livePrice) {
      el.textContent = fmtCurrency(livePrice);
    } else if (!el.querySelector('.price-loading')) {
      el.textContent = 'Unavailable';
    }
  }

  // ── Equity / LTV Auto-update ──────────────────────────────────
  function updateEquityDisplay() {
    const homeValue       = parseFloat($('eq-home-value').value) || 0;
    const mortgageBalance = parseFloat($('eq-mortgage-balance').value) || 0;
    const loanAmount      = parseFloat($('eq-loan-amount').value) || 0;

    const metrics = E.computeEquityMetrics({ homeValue, mortgageBalance, loanAmount });

    const eqEl  = $('eq-home-equity');
    const eLTV  = $('eq-existing-ltv');
    const tLTV  = $('eq-total-ltv');
    const warn  = $('eq-ltv-warning');

    if (eqEl)  eqEl.textContent  = fmtCurrency(toUSD(metrics.homeEquity));
    if (eLTV)  eLTV.textContent  = fmtPct(metrics.existingLTV);
    if (tLTV)  tLTV.textContent  = fmtPct(metrics.totalLTV);

    if (warn) {
      if (metrics.ltvWarning) warn.classList.remove('hidden');
      else warn.classList.add('hidden');
    }
  }

  // ── Future Price Display ──────────────────────────────────────
  function updateFuturePrice() {
    const el = $('eq-future-price');
    if (!el) return;
    const year  = parseInt($('eq-future-year').value) || 2026;
    const month = parseInt($('eq-future-month').value) || 6;
    const futureDate = new Date(year, month - 1, 15);
    const now = new Date();
    const yrsAhead = (futureDate - now) / (365.25 * 24 * 3600 * 1000);
    if (yrsAhead <= 0) {
      el.textContent = 'Date must be in the future';
      return;
    }
    const scenarioMode = $('eq-scenario').value;
    let initialK = null;
    if (livePrice && (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }
    const k = R.resolveScenarioK(scenarioMode, yrsAhead, initialK);
    const price = R.scenarioPrice(currentModel, futureDate, calculatedSigma, k);
    el.textContent = fmtCurrency(price);
  }

  // ── Scenario Descriptions ────────────────────────────────────
  const scenarioDescriptions = {
    cyclical: 'Boom-bust cycles around the power law trend with gradually lengthening periods \u2014 the most realistic historical pattern.',
    cyclical_bear: 'Same cyclical pattern but spending 60% of the time below trend \u2014 a pessimistic but plausible path.',
    smooth_trend: 'Price follows the power law trend exactly with no volatility \u2014 an idealised baseline.',
    smooth_bear: 'Price stays flat at 1 standard deviation below the trend for the entire period \u2014 a persistent bear market.',
    smooth_deep_bear: 'Price stays flat at 2 standard deviations below trend \u2014 an extreme, prolonged downturn.'
  };

  function updateScenarioDescription() {
    const el = $('eq-scenario-desc');
    if (!el) return;
    const mode = $('eq-scenario').value;
    el.textContent = scenarioDescriptions[mode] || '';
  }

  // ── Input Validation ────────────────────────────────────────
  function validateInputs() {
    const loanAmount      = parseFloat($('eq-loan-amount').value) || 0;
    const homeValue       = parseFloat($('eq-home-value').value) || 0;
    const mortgageBalance = parseFloat($('eq-mortgage-balance').value) || 0;
    const duration        = parseInt($('eq-duration').value) || 0;
    const rate            = parseFloat($('eq-interest-rate').value) || 0;

    clearValidation();

    if (loanAmount > 0 && homeValue > 0 && loanAmount > (homeValue - mortgageBalance)) {
      showValidation('eq-loan-amount', 'Loan exceeds available home equity');
    }
    if (rate === 0) {
      showValidation('eq-interest-rate', '0% rate is unrealistic for most loans');
    }
    if (duration > 30) {
      showValidation('eq-duration', 'Durations over 30 years are unusual');
    }
  }

  function showValidation(inputId, msg) {
    let el = document.querySelector('#' + inputId + ' ~ .validation-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'validation-msg';
      const input = $(inputId);
      if (input) input.parentNode.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
  }

  function clearValidation() {
    document.querySelectorAll('.validation-msg').forEach(el => el.classList.remove('visible'));
  }

  // ── Gather User Inputs ────────────────────────────────────────
  function getParams() {
    const scenarioMode = $('eq-scenario').value;
    const buyNow       = $('eq-buy-timing').value === 'now';

    let initialK = null;
    if (livePrice && (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      loanAmount:        toUSD(parseFloat($('eq-loan-amount').value) || 100000),
      loanDurationYears: parseInt($('eq-duration').value) || 15,
      loanInterestRate:  parseFloat($('eq-interest-rate').value) / 100,
      interestOnly:      $('eq-interest-only').checked,

      homeValue:         toUSD(parseFloat($('eq-home-value').value) || 400000),
      mortgageBalance:   toUSD(parseFloat($('eq-mortgage-balance').value) || 200000),
      mortgageRate:      parseFloat($('eq-mortgage-rate').value) / 100,

      buyNow,
      futureBuyYear:     buyNow ? null : (parseInt($('eq-future-year').value) || 2026),
      futureBuyMonth:    buyNow ? null : (parseInt($('eq-future-month').value) || 6),

      model:             currentModel,
      sigma:             calculatedSigma,
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
    updateEquityDisplay();
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
    // Interest rate slider
    const irSlider = $('eq-interest-rate');
    if (irSlider) {
      irSlider.addEventListener('input', () => {
        const disp = $('eq-interest-value');
        if (disp) disp.textContent = irSlider.value;
      });
    }
    // Mortgage rate slider
    const mrSlider = $('eq-mortgage-rate');
    if (mrSlider) {
      mrSlider.addEventListener('input', () => {
        const disp = $('eq-mortgage-rate-value');
        if (disp) disp.textContent = mrSlider.value;
      });
    }
  }

  function setupToggles() {
    // Currency toggle
    const currSel = $('eq-currency');
    if (currSel) {
      currSel.addEventListener('change', () => {
        currency = currSel.value;
        const sym = currency === 'EUR' ? '\u20AC' : '$';
        ['eq-currency-label', 'eq-currency-label2', 'eq-currency-label3'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = sym;
        });
        updateLivePrice();
        updateEquityDisplay();
      });
    }

    // Buy timing toggle
    const timingSel = $('eq-buy-timing');
    if (timingSel) {
      timingSel.addEventListener('change', () => {
        if (timingSel.value === 'future') {
          show('eq-future-date-section');
          updateFuturePrice();
        } else {
          hide('eq-future-date-section');
        }
      });
    }

    // Future date changes
    const fy = $('eq-future-year');
    const fm = $('eq-future-month');
    if (fy) fy.addEventListener('change', updateFuturePrice);
    if (fm) fm.addEventListener('change', updateFuturePrice);

    // Scenario change updates future price + description
    const scn = $('eq-scenario');
    if (scn) {
      scn.addEventListener('change', () => {
        updateFuturePrice();
        updateScenarioDescription();
      });
    }

    // Auto-update equity/LTV and validation on relevant input changes
    ['eq-home-value', 'eq-mortgage-balance', 'eq-loan-amount'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        updateEquityDisplay();
        validateInputs();
      });
    });
  }

  function setupButtons() {
    $('eq-calculate-btn').addEventListener('click', runCalculation);
    $('eq-compare-btn').addEventListener('click', runComparison);
    $('eq-export-pdf-btn').addEventListener('click', exportPDF);
    $('eq-reset-btn').addEventListener('click', resetDefaults);
  }

  // ── Settings Persistence ──────────────────────────────────────
  function saveSettings() {
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      inputs: {
        'eq-loan-amount':      parseFloat($('eq-loan-amount').value),
        'eq-currency':         $('eq-currency').value,
        'eq-duration':         parseInt($('eq-duration').value),
        'eq-interest-rate':    parseFloat($('eq-interest-rate').value),
        'eq-interest-only':    $('eq-interest-only').checked,
        'eq-home-value':       parseFloat($('eq-home-value').value),
        'eq-mortgage-balance': parseFloat($('eq-mortgage-balance').value),
        'eq-mortgage-rate':    parseFloat($('eq-mortgage-rate').value),
        'eq-buy-timing':       $('eq-buy-timing').value,
        'eq-future-year':      parseInt($('eq-future-year').value),
        'eq-future-month':     parseInt($('eq-future-month').value),
        'eq-scenario':         $('eq-scenario').value
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
      ['eq-loan-amount', 'eq-duration', 'eq-home-value', 'eq-mortgage-balance',
       'eq-future-year'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Sliders + display
      if (inp['eq-interest-rate'] !== undefined) {
        $('eq-interest-rate').value = inp['eq-interest-rate'];
        const d = $('eq-interest-value');
        if (d) d.textContent = inp['eq-interest-rate'];
      }
      if (inp['eq-mortgage-rate'] !== undefined) {
        $('eq-mortgage-rate').value = inp['eq-mortgage-rate'];
        const d = $('eq-mortgage-rate-value');
        if (d) d.textContent = inp['eq-mortgage-rate'];
      }

      // Selects
      ['eq-currency', 'eq-buy-timing', 'eq-future-month', 'eq-scenario'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Checkbox
      if (inp['eq-interest-only'] !== undefined) {
        $('eq-interest-only').checked = inp['eq-interest-only'];
      }

      // Currency state
      if (inp['eq-currency']) {
        currency = inp['eq-currency'];
        const sym = currency === 'EUR' ? '\u20AC' : '$';
        ['eq-currency-label', 'eq-currency-label2', 'eq-currency-label3'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = sym;
        });
      }

      // Buy timing visibility
      if (inp['eq-buy-timing'] === 'future') {
        show('eq-future-date-section');
      }

      return true;
    } catch (e) {
      console.warn('Failed to load settings:', e);
      return false;
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    $('eq-loan-amount').value      = 100000;
    $('eq-currency').value         = 'USD';
    $('eq-duration').value         = 15;
    $('eq-interest-rate').value    = 4.5;
    $('eq-interest-only').checked  = false;
    $('eq-home-value').value       = 400000;
    $('eq-mortgage-balance').value = 200000;
    $('eq-mortgage-rate').value    = 3.5;
    $('eq-buy-timing').value       = 'now';
    $('eq-future-year').value      = 2026;
    $('eq-future-month').value     = 6;
    $('eq-scenario').value         = 'cyclical';

    $('eq-interest-value').textContent     = '4.5';
    $('eq-mortgage-rate-value').textContent = '3.5';

    currency = 'USD';
    ['eq-currency-label', 'eq-currency-label2', 'eq-currency-label3'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = '$';
    });

    hide('eq-future-date-section');
    updateEquityDisplay();
    updateLivePrice();
  }

  // ── Main Calculation ──────────────────────────────────────────
  function runCalculation() {
    saveSettings();
    const params = getParams();
    const result  = E.simulateEquityLoan(params, livePrice);
    const summary = E.simulationSummary(result);

    renderStatusBanner(summary);
    renderSummaryCards(summary);
    renderValueChart(result);
    renderYearlyTable(result);
    renderInsight(params, summary);

    show('eq-results-section');
    show('eq-chart-section');
    show('eq-table-section');
    show('eq-insight-section');
    hide('eq-comparison-section');
    show('eq-action-buttons');

    $('eq-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Comparison Mode ───────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();

    // Also run single calculation for the main view
    const result  = E.simulateEquityLoan(params, livePrice);
    const summary = E.simulationSummary(result);

    renderStatusBanner(summary);
    renderSummaryCards(summary);
    renderValueChart(result);
    renderYearlyTable(result);

    const scenarios = E.compareScenarios(params, livePrice);
    renderComparisonTable(scenarios);

    show('eq-results-section');
    show('eq-chart-section');
    show('eq-table-section');
    show('eq-comparison-section');
    show('eq-insight-section');
    show('eq-action-buttons');

    renderComparisonInsight(scenarios);

    $('eq-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Render: Status Banner ─────────────────────────────────────
  function renderStatusBanner(summary) {
    const banner   = $('eq-status-banner');
    const icon     = $('eq-status-icon');
    const headline = $('eq-status-headline');
    const detail   = $('eq-status-detail');

    banner.classList.remove('status-green', 'status-amber', 'status-red', 'hidden');
    banner.style.animation = 'none';
    banner.offsetHeight;
    banner.style.animation = '';

    if (summary.roiPct >= 50) {
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      headline.textContent = 'Strong return: ' + summary.roiPct.toFixed(0) + '% ROI';
      detail.innerHTML =
        'Your ' + fmtCurrency(summary.totalCost) + ' total cost produces a Bitcoin position worth ' +
        '<strong>' + fmtCurrency(summary.finalBtcValue) + '</strong>, a net gain of ' +
        '<strong>' + fmtCurrency(summary.netGainLoss) + '</strong>.' +
        (summary.breakEvenMonth !== null
          ? ' Break-even at month ' + summary.breakEvenMonth + '.'
          : '');
    } else if (summary.roiPct >= 0) {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'Modest return: ' + summary.roiPct.toFixed(0) + '% ROI';
      detail.innerHTML =
        'Your Bitcoin slightly outpaces the loan cost. Net gain: <strong>' +
        fmtCurrency(summary.netGainLoss) + '</strong>. A longer duration or different scenario may improve returns.';
    } else {
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = 'Loss under this scenario';
      detail.innerHTML =
        'The loan costs <strong>' + fmtCurrency(summary.totalCost) + '</strong> but the Bitcoin is only worth <strong>' +
        fmtCurrency(summary.finalBtcValue) + '</strong> at the end. Net loss: <strong>' +
        fmtCurrency(summary.netGainLoss) + '</strong>. Consider a longer horizon or more conservative scenario.';
    }

    // LTV warning overlay
    if (summary.maxLTV > 0.80) {
      detail.innerHTML += '<br><span style="color: var(--red);">\u26A0 Peak LTV reached ' +
        fmtPct(summary.maxLTV) + ' — lender may require mortgage insurance.</span>';
    }

    show('eq-status-banner');
  }

  // ── Render: Summary Cards ─────────────────────────────────────
  function renderSummaryCards(summary) {
    const container = $('eq-summary-cards');
    const roiColor  = summary.roiPct >= 0 ? 'var(--green)' : 'var(--red)';
    const gainColor = summary.netGainLoss >= 0 ? 'var(--green)' : 'var(--red)';

    const breakEvenText = summary.breakEvenMonth !== null
      ? 'Month ' + summary.breakEvenMonth + ' (' + summary.breakEvenDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) + ')'
      : 'Not reached';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-label">Monthly Payment</div>' +
        '<div class="card-value">' + fmtCurrency(summary.monthlyPayment) + '</div>' +
        '<div class="card-sub">per month</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Total Cost</div>' +
        '<div class="card-value">' + fmtCurrency(summary.totalCost) + '</div>' +
        '<div class="card-sub">' + fmtCurrency(summary.totalInterest) + ' in interest</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">BTC Bought</div>' +
        '<div class="card-value" style="color: var(--orange)">' + summary.btcAmount.toFixed(6) + ' BTC</div>' +
        '<div class="card-sub">at ' + fmtCurrency(summary.buyPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Final BTC Value</div>' +
        '<div class="card-value">' + fmtCurrency(summary.finalBtcValue) + '</div>' +
        '<div class="card-sub">at ' + fmtCurrency(summary.finalBtcPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Net Gain / Loss</div>' +
        '<div class="card-value" style="color: ' + gainColor + '">' +
          (summary.netGainLoss >= 0 ? '+' : '') + fmtCurrency(summary.netGainLoss) +
        '</div>' +
        '<div class="card-sub" style="color: ' + roiColor + '">' +
          (summary.roiPct >= 0 ? '+' : '') + summary.roiPct.toFixed(1) + '% ROI</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Break-Even</div>' +
        '<div class="card-value">' + breakEvenText + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Total LTV</div>' +
        '<div class="card-value" style="color: ' + (summary.maxLTV > 0.8 ? 'var(--red)' : 'inherit') + '">' +
          fmtPct(summary.finalLTV) +
        '</div>' +
        '<div class="card-sub">Peak: ' + fmtPct(summary.maxLTV) + '</div>' +
      '</div>';
  }

  // ── Render: Value Chart ───────────────────────────────────────
  function renderValueChart(result) {
    const ctx = $('eq-value-chart');
    if (valueChart) valueChart.destroy();

    const r = getRate();

    // Sample every N months for performance
    const months = result.months;
    const step = months.length > 360 ? 3 : 1;
    const sampled = months.filter((_, i) => i % step === 0 || i === months.length - 1);

    valueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sampled.map(m => m.date),
        datasets: [
          {
            label: 'Bitcoin Value (' + currency + ')',
            data: sampled.map(m => m.btcValueUSD * r),
            borderColor: '#00C853',
            backgroundColor: 'rgba(0, 200, 83, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Cumulative Cost (' + currency + ')',
            data: sampled.map(m => m.cumulativePayments * r),
            borderColor: '#F7931A',
            backgroundColor: 'rgba(247, 147, 26, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Loan Balance (' + currency + ')',
            data: sampled.map(m => m.remainingLoanBalance * r),
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

  // ── Render: Yearly Table ──────────────────────────────────────
  function renderYearlyTable(result) {
    const tbody = $('eq-yearly-table-body');
    tbody.innerHTML = '';

    const months = result.months;

    // Show end-of-year snapshots (every 12 months) + first + last
    let lastYear = null;
    const snapshots = [];

    months.forEach((m, i) => {
      const yr = m.date.getFullYear();
      if (i === 0) { snapshots.push(m); lastYear = yr; return; }
      if (yr !== lastYear || i === months.length - 1) {
        // Push the previous month as end-of-year
        if (i > 0 && yr !== lastYear) snapshots.push(months[i - 1]);
        if (i === months.length - 1) snapshots.push(m);
        lastYear = yr;
      }
    });

    // De-duplicate
    const seen = new Set();
    const unique = snapshots.filter(m => {
      const key = m.monthIndex;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.forEach(m => {
      const tr = document.createElement('tr');
      const roiClass = m.roi >= 0 ? 'roi-positive' : 'roi-negative';
      const dateStr = m.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

      // Compute annual cost (payments in this year)
      const yearStart = Math.max(0, m.monthIndex - 11);
      let annualCost = 0;
      for (let j = yearStart; j <= m.monthIndex && j < result.months.length; j++) {
        annualCost += result.months[j].monthlyPayment;
      }

      tr.innerHTML =
        '<td>' + dateStr + '</td>' +
        '<td>' + fmtCurrency(m.btcPrice) + '</td>' +
        '<td>' + fmtCurrency(m.btcValueUSD) + '</td>' +
        '<td>' + fmtCurrency(annualCost) + '</td>' +
        '<td>' + fmtCurrency(m.cumulativePayments) + '</td>' +
        '<td>' + fmtCurrency(m.remainingLoanBalance) + '</td>' +
        '<td style="color: ' + (m.netPosition >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
          (m.netPosition >= 0 ? '+' : '') + fmtCurrency(m.netPosition) + '</td>' +
        '<td style="color: ' + (m.totalLTV > 0.8 ? 'var(--red)' : 'inherit') + '">' + fmtPct(m.totalLTV) + '</td>' +
        '<td class="' + roiClass + '">' + (m.roi >= 0 ? '+' : '') + m.roi.toFixed(1) + '%</td>';

      tbody.appendChild(tr);
    });
  }

  // ── Render: Comparison Table ──────────────────────────────────
  function renderComparisonTable(scenarios) {
    const tbody = $('eq-comparison-body');
    tbody.innerHTML = '';

    const bestROI = Math.max(...scenarios.map(s => s.summary.roiPct));

    scenarios.forEach(s => {
      const tr = document.createElement('tr');
      if (s.summary.roiPct === bestROI) tr.classList.add('comparison-winner');

      const roiColor = s.summary.roiPct >= 0 ? 'var(--green)' : 'var(--red)';
      const gainColor = s.summary.netGainLoss >= 0 ? 'var(--green)' : 'var(--red)';
      const beText = s.summary.breakEvenMonth !== null
        ? 'Month ' + s.summary.breakEvenMonth
        : 'Never';

      tr.innerHTML =
        '<td><strong>' + s.label + '</strong></td>' +
        '<td>' + fmtCurrency(s.summary.finalBtcValue) + '</td>' +
        '<td>' + fmtCurrency(s.summary.totalCost) + '</td>' +
        '<td style="color: ' + gainColor + '">' + (s.summary.netGainLoss >= 0 ? '+' : '') + fmtCurrency(s.summary.netGainLoss) + '</td>' +
        '<td style="color: ' + roiColor + '">' + (s.summary.roiPct >= 0 ? '+' : '') + s.summary.roiPct.toFixed(1) + '%</td>' +
        '<td>' + beText + '</td>';
      tbody.appendChild(tr);
    });
  }

  // ── Render: Insight ───────────────────────────────────────────
  function renderInsight(params, summary) {
    const el = $('eq-insight-text');
    if (!el) return;

    const scenarioName = R.scenarioLabel(params.scenarioMode);
    const loanType = params.interestOnly ? 'interest-only' : 'amortizing';

    let text = 'Under the <strong>' + scenarioName + '</strong> scenario, a <strong>' +
      fmtCurrency(params.loanAmount) + '</strong> ' + loanType +
      ' equity loan over <strong>' + params.loanDurationYears + ' years</strong> at ' +
      (params.loanInterestRate * 100).toFixed(1) + '% buys <strong>' +
      summary.btcAmount.toFixed(4) + ' BTC</strong>.';

    if (summary.roiPct >= 100) {
      text += ' That\u2019s a <strong>' + summary.roiPct.toFixed(0) + '% return</strong> on total cost \u2014 your money more than doubled.';
    } else if (summary.roiPct >= 0) {
      text += ' That\u2019s a <strong>' + summary.roiPct.toFixed(0) + '% return</strong> on your total loan cost.';
    } else {
      text += ' Under this scenario, the Bitcoin does <strong>not</strong> outpace the loan cost by maturity.';
    }

    if (summary.breakEvenMonth !== null) {
      text += ' You break even at <strong>month ' + summary.breakEvenMonth + '</strong>';
      if (summary.breakEvenDate) {
        text += ' (' + summary.breakEvenDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) + ')';
      }
      text += '.';
    }

    text += ' The power law model suggests that longer time horizons increase the probability of favourable returns, ' +
      'though returns decay over time as Bitcoin matures.';

    el.innerHTML = text;
    show('eq-insight-section');
  }

  function renderComparisonInsight(scenarios) {
    const el = $('eq-insight-text');
    if (!el) return;

    const profitable = scenarios.filter(s => s.summary.roiPct > 0);
    const losing     = scenarios.filter(s => s.summary.roiPct <= 0);

    let text = '<strong>' + profitable.length + ' of ' + scenarios.length + '</strong> scenarios result in a positive ROI. ';

    if (profitable.length === scenarios.length) {
      text += 'The equity loan is profitable under every tested scenario. ';
    } else if (losing.length > 0) {
      text += 'Losses occur under: ' +
        losing.map(s => '<strong>' + s.label + '</strong>').join(', ') + '. ';
    }

    const best = scenarios.reduce((a, b) => a.summary.roiPct > b.summary.roiPct ? a : b);
    text += 'Best case: <strong>' + best.label + '</strong> with ' + best.summary.roiPct.toFixed(0) + '% ROI.';

    el.innerHTML = text;
    show('eq-insight-section');
  }

  // ── PDF Export ────────────────────────────────────────────────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please check your connection and refresh.');
      return;
    }

    const btn = $('eq-export-pdf-btn');
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
      doc.text('\u20BF Home Equity Bitcoin Plan', M, y);
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
        ['Loan:', fmtCurrency(params.loanAmount)],
        ['Duration:', params.loanDurationYears + 'yr'],
        ['Rate:', (params.loanInterestRate * 100).toFixed(1) + '%'],
        ['Type:', params.interestOnly ? 'Interest-only' : 'Amortizing'],
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
      const statusHeadline = $('eq-status-headline') ? $('eq-status-headline').textContent : '';
      const statusBanner   = $('eq-status-banner');
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
      const chartCanvas = $('eq-value-chart');
      const chartMaxH = 50;
      if (chartCanvas && !chartCanvas.closest('section').classList.contains('hidden')) {
        checkPage(chartMaxH + 5);
        try {
          const img = chartCanvas.toDataURL('image/png');
          const ratio = chartCanvas.height / chartCanvas.width;
          const imgH = Math.min(pw * ratio, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Bitcoin Value vs Loan Cost', M, y + 2);
          doc.addImage(img, 'PNG', M, y + 3, pw, imgH);
          y += imgH + 5;
        } catch (e) {}
      }

      // Summary cards
      const summaryCards = document.querySelectorAll('#eq-summary-cards .card');
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

      const filename = 'btc_equity_' + params.loanDurationYears + 'yr_' + new Date().toISOString().split('T')[0] + '.pdf';
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
