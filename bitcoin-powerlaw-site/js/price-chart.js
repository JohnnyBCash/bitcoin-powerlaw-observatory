// Bitcoin Power Law Observatory – Interactive Weekly Price Chart
// Loads Prices.csv and renders a Chart.js line chart.
// Time axis and price axis each toggle independently: linear ↔ logarithmic.
// Overlays the selected power-law trend line and ±1σ / ±2σ bands.

(function () {
  'use strict';

  /* -------------------------------------------------- state -------------------------------------------------- */
  let weeklyData  = [];          // [{date: Date, price: number}]
  let chart       = null;
  let xScale      = 'linear';    // 'linear' | 'logarithmic'
  let yScale      = 'linear';
  let currentModel = 'krueger';  // 'krueger' | 'santostasi'
  let sigma       = 0;           // computed once data is loaded

  /* -------------------------------------------------- load CSV --------------------------------------------------- */
  async function loadData() {
    const res   = await fetch('../datasets/Prices.csv');
    const text  = await res.text();
    const lines = text.trim().split('\n');

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 2) continue;
      const date  = new Date(parts[0].trim() + 'T00:00:00Z');
      const price = parseFloat(parts[1]);
      if (isNaN(price) || isNaN(date.getTime())) continue;
      weeklyData.push({ date, price });
    }

    weeklyData.sort((a, b) => a.date - b.date);
    window._btcWeeklyData = weeklyData;   // share with time-travel.js
  }

  /* -------------------------------------------------- sigma -------------------------------------------------------- */
  // Convert weeklyData into the shape PowerLaw.calculateSigma expects: [{date, price}]
  // PowerLaw.calculateSigma already accepts that shape — just compute once per model switch.
  function computeSigma() {
    const asHistorical = weeklyData.map(w => ({
      date:  w.date.toISOString().slice(0, 10),
      price: w.price
    }));
    sigma = PowerLaw.calculateSigma(asHistorical, currentModel).sigma;
  }

  /* -------------------------------------------------- stats ------------------------------------------------------ */
  function computeStats() {
    if (!weeklyData.length) return;

    let ath = -Infinity, athDate = null;
    let atl =  Infinity, atlDate = null;

    for (const w of weeklyData) {
      if (w.price > ath) { ath = w.price; athDate = w.date; }
      if (w.price < atl) { atl = w.price; atlDate = w.date; }
    }

    const latest = weeklyData[weeklyData.length - 1];

    setText('stat-latest',   formatUSD(latest.price));
    setText('stat-ath',      formatUSD(ath));
    setText('stat-ath-date', fmtDate(athDate));
    setText('stat-atl',      formatUSD(atl));
    setText('stat-atl-date', fmtDate(atlDate));
    setText('stat-weeks',    weeklyData.length.toString());
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /* -------------------------------------------------- formatting ------------------------------------------------- */
  function formatUSD(n) {
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 1)    return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* -------------------------------------------------- x-value helper -------------------------------------------- */
  // Returns the correct x value for a Date depending on current xScale setting.
  function xVal(date) {
    return xScale === 'logarithmic' ? PowerLaw.daysSinceGenesis(date) : date;
  }

  /* -------------------------------------------------- build all datasets ---------------------------------------- */
  function buildDatasets() {
    const showTrend  = document.getElementById('show-trend').checked;
    const show1sigma = document.getElementById('show-1sigma').checked;
    const show2sigma = document.getElementById('show-2sigma').checked;

    // ---- price ----
    const priceData = weeklyData.map(w => ({ x: xVal(w.date), y: w.price }));

    // ---- trend + bands (share the same x points as price) ----
    const trendData  = [];
    const upper1Data = [];
    const lower1Data = [];
    const upper2Data = [];
    const lower2Data = [];

    for (const w of weeklyData) {
      const x     = xVal(w.date);
      const trend = PowerLaw.trendPrice(currentModel, w.date);
      trendData.push({ x, y: trend });
      upper1Data.push({ x, y: PowerLaw.bandPrice(currentModel, sigma, 1,  w.date) });
      lower1Data.push({ x, y: PowerLaw.bandPrice(currentModel, sigma, -1, w.date) });
      upper2Data.push({ x, y: PowerLaw.bandPrice(currentModel, sigma, 2,  w.date) });
      lower2Data.push({ x, y: PowerLaw.bandPrice(currentModel, sigma, -2, w.date) });
    }

    // ---- assemble datasets array in a fixed order so index-based updates stay stable ----
    // Order: [+2σ, +1σ, trend, price, -1σ, -2σ]
    // fill targets reference dataset labels by index:
    //   +2σ  (0) fills to +1σ  (1)
    //   +1σ  (1) fills to trend (2)
    //   -1σ  (4) fills to trend (2)  — use '+2' meaning two indices forward from -1σ…
    //   Actually Chart.js fill can use { target: 'origin' } or dataset index.
    //   We'll use numeric dataset indices directly.

    const datasets = [
      {
        // 0 – +2σ upper boundary
        label: '+2σ',
        data: upper2Data,
        borderColor: 'rgba(255, 23, 68, 0.35)',
        backgroundColor: 'rgba(255, 23, 68, 0.06)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        fill: { target: 1 },   // fill down to +1σ dataset
        display: show2sigma
      },
      {
        // 1 – +1σ upper boundary
        label: '+1σ',
        data: upper1Data,
        borderColor: 'rgba(255, 23, 68, 0.25)',
        backgroundColor: 'rgba(255, 23, 68, 0.1)',
        borderWidth: 1,
        borderDash: [2, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 },   // fill down to trend
        display: show1sigma
      },
      {
        // 2 – trend
        label: 'Power Law Trend',
        data: trendData,
        borderColor: '#F7931A',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0,
        fill: false,
        display: showTrend
      },
      {
        // 3 – actual price (always visible)
        label: 'BTC Weekly Close',
        data: priceData,
        borderColor: '#000000',
        backgroundColor: 'transparent',
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0,
        fill: false
      },
      {
        // 4 – -1σ lower boundary
        label: '-1σ',
        data: lower1Data,
        borderColor: 'rgba(0, 200, 83, 0.25)',
        backgroundColor: 'rgba(0, 200, 83, 0.1)',
        borderWidth: 1,
        borderDash: [2, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 },   // fill up to trend
        display: show1sigma
      },
      {
        // 5 – -2σ lower boundary
        label: '-2σ',
        data: lower2Data,
        borderColor: 'rgba(0, 200, 83, 0.35)',
        backgroundColor: 'rgba(0, 200, 83, 0.06)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        fill: { target: 4 },   // fill up to -1σ dataset
        display: show2sigma
      }
    ];

    return datasets;
  }

  /* -------------------------------------------------- chart options -------------------------------------------- */
  function buildOptions() {
    const xIsLog = (xScale === 'logarithmic');

    const xAxis = xIsLog
      ? {
          type: 'logarithmic',
          title: {
            display: true,
            text: 'Days Since Genesis (log scale)',
            font: { weight: 'bold' }
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: function (value) {
              if (value >= 365) return (value / 365).toFixed(0) + 'y';
              return value + 'd';
            }
          }
        }
      : {
          type: 'time',
          time: { unit: 'year', displayFormats: { year: 'yyyy' } },
          title: {
            display: true,
            text: 'Date',
            font: { weight: 'bold' }
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { maxTicksLimit: 12 }
        };

    const yAxis = {
      type: yScale,
      title: {
        display: true,
        text: 'Price USD' + (yScale === 'logarithmic' ? ' (log scale)' : ''),
        font: { weight: 'bold' }
      },
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: {
        callback: function (value) { return formatUSD(value); }
      }
    };

    if (yScale === 'linear') yAxis.beginAtZero = true;

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: { x: xAxis, y: yAxis },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 16,
            filter: function (item) {
              // Only show legend entries for visible datasets
              return item.datasetIndex !== undefined;
            }
          }
        },
        tooltip: {
          callbacks: {
            title: function (ctx) {
              const idx = ctx[0].dataIndex;
              return fmtDate(weeklyData[idx].date);
            },
            label: function (ctx) {
              const dsLabel = ctx.dataset.label;
              const value   = ctx.parsed.y;
              // Skip band labels cluttering the tooltip
              if (dsLabel === '+2σ' || dsLabel === '-2σ' || dsLabel === '+1σ' || dsLabel === '-1σ') {
                return dsLabel + ': ' + formatUSD(value);
              }
              return dsLabel + ': ' + formatUSD(value);
            }
          }
        }
      }
    };
  }

  /* -------------------------------------------------- render / update ------------------------------------------- */
  function renderChart() {
    const ctx = document.getElementById('price-chart').getContext('2d');

    chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: buildDatasets() },
      options: buildOptions()
    });
  }

  function updateChart() {
    if (!chart) return;
    chart.data.datasets = buildDatasets();
    chart.options = buildOptions();
    chart.update();
  }

  /* -------------------------------------------------- toggle wiring ----------------------------------------------- */
  function setupToggles() {
    // Axis scale pills
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const axis  = btn.dataset.axis;
        const scale = btn.dataset.scale;

        const group = btn.closest('.pill-group');
        group.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (axis === 'x') xScale = scale;
        else              yScale = scale;

        updateChart();
      });
    });

    // Model toggle buttons
    document.querySelectorAll('.toggle-btn[data-model]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn[data-model]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentModel = btn.dataset.model;
        computeSigma();
        updateChart();
      });
    });

    // Band / trend checkboxes
    ['show-trend', 'show-1sigma', 'show-2sigma'].forEach(id => {
      document.getElementById(id).addEventListener('change', updateChart);
    });
  }

  /* -------------------------------------------------- init -------------------------------------------------------- */
  async function init() {
    try {
      await loadData();
      computeSigma();
      computeStats();
      renderChart();
      setupToggles();
    } catch (err) {
      console.error('Price chart init failed:', err);
    }
  }

  if (typeof Chart !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
