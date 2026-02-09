// Bitcoin Machtswet Observatorium - Dashboard Logica (Nederlands)

let historicalData = [];
let sigmaCache = {};
let currentModel = 'santostasi';
let sparklineChart = null;
let chartRangeDays = 180;

// Override valuationLabel met Nederlandse vertalingen
const originalValuationLabel = PowerLaw.valuationLabel;
PowerLaw.valuationLabel = function(mult) {
  if (mult < 0.5) return { label: 'Extreem Ondergewaardeerd', color: '#00C853' };
  if (mult < 0.75) return { label: 'Ondergewaardeerd', color: '#00C853' };
  if (mult < 1.25) return { label: 'Eerlijke Waarde', color: '#757575' };
  if (mult < 2) return { label: 'Overgewaardeerd', color: '#FF1744' };
  if (mult < 3) return { label: 'Sterk Overgewaardeerd', color: '#FF1744' };
  return { label: 'Extreem Overgewaardeerd', color: '#FF1744' };
};

// DOM-elementen
const elements = {
  currentPrice: document.getElementById('current-price'),
  priceChange: document.getElementById('price-change'),
  trendPrice: document.getElementById('trend-price'),
  modelName: document.getElementById('model-name'),
  multiplier: document.getElementById('multiplier'),
  valuationBadge: document.getElementById('valuation-badge'),
  daysCount: document.getElementById('days-count'),
  sigmaValue: document.getElementById('sigma-value'),
  dataPoints: document.getElementById('data-points')
};

// Initialiseren
async function init() {
  await loadHistoricalData();
  await fillRecentPriceGap();
  calculateSigmas();
  await fetchLivePrice();
  initSparklineChart();
  setupRangeToggle();

  // Prijs elke 60 seconden bijwerken
  setInterval(fetchLivePrice, 60000);
}

// Historische data laden
async function loadHistoricalData() {
  try {
    const response = await fetch('../datasets/btc_historical.json');
    historicalData = await response.json();
    elements.dataPoints.textContent = historicalData.length.toLocaleString('nl-NL');
  } catch (error) {
    console.error('Kan historische data niet laden:', error);
  }
}

// Sigma berekenen voor het model
function calculateSigmas() {
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

// Live prijs ophalen van CoinGecko
async function fetchLivePrice() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await response.json();
    const price = data.bitcoin.usd;
    const change24h = data.bitcoin.usd_24h_change;

    updateDashboard(price, change24h);
  } catch (error) {
    console.error('Kan live prijs niet ophalen:', error);
    // Terugvallen op laatste historische prijs
    if (historicalData.length > 0) {
      const latest = historicalData[historicalData.length - 1];
      updateDashboard(latest.price, null);
    }
  }
}

// Dashboard bijwerken met prijsdata
function updateDashboard(price, change24h) {
  const now = new Date();
  const model = currentModel;
  const trend = PowerLaw.trendPrice(model, now);
  const mult = PowerLaw.multiplier(price, model, now);
  const valuation = PowerLaw.valuationLabel(mult);
  const sigma = sigmaCache[model];
  const days = Math.floor(PowerLaw.daysSinceGenesis(now));

  // DOM bijwerken
  elements.currentPrice.textContent = PowerLaw.formatPrice(price);

  if (change24h !== null) {
    const changePrefix = change24h >= 0 ? '+' : '';
    elements.priceChange.textContent = `${changePrefix}${change24h.toFixed(2)}% (24u)`;
    elements.priceChange.className = 'card-sub ' + (change24h >= 0 ? 'green' : 'red');
  } else {
    elements.priceChange.textContent = 'Live prijs niet beschikbaar';
    elements.priceChange.className = 'card-sub';
  }

  elements.trendPrice.textContent = PowerLaw.formatPrice(trend);
  elements.modelName.textContent = PowerLaw.MODELS[model].name + '-model';
  elements.multiplier.textContent = PowerLaw.formatMultiplier(mult);

  // Waarderingsbadge bijwerken
  elements.valuationBadge.textContent = valuation.label;
  elements.valuationBadge.style.backgroundColor = valuation.color + '1A'; // 10% dekking
  elements.valuationBadge.style.color = valuation.color;

  elements.daysCount.textContent = days.toLocaleString('nl-NL');
  elements.sigmaValue.textContent = sigma.sigma.toFixed(3);

  // Sparkline bijwerken indien aanwezig
  if (sparklineChart) {
    updateSparkline(price, trend, mult, sigma.sigma);
  }
}

// Modelwissel verwijderd — enkel model (Santostasi)

// Grafiekbereikwisseling instellen
function setupRangeToggle() {
  const buttons = document.querySelectorAll('.range-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartRangeDays = parseInt(btn.dataset.days);
      updateSparklineData();
    });
  });
}

