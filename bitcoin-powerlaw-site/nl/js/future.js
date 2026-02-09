// Bitcoin Machtswet Observatorium - Toekomstprojecties Logica

// Override PowerLaw.formatDate with Dutch locale
PowerLaw.formatDate = function(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Override PowerLaw.formatPrice with Dutch locale
PowerLaw.formatPrice = function(price) {
  if (price >= 1000000) {
    return '$' + (price / 1000000).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
  } else if (price >= 1000) {
    return '$' + price.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
  } else if (price >= 1) {
    return '$' + price.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    return '$' + price.toLocaleString('nl-NL', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
};

let historicalData = [];
let sigmaCache = {};
let currentModel = 'santostasi';
let projectionChart = null;

// Belangrijke datums en mijlpalen
const PROJECTION_DATES = [
  { date: new Date(2026, 11, 31), label: 'Eind 2026' },
  { date: new Date(2028, 11, 31), label: 'Eind 2028' },
  { date: new Date(2030, 11, 31), label: 'Eind 2030' },
  { date: new Date(2032, 11, 31), label: 'Eind 2032' },
  { date: new Date(2035, 11, 31), label: 'Eind 2035' },
  { date: new Date(2040, 11, 31), label: 'Eind 2040' },
  { date: new Date(2045, 11, 31), label: 'Eind 2045' }
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

// Initialisatie
async function init() {
  await loadHistoricalData();
  calculateSigmas();
  populateTimeline();
  populateProjectionTable();
  populateMilestoneTable();
  initProjectionChart();
  setupControls();
}

// Historische data laden
async function loadHistoricalData() {
  try {
    const response = await fetch('../../datasets/btc_historical.json');
    historicalData = await response.json();
  } catch (error) {
    console.error('Laden van historische data mislukt:', error);
  }
}

// Sigma berekenen voor het model
function calculateSigmas() {
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

// Mijlpalen-tijdlijn vullen
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
      <div class="timeline-label">Trend bereikt</div>
    `;
    container.appendChild(item);
  }
}

// Projectievergelijkingstabel vullen
function populateProjectionTable() {
  const tbody = document.getElementById('projection-table');
  tbody.innerHTML = '';

  const now = new Date();

  // Dynamische rijen toevoegen
  const rows = [
    { date: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()), note: 'Over 1 jaar' },
    { date: new Date(now.getFullYear() + 5, now.getMonth(), now.getDate()), note: 'Over 5 jaar' },
    { date: new Date(now.getFullYear() + 10, now.getMonth(), now.getDate()), note: 'Over 10 jaar' },
    ...PROJECTION_DATES.map(p => ({ date: p.date, note: p.label }))
  ];

  // Sorteren op datum
  rows.sort((a, b) => a.date - b.date);

  // Duplicaten en verlopen datums verwijderen
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

// Mijlpaalsprijstabel vullen
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

// Projectiegrafiek initialiseren
function initProjectionChart() {
  const ctx = document.getElementById('projection-chart').getContext('2d');
  const sigma = sigmaCache[currentModel].sigma;

  // Toekomstige projectiedata genereren (20 jaar)
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
            text: 'Jaar',
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
            text: 'Prijs USD (logschaal)',
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

// Projectiegrafiekdata voorbereiden
function prepareProjectionData(model, sigma, years) {
  const now = new Date();
  const dataPoints = [];

  // Historische data (laatste 5 jaar)
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const recentHistorical = historicalData.filter(d => new Date(d.date) >= fiveYearsAgo);

  const historicalPrices = recentHistorical.map(d => ({
    x: new Date(d.date).getTime(),
    y: d.price
  }));

  // Toekomstige projecties (maandelijkse intervallen)
  const trendData = [];
  const upper1 = [];
  const lower1 = [];
  const upper2 = [];
  const lower2 = [];

  for (let i = -60; i <= years * 12; i++) { // 5 jaar terug + jaren vooruit
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
        label: '+2\u03C3 Band',
        data: upper2,
        borderColor: 'rgba(255, 23, 68, 0.3)',
        backgroundColor: 'rgba(255, 23, 68, 0.05)',
        fill: '+1',
        borderWidth: 1,
        pointRadius: 0
      },
      {
        label: '+1\u03C3 Band',
        data: upper1,
        borderColor: 'rgba(255, 23, 68, 0.2)',
        backgroundColor: 'rgba(117, 117, 117, 0.05)',
        fill: '+1',
        borderWidth: 1,
        pointRadius: 0
      },
      {
        label: 'Machtswettrend',
        data: trendData,
        borderColor: '#F7931A',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0
      },
      {
        label: '-1\u03C3 Band',
        data: lower1,
        borderColor: 'rgba(0, 200, 83, 0.2)',
        backgroundColor: 'rgba(117, 117, 117, 0.05)',
        fill: '-1',
        borderWidth: 1,
        pointRadius: 0
      },
      {
        label: '-2\u03C3 Band',
        data: lower2,
        borderColor: 'rgba(0, 200, 83, 0.3)',
        backgroundColor: 'rgba(0, 200, 83, 0.05)',
        fill: '-1',
        borderWidth: 1,
        pointRadius: 0
      },
      {
        label: 'Historische Prijs',
        data: historicalPrices,
        borderColor: '#000000',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0
      }
    ]
  };
}

// Bediening instellen
function setupControls() {
  // Datumschuifregelaar
  const slider = document.getElementById('date-slider');
  slider.addEventListener('input', updateSliderDisplay);
  updateSliderDisplay(); // Eerste update
}

// Schuifregelaarweergave bijwerken
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

// Alle weergaven bijwerken
function updateAll() {
  populateTimeline();
  populateProjectionTable();
  populateMilestoneTable();
  updateSliderDisplay();

  // Grafiek bijwerken
  const sigma = sigmaCache[currentModel].sigma;
  const chartData = prepareProjectionData(currentModel, sigma, 20);
  projectionChart.data = chartData;
  projectionChart.update();
}

// Datumadapter toevoegen voor Chart.js
// Opmerking: Chart.js heeft een datumadapter nodig voor tijdschalen
// We gebruiken een eenvoudige benadering met timestamps

// Starten
init();
