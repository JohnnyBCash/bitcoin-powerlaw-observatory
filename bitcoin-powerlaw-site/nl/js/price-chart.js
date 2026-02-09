// Bitcoin Power Law Observatory – Interactieve Wekelijkse Prijsgrafiek (NL)
// Laadt Prices.csv en rendert een Chart.js lijngrafiek.
// Tijdas en prijsas schakelen elk onafhankelijk: lineair <-> logaritmisch.
// Toont de geselecteerde machtswet-trendlijn en +/-1σ / +/-2σ banden.

(function () {
  'use strict';

  /* -------------------------------------------------- state -------------------------------------------------- */
  let weeklyData  = [];          // [{date: Date, price: number}]
  let chart       = null;
  let xScale      = 'linear';    // 'linear' | 'logarithmic'
  let yScale      = 'linear';
  let currentModel = 'santostasi';
  let sigma       = 0;           // computed once data is loaded

  /* -------------------------------------------------- load CSV --------------------------------------------------- */
  async function loadData() {
    const res   = await fetch('../../datasets/Prices.csv');
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
    if (n >= 1e3)  return '$' + n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
    if (n >= 1)    return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  function fmtDate(d) {
    return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
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

    // ---- prijs ----
    const priceData = weeklyData.map(w => ({ x: xVal(w.date), y: w.price }));

    // ---- trend + banden (delen dezelfde x-punten als prijs) ----
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

    // ---- stel datasets-array samen in vaste volgorde zodat index-gebaseerde updates stabiel blijven ----
    // Volgorde: [+2σ, +1σ, trend, prijs, -1σ, -2σ]

    const datasets = [
      {
        // 0 – +2σ bovengrens
        label: '+2σ',
        data: upper2Data,
        borderColor: 'rgba(255, 23, 68, 0.35)',
        backgroundColor: 'rgba(255, 23, 68, 0.06)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        fill: { target: 1 },   // vul naar beneden tot +1σ dataset
        display: show2sigma
      },
      {
        // 1 – +1σ bovengrens
        label: '+1σ',
        data: upper1Data,
        borderColor: 'rgba(255, 23, 68, 0.25)',
        backgroundColor: 'rgba(255, 23, 68, 0.1)',
        borderWidth: 1,
        borderDash: [2, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 },   // vul naar beneden tot trend
        display: show1sigma
      },
      {
        // 2 – trend
        label: 'Machtswet Trend',
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
        // 3 – werkelijke prijs (altijd zichtbaar)
        label: 'BTC Wekelijks Slot',
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
        // 4 – -1σ ondergrens
        label: '-1σ',
        data: lower1Data,
        borderColor: 'rgba(0, 200, 83, 0.25)',
        backgroundColor: 'rgba(0, 200, 83, 0.1)',
        borderWidth: 1,
        borderDash: [2, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 },   // vul naar boven tot trend
        display: show1sigma
      },
      {
        // 5 – -2σ ondergrens
        label: '-2σ',
        data: lower2Data,
        borderColor: 'rgba(0, 200, 83, 0.35)',
        backgroundColor: 'rgba(0, 200, 83, 0.06)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        fill: { target: 4 },   // vul naar boven tot -1σ dataset
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
            text: 'Dagen sinds genesis (log schaal)',
            font: { weight: 'bold' }
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: function (value) {
              if (value >= 365) return (value / 365).toFixed(0) + 'j';
              return value + 'd';
            }
          }
        }
      : {
          type: 'time',
          time: { unit: 'year', displayFormats: { year: 'yyyy' } },
          title: {
            display: true,
            text: 'Datum',
            font: { weight: 'bold' }
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { maxTicksLimit: 12 }
        };

    const yAxis = {
      type: yScale,
      title: {
        display: true,
        text: 'Prijs USD' + (yScale === 'logarithmic' ? ' (log schaal)' : ''),
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
              // Toon alleen legenda-items voor zichtbare datasets
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
              // Sla band-labels over die de tooltip vervuilen
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
    // Asschaal-knoppen
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

    // Band / trend selectievakjes
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
      console.error('Prijsgrafiek initialisatie mislukt:', err);
    }
  }

  if (typeof Chart !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
