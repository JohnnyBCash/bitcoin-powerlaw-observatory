// Bitcoin Power Law Observatory - Future Projections Logic

let historicalData = [];
let sigmaCache = {};
let currentModel = 'krueger';
let projectionChart = null;

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
  calculateSigmas();
  populateTimeline();
  populateProjectionTable();
  populateMilestoneTable();
  initProjectionChart();
  setupControls();
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

// Calculate sigma for both models
function calculateSigmas() {
  sigmaCache.krueger = PowerLaw.calculateSigma(historicalData, 'krueger');
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
    const kruegerPrice = PowerLaw.trendPrice('krueger', row.date);
    const santPrice = PowerLaw.trendPrice('santostasi', row.date);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${PowerLaw.formatDate(row.date)}</td>
      <td>${PowerLaw.formatPrice(kruegerPrice)}</td>
      <td>${PowerLaw.formatPrice(santPrice)}</td>
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
    const kruegerDate = PowerLaw.milestoneDateForPrice(price, 'krueger');
    const santDate = PowerLaw.milestoneDateForPrice(price, 'santostasi');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${PowerLaw.formatPrice(price)}</strong></td>
      <td>${PowerLaw.formatDate(kruegerDate)}</td>
      <td>${PowerLaw.formatDate(santDate)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// Initialize projection chart
function initProjectionChart() {
  const ctx = document.getElementById('projection-chart').getContext('2d');
  const sigma = sigmaCache[currentModel].sigma;

  // Generate future projection data (20 years)
  const chartData = prepareProjectionData(currentModel, sigma, 20);

  projectionChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
          position: 'top'
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              return PowerLaw.formatDate(context[0].parsed.x);
            },
            label: function(context) {
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
  const dataPoints = [];

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

  for (let i = -60; i <= years * 12; i++) { // 5 years back + years forward
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const timestamp = date.getTime();
    const trend = PowerLaw.trendPrice(model, date);

    trendData.push({ x: timestamp, y: trend });
    upper1.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, 1, date) });
    lower1.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, -1, date) });
    upper2.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, 2, date) });
    lower2.push({ x: timestamp, y: PowerLaw.bandPrice(model, sigma, -2, date) });
  }

  return {
    datasets: [
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
    ]
  };
}

// Setup controls
function setupControls() {
  // Model toggle
  const buttons = document.querySelectorAll('.toggle-btn[data-model]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentModel = btn.dataset.model;
      updateAll();
    });
  });

  // Date slider
  const slider = document.getElementById('date-slider');
  slider.addEventListener('input', updateSliderDisplay);
  updateSliderDisplay(); // Initial update
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

  // Update chart
  const sigma = sigmaCache[currentModel].sigma;
  const chartData = prepareProjectionData(currentModel, sigma, 20);
  projectionChart.data = chartData;
  projectionChart.update();
}

// Add date adapter for Chart.js
// Note: Chart.js needs a date adapter for time scales
// We'll use a simple approach with timestamps

// Start
init();
