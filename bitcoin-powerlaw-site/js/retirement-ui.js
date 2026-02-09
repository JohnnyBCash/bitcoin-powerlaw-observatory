// Bitcoin Retirement Calculator - UI Handler
(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;

  let currentModel = 'santostasi';
  let cagrChart = null;
  let stackChart = null;
  let historicalData = [];
  let calculatedSigma = 0.3;
  let livePrice = null;       // live BTC price in USD

  const STORAGE_KEY = 'btcRetirement_settings';

  // ── Currency Support ──────────────────────────────────────────
  let currency = 'USD';        // 'USD' or 'EUR'
  let eurRate = null;          // EUR per 1 USD (e.g. 0.92)

  function getCurrencySymbol() { return currency === 'EUR' ? '€' : '$'; }
  function getRate() { return currency === 'EUR' && eurRate ? eurRate : 1; }

  // Convert USD → display currency
  function toDisplay(usd) { return usd * getRate(); }

  // Convert display currency → USD (for user input)
  function toUSD(displayAmount) { return displayAmount / getRate(); }

  // Format amount in selected currency
  function fmtCurrency(usd) {
    const val = toDisplay(usd);
    const sym = getCurrencySymbol();
    if (val >= 1e9) return sym + (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return sym + (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return sym + Math.round(val).toLocaleString('en-US');
    if (val >= 1) return sym + val.toFixed(2);
    return sym + val.toFixed(4);
  }

  async function fetchLiveData() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      const data = await res.json();
      if (data.bitcoin) {
        // Live BTC price
        if (data.bitcoin.usd) livePrice = data.bitcoin.usd;
        // Derive EUR/USD rate from BTC prices in both currencies
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

  // ── Gather User Inputs ───────────────────────────────────────
  function getParams() {
    const useLoans = $('use-loans').checked;
    const spendInput = parseFloat($('annual-spend').value) || 50000;
    const retYear = parseInt($('retirement-year').value) || 2030;
    const scenarioMode = $('price-scenario').value;

    // Compute initialK from live price so cyclical scenarios start at today's real position
    let initialK = null;
    if (livePrice && retYear <= new Date().getFullYear() + 1 &&
        (scenarioMode === 'cyclical' || scenarioMode === 'cyclical_bear')) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      btcHoldings: parseFloat($('btc-holdings').value) || 1.0,
      annualSpendUSD: toUSD(spendInput),  // convert from display currency to USD
      retirementYear: retYear,
      timeHorizonYears: parseInt($('time-horizon').value) || 30,
      m2GrowthRate: parseFloat($('m2-growth').value) / 100,
      model: currentModel,
      sigma: calculatedSigma,
      scenarioMode,
      initialK,
      useLoans,
      loanLTV: parseFloat($('loan-ltv').value) / 100,
      loanInterestRate: parseFloat($('loan-interest').value) / 100,
      loanThreshold: parseFloat($('loan-threshold').value)
    };
  }

  // ── Initialize ───────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    fetchLiveData(); // non-blocking, we don't await
    loadSettings();  // restore saved settings from localStorage
    setupSliders();
    setupLoanToggle();
    setupCurrencyToggle();
    setupStartNow();
    setupButtons();
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

  // ── Setup Functions ──────────────────────────────────────────
  function setupSliders() {
    const sliders = [
      { input: 'm2-growth', display: 'm2-value', suffix: '' },
      { input: 'loan-ltv', display: 'ltv-value', suffix: '' },
      { input: 'loan-interest', display: 'interest-value', suffix: '' },
      { input: 'loan-threshold', display: 'threshold-value', suffix: '' }
    ];
    sliders.forEach(s => {
      const el = $(s.input);
      if (el) el.addEventListener('input', () => {
        const display = $(s.display);
        if (display) display.textContent = el.value;
        // Show warning when spending growth is 0%
        if (s.input === 'm2-growth') {
          const hint = $('spending-growth-hint');
          if (hint) {
            if (parseFloat(el.value) === 0) {
              hint.classList.remove('hidden');
            } else {
              hint.classList.add('hidden');
            }
          }
        }
      });
    });
  }

  // Model toggle removed — single model (Santostasi)

  function setupLoanToggle() {
    const toggle = $('use-loans');
    const params = $('loan-params');
    const label = $('loans-label');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        params.classList.remove('hidden');
        label.textContent = 'Loans: ON — Borrow below trend';
      } else {
        params.classList.add('hidden');
        label.textContent = 'Loans: OFF — Sell only';
      }
    });
  }

  function setupCurrencyToggle() {
    const sel = $('currency');
    if (!sel) return;
    sel.addEventListener('change', () => {
      currency = sel.value;
      const label = $('currency-label');
      if (label) label.textContent = currency;
    });
  }

  function setupStartNow() {
    const btn = $('start-now-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const yearInput = $('retirement-year');
      if (yearInput) yearInput.value = new Date().getFullYear();
    });
  }

  // ── Settings Persistence ─────────────────────────────────────
  function saveSettings() {
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      inputs: {
        'btc-holdings':    parseFloat($('btc-holdings').value),
        'currency':        $('currency').value,
        'annual-spend':    parseFloat($('annual-spend').value),
        'retirement-year': parseInt($('retirement-year').value),
        'time-horizon':    parseInt($('time-horizon').value),
        'm2-growth':       parseFloat($('m2-growth').value),
        'price-scenario':  $('price-scenario').value,
        'use-loans':       $('use-loans').checked,
        'loan-ltv':        parseFloat($('loan-ltv').value),
        'loan-interest':   parseFloat($('loan-interest').value),
        'loan-threshold':  parseFloat($('loan-threshold').value)
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

      // Numeric inputs
      ['btc-holdings', 'annual-spend', 'retirement-year', 'time-horizon'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Select elements
      ['currency', 'price-scenario'].forEach(id => {
        const el = $(id);
        if (el && inp[id] !== undefined) el.value = inp[id];
      });

      // Sliders + their display labels
      const sliderMap = {
        'm2-growth': 'm2-value',
        'loan-ltv': 'ltv-value',
        'loan-interest': 'interest-value',
        'loan-threshold': 'threshold-value'
      };
      Object.entries(sliderMap).forEach(([sliderId, displayId]) => {
        const el = $(sliderId);
        const display = $(displayId);
        if (el && inp[sliderId] !== undefined) {
          el.value = inp[sliderId];
          if (display) display.textContent = inp[sliderId];
        }
      });

      // Checkbox + loan params visibility
      if (inp['use-loans'] !== undefined) {
        const toggle = $('use-loans');
        toggle.checked = inp['use-loans'];
        const params = $('loan-params');
        const label = $('loans-label');
        if (toggle.checked) {
          params.classList.remove('hidden');
          label.textContent = 'Loans: ON \u2014 Borrow below trend';
        }
      }

      // Currency state
      if (inp['currency']) {
        currency = inp['currency'];
        const label = $('currency-label');
        if (label) label.textContent = currency;
      }

      // Spending growth hint
      if (parseFloat(inp['m2-growth']) === 0) {
        const hint = $('spending-growth-hint');
        if (hint) hint.classList.remove('hidden');
      }

      return true;
    } catch (e) {
      console.warn('Failed to load settings:', e);
      return false;
    }
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }

    $('btc-holdings').value = 1.0;
    $('currency').value = 'USD';
    $('annual-spend').value = 50000;
    $('retirement-year').value = 2030;
    $('time-horizon').value = 30;
    $('m2-growth').value = 6.5;
    $('price-scenario').value = 'cyclical';
    $('use-loans').checked = false;
    $('loan-ltv').value = 40;
    $('loan-interest').value = 8;
    $('loan-threshold').value = 1.0;

    $('m2-value').textContent = '6.5';
    $('ltv-value').textContent = '40';
    $('interest-value').textContent = '8';
    $('threshold-value').textContent = '1.0';

    currency = 'USD';
    $('currency-label').textContent = 'USD';

    $('loan-params').classList.add('hidden');
    $('loans-label').textContent = 'Loans: OFF \u2014 Sell only';

    const hint = $('spending-growth-hint');
    if (hint) hint.classList.add('hidden');
  }

  // ── PDF Export (jsPDF direct drawing — compact single-page) ──────
  function exportPDF() {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please check your connection and refresh.');
      return;
    }

    const btn = $('export-pdf-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '&#9203; Generating\u2026';
    btn.disabled = true;

    try {
      const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const W = 210, H = 297, M = 8; // page width, height, margin (tight)
      const pw = W - 2 * M; // printable width
      let y = M; // current y cursor

      // Helper: add new page if needed
      function checkPage(needed) {
        if (y + needed > H - M) { doc.addPage(); y = M; }
        return y;
      }

      // ── Title — compact single line
      doc.setFillColor(247, 147, 26);
      doc.rect(M, y, pw, 0.5, 'F');
      y += 3;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('\u20BF Bitcoin Retirement Plan', M, y);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' — Power Law Observatory', W - M, y, { align: 'right' });
      doc.setTextColor(0);
      y += 3;

      // ── Parameters — inline compact grid
      const params = getParams();
      const scenarioName = R.scenarioLabel(params.scenarioMode);
      const modeName = params.useLoans ? 'Loans' : 'Sell Only';
      const spendDisplay = fmtCurrency(params.annualSpendUSD);

      doc.setFillColor(248, 248, 248);
      doc.rect(M, y - 1, pw, 7.5, 'F');
      doc.setFontSize(5.5);
      // Row 1
      const paramPairs1 = [
        ['Holdings:', params.btcHoldings + ' BTC'],
        ['Spending:', spendDisplay + '/yr'],
        ['Start:', '' + params.retirementYear],
        ['Horizon:', params.timeHorizonYears + 'yr'],
        ['Scenario:', scenarioName],
        ['Mode:', modeName]
      ];
      const pairW = pw / paramPairs1.length;
      paramPairs1.forEach((p, i) => {
        const x = M + i * pairW + 1;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
        doc.text(p[0], x, y + 1.5);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
        doc.text(p[1], x + doc.getTextWidth(p[0]) + 0.8, y + 1.5);
      });
      // Row 2
      const paramPairs2 = [
        ['Growth:', (params.m2GrowthRate * 100).toFixed(1) + '%/yr'],
        ['Currency:', currency]
      ];
      if (params.useLoans) {
        paramPairs2.push(['LTV:', (params.loanLTV * 100).toFixed(0) + '%']);
        paramPairs2.push(['Rate:', (params.loanInterest * 100).toFixed(0) + '%']);
      }
      paramPairs2.forEach((p, i) => {
        const x = M + i * pairW + 1;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
        doc.text(p[0], x, y + 5);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
        doc.text(p[1], x + doc.getTextWidth(p[0]) + 0.8, y + 5);
      });
      doc.setFont('helvetica', 'normal');
      y += 8.5;

      // ── Status banner — single line
      const statusHeadline = $('status-headline') ? $('status-headline').textContent : '';
      const statusBanner = $('status-banner');
      let sR = 0, sG = 180, sB = 75;
      if (statusBanner && statusBanner.classList.contains('status-red')) { sR = 220; sG = 30; sB = 60; }
      else if (statusBanner && statusBanner.classList.contains('status-amber')) { sR = 230; sG = 140; sB = 20; }

      doc.setFillColor(sR, sG, sB);
      doc.rect(M, y, 0.8, 4, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(sR, sG, sB);
      doc.text(statusHeadline, M + 2.5, y + 2.8);
      // Add detail text on same line if short enough
      const statusDetailEl = $('status-detail');
      const statusDetailText = statusDetailEl ? statusDetailEl.textContent : '';
      if (statusDetailText) {
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        const detailTrunc = statusDetailText.length > 120 ? statusDetailText.substring(0, 117) + '...' : statusDetailText;
        doc.text(detailTrunc, M + 2.5, y + 5.5);
        y += 7.5;
      } else {
        y += 5.5;
      }
      doc.setTextColor(0);

      // ── Charts — side by side if both visible, reduced height
      const chartMaxH = 38; // compact chart height
      const cagrCanvas = $('cagr-chart');
      const stackCanvas = $('stack-chart');
      const cagrVisible = cagrCanvas && !cagrCanvas.closest('section').classList.contains('hidden');
      const stackVisible = stackCanvas && !stackCanvas.closest('section').classList.contains('hidden');

      if (cagrVisible && stackVisible) {
        // Two charts side by side
        checkPage(chartMaxH + 5);
        const halfW = (pw - 2) / 2;
        try {
          const cagrImg = cagrCanvas.toDataURL('image/png');
          const cagrRatio = cagrCanvas.height / cagrCanvas.width;
          const cagrH = Math.min(halfW * cagrRatio, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Expected Return Decay', M, y + 2);
          doc.addImage(cagrImg, 'PNG', M, y + 3, halfW, cagrH);
        } catch (e) {}
        try {
          const stackImg = stackCanvas.toDataURL('image/png');
          const stackRatio = stackCanvas.height / stackCanvas.width;
          const stackH = Math.min(halfW * stackRatio, chartMaxH);
          doc.setFontSize(6); doc.setFont('helvetica', 'bold');
          doc.text('Stack & Spending Over Time', M + halfW + 2, y + 2);
          doc.addImage(stackImg, 'PNG', M + halfW + 2, y + 3, halfW, stackH);
        } catch (e) {}
        y += chartMaxH + 5;
      } else {
        // Single chart full width but short
        function addChart(canvasId, label) {
          const canvas = $(canvasId);
          if (!canvas || canvas.closest('section').classList.contains('hidden')) return;
          try {
            const imgData = canvas.toDataURL('image/png');
            const ratio = canvas.height / canvas.width;
            const imgH = Math.min(pw * ratio, chartMaxH);
            checkPage(imgH + 5);
            doc.setFontSize(6); doc.setFont('helvetica', 'bold');
            doc.text(label, M, y + 2);
            doc.addImage(imgData, 'PNG', M, y + 3, pw, imgH);
            y += imgH + 4;
            doc.setFont('helvetica', 'normal');
          } catch (e) {}
        }
        addChart('cagr-chart', 'Expected Return Decay');
        addChart('stack-chart', 'Stack & Spending Over Time');
      }

      // ── Summary cards — compact row
      const summaryCards = document.querySelectorAll('#results-section .summary-card');
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
            doc.text(value.textContent.trim().substring(0, 14), x + 1, y + 5);
          }
        });
        y += 7;
      }

      // ── Yearly table — very compact
      const tableBody = $('yearly-table-body');
      const tableSection = tableBody ? tableBody.closest('section') : null;
      if (tableBody && tableSection && !tableSection.classList.contains('hidden')) {
        const rows = tableBody.querySelectorAll('tr');
        if (rows.length > 0) {
          checkPage(12);
          doc.setFontSize(6);
          doc.setFont('helvetica', 'bold');
          doc.text('Year-by-Year Breakdown', M, y + 2);
          y += 3.5;

          // Determine columns based on what's visible
          const headerCells = tableSection.querySelectorAll('thead th');
          const cols = [];
          headerCells.forEach(th => cols.push(th.textContent.trim()));
          const numCols = cols.length || 11;
          const cw = pw / numCols;

          // Header row
          doc.setFontSize(4.5);
          doc.setFillColor(235, 235, 235);
          doc.rect(M, y - 1.5, pw, 3, 'F');
          doc.setFont('helvetica', 'bold');
          cols.forEach((c, i) => doc.text(c.substring(0, 8), M + i * cw + 0.3, y));
          y += 2.5;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(4.5);

          // Show first 5 + last 3 for long tables, all for short
          const total = rows.length;
          let indices = [];
          if (total <= 12) {
            for (let i = 0; i < total; i++) indices.push(i);
          } else {
            for (let i = 0; i < 5; i++) indices.push(i);
            indices.push(-1);
            for (let i = total - 3; i < total; i++) indices.push(i);
          }

          const rh = 2.5; // row height mm
          indices.forEach(idx => {
            checkPage(rh + 1);
            if (idx === -1) {
              doc.setTextColor(140);
              doc.setFontSize(4);
              doc.text('\u2026 ' + (total - 8) + ' rows omitted \u2026', M + pw / 2, y, { align: 'center' });
              doc.setTextColor(0);
              doc.setFontSize(4.5);
              y += rh;
              return;
            }
            if (idx % 2 === 0) {
              doc.setFillColor(250, 250, 250);
              doc.rect(M, y - 1.5, pw, rh, 'F');
            }
            const cells = rows[idx].querySelectorAll('td');
            cells.forEach((td, ci) => {
              if (ci < numCols) {
                const txt = td.textContent.trim().substring(0, 10);
                doc.text(txt, M + ci * cw + 0.3, y);
              }
            });
            y += rh;
          });
          y += 2;
        }
      }

      // ── Comparison table — compact
      const compSection = $('comparison-section');
      if (compSection && !compSection.classList.contains('hidden')) {
        const compRows = compSection.querySelectorAll('tbody tr');
        if (compRows.length > 0) {
          checkPage(15);
          doc.setFontSize(6);
          doc.setFont('helvetica', 'bold');
          doc.text('Loans vs Sell-Only: Required Stack', M, y + 2);
          y += 3.5;

          const compCols = ['Scenario', 'Sell Only', 'With Loans', 'BTC Saved', 'Savings %', 'Interest'];
          const ccw = pw / compCols.length;
          doc.setFontSize(4.5);
          doc.setFillColor(235, 235, 235);
          doc.rect(M, y - 1.5, pw, 3, 'F');
          doc.setFont('helvetica', 'bold');
          compCols.forEach((c, i) => doc.text(c, M + i * ccw + 0.3, y));
          y += 2.5;
          doc.setFont('helvetica', 'normal');

          compRows.forEach((row, ri) => {
            checkPage(3);
            if (ri % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(M, y - 1.5, pw, 2.5, 'F'); }
            const cells = row.querySelectorAll('td');
            cells.forEach((td, ci) => {
              if (ci < compCols.length) doc.text(td.textContent.trim().substring(0, 16), M + ci * ccw + 0.3, y);
            });
            y += 2.5;
          });
          y += 2;
        }
      }

      // ── Footer
      checkPage(5);
      doc.setDrawColor(210);
      doc.line(M, y, W - M, y);
      y += 2;
      doc.setFontSize(5);
      doc.setTextColor(160);
      doc.text('Not financial advice. Power law models are educational projections, not guarantees.', W / 2, y, { align: 'center' });

      // ── Save
      const filename = 'btc_retirement_' + params.btcHoldings + 'btc_' + params.retirementYear + '_' + new Date().toISOString().split('T')[0] + '.pdf';
      doc.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + err.message);
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }

  function setupButtons() {
    $('calculate-btn').addEventListener('click', runCalculation);
    $('compare-btn').addEventListener('click', runComparison);
    $('export-pdf-btn').addEventListener('click', exportPDF);
    $('reset-defaults-btn').addEventListener('click', resetDefaults);
  }

  // ── Main Calculation ─────────────────────────────────────────
  function runCalculation() {
    saveSettings();
    const params = getParams();
    const simulate = params.useLoans ? R.simulateWithLoans : R.simulateSellOnly;
    const result = simulate(params);
    const summary = R.simulationSummary(result);
    const cagrTable = R.cagrDecayTable(params.model, params.retirementYear, params.timeHorizonYears);

    // Status banner first — visible without scrolling
    renderStatusBanner(params, result, summary);

    renderCAGRChart(cagrTable);
    renderSummaryCards(params, result, summary);
    renderStackChart(result, params);
    renderYearlyTable(result, params);
    renderInsight(params, result, summary);

    show('cagr-section');
    show('results-section');
    show('stack-chart-section');
    show('table-section');
    show('insight-section');
    hide('comparison-section');

    // Show action buttons (PDF export, reset)
    show('action-buttons');

    // Scroll to results
    $('cagr-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Comparison Mode ──────────────────────────────────────────
  function runComparison() {
    saveSettings();
    const params = getParams();
    const comparison = R.compareStrategies(params);

    const tbody = $('comparison-body');
    tbody.innerHTML = '';

    comparison.forEach(row => {
      const tr = document.createElement('tr');
      const isHighlight = row.btcSaved > 0;
      if (isHighlight) tr.classList.add('comparison-highlight');

      tr.innerHTML = `
        <td><strong>${row.scenario}</strong></td>
        <td>${row.sellOnly.minStack === Infinity ? '∞ (impossible)' : row.sellOnly.minStack.toFixed(3) + ' BTC'}</td>
        <td>${row.withLoans.minStack === Infinity ? '∞ (impossible)' : row.withLoans.minStack.toFixed(3) + ' BTC'}</td>
        <td>${row.btcSaved === Infinity ? '—' : row.btcSaved.toFixed(3) + ' BTC'}</td>
        <td>${row.savingsPct === Infinity || isNaN(row.savingsPct) ? '—' : row.savingsPct.toFixed(1) + '%'}</td>
        <td>${row.withLoans.totalInterest > 0 ? fmtCurrency(row.withLoans.totalInterest) : '—'}</td>
      `;
      tbody.appendChild(tr);
    });

    show('comparison-section');
    hide('results-section');
    hide('stack-chart-section');
    hide('table-section');
    hide('insight-section');

    // Still show CAGR chart for context
    const cagrTable = R.cagrDecayTable(params.model, params.retirementYear, params.timeHorizonYears);
    renderCAGRChart(cagrTable);
    show('cagr-section');

    // Show action buttons (PDF export, reset)
    show('action-buttons');

    $('comparison-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── CAGR Decay Chart ─────────────────────────────────────────
  function renderCAGRChart(cagrTable) {
    const ctx = $('cagr-chart');
    if (cagrChart) cagrChart.destroy();

    const labels = cagrTable.map(r => r.year);
    const data = cagrTable.map(r => r.cagr * 100);

    cagrChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Expected Annual Return (%)',
          data,
          backgroundColor: data.map(v => v > 20 ? '#F7931A' : v > 10 ? '#FFB74D' : '#E0E0E0'),
          borderRadius: 4,
          barPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `CAGR: ${ctx.raw.toFixed(1)}%`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 15 }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => v + '%'
            },
            grid: { color: 'rgba(0,0,0,0.05)' }
          }
        }
      }
    });
  }

  // ── Stack & Spending Chart ───────────────────────────────────
  function renderStackChart(result, params) {
    const ctx = $('stack-chart');
    if (stackChart) stackChart.destroy();

    const years = result.results.map(r => r.year);
    const sym = getCurrencySymbol();
    const r8 = getRate();
    const stackData = result.results.map(r => r.stackAfter);
    const portfolioData = result.results.map(r => r.portfolioValueUSD * r8);
    const spendData = result.results.map(r => r.annualSpend * r8);
    const loanData = result.results.map(r => (r.loanBalance || 0) * r8);

    const datasets = [
      {
        label: 'BTC Stack',
        data: stackData,
        borderColor: '#F7931A',
        backgroundColor: 'rgba(247, 147, 26, 0.1)',
        fill: true,
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.2,
        yAxisID: 'yBTC'
      },
      {
        label: 'Annual Spending (' + currency + ')',
        data: spendData,
        borderColor: '#FF1744',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yVal'
      },
      {
        label: 'Portfolio Value (' + currency + ')',
        data: portfolioData,
        borderColor: '#00C853',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yVal'
      }
    ];

    // Add loan balance line if loans are active
    if (params.useLoans && loanData.some(v => v > 0)) {
      datasets.push({
        label: 'Loan Balance (' + currency + ')',
        data: loanData,
        borderColor: '#9C27B0',
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yVal'
      });
    }

    stackChart = new Chart(ctx, {
      type: 'line',
      data: { labels: years, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, padding: 16 }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const val = ctx.raw;
                if (ctx.dataset.yAxisID === 'yBTC') {
                  return ctx.dataset.label + ': ' + val.toFixed(4) + ' BTC';
                }
                return ctx.dataset.label + ': ' + sym + Math.round(val).toLocaleString();
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 15 }
          },
          yBTC: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'BTC Stack' },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { callback: v => v.toFixed(2) }
          },
          yVal: {
            type: 'logarithmic',
            position: 'right',
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
  function renderSummaryCards(params, result, summary) {
    const container = $('summary-cards');
    if (!summary) {
      container.innerHTML = `
        <div class="card">
          <div class="card-label">Result</div>
          <div class="card-value" style="color: var(--red);">RUIN</div>
          <div class="card-sub">Stack depleted in year ${result.ruinYear}</div>
        </div>
      `;
      return;
    }

    const scenarioName = R.scenarioLabel(params.scenarioMode);
    const modeName = params.useLoans ? 'With Loans' : 'Sell Only';

    container.innerHTML = `
      <div class="card">
        <div class="card-label">Strategy</div>
        <div class="card-value">${modeName}</div>
        <div class="card-sub">${scenarioName} scenario · ${PL.MODELS[params.model].name}</div>
      </div>
      <div class="card">
        <div class="card-label">Years Sustained</div>
        <div class="card-value large" style="color: ${summary.yearsBeforeRuin >= params.timeHorizonYears ? 'var(--green)' : 'var(--red)'}">
          ${summary.yearsBeforeRuin}
        </div>
        <div class="card-sub">of ${params.timeHorizonYears} year horizon</div>
      </div>
      <div class="card">
        <div class="card-label">Final Stack</div>
        <div class="card-value">${summary.finalStack.toFixed(4)} BTC</div>
        <div class="card-sub">${fmtCurrency(summary.finalValue)} portfolio value</div>
      </div>
      <div class="card">
        <div class="card-label">Total BTC Sold</div>
        <div class="card-value">${summary.totalBTCSold.toFixed(4)}</div>
        <div class="card-sub">of ${params.btcHoldings.toFixed(4)} starting stack</div>
      </div>
      <div class="card">
        <div class="card-label">Average SWR</div>
        <div class="card-value">${summary.avgSWR.toFixed(2)}%</div>
        <div class="card-sub">Dynamic: fixed ${getCurrencySymbol()} amount, shrinking %</div>
      </div>
      <div class="card">
        <div class="card-label">Total Spent</div>
        <div class="card-value">${fmtCurrency(summary.totalSpent)}</div>
        <div class="card-sub">At ${(params.m2GrowthRate * 100).toFixed(1)}% annual spending growth</div>
      </div>
      ${params.useLoans ? `
      <div class="card">
        <div class="card-label">Borrow Years</div>
        <div class="card-value" style="color: var(--orange)">${summary.borrowYears}</div>
        <div class="card-sub">Years borrowing instead of selling</div>
      </div>
      <div class="card">
        <div class="card-label">Total Interest Paid</div>
        <div class="card-value">${fmtCurrency(summary.totalInterestPaid)}</div>
        <div class="card-sub">At ${(params.loanInterestRate * 100).toFixed(1)}% annual rate</div>
      </div>
      ` : ''}
    `;
  }

  // ── Year-by-Year Table ──────────────────────────────────────
  function renderYearlyTable(result, params) {
    const tbody = $('yearly-table-body');
    tbody.innerHTML = '';

    result.results.forEach(row => {
      const tr = document.createElement('tr');

      // Status styling
      let statusClass = 'status-ok';
      let statusText = row.status;
      if (row.status === 'RUIN') {
        statusClass = 'status-ruin';
        statusText = '⚠ RUIN';
      } else if (row.status === 'BORROWING' || row.status === 'PARTIAL_BORROW') {
        statusClass = 'status-borrow';
        statusText = '🔄 Borrow';
      } else if (row.status === 'SELL_AND_REPAY') {
        statusClass = 'status-sell';
        statusText = '✓ Sell + Repay';
      } else if (row.status === 'FORCED_SELL') {
        statusClass = 'status-ruin';
        statusText = '⚠ Forced Sell';
      } else if (row.status === 'PARTIAL_REPAY') {
        statusClass = 'status-sell';
        statusText = '↻ Partial Repay';
      } else {
        statusText = '✓ OK';
      }

      tr.innerHTML = `
        <td><strong>${row.year}</strong></td>
        <td>${row.price > 0 ? fmtCurrency(row.price) : '—'}</td>
        <td>${row.trend > 0 ? fmtCurrency(row.trend) : '—'}</td>
        <td class="multiple-cell ${row.multiple < 1 ? 'under' : row.multiple > 1.5 ? 'over' : 'fair'}">
          ${row.multiple > 0 ? row.multiple.toFixed(2) + '×' : '—'}
        </td>
        <td>${fmtCurrency(row.annualSpend)}</td>
        <td>${row.btcSold > 0 ? row.btcSold.toFixed(4) : '—'}</td>
        <td>${(row.loanBalance || 0) > 0 ? fmtCurrency(row.loanBalance) : '—'}</td>
        <td>${row.stackAfter > 0 ? row.stackAfter.toFixed(4) : '0'}</td>
        <td>${row.portfolioValueUSD > 0 ? fmtCurrency(row.portfolioValueUSD) : '—'}</td>
        <td>${row.swrPct > 0 ? row.swrPct.toFixed(2) + '%' : '—'}</td>
        <td class="${statusClass}">${statusText}</td>
      `;

      // Highlight ruin rows
      if (row.status === 'RUIN') {
        tr.style.background = 'rgba(255, 23, 68, 0.05)';
      }
      // Highlight borrow rows
      if (row.status === 'BORROWING' || row.status === 'PARTIAL_BORROW') {
        tr.style.background = 'rgba(247, 147, 26, 0.05)';
      }

      tbody.appendChild(tr);
    });
  }

  // ── Dynamic Insight Text ─────────────────────────────────────
  function renderInsight(params, result, summary) {
    const el = $('insight-text');
    if (!el) return;

    if (!summary) {
      el.innerHTML = `With <strong>${params.btcHoldings} BTC</strong> and <strong>${fmtCurrency(params.annualSpendUSD)}/year</strong> spending, your stack would be depleted by <strong>${result.ruinYear}</strong> under the ${R.scenarioLabel(params.scenarioMode)} scenario. Consider reducing spending, increasing holdings, or delaying retirement.`;
      return;
    }

    const startCAGR = R.instantaneousCAGR(params.model, new Date(params.retirementYear, 0, 1));
    const endCAGR = R.instantaneousCAGR(params.model, new Date(params.retirementYear + params.timeHorizonYears, 0, 1));
    const spendStart = params.annualSpendUSD;
    const spendEnd = params.annualSpendUSD * Math.pow(1 + params.m2GrowthRate, params.timeHorizonYears);

    let text = `On the power law model, expected annual returns decline from <strong>${(startCAGR * 100).toFixed(1)}%</strong> in ${params.retirementYear} to <strong>${(endCAGR * 100).toFixed(1)}%</strong> by ${params.retirementYear + params.timeHorizonYears}. `;
    text += `This is fundamentally different from stock-based retirement planning where CAGR is assumed constant. `;
    text += `Your spending rises from <strong>${fmtCurrency(spendStart)}</strong> to <strong>${fmtCurrency(spendEnd)}</strong> over ${params.timeHorizonYears} years at ${(params.m2GrowthRate * 100).toFixed(1)}% annual spending growth. `;

    if (summary.yearsBeforeRuin >= params.timeHorizonYears) {
      text += `Your stack of <strong>${params.btcHoldings} BTC</strong> survives the full ${params.timeHorizonYears}-year horizon, ending with <strong>${summary.finalStack.toFixed(4)} BTC</strong> worth <strong>${fmtCurrency(summary.finalValue)}</strong>. `;
    }

    if (params.useLoans && summary.borrowYears > 0) {
      text += `The loan strategy preserves bitcoin during ${summary.borrowYears} below-trend years, costing <strong>${fmtCurrency(summary.totalInterestPaid)}</strong> in interest. `;
    }

    text += `Your average withdrawal rate is <strong>${summary.avgSWR.toFixed(2)}%</strong> — a "dynamic SWR" where the ${currency} amount stays constant (adjusted for spending growth) but the percentage of your stack decreases as bitcoin appreciates.`;

    el.innerHTML = text;
  }

  // ── Status Banner ──────────────────────────────────────────
  function classifyResult(params, result, summary) {
    // RUIN
    if (result.ruinYear !== null) {
      return { status: 'red', ruinYear: result.ruinYear };
    }

    // TIGHT: stack drops below 5% of starting holdings
    const threshold = params.btcHoldings * 0.05;
    const nonRuin = result.results.filter(r => r.status !== 'RUIN');
    const tightYear = nonRuin.find(r => r.stackAfter < threshold && r.stackAfter > 0);

    if (tightYear) {
      return {
        status: 'amber',
        tightYear: tightYear.year,
        minStack: tightYear.stackAfter
      };
    }

    // GREEN: comfortable survival
    return {
      status: 'green',
      finalStack: summary.finalStack,
      finalValue: summary.finalValue
    };
  }

  function computeFixSuggestion(params) {
    // 1. Find minimum stack needed
    const minResult = R.findMinimumStack(params, params.useLoans);
    const minStack = minResult.minStack;
    const additionalBTC = minStack - params.btcHoldings;

    // 2. Binary search for max safe annual spending
    const simulate = params.useLoans ? R.simulateWithLoans : R.simulateSellOnly;
    let loSpend = 1000;
    let hiSpend = params.annualSpendUSD;
    let iterations = 0;

    while (hiSpend - loSpend > 500 && iterations < 30) {
      const midSpend = Math.round((loSpend + hiSpend) / 2);
      const testResult = simulate({ ...params, annualSpendUSD: midSpend });
      if (testResult.ruinYear !== null) {
        hiSpend = midSpend;
      } else {
        loSpend = midSpend;
      }
      iterations++;
    }

    const maxSafeSpend = loSpend;
    const spendReduction = params.annualSpendUSD - maxSafeSpend;

    let html = '';
    if (additionalBTC > 0 && minStack !== Infinity) {
      html += `Need <strong>${additionalBTC.toFixed(3)} more BTC</strong> (total ${minStack.toFixed(3)} BTC) to survive the full horizon`;
    } else {
      html += `Insufficient BTC for this scenario`;
    }

    if (spendReduction > 0 && maxSafeSpend >= 1000) {
      html += `, or reduce spending by <strong>${fmtCurrency(spendReduction)}/year</strong> to <strong>${fmtCurrency(maxSafeSpend)}/year</strong>`;
    }

    html += '.';
    return html;
  }

  function renderStatusBanner(params, result, summary) {
    const banner = $('status-banner');
    const icon = $('status-icon');
    const headline = $('status-headline');
    const detail = $('status-detail');

    const classification = classifyResult(params, result, summary);

    // Remove previous state classes
    banner.classList.remove('status-green', 'status-amber', 'status-red');

    if (classification.status === 'green') {
      banner.classList.add('status-green');
      icon.textContent = '\u2705';
      headline.textContent = `You survive all ${params.timeHorizonYears} years`;
      detail.innerHTML = `Ending with <strong>${classification.finalStack.toFixed(4)} BTC</strong> (${fmtCurrency(classification.finalValue)} portfolio value)`;

    } else if (classification.status === 'amber') {
      banner.classList.add('status-amber');
      icon.textContent = '\u26A0\uFE0F';
      headline.textContent = `Tight \u2014 you survive but barely`;
      detail.innerHTML = `Stack drops below <strong>5% of starting holdings</strong> by year <strong>${classification.tightYear}</strong> (${classification.minStack.toFixed(4)} BTC minimum). Consider a small increase in holdings.`;

    } else {
      banner.classList.add('status-red');
      icon.textContent = '\uD83D\uDED1';
      headline.textContent = `Ruin in year ${classification.ruinYear}`;
      detail.innerHTML = computeFixSuggestion(params);
    }

    // Re-trigger animation
    banner.classList.remove('hidden');
    banner.style.animation = 'none';
    banner.offsetHeight; // force reflow
    banner.style.animation = '';

    show('status-banner');
  }

  // ── Start ────────────────────────────────────────────────────
  init();

})();
