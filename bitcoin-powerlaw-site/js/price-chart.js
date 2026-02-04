// Bitcoin Power Law Observatory – Interactive Weekly Price Chart
// Loads Prices.csv and renders a Chart.js line chart.
// Time axis and price axis each toggle independently: linear ↔ logarithmic.

(function () {
  'use strict';

  /* -------------------------------------------------- state -------------------------------------------------- */
  let weeklyData = [];        // [{date: Date, price: number}]
  let chart = null;
  let xScale = 'linear';      // 'linear' | 'logarithmic'
  let yScale = 'linear';

  /* -------------------------------------------------- load CSV --------------------------------------------------- */
  async function loadData() {
    const res = await fetch('../datasets/Prices.csv');
    const text = await res.text();
    const lines = text.trim().split('\n');

    // skip header
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 2) continue;
      const date = new Date(parts[0].trim() + 'T00:00:00Z');
      const price = parseFloat(parts[1]);
      if (isNaN(price) || isNaN(date.getTime())) continue;
      weeklyData.push({ date, price });
    }

    // ensure chronological order
    weeklyData.sort((a, b) => a.date - b.date);
  }

  /* -------------------------------------------------- stats ------------------------------------------------------ */
  function computeStats() {
    if (!weeklyData.length) return;

    let ath = -Infinity, athDate = null;
    let atl = Infinity,  atlDate = null;

    for (const w of weeklyData) {
      if (w.price > ath) { ath = w.price; athDate = w.date; }
      if (w.price < atl) { atl = w.price; atlDate = w.date; }
    }

    const latest = weeklyData[weeklyData.length - 1];

    setText('stat-latest', formatUSD(latest.price));
    setText('stat-ath',    formatUSD(ath));
    setText('stat-ath-date', fmtDate(athDate));
    setText('stat-atl',    formatUSD(atl));
    setText('stat-atl-date', fmtDate(atlDate));
    setText('stat-weeks',  weeklyData.length.toString());
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

  /* -------------------------------------------------- chart data ------------------------------------------------- */
  function buildDataset() {
    // When x-axis is logarithmic we use "days since genesis" as numeric x.
    // When x-axis is linear (time) we use the Date object directly (chartjs-adapter-date-fns handles it).
    return weeklyData.map(w => {
      if (xScale === 'logarithmic') {
        return { x: PowerLaw.daysSinceGenesis(w.date), y: w.price };
      }
      return { x: w.date, y: w.price };
    });
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
              // Show nice labels: days or years
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
      type: yScale,                 // 'linear' or 'logarithmic'
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

    // On linear price scale start at zero; on log scale Chart.js handles it automatically.
    if (yScale === 'linear') yAxis.beginAtZero = true;

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: { x: xAxis, y: yAxis },
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 16 } },
        tooltip: {
          callbacks: {
            title: function (ctx) {
              // Always show the real date in the tooltip
              const idx = ctx[0].dataIndex;
              return fmtDate(weeklyData[idx].date);
            },
            label: function (ctx) {
              return 'Price: ' + formatUSD(ctx.parsed.y);
            }
          }
        }
      }
    };
  }

  /* -------------------------------------------------- render / update ------------------------------------------- */
  function renderChart() {
    const ctx = document.getElementById('price-chart').getContext('2d');

    const dataset = {
      label: 'BTC Weekly Close',
      data: buildDataset(),
      borderColor: '#F7931A',
      backgroundColor: 'rgba(247, 147, 26, 0.08)',
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0
    };

    chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [dataset] },
      options: buildOptions()
    });
  }

  function updateChart() {
    if (!chart) return;

    // Rebuild dataset (x values change when switching time ↔ log)
    chart.data.datasets[0].data = buildDataset();
    chart.options = buildOptions();
    chart.update();
  }

  /* -------------------------------------------------- toggle wiring ----------------------------------------------- */
  function setupToggles() {
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const axis = btn.dataset.axis;   // 'x' or 'y'
        const scale = btn.dataset.scale; // 'linear' or 'logarithmic'

        // update active state within the same pill group
        const group = btn.closest('.pill-group');
        group.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // apply
        if (axis === 'x') xScale = scale;
        else              yScale = scale;

        updateChart();
      });
    });
  }

  /* -------------------------------------------------- init -------------------------------------------------------- */
  async function init() {
    try {
      await loadData();
      computeStats();
      renderChart();
      setupToggles();
    } catch (err) {
      console.error('Price chart init failed:', err);
    }
  }

  // Wait for Chart.js + adapter to be ready
  if (typeof Chart !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