// Sparkline-grafiek initialiseren
function initSparklineChart() {
  const ctx = document.getElementById('sparkline-chart').getContext('2d');

  // Laatste dagen van data voor sparkline
  const recentData = historicalData.slice(-chartRangeDays);
  const sigma = sigmaCache[currentModel].sigma;

  const labels = recentData.map(d => d.date);
  const prices = recentData.map(d => d.price);
  const trendPrices = recentData.map(d => PowerLaw.trendPrice(currentModel, new Date(d.date)));
  const upperBand1 = trendPrices.map(t => t * Math.pow(10, sigma));
  const lowerBand1 = trendPrices.map(t => t * Math.pow(10, -sigma));
  const upperBand2 = trendPrices.map(t => t * Math.pow(10, 2 * sigma));
  const lowerBand2 = trendPrices.map(t => t * Math.pow(10, -2 * sigma));

  sparklineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '+2\u03C3 Band',
          data: upperBand2,
          borderColor: 'rgba(255, 23, 68, 0.3)',
          backgroundColor: 'rgba(255, 23, 68, 0.05)',
          fill: '+1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '+1\u03C3 Band',
          data: upperBand1,
          borderColor: 'rgba(255, 23, 68, 0.2)',
          backgroundColor: 'rgba(117, 117, 117, 0.05)',
          fill: '+1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'Machtswettrend',
          data: trendPrices,
          borderColor: '#F7931A',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '-1\u03C3 Band',
          data: lowerBand1,
          borderColor: 'rgba(0, 200, 83, 0.2)',
          backgroundColor: 'rgba(117, 117, 117, 0.05)',
          fill: '-1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '-2\u03C3 Band',
          data: lowerBand2,
          borderColor: 'rgba(0, 200, 83, 0.3)',
          backgroundColor: 'rgba(0, 200, 83, 0.05)',
          fill: '-1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'BTC Prijs',
          data: prices,
          borderColor: '#000000',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          },
          ticks: {
            maxTicksLimit: 6,
            callback: function(value, index) {
              const date = new Date(this.getLabelForValue(value));
              return date.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' });
            }
          }
        },
        y: {
          type: 'logarithmic',
          display: true,
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
          display: false
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const d = new Date(context[0].label);
              return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric' });
            },
            label: function(context) {
              return context.dataset.label + ': ' + PowerLaw.formatPrice(context.raw);
            }
          }
        }
      }
    }
  });
}

// Sparkline-data bijwerken bij model- of bereikwijziging
function updateSparklineData() {
  if (!sparklineChart) return;

  const recentData = historicalData.slice(-chartRangeDays);
  const sigma = sigmaCache[currentModel].sigma;

  const labels = recentData.map(d => d.date);
  const prices = recentData.map(d => d.price);
  const trendPrices = recentData.map(d => PowerLaw.trendPrice(currentModel, new Date(d.date)));
  const upperBand1 = trendPrices.map(t => t * Math.pow(10, sigma));
  const lowerBand1 = trendPrices.map(t => t * Math.pow(10, -sigma));
  const upperBand2 = trendPrices.map(t => t * Math.pow(10, 2 * sigma));
  const lowerBand2 = trendPrices.map(t => t * Math.pow(10, -2 * sigma));

  sparklineChart.data.labels = labels;
  sparklineChart.data.datasets[0].data = upperBand2;
  sparklineChart.data.datasets[1].data = upperBand1;
  sparklineChart.data.datasets[2].data = trendPrices;
  sparklineChart.data.datasets[3].data = lowerBand1;
  sparklineChart.data.datasets[4].data = lowerBand2;
  sparklineChart.data.datasets[5].data = prices;

  sparklineChart.update();
}

// Recente dagprijzen ophalen van CoinGecko om het gat te vullen
// tussen de statische btc_historical.json en vandaag
async function fillRecentPriceGap() {
  if (historicalData.length === 0) return;

  const lastDate = new Date(historicalData[historicalData.length - 1].date);
  const now = new Date();
  const gapDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (gapDays <= 1) return; // geen gat om te vullen

  try {
    // CoinGecko market_chart: voldoende dagen ophalen om het gat te dekken + buffer
    const fetchDays = Math.min(gapDays + 2, 90);
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${fetchDays}&interval=daily`
    );
    const data = await response.json();

    if (!data.prices || data.prices.length === 0) return;

    // Alleen datums na onze laatste historische vermelding toevoegen
    const lastTimestamp = lastDate.getTime();
    let added = 0;

    for (const [timestamp, price] of data.prices) {
      if (timestamp > lastTimestamp + 12 * 60 * 60 * 1000) { // minstens 12u na laatste vermelding
        const date = new Date(timestamp);
        const dateStr = date.toISOString().split('T')[0];

        // Dubbele datums voorkomen
        const alreadyExists = historicalData.some(d => d.date === dateStr);
        if (!alreadyExists) {
          historicalData.push({ date: dateStr, price: price });
          added++;
        }
      }
    }

    if (added > 0) {
      console.log(`${added} dagen aan prijsdata aangevuld vanuit CoinGecko`);
      elements.dataPoints.textContent = historicalData.length.toLocaleString('nl-NL');
    }
  } catch (error) {
    console.warn('Kon prijsgat niet aanvullen vanuit CoinGecko:', error);
  }
}

// Sparkline bijwerken met huidige live prijs als laatste datapunt
function updateSparkline(price, trend, mult, sigma) {
  if (!sparklineChart) return;

  const today = new Date().toISOString().split('T')[0];
  const labels = sparklineChart.data.labels;
  const lastLabel = labels[labels.length - 1];

  // Als vandaag al het laatste label is, alleen de waarde bijwerken
  // Anders een nieuw punt toevoegen
  if (lastLabel === today) {
    sparklineChart.data.datasets[5].data[labels.length - 1] = price;
  } else {
    // Vandaag toevoegen aan alle datasets
    labels.push(today);
    const trendToday = PowerLaw.trendPrice(currentModel, new Date());
    sparklineChart.data.datasets[0].data.push(trendToday * Math.pow(10, 2 * sigma));
    sparklineChart.data.datasets[1].data.push(trendToday * Math.pow(10, sigma));
    sparklineChart.data.datasets[2].data.push(trendToday);
    sparklineChart.data.datasets[3].data.push(trendToday * Math.pow(10, -sigma));
    sparklineChart.data.datasets[4].data.push(trendToday * Math.pow(10, -2 * sigma));
    sparklineChart.data.datasets[5].data.push(price);
  }

  sparklineChart.update('none'); // bijwerken zonder animatie voor soepele 60s-verversing
}

// App starten
init();
