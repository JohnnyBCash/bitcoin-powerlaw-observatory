// Bitcoin Power Law Observatory - Future Projections Logic

let historicalData = [];
let sigmaCache = {};
let currentModel = 'santostasi';
let projectionChart = null;
let projectionYears = 20;
let showCycleOverlay = false;
let livePrice = null;

// Key dates and milestones
const PROJECTION_DATES = [
  { date: new Date(2026, 11, 31), label: 'End of 2026' },
  { date: new Date(2028, 11, 31), label: 'End of 2028' },
  { date: new Date(2030, 11, 31), label: 'End of 2030' },
  { date: new Date(2032, 11, 31), label: 'End of 2032' },
  { date: new Date(2035, 11, 31), label: 'End of 2035' },
  { date: new Date(2040, 11, 31), label: 'End of 2040' },
  { date: new Date(2045, 11, 31), label: 'End of 2045' }
];

const MILESTONE_PRICES = [
  100000,
  250000,
  500000,
  1000000,
  2500000,
  5000000,
  10000000
];

// Initialize
async function init() {
  await loadHistoricalData();
  await fillRecentPriceGap();
  calculateSigmas();
  populateTimeline();
  populateProjectionTable();
  populateMilestoneTable();
  initProjectionChart();
  setupControls();
  fetchLivePrice();
}

// Load historical data
async function loadHistoricalData() {
  try {
    const response = await fetch('../datasets/btc_historical.json');
    historicalData = await response.json();
  } catch (error) {
    console.error('Failed to load historical data:', error);
  }
}

// Fetch recent daily prices from CoinGecko to fill the gap between
// the static btc_historical.json and today
async function fillRecentPriceGap() {
  if (historicalData.length === 0) return;

  const lastDate = new Date(historicalData[historicalData.length - 1].date);
  const now = new Date();
  const gapDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (gapDays <= 1) return;

  try {
    const fetchDays = Math.min(gapDays + 2, 90);
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${fetchDays}&interval=daily`
    );
    const data = await response.json();

    if (!data.prices || data.prices.length === 0) return;

    const lastTimestamp = lastDate.getTime();
    let added = 0;

    for (const [timestamp, price] of data.prices) {
      if (timestamp > lastTimestamp + 12 * 60 * 60 * 1000) {
        const date = new Date(timestamp);
        const dateStr = date.toISOString().split('T')[0];

        const alreadyExists = historicalData.some(d => d.date === dateStr);
        if (!alreadyExists) {
          historicalData.push({ date: dateStr, price: price });
          added++;
        }
      }
    }

    if (added > 0) {
      console.log(`Future page: filled ${added} days of price data from CoinGecko`);
    }
  } catch (error) {
    console.warn('Could not fill price gap from CoinGecko:', error);
  }
}

// Fetch live BTC price for initialK calculation and rebuild chart
async function fetchLivePrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const data = await res.json();
    if (data.bitcoin && data.bitcoin.usd) {
      livePrice = data.bitcoin.usd;
      // Rebuild chart so cyclical overlay uses the correct starting position
      if (projectionChart) rebuildChart();
    }
  } catch (e) {
    console.warn('Live price fetch failed:', e);
  }
}

// Calculate sigma for the model
function calculateSigmas() {
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

// Populate milestone timeline
function populateTimeline() {
  const container = document.getElementById('milestone-timeline');
  container.innerHTML = '';

  const milestones = [
    { price: 100000, label: '$100K' },
    { price: 250000, label: '$250K' },
    { price: 500000, label: '$500K' },
    { price: 1000000, label: '$1M' },
    { price: 5000000, label: '$5M' },
    { price: 10000000, label: '$10M' }
  ];

  for (const milestone of milestones) {
    const date = PowerLaw.milestoneDateForPrice(milestone.price, currentModel);
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <div class="timeline-date">${PowerLaw.formatDate(date)}</div>
      <div class="timeline-price">${milestone.label}</div>
      <div class="timeline-label">Trend reaches</div>
    `;
    container.appendChild(item);
  }
}

