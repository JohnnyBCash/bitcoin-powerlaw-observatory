// Bitcoin Power Law Observatory - Dashboard Logic

let historicalData = [];
let sigmaCache = {};
let currentModel = 'krueger';
let sparklineChart = null;

// DOM elements
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

// Initialize
async function init() {
  await loadHistoricalData();
  await fillRecentPriceGap();
  calculateSigmas();
  await fetchLivePrice();
  initSparklineChart();
  setupModelToggle();

  // Update price every 60 seconds
  setInterval(fetchLivePrice, 60000);
}

// Load historical data
async function loadHistoricalData() {
  try {
    const response = await fetch('datasets/btc_historical.json');
    historicalData = await response.json();
    elements.dataPoints.textContent = historicalData.length.toLocaleString();
  } catch (error) {
    console.error('Failed to load historical data:', error);
  }
}

// Calculate sigma for both models
function calculateSigmas() {
  sigmaCache.krueger = PowerLaw.calculateSigma(historicalData, 'krueger');
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

// Fetch live price from CoinGecko
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
    console.error('Failed to fetch live price:', error);
    // Fallback to latest historical price
    if (historicalData.length > 0) {
      const latest = historicalData[historicalData.length - 1];
      updateDashboard(latest.price, null);
    }
  }
}

// Update dashboard with price data
function updateDashboard(price, change24h) {
  const now = new Date();
  const model = currentModel;
  const trend = PowerLaw.trendPrice(model, now);
  const mult = PowerLaw.multiplier(price, model, now);
  const valuation = PowerLaw.valuationLabel(mult);
  const sigma = sigmaCache[model];
  const days = Math.floor(PowerLaw.daysSinceGenesis(now));

  // Update DOM
  elements.currentPrice.textContent = PowerLaw.formatPrice(price);

  if (change24h !== null) {
    const changePrefix = change24h >= 0 ? '+' : '';
    elements.priceChange.textContent = `${changePrefix}${change24h.toFixed(2)}% (24h)`;
    elements.priceChange.className = 'card-sub ' + (change24h >= 0 ? 'green' : 'red');
  } else {
    elements.priceChange.textContent = 'Live price unavailable';
    elements.priceChange.className = 'card-sub';
  }

  elements.trendPrice.textContent = PowerLaw.formatPrice(trend);
  elements.modelName.textContent = PowerLaw.MODELS[model].name + ' model';
  elements.multiplier.textContent = PowerLaw.formatMultiplier(mult);

  // Update valuation badge
  elements.valuationBadge.textContent = valuation.label;
  elements.valuationBadge.style.backgroundColor = valuation.color + '1A'; // 10% opacity
  elements.valuationBadge.style.color = valuation.color;

  elements.daysCount.textContent = days.toLocaleString();
  elements.sigmaValue.textContent = sigma.sigma.toFixed(3);

  // Update sparkline if exists
  if (sparklineChart) {
    updateSparkline(price, trend, mult, sigma.sigma);
  }
}

// Setup model toggle buttons
function setupModelToggle() {
  const buttons = document.querySelectorAll('.toggle-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentModel = btn.dataset.model;

      // Re-fetch and update
      fetchLivePrice();
      updateSparklineData();
    });
  });
}

