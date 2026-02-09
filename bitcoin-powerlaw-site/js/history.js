// Bitcoin Power Law Observatory - History Page Logic

let historicalData = [];
let sigmaCache = {};
let currentModel = 'santostasi';
let historyChart = null;
let bellCurveChart = null;

// Initialize
async function init() {
  await loadHistoricalData();
  calculateSigmas();
  initHistoryChart();
  initBellCurve();
  setupControls();
  updateStatistics();
  setupRubberBandDemo();
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

// Calculate sigma for the model
function calculateSigmas() {
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

// Initialize the main history chart
function initHistoryChart() {
  const ctx = document.getElementById('history-chart').getContext('2d');
  const sigma = sigmaCache[currentModel].sigma;

  // Prepare data - use log scale for both axes
  const chartData = prepareChartData(historicalData, currentModel, sigma);

  historyChart = new Chart(ctx, {
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
          type: 'logarithmic',
          title: {
            display: true,
            text: 'Days Since Genesis (log scale)',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: function(value) {
              if (value >= 365) {
                return (value / 365).toFixed(0) + 'y';
              }
              return value + 'd';
            }
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
            padding: 20
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const dataIndex = context[0].dataIndex;
              const point = getDataPoint(dataIndex);
              if (point) {
                return PowerLaw.formatDate(point.date);
              }
              return '';
            },
            label: function(context) {
              const value = context.raw.y;
              return context.dataset.label + ': ' + PowerLaw.formatPrice(value);
            },
            afterBody: function(context) {
              const dataIndex = context[0].dataIndex;
              const point = getDataPoint(dataIndex);
              if (point) {
                const mult = PowerLaw.multiplier(point.price, currentModel, new Date(point.date));
                return ['Multiplier: ' + PowerLaw.formatMultiplier(mult)];
              }
              return [];
            }
          }
        }
      }
    }
  });
}

// Get data point by index (accounting for filtered data)
function getDataPoint(index) {
  const range = document.getElementById('date-range').value;
  const filteredData = filterDataByRange(historicalData, range);
  return filteredData[index];
}

// Prepare chart data
function prepareChartData(data, model, sigma) {
  const range = document.getElementById('date-range')?.value || 'all';
  const filteredData = filterDataByRange(data, range);

  const show1Sigma = document.getElementById('show-1sigma')?.checked ?? true;
  const show2Sigma = document.getElementById('show-2sigma')?.checked ?? true;

  // Convert to {x: days, y: price} format for log-log chart
  const priceData = filteredData.map(d => ({
    x: PowerLaw.daysSinceGenesis(new Date(d.date)),
    y: d.price
  }));

  const trendData = filteredData.map(d => {
    const days = PowerLaw.daysSinceGenesis(new Date(d.date));
    return {
      x: days,
      y: PowerLaw.trendPrice(model, new Date(d.date))
    };
  });

  const datasets = [
    {
      label: 'BTC Price',
      data: priceData,
      borderColor: '#000000',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      order: 1
    },
    {
      label: 'Power Law Trend',
      data: trendData,
      borderColor: '#F7931A',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0,
      order: 2
    }
  ];

  // Add sigma bands
  if (show2Sigma) {
    const upper2 = filteredData.map(d => {
      const days = PowerLaw.daysSinceGenesis(new Date(d.date));
      return {
        x: days,
        y: PowerLaw.bandPrice(model, sigma, 2, new Date(d.date))
      };
    });

    const lower2 = filteredData.map(d => {
      const days = PowerLaw.daysSinceGenesis(new Date(d.date));
      return {
        x: days,
        y: PowerLaw.bandPrice(model, sigma, -2, new Date(d.date))
      };
    });

    datasets.unshift({
      label: '+2σ (Extreme Over)',
      data: upper2,
      borderColor: 'rgba(255, 23, 68, 0.4)',
      backgroundColor: 'rgba(255, 23, 68, 0.08)',
      fill: '+1',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
      order: 5
    });

    datasets.push({
      label: '-2σ (Extreme Under)',
      data: lower2,
      borderColor: 'rgba(0, 200, 83, 0.4)',
      backgroundColor: 'rgba(0, 200, 83, 0.08)',
      fill: '-1',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
      order: 6
    });
  }

  if (show1Sigma) {
    const upper1 = filteredData.map(d => {
      const days = PowerLaw.daysSinceGenesis(new Date(d.date));
      return {
        x: days,
        y: PowerLaw.bandPrice(model, sigma, 1, new Date(d.date))
      };
    });

    const lower1 = filteredData.map(d => {
      const days = PowerLaw.daysSinceGenesis(new Date(d.date));
      return {
        x: days,
        y: PowerLaw.bandPrice(model, sigma, -1, new Date(d.date))
      };
    });

    datasets.splice(show2Sigma ? 1 : 0, 0, {
      label: '+1σ (Overvalued)',
      data: upper1,
      borderColor: 'rgba(255, 23, 68, 0.25)',
      backgroundColor: 'rgba(117, 117, 117, 0.05)',
      fill: '+1',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
      order: 3
    });

    datasets.push({
      label: '-1σ (Undervalued)',
      data: lower1,
      borderColor: 'rgba(0, 200, 83, 0.25)',
      backgroundColor: 'rgba(117, 117, 117, 0.05)',
      fill: '-1',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0,
      order: 4
    });
  }

  return { datasets };
}