// Populate projection comparison table
function populateProjectionTable() {
  const tbody = document.getElementById('projection-table');
  tbody.innerHTML = '';

  const now = new Date();

  // Add dynamic rows
  const rows = [
    { date: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()), note: '1 year from now' },
    { date: new Date(now.getFullYear() + 5, now.getMonth(), now.getDate()), note: '5 years from now' },
    { date: new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()), note: '10 years from now' },
    ...PROJECTION_DATES.map(p => ({ date: p.date, note: p.label }))
  ];

  // Sort by date
  rows.sort((a, b) => a.date - b.date);

  // Remove duplicates and past dates
  const seen = new Set();
  const filteredRows = rows.filter(r => {
    const key = r.date.toISOString().split('T')[0];
    if (seen.has(key) || r.date < now) return false;
    seen.add(key);
    return true;
  });

  for (const row of filteredRows) {
    const trendPrice = PowerLaw.trendPrice('santostasi', row.date);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${PowerLaw.formatDate(row.date)}</td>
      <td>${PowerLaw.formatPrice(trendPrice)}</td>
      <td>${row.note}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Populate milestone price table
function populateMilestoneTable() {
  const tbody = document.getElementById('milestone-table');
  tbody.innerHTML = '';

  for (const price of MILESTONE_PRICES) {
    const milestoneDate = PowerLaw.milestoneDateForPrice(price, 'santostasi');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${PowerLaw.formatPrice(price)}</strong></td>
      <td>${PowerLaw.formatDate(milestoneDate)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Initialize projection chart
function initProjectionChart() {
  const ctx = document.getElementById('projection-chart').getContext('2d');
  const sigma = sigmaCache[currentModel].sigma;

  const chartData = prepareProjectionData(currentModel, sigma, projectionYears);

  projectionChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'year',
            displayFormats: {
              year: 'yyyy'
            }
          },
          title: {
            display: true,
            text: 'Year',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        y: {
          type: 'logarithmic',
          title: {
            display: true,
            text: 'Price USD (log scale)',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: function(value) {
              return PowerLaw.formatPrice(value);
            }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 16,
            filter: function(item) {
              // Hide cycle datasets from legend when overlay is off
              if (!showCycleOverlay && (item.text === 'Cyclical Price Path' || item.text === 'Cyclical Upper (1σ)' || item.text === 'Cyclical Lower (1σ)')) {
                return false;
              }
              return true;
            }
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              return PowerLaw.formatDate(context[0].parsed.x);
            },
            label: function(context) {
              if (context.parsed.y == null) return null;
              return context.dataset.label + ': ' + PowerLaw.formatPrice(context.parsed.y);
            }
          }
        }
      }
    }
  });
}

// Prepare projection chart data
function prepareProjectionData(model, sigma, years) {
  const now = new Date();
  const R = window.Retirement;

  // Historical data (last 5 years)
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const recentHistorical = historicalData.filter(d => new Date(d.date) >= fiveYearsAgo);

  const historicalPrices = recentHistorical.map(d => ({
    x: new Date(d.date).getTime(),
    y: d.price
  }));

  // Future projections (monthly intervals)
  const trendData = [];
  const upper1 = [];
  const lower1 = [];
  const upper2 = [];
  const lower2 = [];

  // Cyclical overlay data
  const cyclicalData = [];
  const cyclicalUpper = [];
  const cyclicalLower = [];

  // Compute initialK from live price
  let initialK = null;
  if (livePrice && R) {
    initialK = R.currentSigmaK(model, sigma, livePrice);
  }

  for (let i = -60; i <= years * 12; i++) { // 5 years back + years forward
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const timestamp = date.getTime();
    const trend = PowerLaw.trendPrice(model, date);

    trendData.push({ x: timestamp, y: trend });
    upper1.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, 1, date) });
    lower1.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, -1, date) });
    upper2.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, 2, date) });
    lower2.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, -2, date) });

    // Cyclical path: only for future months
    if (R && i >= 0) {
      const yearIndex = i / 12;
      const effectiveK = R.cyclicalSigmaK(yearIndex, {
        bearBias: 0,
        initialK: initialK
      });
      const cyclicalPrice = R.scenarioPrice(model, date, sigma, effectiveK);
      cyclicalData.push({ x: timestamp, y: cyclicalPrice });

      // Upper/lower cycle envelope: shift the cyclical wave by ~0.5σ
      const upperK = R.cyclicalSigmaK(yearIndex, {
        bearBias: 0,
        amplitude: 1.0,
        initialK: initialK != null ? Math.min(1, initialK + 0.5) : null
      });
      const lowerK = R.cyclicalSigmaK(yearIndex, {
        bearBias: 0,
        amplitude: 1.0,
        initialK: initialK != null ? Math.max(-1, initialK - 0.5) : null
      });
      // Use +0.3σ above and -0.3σ below the cyclical path for a tight corridor
      const upperPrice = R.scenarioPrice(model, date, sigma, Math.min(2, effectiveK + 0.3));
      const lowerPrice = R.scenarioPrice(model, date, sigma, Math.max(-2, effectiveK - 0.3));
      cyclicalUpper.push({ x: timestamp, y: upperPrice });
      cyclicalLower.push({ x: timestamp, y: lowerPrice });
    } else if (R && i < 0) {
      cyclicalData.push({ x: timestamp, y: null });
      cyclicalUpper.push({ x: timestamp, y: null });
      cyclicalLower.push({ x: timestamp, y: null });
    }
  }

  const datasets = [
    {
      label: '+2σ Band',
      data: upper2,
      borderColor: 'rgba(255, 23, 68, 0.3)',
      backgroundColor: 'rgba(255, 23, 68, 0.05)',
      fill: '+1',
      borderWidth: 1,
      pointRadius: 0
    },
    {
      label: '+1σ Band',
      data: upper1,
      borderColor: 'rgba(255, 23, 68, 0.2)',
      backgroundColor: 'rgba(117, 117, 117, 0.05)',
      fill: '+1',
      borderWidth: 1,
      pointRadius: 0
    },
    {
      label: 'Power Law Trend',
      data: trendData,
      borderColor: '#F7931A',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0
    },
    {
      label: '-1σ Band',
      data: lower1,
      borderColor: 'rgba(0, 200, 83, 0.2)',
      backgroundColor: 'rgba(117, 117, 117, 0.05)',
      fill: '-1',
      borderWidth: 1,
      pointRadius: 0
    },
    {
      label: '-2σ Band',
      data: lower2,
      borderColor: 'rgba(0, 200, 83, 0.3)',
      backgroundColor: 'rgba(0, 200, 83, 0.05)',
      fill: '-1',
      borderWidth: 1,
      pointRadius: 0
    },
    {
      label: 'Historical Price',
      data: historicalPrices,
      borderColor: '#000000',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0
    }
  ];

  // Cyclical overlay datasets (hidden unless toggle is on)
  if (R) {
    datasets.push(
      {
        label: 'Cyclical Upper (1σ)',
        data: cyclicalUpper,
        borderColor: showCycleOverlay ? 'rgba(156, 39, 176, 0.15)' : 'transparent',
        backgroundColor: showCycleOverlay ? 'rgba(156, 39, 176, 0.06)' : 'transparent',
        fill: '+1',
        borderWidth: showCycleOverlay ? 1 : 0,
        pointRadius: 0,
        spanGaps: false,
        hidden: !showCycleOverlay
      },
      {
        label: 'Cyclical Price Path',
        data: cyclicalData,
        borderColor: showCycleOverlay ? '#9C27B0' : 'transparent',
        backgroundColor: 'transparent',
        borderWidth: showCycleOverlay ? 2.5 : 0,
        pointRadius: 0,
        borderDash: [6, 3],
        spanGaps: false,
        hidden: !showCycleOverlay
      },
      {
        label: 'Cyclical Lower (1σ)',
        data: cyclicalLower,
        borderColor: showCycleOverlay ? 'rgba(156, 39, 176, 0.15)' : 'transparent',
        backgroundColor: showCycleOverlay ? 'rgba(156, 39, 176, 0.06)' : 'transparent',
        fill: '-1',
        borderWidth: showCycleOverlay ? 1 : 0,
        pointRadius: 0,
        spanGaps: false,
        hidden: !showCycleOverlay
      }
    );
  }

  return { datasets };
}