// Initialize sparkline chart
function initSparklineChart() {
  const ctx = document.getElementById('sparkline-chart').getContext('2d');

  // Get last 365 days of data for sparkline
  const recentData = historicalData.slice(-365);
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
          label: '+2σ Band',
          data: upperBand2,
          borderColor: 'rgba(255, 23, 68, 0.3)',
          backgroundColor: 'rgba(255, 23, 68, 0.05)',
          fill: '+1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '+1σ Band',
          data: upperBand1,
          borderColor: 'rgba(255, 23, 68, 0.2)',
          backgroundColor: 'rgba(117, 117, 117, 0.05)',
          fill: '+1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'Power Law Trend',
          data: trendPrices,
          borderColor: '#F7931A',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '-1σ Band',
          data: lowerBand1,
          borderColor: 'rgba(0, 200, 83, 0.2)',
          backgroundColor: 'rgba(117, 117, 117, 0.05)',
          fill: '-1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: '-2σ Band',
          data: lowerBand2,
          borderColor: 'rgba(0, 200, 83, 0.3)',
          backgroundColor: 'rgba(0, 200, 83, 0.05)',
          fill: '-1',
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'BTC Price',
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
              return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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
              return PowerLaw.formatDate(context[0].label);
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

// Update sparkline data when model changes
function updateSparklineData() {
  if (!sparklineChart) return;

  const recentData = historicalData.slice(-365);
  const sigma = sigmaCache[currentModel].sigma;

  const trendPrices = recentData.map(d => PowerLaw.trendPrice(currentModel, new Date(d.date)));
  const upperBand1 = trendPrices.map(t => t * Math.pow(10, sigma));
  const lowerBand1 = trendPrices.map(t => t * Math.pow(10, -sigma));
  const upperBand2 = trendPrices.map(t => t * Math.pow(10, 2 * sigma));
  const lowerBand2 = trendPrices.map(t => t * Math.pow(10, -2 * sigma));

  sparklineChart.data.datasets[0].data = upperBand2;
  sparklineChart.data.datasets[1].data = upperBand1;
  sparklineChart.data.datasets[2].data = trendPrices;
  sparklineChart.data.datasets[3].data = lowerBand1;
  sparklineChart.data.datasets[4].data = lowerBand2;

  sparklineChart.update();
}

// Fetch recent daily prices from CoinGecko to fill the gap between
// the static btc_historical.json and today
async function fillRecentPriceGap() {
  if (historicalData.length === 0) return;

  const lastDate = new Date(historicalData[historicalData.length - 1].date);
  const now = new Date();
  const gapDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (gapDays <= 1) return; // no gap to fill

  try {
    // CoinGecko market_chart: fetch enough days to cover the gap + buffer
    const fetchDays = Math.min(gapDays + 2, 90);
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${fetchDays}&interval=daily`
    );
    const data = await response.json();

    if (!data.prices || data.prices.length === 0) return;

    // Append only dates after our last historical entry
    const lastTimestamp = lastDate.getTime();
    let added = 0;

    for (const [timestamp, price] of data.prices) {
      if (timestamp > lastTimestamp + 12 * 60 * 60 * 1000) { // at least 12h after last entry
        const date = new Date(timestamp);
        const dateStr = date.toISOString().split('T')[0];

        // Avoid duplicate dates
        const alreadyExists = historicalData.some(d => d.date === dateStr);
        if (!alreadyExists) {
          historicalData.push({ date: dateStr, price: price });
          added++;
        }
      }
    }

    if (added > 0) {
      console.log(`Filled ${added} days of price data from CoinGecko`);
      elements.dataPoints.textContent = historicalData.length.toLocaleString();
    }
  } catch (error) {
    console.warn('Could not fill price gap from CoinGecko:', error);
  }
}

// Update sparkline with current live price as the final data point
function updateSparkline(price, trend, mult, sigma) {
  if (!sparklineChart) return;

  const today = new Date().toISOString().split('T')[0];
  const labels = sparklineChart.data.labels;
  const lastLabel = labels[labels.length - 1];

  // If today is already the last label, just update the value
  // Otherwise append a new point
  if (lastLabel === today) {
    sparklineChart.data.datasets[5].data[labels.length - 1] = price;
  } else {
    // Add today to all datasets
    labels.push(today);
    const trendToday = PowerLaw.trendPrice(currentModel, new Date());
    sparklineChart.data.datasets[0].data.push(trendToday * Math.pow(10, 2 * sigma));
    sparklineChart.data.datasets[1].data.push(trendToday * Math.pow(10, sigma));
    sparklineChart.data.datasets[2].data.push(trendToday);
    sparklineChart.data.datasets[3].data.push(trendToday * Math.pow(10, -sigma));
    sparklineChart.data.datasets[4].data.push(trendToday * Math.pow(10, -2 * sigma));
    sparklineChart.data.datasets[5].data.push(price);
  }

  sparklineChart.update('none'); // update without animation for smooth 60s refresh
}

// Start the app
init();