// Filter data by date range
function filterDataByRange(data, range) {
  if (range === 'all') return data;

  const now = new Date();
  let cutoff;

  switch (range) {
    case '10y':
      cutoff = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
      break;
    case '5y':
      cutoff = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      break;
    case '3y':
      cutoff = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
      break;
    case '1y':
      cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    default:
      return data;
  }

  return data.filter(d => new Date(d.date) >= cutoff);
}

// Setup controls
function setupControls() {
  // Date range
  document.getElementById('date-range').addEventListener('change', updateChart);

  // Sigma band toggles
  document.getElementById('show-1sigma').addEventListener('change', updateChart);
  document.getElementById('show-2sigma').addEventListener('change', updateChart);

  // Export CSV
  document.getElementById('export-csv').addEventListener('click', exportCSV);
}

// Update chart
function updateChart() {
  const sigma = sigmaCache[currentModel].sigma;
  const chartData = prepareChartData(historicalData, currentModel, sigma);
  historyChart.data = chartData;
  historyChart.update();
}

// Update statistics
function updateStatistics() {
  const sigma = sigmaCache[currentModel];
  document.getElementById('current-sigma').textContent = sigma.sigma.toFixed(3);

  // Find max and min multipliers
  let maxMult = 0, minMult = Infinity;
  let maxDate = '', minDate = '';

  for (const point of historicalData) {
    const mult = PowerLaw.multiplier(point.price, currentModel, new Date(point.date));
    if (mult > maxMult) {
      maxMult = mult;
      maxDate = point.date;
    }
    if (mult < minMult) {
      minMult = mult;
      minDate = point.date;
    }
  }

  document.getElementById('max-mult').textContent = PowerLaw.formatMultiplier(maxMult);
  document.getElementById('max-mult-date').textContent = PowerLaw.formatDate(maxDate);
  document.getElementById('min-mult').textContent = PowerLaw.formatMultiplier(minMult);
  document.getElementById('min-mult-date').textContent = PowerLaw.formatDate(minDate);
}

