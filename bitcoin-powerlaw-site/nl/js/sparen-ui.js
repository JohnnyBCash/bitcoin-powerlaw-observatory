// ── DCA Rekentool — UI Handler (NL) ──────────────────────────────────
// Spiegelt retirement-ui.js IIFE-patroon.
// Afhankelijk van: window.PowerLaw, window.Retirement, window.DCA
(function () {
  'use strict';

  const PL = window.PowerLaw;
  const R  = window.Retirement;
  const D  = window.DCA;

  let currentModel     = 'santostasi';
  let growthChart       = null;
  let accumulationChart = null;
  let comparisonChart   = null;
  let historicalData    = [];
  let calculatedSigma   = 0.3;
  let livePrice         = null;
  let showAllMonths     = false;    // tabelwisselstatus
  let lastResult        = null;     // gecachet voor tabelwissel
  let debounceTimer     = null;

  const STORAGE_KEY = 'btcSavings_settings_nl';

  // ── Scenario Labels (NL) ────────────────────────────────────────
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

  // ── Valuta Ondersteuning ────────────────────────────────────────
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
    if (val >= 1e3) return sign + sym + Math.round(val).toLocaleString('nl-NL');
    if (val >= 1)   return sign + sym + val.toFixed(2);
    return sign + sym + val.toFixed(4);
  }

  async function fetchLiveData() {
    try {
      const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      const data = await res.json();
      if (data.bitcoin) {
        if (data.bitcoin.usd) livePrice = data.bitcoin.usd;
        if (data.bitcoin.usd && data.bitcoin.eur) eurRate = data.bitcoin.eur / data.bitcoin.usd;
      }
    } catch (e) {
      console.warn('Live data ophalen mislukt, fallback gebruikt', e);
      eurRate = 0.92;
    }
  }

  // ── DOM Helpers ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
  const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

  // ── Gebruikersinvoer Verzamelen ─────────────────────────────────
  function getParams() {
    const scenarioMode = $('dca-scenario').value;
    const startYear    = parseInt($('dca-start-year').value) || new Date().getFullYear();

    let initialK = null;
    if (livePrice && startYear <= new Date().getFullYear() + 1 &&
        (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      lumpSumUSD:       toUSD(parseFloat($('dca-lump-sum').value) || 0),
      monthlyDCAUSD:    toUSD(parseFloat($('dca-monthly').value) || 0),
      startYear,
      startMonth:       parseInt($('dca-start-month').value) || (new Date().getMonth() + 1),
      timeHorizonYears: parseInt($('dca-horizon').value) || 10,
      model:            currentModel,
      sigma:            calculatedSigma,
      scenarioMode,
      initialK
    };
  }

  // ── Initialisatie ───────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData();
    loadSettings();
    setDefaultMonth();
    setupCurrencyToggle();
    setupStartNow();
    setupButtons();
    setupInputListeners();
    scheduleCalculation();
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

  function setDefaultMonth() {
    // Standaard startmaand op huidige maand als niet al ingesteld door opgeslagen instellingen
    const sel = $('dca-start-month');
    if (sel && !localStorage.getItem(STORAGE_KEY)) {
      sel.value = new Date().getMonth() + 1;
    }
  }

  function setupCurrencyToggle() {
    const sel = $('dca-currency');
    if (!sel) return;
    sel.addEventListener('change', () => {
      currency = sel.value;
      const labels = ['dca-currency-label', 'dca-currency-label2'];
      labels.forEach(id => {
        const el = $(id);
        if (el) el.textContent = currency;
      });
    });
  }

  function setupStartNow() {
    const btn = $('dca-start-now-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const yearInput = $('dca-start-year');
      if (yearInput) yearInput.value = new Date().getFullYear();
      const monthSel = $('dca-start-month');
      if (monthSel) monthSel.value = new Date().getMonth() + 1;
    });
  }

  function scheduleCalculation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      runCalculation();
      // Auto-run comparison if both strategies have amounts
      var lump = parseFloat($('dca-lump-sum').value) || 0;
      var monthly = parseFloat($('dca-monthly').value) || 0;
      if (lump > 0 && monthly > 0) {
        runComparison();
      }
    }, 150);
  }

  function setupInputListeners() {
    var inputIds = ['dca-lump-sum', 'dca-monthly', 'dca-currency', 'dca-start-year', 'dca-start-month', 'dca-horizon', 'dca-scenario'];
    inputIds.forEach(function(id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', scheduleCalculation);
      el.addEventListener('change', scheduleCalculation);
    });
  }

  function setupButtons() {
    $('dca-export-pdf-btn').addEventListener('click', exportPDF);
    $('dca-reset-btn').addEventListener('click', resetDefaults);

    // Tabelwissel: toon alle maanden vs jaarlijks overzicht
    const toggleBtn = $('dca-table-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        showAllMonths = !showAllMonths;
        toggleBtn.textContent = showAllMonths ? 'Toon Jaarlijks Overzicht' : 'Toon Alle Maanden';
        if (lastResult) renderMonthlyTable(lastResult);
      });
    }
  }

  // ── Instellingen Opslaan ────────────────────────────────────────
  function saveSettings() {
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      inputs: {
        'dca-lump-sum':    parseFloat($('dca-lump-sum').value),
        'dca-monthly':     parseFloat($('dca-monthly').value),
        'dca-currency':    $('dca-currency').value,
        'dca-start-year':  parseInt($('dca-start-year').value),
        'dca-start-month': parseInt($('dca-start-month').value),
        'dca-horizon':     parseInt($('dca-horizon').value),
        'dca-scenario':    $('dca-scenario').value
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

      ['dca-lump-sum', 'dca-monthly', 'dca-start-year', 'dca-horizon'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      ['dca-currency', 'dca-start-month', 'dca-scenario'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      if (inp['dca-currency']) {
        currency = inp['dca-currency'];
        ['dca-currency-label', 'dca-currency-label2'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = currency;
        });
      }

      return true;
    } catch (e) {
      console.warn('Instellingen laden mislukt:', e);
      return false;
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* negeren */ }

    $('dca-lump-sum').value    = 10000;
    $('dca-monthly').value     = 500;
    $('dca-currency').value    = 'USD';
    $('dca-start-year').value  = new Date().getFullYear();
    $('dca-start-month').value = new Date().getMonth() + 1;
    $('dca-horizon').value     = 10;
    $('dca-scenario').value    = 'cyclical';

    currency = 'USD';
    ['dca-currency-label', 'dca-currency-label2'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = 'USD';
    });
  }

  // ── Hoofdberekening ─────────────────────────────────────────────
  function runCalculation() {
    saveSettings();
    const params = getParams();

    if (params.lumpSumUSD <= 0 && params.monthlyDCAUSD <= 0) {
      alert('Voer een eenmalig bedrag, een maandelijks DCA-bedrag, of beide in.');
      return;
    }

    const result  = D.simulateDCA(params);
    const summary = D.simulationSummary(result);
    lastResult    = result;

    renderStatusInsight(params, summary);
    renderSummaryCards(summary);
    renderGrowthChart(result);
    renderAccumulationChart(result);
    renderMonthlyTable(result);
    renderInsightText(params, summary);

    show('dca-results-section');
    show('dca-growth-section');
    show('dca-accumulation-section');
    show('dca-table-section');
    show('dca-insight-section');
    hide('dca-comparison-section');
    show('dca-action-buttons');

    $('dca-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Vergelijkingsmodus ──────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();

    if (params.lumpSumUSD <= 0 && params.monthlyDCAUSD <= 0) {
      alert('Voer zowel een eenmalig bedrag als een maandelijks DCA-bedrag in om strategieen te vergelijken.');
      return;
    }
    if (params.lumpSumUSD <= 0 || params.monthlyDCAUSD <= 0) {
      alert('Vergelijking vereist zowel een eenmalig bedrag ALS een maandelijks DCA-bedrag. Stel beide in om te vergelijken.');
      return;
    }

    const comparison = D.simulateComparison(params);
    const combined   = comparison.combined;
    const summary    = D.simulationSummary(combined);
    lastResult       = combined;

    renderStatusInsight(params, summary);
    renderComparisonView(comparison);
    renderGrowthChart(combined);
    renderAccumulationChart(combined);

    show('dca-results-section');
    show('dca-growth-section');
    show('dca-accumulation-section');
    show('dca-comparison-section');
    hide('dca-table-section');
    hide('dca-insight-section');
    show('dca-action-buttons');

    $('dca-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Render: Samenvattingskaarten ────────────────────────────────
  function renderSummaryCards(summary) {
    const container = $('dca-summary-cards');
    const roiColor  = summary.roiPct >= 0 ? 'var(--green)' : 'var(--red)';
    const gainColor = summary.gainUSD >= 0 ? 'var(--green)' : 'var(--red)';

    container.innerHTML = `
      <div class="card">
        <div class="card-label">Totaal Ge\u00EFnvesteerd</div>
        <div class="card-value">${fmtCurrency(summary.totalInvestedUSD)}</div>
        <div class="card-sub">over ${summary.totalMonths} maanden</div>
      </div>
      <div class="card">
        <div class="card-label">BTC Geaccumuleerd</div>
        <div class="card-value" style="color: var(--orange)">${summary.totalBTC.toFixed(6)} BTC</div>
        <div class="card-sub">gem. kostprijs ${fmtCurrency(summary.avgCostBasis)}/BTC</div>
      </div>
      <div class="card">
        <div class="card-label">Portfoliowaarde</div>
        <div class="card-value">${fmtCurrency(summary.finalValueUSD)}</div>
        <div class="card-sub">bij ${fmtCurrency(summary.finalPrice)}/BTC</div>
      </div>
      <div class="card">
        <div class="card-label">Totale Winst / Verlies</div>
        <div class="card-value" style="color: ${gainColor}">${summary.gainUSD >= 0 ? '+' : ''}${fmtCurrency(summary.gainUSD)}</div>
        <div class="card-sub">${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(1)}% rendement</div>
      </div>
      <div class="card">
        <div class="card-label">ROI</div>
        <div class="card-value large" style="color: ${roiColor}">${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(1)}%</div>
      </div>
      <div class="card">
        <div class="card-label">Gem. Kostprijs</div>
        <div class="card-value">${fmtCurrency(summary.avgCostBasis)}</div>
        <div class="card-sub">${summary.costBasisVsFinal.toFixed(1)}x onder de eindprijs</div>
      </div>
    `;
  }

  // ── Render: Groeigrafiek ────────────────────────────────────────
  function renderGrowthChart(result) {
    const ctx = $('dca-growth-chart');
    if (growthChart) growthChart.destroy();

    const r = getRate();
    growthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: result.months.map(m => m.date),
        datasets: [
          {
            label: 'Portfoliowaarde (' + currency + ')',
            data: result.months.map(m => m.portfolioValueUSD * r),
            borderColor: '#00C853',
            backgroundColor: 'rgba(0, 200, 83, 0.1)',
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Totaal Ge\u00EFnvesteerd (' + currency + ')',
            data: result.months.map(m => m.cumulativeInvestedUSD * r),
            borderColor: '#F7931A',
            backgroundColor: 'rgba(247, 147, 26, 0.1)',
            fill: true,
            borderWidth: 2,
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

  // ── Render: Accumulatiegrafiek ──────────────────────────────────
  function renderAccumulationChart(result) {
    const ctx = $('dca-accumulation-chart');
    if (accumulationChart) accumulationChart.destroy();

    accumulationChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: result.months.map(m => m.date),
        datasets: [{
          label: 'BTC Geaccumuleerd',
          data: result.months.map(m => m.cumulativeBTC),
          borderColor: '#F7931A',
          backgroundColor: 'rgba(247, 147, 26, 0.15)',
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const d = new Date(items[0].parsed.x);
                return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' });
              },
              label: item => item.raw.toFixed(6) + ' BTC'
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
            title: { display: true, text: 'BTC' },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              callback: v => {
                if (v >= 1) return v.toFixed(2);
                return v.toFixed(4);
              }
            }
          }
        }
      }
    });
  }

  // ── Render: Maandelijkse Tabel ──────────────────────────────────
  function renderMonthlyTable(result) {
    const tbody = $('dca-monthly-table-body');
    tbody.innerHTML = '';

    const months = result.months;
    const horizon = result.params.timeHorizonYears;

    // Voor lange horizonnen, standaard jaarlijkse samenvattingen
    if (!showAllMonths && horizon > 5) {
      renderYearlySummary(months, tbody);
    } else {
      months.forEach(m => {
        const tr = document.createElement('tr');
        const roiClass = m.roiPct >= 0 ? 'roi-positive' : 'roi-negative';
        const dateStr = m.date.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short' });
        tr.innerHTML =
          '<td>' + dateStr + '</td>' +
          '<td>' + fmtCurrency(m.price) + '</td>' +
          '<td>' + (m.fiatSpent > 0 ? fmtCurrency(m.fiatSpent) : '\u2014') + '</td>' +
          '<td>' + (m.btcBought > 0 ? m.btcBought.toFixed(6) : '\u2014') + '</td>' +
          '<td>' + m.cumulativeBTC.toFixed(6) + '</td>' +
          '<td>' + fmtCurrency(m.cumulativeInvestedUSD) + '</td>' +
          '<td>' + fmtCurrency(m.portfolioValueUSD) + '</td>' +
          '<td class="' + roiClass + '">' + (m.roiPct >= 0 ? '+' : '') + m.roiPct.toFixed(1) + '%</td>';
        tbody.appendChild(tr);
      });
    }
  }

  function renderYearlySummary(months, tbody) {
    // Groepeer per jaar, toon einde-jaar snapshot
    let currentYear = null;
    let yearFiat = 0;
    let yearBTC  = 0;

    months.forEach((m, i) => {
      const isNewYear = m.year !== currentYear;
      const isLast    = i === months.length - 1;

      if (isNewYear && currentYear !== null) {
        // Render de samenvatting van het vorige jaar met de vorige maand
        const prev = months[i - 1];
        appendYearRow(tbody, currentYear, yearFiat, yearBTC, prev);
        yearFiat = 0;
        yearBTC  = 0;
      }

      currentYear = m.year;
      yearFiat   += m.fiatSpent;
      yearBTC    += m.btcBought;

      if (isLast) {
        appendYearRow(tbody, currentYear, yearFiat, yearBTC, m);
      }
    });
  }

  function appendYearRow(tbody, year, yearFiat, yearBTC, snapshot) {
    const tr = document.createElement('tr');
    const roiClass = snapshot.roiPct >= 0 ? 'roi-positive' : 'roi-negative';
    tr.innerHTML =
      '<td><strong>' + year + '</strong></td>' +
      '<td>' + fmtCurrency(snapshot.price) + '</td>' +
      '<td>' + (yearFiat > 0 ? fmtCurrency(yearFiat) : '\u2014') + '</td>' +
      '<td>' + (yearBTC > 0 ? yearBTC.toFixed(6) : '\u2014') + '</td>' +
      '<td>' + snapshot.cumulativeBTC.toFixed(6) + '</td>' +
      '<td>' + fmtCurrency(snapshot.cumulativeInvestedUSD) + '</td>' +
      '<td>' + fmtCurrency(snapshot.portfolioValueUSD) + '</td>' +
      '<td class="' + roiClass + '">' + (snapshot.roiPct >= 0 ? '+' : '') + snapshot.roiPct.toFixed(1) + '%</td>';
    tbody.appendChild(tr);
  }

  // ── Render: Statusinzicht Banner ────────────────────────────────
  function renderStatusInsight(params, summary) {
    const banner   = $('dca-status-banner');
    const icon     = $('dca-status-icon');
    const headline = $('dca-status-headline');
    const detail   = $('dca-status-detail');

    banner.classList.remove('status-green', 'status-amber', 'hidden');
    // Animatie opnieuw triggeren
    banner.style.animation = 'none';
    banner.offsetHeight; // forceer reflow
    banner.style.animation = '';

    if (summary.roiPct >= 0) {
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      headline.textContent = 'Je investering groeide ' + summary.roiPct.toFixed(0) + '%';
      detail.innerHTML =
        '<strong>' + fmtCurrency(summary.totalInvestedUSD) + '</strong> ge\u00EFnvesteerd werd ' +
        '<strong>' + fmtCurrency(summary.finalValueUSD) + '</strong>. ' +
        'Je gemiddelde kostprijs van <strong>' + fmtCurrency(summary.avgCostBasis) + '</strong>/BTC ' +
        'is ' + summary.costBasisVsFinal.toFixed(1) + '\u00D7 onder de eindprijs van ' +
        '<strong>' + fmtCurrency(summary.finalPrice) + '</strong>.';
    } else {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = 'Nog steeds onder water aan het einde van de projectie';
      detail.innerHTML =
        'Onder het <strong>' + scenarioLabelNL(params.scenarioMode) + '</strong> scenario, ' +
        'zou je DCA een verlies van <strong>' + Math.abs(summary.roiPct).toFixed(1) + '%</strong> tonen na ' +
        summary.totalMonths + ' maanden. Overweeg een langere tijdshorizon \u2014 machtsweetrendementen verbeteren met de tijd.';
    }

    show('dca-status-banner');
  }

  // ── Render: Inzichttekst ────────────────────────────────────────
  function renderInsightText(params, summary) {
    const el = $('dca-insight-text');
    if (!el) return;

    const scenarioName = scenarioLabelNL(params.scenarioMode);
    const lumpPart = params.lumpSumUSD > 0
      ? 'een eenmalige investering van <strong>' + fmtCurrency(params.lumpSumUSD) + '</strong>' : '';
    const dcaPart = params.monthlyDCAUSD > 0
      ? '<strong>' + fmtCurrency(params.monthlyDCAUSD) + '</strong>/maand DCA' : '';
    const strategyText = lumpPart && dcaPart
      ? lumpPart + ' plus ' + dcaPart
      : lumpPart || dcaPart;

    let text = 'Onder het <strong>' + scenarioName + '</strong> scenario, ' +
      'accumuleert ' + strategyText + ' over <strong>' + params.timeHorizonYears + ' jaar</strong> ' +
      '<strong>' + summary.totalBTC.toFixed(4) + ' BTC</strong>.';

    if (summary.roiPct >= 100) {
      text += ' Dat is een <strong>' + summary.roiPct.toFixed(0) + '% rendement</strong> \u2014 je geld is meer dan verdubbeld.';
    } else if (summary.roiPct >= 0) {
      text += ' Dat is een <strong>' + summary.roiPct.toFixed(0) + '% rendement</strong>.';
    }

    text += ' Het machtswetmodel suggereert dat de jaarlijkse rendementen van Bitcoin afnemen in de tijd, ' +
      'maar vroege accumuleerders profiteren nog steeds van samengestelde groei op een langetermijntrend.';

    if (summary.costBasisVsFinal > 2) {
      text += ' Je gemiddelde kostprijs van <strong>' + fmtCurrency(summary.avgCostBasis) + '</strong>/BTC ' +
        'ligt ruim onder de verwachte eindprijs van <strong>' + fmtCurrency(summary.finalPrice) + '</strong>, ' +
        'wat de kracht van accumuleren tijdens dips laat zien.';
    }

    el.innerHTML = text;
  }

  // ── Render: Vergelijkingsweergave ───────────────────────────────
  function renderComparisonView(comparison) {
    const { lumpOnly, dcaOnly, combined } = comparison;
    const lSum = D.simulationSummary(lumpOnly);
    const dSum = D.simulationSummary(dcaOnly);
    const cSum = D.simulationSummary(combined);

    // Samenvattingskaarten tonen gecombineerde strategie
    renderSummaryCards(cSum);

    // Vergelijkingstabel
    const tbody = $('dca-comparison-body');
    tbody.innerHTML = '';

    const strategies = [
      { label: 'Alleen Eenmalig', s: lSum },
      { label: 'Alleen DCA',      s: dSum },
      { label: 'Gecombineerd',     s: cSum }
    ];

    const bestROI = Math.max(...strategies.map(st => st.s.roiPct));

    strategies.forEach(row => {
      const tr = document.createElement('tr');
      if (row.s.roiPct === bestROI) tr.classList.add('comparison-winner');

      const roiColor = row.s.roiPct >= 0 ? 'var(--green)' : 'var(--red)';
      const gainColor = row.s.gainUSD >= 0 ? 'var(--green)' : 'var(--red)';

      tr.innerHTML =
        '<td><strong>' + row.label + '</strong></td>' +
        '<td>' + fmtCurrency(row.s.totalInvestedUSD) + '</td>' +
        '<td>' + row.s.totalBTC.toFixed(6) + ' BTC</td>' +
        '<td>' + fmtCurrency(row.s.finalValueUSD) + '</td>' +
        '<td style="color:' + gainColor + '">' + (row.s.gainUSD >= 0 ? '+' : '') + fmtCurrency(row.s.gainUSD) + '</td>' +
        '<td style="color:' + roiColor + '">' + (row.s.roiPct >= 0 ? '+' : '') + row.s.roiPct.toFixed(1) + '%</td>' +
        '<td>' + fmtCurrency(row.s.avgCostBasis) + '</td>';
      tbody.appendChild(tr);
    });

    // Vergelijkingsgrafiek: 3 portfoliowaardelinjen
    renderComparisonChart(comparison);
  }

  function renderComparisonChart(comparison) {
    const ctx = $('dca-comparison-chart');
    if (comparisonChart) comparisonChart.destroy();

    const r = getRate();

    comparisonChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: comparison.combined.months.map(m => m.date),
        datasets: [
          {
            label: 'Gecombineerd (' + currency + ')',
            data: comparison.combined.months.map(m => m.portfolioValueUSD * r),
            borderColor: '#00C853',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Alleen Eenmalig (' + currency + ')',
            data: comparison.lumpOnly.months.map(m => m.portfolioValueUSD * r),
            borderColor: '#F7931A',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: 'Alleen DCA (' + currency + ')',
            data: comparison.dcaOnly.months.map(m => m.portfolioValueUSD * r),
            borderColor: '#9C27B0',
            borderWidth: 2,
            borderDash: [3, 3],
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

  // ── PDF Export (jsPDF directe tekening — compact) ───────────────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF-bibliotheek niet geladen. Controleer je verbinding en ververs de pagina.');
      return;
    }

    const btn = $('dca-export-pdf-btn');
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
      doc.text('\u20BF Bitcoin DCA Plan', M, y);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' }) + ' \u2014 Machtswet Observatorium', W - M, y, { align: 'right' });
      doc.setTextColor(0);
      y += 3;

      // Parameters
      const params = getParams();
      const scenarioName = scenarioLabelNL(params.scenarioMode);
      doc.setFillColor(248, 248, 248);
      doc.rect(M, y - 1, pw, 5, 'F');
      doc.setFontSize(5.5);

      const pairs = [
        ['Eenmalig:', fmtCurrency(params.lumpSumUSD)],
        ['Maandelijks:', fmtCurrency(params.monthlyDCAUSD) + '/ma'],
        ['Start:', params.startYear + '/' + params.startMonth],
        ['Horizon:', params.timeHorizonYears + 'jr'],
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
      const statusHeadline = $('dca-status-headline') ? $('dca-status-headline').textContent : '';
      const statusBanner = $('dca-status-banner');
      let sR = 0, sG = 180, sB = 75;
      if (statusBanner && statusBanner.classList.contains('status-amber')) { sR = 230; sG = 140; sB = 20; }

      doc.setFillColor(sR, sG, sB);
      doc.rect(M, y, 0.8, 4, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(sR, sG, sB);
      doc.text(statusHeadline, M + 2.5, y + 2.8);
      doc.setTextColor(0);
      y += 6;

      // Grafieken naast elkaar
      const chartMaxH = 38;
      const growthCanvas = $('dca-growth-chart');
      const accumCanvas  = $('dca-accumulation-chart');
      const gVisible = growthCanvas && !growthCanvas.closest('section').classList.contains('hidden');
      const aVisible = accumCanvas && !accumCanvas.closest('section').classList.contains('hidden');

      if (gVisible && aVisible) {
        checkPage(chartMaxH + 5);
        const halfW = (pw - 2) / 2;
        try {
          const gImg = growthCanvas.toDataURL('image/png');
          const gH = Math.min(halfW * growthCanvas.height / growthCanvas.width, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Portfoliowaarde vs Ge\u00EFnvesteerd', M, y + 2);
          doc.addImage(gImg, 'PNG', M, y + 3, halfW, gH);
        } catch (e) {}
        try {
          const aImg = accumCanvas.toDataURL('image/png');
          const aH = Math.min(halfW * accumCanvas.height / accumCanvas.width, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('BTC Accumulatie', M + halfW + 2, y + 2);
          doc.addImage(aImg, 'PNG', M + halfW + 2, y + 3, halfW, aH);
        } catch (e) {}
        y += chartMaxH + 5;
      }

      // Samenvattingskaarten rij
      const summaryCards = document.querySelectorAll('#dca-results-section .card');
      if (summaryCards.length > 0) {
        checkPage(8);
        doc.setFontSize(5);
        const cardW = pw / Math.min(summaryCards.length, 6);
        summaryCards.forEach((card, i) => {
          if (i >= 6) return;
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

      const filename = 'btc_dca_' + params.timeHorizonYears + 'jr_' + new Date().toISOString().split('T')[0] + '.pdf';
      doc.save(filename);
    } catch (err) {
      console.error('PDF genereren mislukt:', err);
      alert('PDF genereren mislukt: ' + err.message);
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }

  // ── Start ──────────────────────────────────────────────────────
  init();

})();