// Setup controls
function setupControls() {
  // Date slider
  const slider = document.getElementById('date-slider');
  slider.addEventListener('input', updateSliderDisplay);
  updateSliderDisplay(); // Initial update

  // Horizon buttons
  document.querySelectorAll('.zoom-btn[data-years]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.zoom-btn[data-years]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      projectionYears = parseInt(btn.dataset.years);
      rebuildChart();
    });
  });

  // Cycle overlay toggle
  const cycleToggle = document.getElementById('cycle-overlay-toggle');
  if (cycleToggle) {
    cycleToggle.addEventListener('change', () => {
      showCycleOverlay = cycleToggle.checked;
      rebuildChart();
    });
  }
}

// Rebuild chart with current settings
function rebuildChart() {
  const sigma = sigmaCache[currentModel].sigma;
  const chartData = prepareProjectionData(currentModel, sigma, projectionYears);

  if (projectionChart) {
    projectionChart.data = chartData;
    projectionChart.update();
  }
}

// Update slider display
function updateSliderDisplay() {
  const slider = document.getElementById('date-slider');
  const years = parseFloat(slider.value);
  const sigma = sigmaCache[currentModel].sigma;

  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + Math.floor(years));
  futureDate.setMonth(futureDate.getMonth() + Math.round((years % 1) * 12));

  const trend = PowerLaw.trendPrice(currentModel, futureDate);
  const lower = PowerLaw.bandPrice(currentModel, sigma, -1, futureDate);
  const upper = PowerLaw.bandPrice(currentModel, sigma, 1, futureDate);

  document.getElementById('selected-date').textContent = PowerLaw.formatDate(futureDate);
  document.getElementById('projected-trend').textContent = PowerLaw.formatPrice(trend);
  document.getElementById('projected-range').textContent = `${PowerLaw.formatPrice(lower)} - ${PowerLaw.formatPrice(upper)}`;
}

// Update all displays
function updateAll() {
  populateTimeline();
  populateProjectionTable();
  populateMilestoneTable();
  updateSliderDisplay();
  rebuildChart();
}

// Start
init();
