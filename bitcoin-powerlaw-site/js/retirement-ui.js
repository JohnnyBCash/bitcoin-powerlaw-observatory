// Bitcoin Retirement Calculator - UI Handler
(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;

  let currentModel = 'krueger';
  let cagrChart = null;
  let stackChart = null;
  let historicalData = [];
  let calculatedSigma = 0.3;

  // ── DOM Helpers ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
  const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

  // ── Gather User Inputs ───────────────────────────────────────
  function getParams() {
    const useLoans = $('use-loans').checked;
    return {
      btcHoldings: parseFloat($('btc-holdings').value) || 1.0,
      annualSpendUSD: parseFloat($('annual-spend').value) || 50000,
      retirementYear: parseInt($('retirement-year').value) || 2030,
      timeHorizonYears: parseInt($('time-horizon').value) || 30,
      m2GrowthRate: parseFloat($('m2-growth').value) / 100,
      model: currentModel,
      sigma: calculatedSigma,
      priceScenarioK: parseInt($('price-scenario').value),
      useLoans,
      loanLTV: parseFloat($('loan-ltv').value) / 100,
      loanInterestRate: parseFloat($('loan-interest').value) / 100,
      loanThreshold: parseFloat($('loan-threshold').value)
    };
  }

  // ── Initialize ───────────────────────────────────────────────
  async function init() {
    await loadHistoricalData();
    setupSliders();
    setupModelToggle();
    setupLoanToggle();
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
      });
    });
  }

  function setupModelToggle() {
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentModel = btn.dataset.model;
        if (historicalData.length) {
          calculatedSigma = PL.calculateSigma(historicalData, currentModel).sigma;
        }
      });
    });
  }

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

  function setupButtons() {
    $('calculate-btn').addEventListener('click', runCalculation);
    $('compare-btn').addEventListener('click', runComparison);
  }

  // ── Main Calculation ─────────────────────────────────────────
  function runCalculation() {
    const params = getParams();
    const simulate = params.useLoans ? R.simulateWithLoans : R.simulateSellOnly;
    const result = simulate(params);
    const summary = R.simulationSummary(result);
    const cagrTable = R.cagrDecayTable(params.model, params.retirementYear, params.timeHorizonYears);

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

    // Scroll to results
    $('cagr-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Comparison Mode ──────────────────────────────────────────
  function runComparison() {
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
        <td>${row.withLoans.totalInterest > 0 ? '$' + Math.round(row.withLoans.totalInterest).toLocaleString() : '—'}</td>
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
    const stackData = result.results.map(r => r.stackAfter);
    const portfolioData = result.results.map(r => r.portfolioValueUSD);
    const spendData = result.results.map(r => r.annualSpend);
    const loanData = result.results.map(r => r.loanBalance || 0);

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
        label: 'Annual Spending (USD)',
        data: spendData,
        borderColor: '#FF1744',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yUSD'
      },
      {
        label: 'Portfolio Value (USD)',
        data: portfolioData,
        borderColor: '#00C853',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yUSD'
      }
    ];

    // Add loan balance line if loans are active
    if (params.useLoans && loanData.some(v => v > 0)) {
      datasets.push({
        label: 'Loan Balance (USD)',
        data: loanData,
        borderColor: '#9C27B0',
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.2,
        yAxisID: 'yUSD'
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
                return ctx.dataset.label + ': $' + Math.round(val).toLocaleString();
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
          yUSD: {
            type: 'logarithmic',
            position: 'right',
            title: { display: true, text: 'USD Value' },
            grid: { display: false },
            ticks: {
              callback: v => {
                if (v >= 1e9) return '$' + (v / 1e9).toFixed(0) + 'B';
                if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
                if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
                return '$' + v;
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

    const scenarioName = R.scenarioLabel(params.priceScenarioK);
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
        <div class="card-sub">$${Math.round(summary.finalValue).toLocaleString()} portfolio value</div>
      </div>
      <div class="card">
        <div class="card-label">Total BTC Sold</div>
        <div class="card-value">${summary.totalBTCSold.toFixed(4)}</div>
        <div class="card-sub">of ${params.btcHoldings.toFixed(4)} starting stack</div>
      </div>
      <div class="card">
        <div class="card-label">Average SWR</div>
        <div class="card-value">${summary.avgSWR.toFixed(2)}%</div>
        <div class="card-sub">Dynamic: fixed $ amount, shrinking %</div>
      </div>
      <div class="card">
        <div class="card-label">Total Spent</div>
        <div class="card-value">$${Math.round(summary.totalSpent).toLocaleString()}</div>
        <div class="card-sub">Adjusted for ${(params.m2GrowthRate * 100).toFixed(1)}% M2 inflation</div>
      </div>
      ${params.useLoans ? `
      <div class="card">
        <div class="card-label">Borrow Years</div>
        <div class="card-value" style="color: var(--orange)">${summary.borrowYears}</div>
        <div class="card-sub">Years borrowing instead of selling</div>
      </div>
      <div class="card">
        <div class="card-label">Total Interest Paid</div>
        <div class="card-value">$${Math.round(summary.totalInterestPaid).toLocaleString()}</div>
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
        <td>${row.price > 0 ? PL.formatPrice(row.price) : '—'}</td>
        <td>${row.trend > 0 ? PL.formatPrice(row.trend) : '—'}</td>
        <td class="multiple-cell ${row.multiple < 1 ? 'under' : row.multiple > 1.5 ? 'over' : 'fair'}">
          ${row.multiple > 0 ? row.multiple.toFixed(2) + '×' : '—'}
        </td>
        <td>$${Math.round(row.annualSpend).toLocaleString()}</td>
        <td>${row.btcSold > 0 ? row.btcSold.toFixed(4) : '—'}</td>
        <td>${(row.loanBalance || 0) > 0 ? '$' + Math.round(row.loanBalance).toLocaleString() : '—'}</td>
        <td>${row.stackAfter > 0 ? row.stackAfter.toFixed(4) : '0'}</td>
        <td>${row.portfolioValueUSD > 0 ? '$' + Math.round(row.portfolioValueUSD).toLocaleString() : '—'}</td>
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
      el.innerHTML = `With <strong>${params.btcHoldings} BTC</strong> and <strong>$${params.annualSpendUSD.toLocaleString()}/year</strong> spending, your stack would be depleted by <strong>${result.ruinYear}</strong> under the ${R.scenarioLabel(params.priceScenarioK)} scenario. Consider reducing spending, increasing holdings, or delaying retirement.`;
      return;
    }

    const startCAGR = R.instantaneousCAGR(params.model, new Date(params.retirementYear, 0, 1));
    const endCAGR = R.instantaneousCAGR(params.model, new Date(params.retirementYear + params.timeHorizonYears, 0, 1));
    const spendStart = params.annualSpendUSD;
    const spendEnd = params.annualSpendUSD * Math.pow(1 + params.m2GrowthRate, params.timeHorizonYears);

    let text = `On the power law model, expected annual returns decline from <strong>${(startCAGR * 100).toFixed(1)}%</strong> in ${params.retirementYear} to <strong>${(endCAGR * 100).toFixed(1)}%</strong> by ${params.retirementYear + params.timeHorizonYears}. `;
    text += `This is fundamentally different from stock-based retirement planning where CAGR is assumed constant. `;
    text += `Your spending rises from <strong>$${spendStart.toLocaleString()}</strong> to <strong>$${Math.round(spendEnd).toLocaleString()}</strong> over ${params.timeHorizonYears} years at ${(params.m2GrowthRate * 100).toFixed(1)}% M2 growth. `;

    if (summary.yearsBeforeRuin >= params.timeHorizonYears) {
      text += `Your stack of <strong>${params.btcHoldings} BTC</strong> survives the full ${params.timeHorizonYears}-year horizon, ending with <strong>${summary.finalStack.toFixed(4)} BTC</strong> worth <strong>$${Math.round(summary.finalValue).toLocaleString()}</strong>. `;
    }

    if (params.useLoans && summary.borrowYears > 0) {
      text += `The loan strategy preserves bitcoin during ${summary.borrowYears} below-trend years, costing <strong>$${Math.round(summary.totalInterestPaid).toLocaleString()}</strong> in interest. `;
    }

    text += `Your average withdrawal rate is <strong>${summary.avgSWR.toFixed(2)}%</strong> — a "dynamic SWR" where the dollar amount stays constant (adjusted for M2 inflation) but the percentage of your stack decreases as bitcoin appreciates.`;

    el.innerHTML = text;
  }

  // ── Start ────────────────────────────────────────────────────
  init();

})();