// Export CSV
function exportCSV() {
  const sigma = sigmaCache[currentModel].sigma;
  const rows = [['date', 'price', 'trend', 'multiplier', 'upper_1sigma', 'lower_1sigma', 'upper_2sigma', 'lower_2sigma']];

  for (const point of historicalData) {
    const date = new Date(point.date);
    const trend = PowerLaw.trendPrice(currentModel, date);
    const mult = PowerLaw.multiplier(point.price, currentModel, date);
    rows.push([
      point.date,
      point.price.toFixed(2),
      trend.toFixed(2),
      mult.toFixed(4),
      PowerLaw.bandPrice(currentModel, sigma, 1, date).toFixed(2),
      PowerLaw.bandPrice(currentModel, sigma, -1, date).toFixed(2),
      PowerLaw.bandPrice(currentModel, sigma, 2, date).toFixed(2),
      PowerLaw.bandPrice(currentModel, sigma, -2, date).toFixed(2)
    ]);
  }

  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `btc_powerlaw_${currentModel}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Rubber band demo animation
function setupRubberBandDemo() {
  const ball = document.getElementById('rubber-band-ball');
  const button = document.getElementById('animate-rubber-band');
  let animating = false;

  button.addEventListener('click', () => {
    if (animating) return;
    animating = true;

    // Animate up (bubble)
    ball.style.top = '10%';
    setTimeout(() => {
      // Crash down
      ball.style.top = '90%';
      setTimeout(() => {
        // Return to trend
        ball.style.top = '50%';
        setTimeout(() => {
          animating = false;
        }, 500);
      }, 800);
    }, 800);
  });
}

// ============================================
// BELL CURVE VISUALIZATION
// ============================================

// Compute log residuals for all historical data
function computeLogResiduals(model) {
  return historicalData.map(d => {
    const trend = PowerLaw.trendPrice(model, new Date(d.date));
    return Math.log(d.price / trend); // Natural log
  });
}

// Compute histogram bins from residuals
function binResiduals(residuals, numBins, sigma) {
  const minVal = -3 * sigma;
  const maxVal = 3 * sigma;
  const binWidth = (maxVal - minVal) / numBins;

  // Initialize bins
  const bins = [];
  for (let i = 0; i < numBins; i++) {
    const binStart = minVal + i * binWidth;
    const binCenter = binStart + binWidth / 2;
    bins.push({ x: binCenter, count: 0, binStart, binEnd: binStart + binWidth });
  }

  // Count residuals in each bin
  let totalInRange = 0;
  for (const r of residuals) {
    if (r >= minVal && r < maxVal) {
      const binIndex = Math.min(Math.floor((r - minVal) / binWidth), numBins - 1);
      bins[binIndex].count++;
      totalInRange++;
    }
  }

  // Normalize to density (so area sums to ~1, comparable to Gaussian)
  for (const bin of bins) {
    bin.y = bin.count / (totalInRange * binWidth);
  }

  return bins;
}

// Generate Gaussian curve points
function generateGaussianCurve(mean, sigma, numPoints = 100) {
  const points = [];
  const minX = -3 * sigma;
  const maxX = 3 * sigma;
  const step = (maxX - minX) / numPoints;

  for (let x = minX; x <= maxX; x += step) {
    const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mean) / sigma, 2));
    points.push({ x, y });
  }

  return points;
}

// Get color for histogram bar based on x position (residual value)
function getBarColor(x, sigma) {
  if (x < -sigma) return 'rgba(0, 200, 83, 0.6)';      // Green - undervalued
  if (x > sigma) return 'rgba(255, 23, 68, 0.6)';      // Red - overvalued
  return 'rgba(117, 117, 117, 0.5)';                    // Gray - fair value
}

// Calculate what percentile a value falls in
function calculatePercentile(value, sortedArray) {
  let count = 0;
  for (const v of sortedArray) {
    if (v <= value) count++;
  }
  return (count / sortedArray.length) * 100;
}

// Initialize bell curve chart
function initBellCurve() {
  const ctx = document.getElementById('bell-curve-chart').getContext('2d');
  const sigmaData = sigmaCache[currentModel];
  const sigma = sigmaData.sigma;

  // Compute residuals
  const residuals = computeLogResiduals(currentModel);
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;

  // Bin the residuals
  const bins = binResiduals(residuals, 30, sigma);

  // Generate Gaussian curve
  const gaussianPoints = generateGaussianCurve(mean, sigma);

  // Get today's residual
  const latestData = historicalData[historicalData.length - 1];
  const latestTrend = PowerLaw.trendPrice(currentModel, new Date(latestData.date));
  const todayResidual = Math.log(latestData.price / latestTrend);
  const todayMultiplier = latestData.price / latestTrend;

  // Calculate percentile
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const percentile = calculatePercentile(todayResidual, sortedResiduals);

  // Calculate % within 1 sigma
  const within1Sigma = residuals.filter(r => Math.abs(r - mean) <= sigma).length / residuals.length * 100;

  // Update stats display
  document.getElementById('today-multiplier').textContent = todayMultiplier.toFixed(2) + '×';
  document.getElementById('today-percentile').textContent = percentile.toFixed(0) + 'th percentile';
  document.getElementById('within-1sigma').textContent = within1Sigma.toFixed(0) + '%';
  document.getElementById('bell-sigma').textContent = sigma.toFixed(3);

  // Color the today's position based on valuation
  const todayEl = document.getElementById('today-multiplier');
  if (todayMultiplier < 1 / Math.exp(sigma)) {
    todayEl.style.color = '#00C853';
  } else if (todayMultiplier > Math.exp(sigma)) {
    todayEl.style.color = '#FF1744';
  } else {
    todayEl.style.color = 'var(--black)';
  }

  // Create gradient for bars
  const barColors = bins.map(bin => getBarColor(bin.x, sigma));

  bellCurveChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: bins.map(b => b.x.toFixed(2)),
      datasets: [
        {
          type: 'bar',
          label: 'Historical Deviations',
          data: bins.map(b => b.y),
          backgroundColor: barColors,
          borderWidth: 0,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
          order: 2
        },
        {
          type: 'line',
          label: 'Gaussian Fit (σ=' + sigma.toFixed(2) + ')',
          data: gaussianPoints.map(p => ({ x: p.x, y: p.y })),
          borderColor: '#F7931A',
          backgroundColor: 'transparent',
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.4,
          order: 1
        },
        {
          type: 'scatter',
          label: 'Today: ' + todayMultiplier.toFixed(2) + '× trend',
          data: [{ x: todayResidual, y: 0 }],
          backgroundColor: '#000000',
          borderColor: '#000000',
          pointRadius: 8,
          pointStyle: 'rectRot',
          order: 0
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
          type: 'linear',
          title: {
            display: true,
            text: 'Log Deviation (Undervalued ← → Overvalued)',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: function(value) {
              const mult = Math.exp(value);
              if (mult < 1) return mult.toFixed(2) + '×';
              return mult.toFixed(1) + '×';
            }
          }
        },
        y: {
          title: {
            display: true,
            text: 'Density',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 15
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const x = parseFloat(context[0].label);
              const mult = Math.exp(x);
              return mult.toFixed(2) + '× trend';
            },
            label: function(context) {
              if (context.dataset.type === 'bar') {
                const binIndex = context.dataIndex;
                const bin = bins[binIndex];
                const pct = (bin.count / residuals.length * 100).toFixed(1);
                return `${pct}% of history in this range`;
              }
              if (context.dataset.type === 'scatter') {
                return 'Current position';
              }
              return context.dataset.label;
            }
          }
        }
      }
    }
  });
}

// Update bell curve when model changes
function updateBellCurve() {
  if (!bellCurveChart) return;

  const sigmaData = sigmaCache[currentModel];
  const sigma = sigmaData.sigma;

  // Recompute residuals
  const residuals = computeLogResiduals(currentModel);
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;

  // Rebin
  const bins = binResiduals(residuals, 30, sigma);

  // Regenerate Gaussian
  const gaussianPoints = generateGaussianCurve(mean, sigma);

  // Get today's residual
  const latestData = historicalData[historicalData.length - 1];
  const latestTrend = PowerLaw.trendPrice(currentModel, new Date(latestData.date));
  const todayResidual = Math.log(latestData.price / latestTrend);
  const todayMultiplier = latestData.price / latestTrend;

  // Calculate percentile
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const percentile = calculatePercentile(todayResidual, sortedResiduals);

  // Calculate % within 1 sigma
  const within1Sigma = residuals.filter(r => Math.abs(r - mean) <= sigma).length / residuals.length * 100;

  // Update stats display
  document.getElementById('today-multiplier').textContent = todayMultiplier.toFixed(2) + '×';
  document.getElementById('today-percentile').textContent = percentile.toFixed(0) + 'th percentile';
  document.getElementById('within-1sigma').textContent = within1Sigma.toFixed(0) + '%';
  document.getElementById('bell-sigma').textContent = sigma.toFixed(3);

  // Color the today's position
  const todayEl = document.getElementById('today-multiplier');
  if (todayMultiplier < 1 / Math.exp(sigma)) {
    todayEl.style.color = '#00C853';
  } else if (todayMultiplier > Math.exp(sigma)) {
    todayEl.style.color = '#FF1744';
  } else {
    todayEl.style.color = 'var(--black)';
  }

  // Update chart data
  const barColors = bins.map(bin => getBarColor(bin.x, sigma));

  bellCurveChart.data.labels = bins.map(b => b.x.toFixed(2));
  bellCurveChart.data.datasets[0].data = bins.map(b => b.y);
  bellCurveChart.data.datasets[0].backgroundColor = barColors;
  bellCurveChart.data.datasets[1].data = gaussianPoints.map(p => ({ x: p.x, y: p.y }));
  bellCurveChart.data.datasets[1].label = 'Gaussian Fit (σ=' + sigma.toFixed(2) + ')';
  bellCurveChart.data.datasets[2].data = [{ x: todayResidual, y: 0 }];
  bellCurveChart.data.datasets[2].label = 'Today: ' + todayMultiplier.toFixed(2) + '× trend';

  bellCurveChart.update();
}

// Start
init();
