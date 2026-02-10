// ── Overwaarde Bitcoin Rekentool — UI Handler (NL) ─────────────────
// Spiegelt equity-ui.js IIFE-patroon met Nederlandse vertalingen.
// Afhankelijk van: window.PowerLaw, window.Retirement, window.Equity
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

  const STORAGE_KEY = 'btcEquity_settings_nl';

  // ── Scenario Labels (NL) ──────────────────────────────────────
  function scenarioLabelNL(mode) {
    const labels = {
      'smooth_trend': 'Vlakke Trend',
      'smooth_bear': 'Bear (\u22121\u03C3)',
      'smooth_deep_bear': 'Diepe Bear (\u22122\u03C3)',
      'cyclical': 'Cyclisch (\u00B11\u03C3)',
      'cyclical_bear': 'Bear Bias'
    };
    return labels[mode] || mode;
  }

  // ── Valuta Ondersteuning ──────────────────────────────────────
  let currency = 'EUR';
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
    if (val >= 1e3) return sign + sym + Math.round(val).toLocaleString('nl-NL');
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
      console.warn('Live data ophalen mislukt, gebruik fallback', e);
      eurRate = 0.92;
    }
    updateLivePrice();
  }

  // ── DOM Helpers ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
  const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

  // ── Live Prijs Weergave ───────────────────────────────────────
  function updateLivePrice() {
    const el = $('eq-live-price');
    if (!el) return;
    if (livePrice) {
      el.textContent = fmtCurrency(livePrice);
    } else {
      el.textContent = 'Niet beschikbaar';
    }
  }

  // ── Overwaarde / LTV Auto-update ──────────────────────────────
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

  // ── Toekomstige Prijs Weergave ────────────────────────────────
  function updateFuturePrice() {
    const el = $('eq-future-price');
    if (!el) return;
    const year  = parseInt($('eq-future-year').value) || 2026;
    const month = parseInt($('eq-future-month').value) || 6;
    const futureDate = new Date(year, month - 1, 15);
    const now = new Date();
    const yrsAhead = (futureDate - now) / (365.25 * 24 * 3600 * 1000);
    if (yrsAhead <= 0) {
      el.textContent = 'Datum moet in de toekomst liggen';
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

  // ── Gebruikersinvoer Verzamelen ───────────────────────────────
  function getParams() {
    const scenarioMode = $('eq-scenario').value;
    const buyNow       = $('eq-buy-timing').value === 'now';

    let initialK = null;
    if (livePrice && (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      loanAmount:        toUSD(parseFloat($('eq-loan-amount').value) || 50000),
      loanDurationYears: parseInt($('eq-duration').value) || 10,
      loanInterestRate:  parseFloat($('eq-interest-rate').value) / 100,
      interestOnly:      $('eq-interest-only').checked,

      homeValue:         toUSD(parseFloat($('eq-home-value').value) || 500000),
      mortgageBalance:   toUSD(parseFloat($('eq-mortgage-balance').value) || 300000),
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

  // ── Initialisatie ─────────────────────────────────────────────
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
      const response = await fetch('../../datasets/btc_historical.json');
      historicalData = await response.json();
      const sigmaData = PL.calculateSigma(historicalData, currentModel);
      calculatedSigma = sigmaData.sigma;
    } catch (e) {
      console.warn('Historische data laden mislukt:', e);
    }
  }

  // ── Setup Functies ────────────────────────────────────────────
  function setupSliders() {
    const irSlider = $('eq-interest-rate');
    if (irSlider) {
      irSlider.addEventListener('input', () => {
        const disp = $('eq-interest-value');
        if (disp) disp.textContent = irSlider.value;
      });
    }
    const mrSlider = $('eq-mortgage-rate');
    if (mrSlider) {
      mrSlider.addEventListener('input', () => {
        const disp = $('eq-mortgage-rate-value');
        if (disp) disp.textContent = mrSlider.value;
      });
    }
  }

  function setupToggles() {
    // Valutawissel
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

    // Koopmoment wissel
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

    // Toekomstige datum wijzigingen
    const fy = $('eq-future-year');
    const fm = $('eq-future-month');
    if (fy) fy.addEventListener('change', updateFuturePrice);
    if (fm) fm.addEventListener('change', updateFuturePrice);

    // Scenario wijziging update toekomstige prijs
    const scn = $('eq-scenario');
    if (scn) scn.addEventListener('change', updateFuturePrice);

    // Auto-update overwaarde/LTV bij relevante invoerwijzigingen
    ['eq-home-value', 'eq-mortgage-balance', 'eq-loan-amount'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', updateEquityDisplay);
    });
  }

  function setupButtons() {
    $('eq-calculate-btn').addEventListener('click', runCalculation);
    $('eq-compare-btn').addEventListener('click', runComparison);
    $('eq-export-pdf-btn').addEventListener('click', exportPDF);
    $('eq-reset-btn').addEventListener('click', resetDefaults);
  }

  // ── Instellingen Opslag ───────────────────────────────────────
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
    catch (e) { console.warn('Instellingen opslaan mislukt:', e); }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.inputs) return false;
      const inp = data.inputs;

      ['eq-loan-amount', 'eq-duration', 'eq-home-value', 'eq-mortgage-balance',
       'eq-future-year'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

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

      ['eq-currency', 'eq-buy-timing', 'eq-future-month', 'eq-scenario'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      if (inp['eq-interest-only'] !== undefined) {
        $('eq-interest-only').checked = inp['eq-interest-only'];
      }

      if (inp['eq-currency']) {
        currency = inp['eq-currency'];
        const sym = currency === 'EUR' ? '\u20AC' : '$';
        ['eq-currency-label', 'eq-currency-label2', 'eq-currency-label3'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = sym;
        });
      }

      if (inp['eq-buy-timing'] === 'future') {
        show('eq-future-date-section');
      }

      return true;
    } catch (e) {
      console.warn('Instellingen laden mislukt:', e);
      return false;
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* negeren */ }

    $('eq-loan-amount').value      = 50000;
    $('eq-currency').value         = 'EUR';
    $('eq-duration').value         = 10;
    $('eq-interest-rate').value    = 4.5;
    $('eq-interest-only').checked  = false;
    $('eq-home-value').value       = 500000;
    $('eq-mortgage-balance').value = 300000;
    $('eq-mortgage-rate').value    = 3.5;
    $('eq-buy-timing').value       = 'now';
    $('eq-future-year').value      = 2026;
    $('eq-future-month').value     = 6;
    $('eq-scenario').value         = 'cyclical';

    $('eq-interest-value').textContent     = '4.5';
    $('eq-mortgage-rate-value').textContent = '3.5';

    currency = 'EUR';
    ['eq-currency-label', 'eq-currency-label2', 'eq-currency-label3'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = '\u20AC';
    });

    hide('eq-future-date-section');
    updateEquityDisplay();
    updateLivePrice();
  }

  // ── Hoofdberekening ───────────────────────────────────────────
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

  // ── Vergelijkingsmodus ────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();

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

  // ── Render: Statusbanner ──────────────────────────────────────
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
      headline.textContent = 'Sterk rendement: ' + summary.roiPct.toFixed(0) + '% ROI';
      detail.innerHTML =
        'Je totale kosten van ' + fmtCurrency(summary.totalCost) + ' leveren een Bitcoin-positie op ter waarde van ' +
        '<strong>' + fmtCurrency(summary.finalBtcValue) + '</strong>, een nettowinst van ' +
        '<strong>' + fmtCurrency(summary.netGainLoss) + '</strong>.' +
        (summary.breakEvenMonth !== null
          ? ' Break-even bij maand ' + summary.breakEvenMonth + '.'
          : '');
    } else if (summary.roiPct >= 0) {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'Bescheiden rendement: ' + summary.roiPct.toFixed(0) + '% ROI';
      detail.innerHTML =
        'Je Bitcoin overtreft de leenkosten licht. Nettowinst: <strong>' +
        fmtCurrency(summary.netGainLoss) + '</strong>. Een langere looptijd of ander scenario kan het rendement verbeteren.';
    } else {
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = 'Verlies onder dit scenario';
      detail.innerHTML =
        'De lening kost <strong>' + fmtCurrency(summary.totalCost) + '</strong> maar de Bitcoin is slechts <strong>' +
        fmtCurrency(summary.finalBtcValue) + '</strong> waard aan het einde. Nettoverlies: <strong>' +
        fmtCurrency(summary.netGainLoss) + '</strong>. Overweeg een langere looptijd of conservatiever scenario.';
    }

    if (summary.maxLTV > 0.80) {
      detail.innerHTML += '<br><span style="color: var(--red);">\u26A0 Piek-LTV bereikte ' +
        fmtPct(summary.maxLTV) + ' \u2014 geldverstrekker kan hypotheekverzekering vereisen.</span>';
    }

    show('eq-status-banner');
  }

  // ── Render: Samenvattingskaarten ──────────────────────────────
  function renderSummaryCards(summary) {
    const container = $('eq-summary-cards');
    const roiColor  = summary.roiPct >= 0 ? 'var(--green)' : 'var(--red)';
    const gainColor = summary.netGainLoss >= 0 ? 'var(--green)' : 'var(--red)';

    const breakEvenText = summary.breakEvenMonth !== null
      ? 'Maand ' + summary.breakEvenMonth + ' (' + summary.breakEvenDate.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' }) + ')'
      : 'Niet bereikt';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-label">Maandlasten</div>' +
        '<div class="card-value">' + fmtCurrency(summary.monthlyPayment) + '</div>' +
        '<div class="card-sub">per maand</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Totale Kosten</div>' +
        '<div class="card-value">' + fmtCurrency(summary.totalCost) + '</div>' +
        '<div class="card-sub">' + fmtCurrency(summary.totalInterest) + ' aan rente</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">BTC Gekocht</div>' +
        '<div class="card-value" style="color: var(--orange)">' + summary.btcAmount.toFixed(6) + ' BTC</div>' +
        '<div class="card-sub">tegen ' + fmtCurrency(summary.buyPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Eindwaarde BTC</div>' +
        '<div class="card-value">' + fmtCurrency(summary.finalBtcValue) + '</div>' +
        '<div class="card-sub">tegen ' + fmtCurrency(summary.finalBtcPrice) + '/BTC</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Netto Winst / Verlies</div>' +
        '<div class="card-value" style="color: ' + gainColor + '">' +
          (summary.netGainLoss >= 0 ? '+' : '') + fmtCurrency(summary.netGainLoss) +
        '</div>' +
        '<div class="card-sub" style="color: ' + roiColor + '">' +
          (summary.roiPct >= 0 ? '+' : '') + summary.roiPct.toFixed(1) + '% ROI</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Break-even</div>' +
        '<div class="card-value">' + breakEvenText + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-label">Totaal LTV</div>' +
        '<div class="card-value" style="color: ' + (summary.maxLTV > 0.8 ? 'var(--red)' : 'inherit') + '">' +
          fmtPct(summary.finalLTV) +
        '</div>' +
        '<div class="card-sub">Piek: ' + fmtPct(summary.maxLTV) + '</div>' +
      '</div>';
  }

  // ── Render: Waardegrafiek ─────────────────────────────────────
  function renderValueChart(result) {
    const ctx = $('eq-value-chart');
    if (valueChart) valueChart.destroy();

    const r = getRate();
    const months = result.months;
    const step = months.length > 360 ? 3 : 1;
    const sampled = months.filter((_, i) => i % step === 0 || i === months.length - 1);

    valueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sampled.map(m => m.date),
        datasets: [
          {
            label: 'Bitcoin Waarde (' + currency + ')',
            data: sampled.map(m => m.btcValueUSD * r),
            borderColor: '#00C853',
            backgroundColor: 'rgba(0, 200, 83, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Cumulatieve Kosten (' + currency + ')',
            data: sampled.map(m => m.cumulativePayments * r),
            borderColor: '#F7931A',
            backgroundColor: 'rgba(247, 147, 26, 0.08)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Leningsaldo (' + currency + ')',
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
                return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' });
              },
              label: item => item.dataset.label + ': ' + getCurrencySymbol() + Math.round(item.raw).toLocaleString('nl-NL')
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

  // ── Render: Jaarlijks Overzicht ───────────────────────────────
  function renderYearlyTable(result) {
    const tbody = $('eq-yearly-table-body');
    tbody.innerHTML = '';

    const months = result.months;
    let lastYear = null;
    const snapshots = [];

    months.forEach((m, i) => {
      const yr = m.date.getFullYear();
      if (i === 0) { snapshots.push(m); lastYear = yr; return; }
      if (yr !== lastYear || i === months.length - 1) {
        if (i > 0 && yr !== lastYear) snapshots.push(months[i - 1]);
        if (i === months.length - 1) snapshots.push(m);
        lastYear = yr;
      }
    });

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
      const dateStr = m.date.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' });

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

  // ── Render: Vergelijkingstabel ────────────────────────────────
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
        ? 'Maand ' + s.summary.breakEvenMonth
        : 'Nooit';

      tr.innerHTML =
        '<td><strong>' + scenarioLabelNL(s.scenarioMode) + '</strong></td>' +
        '<td>' + fmtCurrency(s.summary.finalBtcValue) + '</td>' +
        '<td>' + fmtCurrency(s.summary.totalCost) + '</td>' +
        '<td style="color: ' + gainColor + '">' + (s.summary.netGainLoss >= 0 ? '+' : '') + fmtCurrency(s.summary.netGainLoss) + '</td>' +
        '<td style="color: ' + roiColor + '">' + (s.summary.roiPct >= 0 ? '+' : '') + s.summary.roiPct.toFixed(1) + '%</td>' +
        '<td>' + beText + '</td>';
      tbody.appendChild(tr);
    });
  }

  // ── Render: Inzicht ───────────────────────────────────────────
  function renderInsight(params, summary) {
    const el = $('eq-insight-text');
    if (!el) return;

    const scenarioName = scenarioLabelNL(params.scenarioMode);
    const loanType = params.interestOnly ? 'aflossingsvrij' : 'annuïtair';

    let text = 'Onder het <strong>' + scenarioName + '</strong> scenario levert een <strong>' +
      fmtCurrency(params.loanAmount) + '</strong> ' + loanType +
      ' overwaardekrediet over <strong>' + params.loanDurationYears + ' jaar</strong> tegen ' +
      (params.loanInterestRate * 100).toFixed(1) + '% rente <strong>' +
      summary.btcAmount.toFixed(4) + ' BTC</strong> op.';

    if (summary.roiPct >= 100) {
      text += ' Dat is een <strong>' + summary.roiPct.toFixed(0) + '% rendement</strong> op de totale kosten \u2014 je geld is meer dan verdubbeld.';
    } else if (summary.roiPct >= 0) {
      text += ' Dat is een <strong>' + summary.roiPct.toFixed(0) + '% rendement</strong> op je totale leenkosten.';
    } else {
      text += ' Onder dit scenario overtreft de Bitcoin de leenkosten <strong>niet</strong> voor het einde van de looptijd.';
    }

    if (summary.breakEvenMonth !== null) {
      text += ' Je bereikt break-even bij <strong>maand ' + summary.breakEvenMonth + '</strong>';
      if (summary.breakEvenDate) {
        text += ' (' + summary.breakEvenDate.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' }) + ')';
      }
      text += '.';
    }

    text += ' Het machtswetmodel suggereert dat langere looptijden de kans op gunstige rendementen vergroten, ' +
      'hoewel rendementen afnemen naarmate Bitcoin volwassener wordt.';

    el.innerHTML = text;
    show('eq-insight-section');
  }

  function renderComparisonInsight(scenarios) {
    const el = $('eq-insight-text');
    if (!el) return;

    const profitable = scenarios.filter(s => s.summary.roiPct > 0);
    const losing     = scenarios.filter(s => s.summary.roiPct <= 0);

    let text = '<strong>' + profitable.length + ' van ' + scenarios.length + '</strong> scenario\'s resulteren in een positief rendement. ';

    if (profitable.length === scenarios.length) {
      text += 'Het overwaardekrediet is winstgevend onder elk getest scenario. ';
    } else if (losing.length > 0) {
      text += 'Verlies treedt op onder: ' +
        losing.map(s => '<strong>' + scenarioLabelNL(s.scenarioMode) + '</strong>').join(', ') + '. ';
    }

    const best = scenarios.reduce((a, b) => a.summary.roiPct > b.summary.roiPct ? a : b);
    text += 'Beste geval: <strong>' + scenarioLabelNL(best.scenarioMode) + '</strong> met ' + best.summary.roiPct.toFixed(0) + '% ROI.';

    el.innerHTML = text;
    show('eq-insight-section');
  }

  // ── PDF Export ────────────────────────────────────────────────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF-bibliotheek niet geladen. Controleer je verbinding en ververs de pagina.');
      return;
    }

    const btn = $('eq-export-pdf-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '&#9203; Genereren\u2026';
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

      // Titel
      doc.setFillColor(247, 147, 26);
      doc.rect(M, y, pw, 0.5, 'F');
      y += 3;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('\u20BF Overwaarde Bitcoin Plan', M, y);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' \u2014 Machtswet Observatorium', W - M, y, { align: 'right' });
      doc.setTextColor(0);
      y += 3;

      // Parameters
      const params = getParams();
      const scenarioName = scenarioLabelNL(params.scenarioMode);
      doc.setFillColor(248, 248, 248);
      doc.rect(M, y - 1, pw, 5, 'F');
      doc.setFontSize(5.5);

      const pairs = [
        ['Lening:', fmtCurrency(params.loanAmount)],
        ['Looptijd:', params.loanDurationYears + 'jr'],
        ['Rente:', (params.loanInterestRate * 100).toFixed(1) + '%'],
        ['Type:', params.interestOnly ? 'Aflossingsvrij' : 'Annuïtair'],
        ['Scenario:', scenarioName],
        ['Valuta:', currency]
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

      // Grafiek
      const chartCanvas = $('eq-value-chart');
      const chartMaxH = 50;
      if (chartCanvas && !chartCanvas.closest('section').classList.contains('hidden')) {
        checkPage(chartMaxH + 5);
        try {
          const img = chartCanvas.toDataURL('image/png');
          const ratio = chartCanvas.height / chartCanvas.width;
          const imgH = Math.min(pw * ratio, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Bitcoin Waarde vs Leenkosten', M, y + 2);
          doc.addImage(img, 'PNG', M, y + 3, pw, imgH);
          y += imgH + 5;
        } catch (e) {}
      }

      // Samenvattingskaarten
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

      // Voettekst
      checkPage(5);
      doc.setDrawColor(210);
      doc.line(M, y, W - M, y);
      y += 2;
      doc.setFontSize(5);
      doc.setTextColor(160);
      doc.text('Geen financieel advies. Machtswetmodellen zijn educatieve projecties, geen garanties.', W / 2, y, { align: 'center' });

      const filename = 'btc_overwaarde_' + params.loanDurationYears + 'jr_' + new Date().toISOString().split('T')[0] + '.pdf';
      doc.save(filename);
    } catch (err) {
      console.error('PDF generatie mislukt:', err);
      alert('PDF generatie mislukt: ' + err.message);
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }

  // ── Start ─────────────────────────────────────────────────────
  init();

})();
