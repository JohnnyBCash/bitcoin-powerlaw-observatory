// Retirement Calculator UI Handler
(function() {
  'use strict';

  const PL = window.PowerLaw;
  const R = window.Retirement;

  let currentModel = 'krueger';
  let cagrChart = null;
  let stackChart = null;

  // ── DOM References ──────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Slider Value Display ────────────────────────────────────
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
        $(s.display).textContent = el.value;
      });
    });
  }


  // ── Loans Toggle ────────────────────────────────────────────
  function setupLoansToggle() {
    const cb = $('use-loans');
    const params = $('loan-params');
    const label = $('loans-label');

    cb.addEventListener('change', () => {
      if (cb.checked) {
        params.classList.remove('hidden');
        label.textContent = 'Loans: ON — Borrow below trend';
      } else {
        params.classList.add('hidden');
        label.textContent = 'Loans: OFF — Sell only';
      }
    });
  }

  // ── Model Toggle ────────────────────────────────────────────
  function setupModelToggle() {
    document.querySelectorAll('.toggle-btn[data-model]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn[data-model]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentModel = btn.dataset.model;
      });
    });
  }

  // ── Gather Parameters ───────────────────────────────────────
  function getParams() {
    return {
      btcHoldings: parseFloat($('btc-holdings').value) || 1,
      annualSpendUSD: parseFloat($('annual-spend').value) || 50000,
      retirementYear: parseInt($('retirement-year').value) || 2030,
      timeHorizonYears: parseInt($('time-horizon').value) || 30,
      m2GrowthRate: parseFloat($('m2-growth').value) / 100,
      model: currentModel,
      sigma: 0.3, // will be updated if we have historical data
      priceScenarioK: parseFloat($('price-scenario').value),
      useLoans: $('use-loans').checked,
      loanLTV: parseFloat($('loan-ltv').value) / 100,
      loanInterestRate: parseFloat($('loan-interest').value) / 100,
      loanThreshold: parseFloat($('loan-threshold').value)
    };
  }


  // ── Render CAGR Chart ───────────────────────────────────────
  function renderCAGRChart(params) {
    const table = R.cagrDecayTable(params.model, params.retirementYear, params.timeHorizonYears);
    const section = $('cagr-section');
    section.classList.remove('hidden');

    if (cagrChart) cagrChart.destroy();

    const ctx = $('cagr-chart').getContext('2d');
    cagrChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: table.map(r => r.year),
        datasets: [{
          label: 'Expected Annual Return (%)',
          data: table.map(r => parseFloat(r.cagrPct)),
          backgroundColor: table.map(r =>
            parseFloat(r.cagrPct) > 10 ? 'rgba(247, 147, 26, 0.7)' : 'rgba(117, 117, 117, 0.4)'
          ),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `CAGR: ${ctx.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          y: {
            title: { display: true, text: 'CAGR %' },
            beginAtZero: true
          },
          x: { title: { display: true, text: 'Year' } }
        }
      }
    });
  }

