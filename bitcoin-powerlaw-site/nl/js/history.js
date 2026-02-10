// Bitcoin Machtswet Observatorium - Geschiedenis Pagina Logica (NL)
// Samengevoegd: bevat nu onafhankelijke as-schaalwisseling (Lineair/Log)

// Override PowerLaw.valuationLabel with Dutch labels
const _originalValuationLabel = PowerLaw.valuationLabel;
PowerLaw.valuationLabel = function(mult) {
  if (mult < 0.5) return { label: 'Extreem Ondergewaardeerd', color: '#00C853' };
  if (mult < 0.75) return { label: 'Ondergewaardeerd', color: '#00C853' };
  if (mult < 1.25) return { label: 'Eerlijke Waarde', color: '#757575' };
  if (mult < 2) return { label: 'Overgewaardeerd', color: '#FF1744' };
  if (mult < 3) return { label: 'Sterk Overgewaardeerd', color: '#FF1744' };
  return { label: 'Extreem Overgewaardeerd', color: '#FF1744' };
};

// Override PowerLaw.formatDate with Dutch locale
PowerLaw.formatDate = function(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Override PowerLaw.formatPrice with Dutch locale
PowerLaw.formatPrice = function(price) {
  if (price >= 1) return '$' + price.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
  return '$' + price.toFixed(4);
};

let historicalData = [];
let sigmaCache = {};
let currentModel = 'santostasi';
let historyChart = null;
let bellCurveChart = null;
let bellCurveTodayResidual = 0;
let bellCurveTodayMultiplier = 1;
let bellCurveLnSigma = 0.7;
let bellCurveBins = [];
let bellCurveResiduals = [];
let livePrice = null;

// Schaaltoestand (standaard log-log — klassieke machtswet weergave)
let xScale = 'logarithmic';   // 'linear' | 'logarithmic'
let yScale = 'logarithmic';

// Initialisatie
async function init() {
  await loadHistoricalData();
  await fillRecentPriceGap();
  calculateSigmas();
  computeStats();
  initHistoryChart();
  initBellCurve();
  setupControls();
  setupScaleToggles();
  setupZoomButtons();
  updateStatistics();
  setupRubberBandDemo();
  fetchLivePrice();
}

// Historische data laden
async function loadHistoricalData() {
  try {
    const response = await fetch('../../datasets/btc_historical.json');
    historicalData = await response.json();
  } catch (error) {
    console.error('Historische data laden mislukt:', error);
  }
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
      console.log(`${added} dagen prijsdata aangevuld via CoinGecko`);
    }
  } catch (error) {
    console.warn('Kon prijsgat niet aanvullen via CoinGecko:', error);
  }
}

// Live prijs ophalen van CoinGecko en positie van vandaag bijwerken
async function fetchLivePrice() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );
    const data = await response.json();
    livePrice = data.bitcoin.usd;
    updateTodayPosition();
  } catch (error) {
    console.error('Live prijs ophalen mislukt:', error);
  }
}

// VANDAAG-markering en statistiekkaarten bijwerken met huidige prijs
function updateTodayPosition() {
  const price = livePrice || historicalData[historicalData.length - 1].price;
  const todayTrend = PowerLaw.trendPrice(currentModel, new Date());
  bellCurveTodayMultiplier = price / todayTrend;
  bellCurveTodayResidual = Math.log(bellCurveTodayMultiplier);

  // Percentiel herberekenen tegen historische residuen
  const residuals = computeLogResiduals(currentModel);
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const percentile = calculatePercentile(bellCurveTodayResidual, sortedResiduals);

  // Statistiekkaarten bijwerken
  const todayMultEl = document.getElementById('today-pct-from-trend');
  todayMultEl.textContent = PowerLaw.formatMultiplier(bellCurveTodayMultiplier);

  const valuation = PowerLaw.valuationLabel(bellCurveTodayMultiplier);
  todayMultEl.style.color = valuation.color;
  document.getElementById('today-valuation-label').textContent = valuation.label;

  const pctile = Math.round(percentile);
  const suffix = 'e';
  document.getElementById('today-percentile-value').textContent = pctile + suffix;
  document.getElementById('pct-cheaper').textContent = (100 - pctile);

  // Grafiek opnieuw tekenen om VANDAAG-markering bij te werken
  if (bellCurveChart) bellCurveChart.update();
}

// Sigma berekenen voor het model
function calculateSigmas() {
  sigmaCache.santostasi = PowerLaw.calculateSigma(historicalData, 'santostasi');
}

/* -------------------------------------------------- opmaak ------------------------------------------------- */
function formatUSD(n) {
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return '$' + n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
  if (n >= 1)    return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
}

function fmtDate(d) {
  if (!d) return '--';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* -------------------------------------------------- statistieken (ATH/ATL) ---------------------------------- */
function computeStats() {
  if (!historicalData.length) return;

  let ath = -Infinity, athDate = null;
  let atl =  Infinity, atlDate = null;

  for (const d of historicalData) {
    if (d.price > ath) { ath = d.price; athDate = d.date; }
    if (d.price < atl) { atl = d.price; atlDate = d.date; }
  }

  const latest = historicalData[historicalData.length - 1];

  setText('stat-latest',  formatUSD(latest.price));
  setText('stat-ath',     formatUSD(ath));
  setText('stat-ath-date', fmtDate(athDate));
  setText('stat-atl',     formatUSD(atl));
  setText('stat-atl-date', fmtDate(atlDate));
  setText('stat-points',  historicalData.length.toLocaleString('nl-NL'));
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

/* -------------------------------------------------- x-waarde helper ----------------------------------------- */
function xVal(dateStr) {
  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  return xScale === 'logarithmic' ? PowerLaw.daysSinceGenesis(date) : date;
}

/* -------------------------------------------------- grafiekopties ------------------------------------------- */
function buildOptions() {
  const xIsLog = (xScale === 'logarithmic');
  const sigma = sigmaCache[currentModel].sigma;

  const xAxis = xIsLog
    ? {
        type: 'logarithmic',
        title: {
          display: true,
          text: 'Dagen Sinds Genesis (logschaal)',
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
      text: 'Prijs USD' + (yScale === 'logarithmic' ? ' (logschaal)' : ''),
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
          padding: 20
        }
      },
      tooltip: {
        callbacks: {
          title: function(context) {
            const dataIndex = context[0].dataIndex;
            const point = getDataPoint(dataIndex);
            if (point) {
              return fmtDate(point.date);
            }
            return '';
          },
          label: function(context) {
            const value = context.raw.y;
            return context.dataset.label + ': ' + formatUSD(value);
          },
          afterBody: function(context) {
            const dataIndex = context[0].dataIndex;
            const point = getDataPoint(dataIndex);
            if (point) {
              const mult = PowerLaw.multiplier(point.price, currentModel, new Date(point.date));
              return ['Vermenigvuldiger: ' + PowerLaw.formatMultiplier(mult)];
            }
            return [];
          }
        }
      }
    }
  };
}

// Hoofdgeschiedenisgrafiek initialiseren
function initHistoryChart() {
  const ctx = document.getElementById('history-chart').getContext('2d');
  const sigma = sigmaCache[currentModel].sigma;

  const chartData = prepareChartData(historicalData, currentModel, sigma);

  historyChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: buildOptions()
  });
}

// Datapunt ophalen op index (rekening houdend met gefilterde data)
function getDataPoint(index) {
  const filteredData = filterDataByRange(historicalData, currentRange);
  return filteredData[index];
}

// Grafiekdata voorbereiden
function prepareChartData(data, model, sigma) {
  const filteredData = filterDataByRange(data, currentRange);

  const showTrend  = document.getElementById('show-trend')?.checked ?? true;
  const show1Sigma = document.getElementById('show-1sigma')?.checked ?? true;
  const show2Sigma = document.getElementById('show-2sigma')?.checked ?? true;

  // Converteren naar {x, y} formaat — x hangt af van huidige schaal
  const priceData = filteredData.map(d => ({
    x: xVal(d.date),
    y: d.price
  }));

  const trendData = filteredData.map(d => ({
    x: xVal(d.date),
    y: PowerLaw.trendPrice(model, new Date(d.date))
  }));

  // Datasets in vaste volgorde opbouwen: [+2σ, +1σ, trend, prijs, -1σ, -2σ]
  const upper2Data = filteredData.map(d => ({ x: xVal(d.date), y: PowerLaw.bandPrice(model, sigma, 2, new Date(d.date)) }));
  const upper1Data = filteredData.map(d => ({ x: xVal(d.date), y: PowerLaw.bandPrice(model, sigma, 1, new Date(d.date)) }));
  const lower1Data = filteredData.map(d => ({ x: xVal(d.date), y: PowerLaw.bandPrice(model, sigma, -1, new Date(d.date)) }));
  const lower2Data = filteredData.map(d => ({ x: xVal(d.date), y: PowerLaw.bandPrice(model, sigma, -2, new Date(d.date)) }));

  const datasets = [
    {
      label: '+2σ',
      data: upper2Data,
      borderColor: 'rgba(255, 23, 68, 0.35)',
      backgroundColor: 'rgba(255, 23, 68, 0.06)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0,
      fill: { target: 1 },
      display: show2Sigma
    },
    {
      label: '+1σ',
      data: upper1Data,
      borderColor: 'rgba(255, 23, 68, 0.25)',
      backgroundColor: 'rgba(255, 23, 68, 0.1)',
      borderWidth: 1,
      borderDash: [2, 3],
      pointRadius: 0,
      tension: 0,
      fill: { target: 2 },
      display: show1Sigma
    },
    {
      label: 'Machtswettrend',
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
      label: 'BTC Prijs',
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
      label: '-1σ',
      data: lower1Data,
      borderColor: 'rgba(0, 200, 83, 0.25)',
      backgroundColor: 'rgba(0, 200, 83, 0.1)',
      borderWidth: 1,
      borderDash: [2, 3],
      pointRadius: 0,
      tension: 0,
      fill: { target: 2 },
      display: show1Sigma
    },
    {
      label: '-2σ',
      data: lower2Data,
      borderColor: 'rgba(0, 200, 83, 0.35)',
      backgroundColor: 'rgba(0, 200, 83, 0.06)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0,
      fill: { target: 4 },
      display: show2Sigma
    }
  ];

  return { datasets };
}

// Huidig zoombereik (standaard: alles)
let currentRange = 'all';

// Data filteren op datumbereik
function filterDataByRange(data, range) {
  if (range === 'all') return data;

  const now = new Date();
  let cutoff;

  switch (range) {
    case '1w':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1m':
      cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    case '6m':
      cutoff = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      break;
    case '1y':
      cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    case '5y':
      cutoff = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      break;
    default:
      return data;
  }

  return data.filter(d => new Date(d.date) >= cutoff);
}

// Bediening instellen
function setupControls() {
  // Band / trend schakelaars
  ['show-trend', 'show-1sigma', 'show-2sigma'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateChart);
  });

  // CSV exporteren
  document.getElementById('export-csv').addEventListener('click', exportCSV);
}

// Zoomknoppen instellen
function setupZoomButtons() {
  document.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      updateChart();
    });
  });
}

// Schaalknoppen instellen
function setupScaleToggles() {
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
}

// Grafiek bijwerken
function updateChart() {
  const sigma = sigmaCache[currentModel].sigma;
  const chartData = prepareChartData(historicalData, currentModel, sigma);
  historyChart.data = chartData;
  historyChart.options = buildOptions();
  historyChart.update();
}

// Statistieken bijwerken
function updateStatistics() {
  const sigma = sigmaCache[currentModel];
  document.getElementById('current-sigma').textContent = sigma.sigma.toFixed(3);

  // Max en min vermenigvuldigers vinden
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

// CSV exporteren
function exportCSV() {
  const sigma = sigmaCache[currentModel].sigma;
  const rows = [['datum', 'prijs', 'trend', 'vermenigvuldiger', 'boven_1sigma', 'onder_1sigma', 'boven_2sigma', 'onder_2sigma']];

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
  a.download = `btc_machtswet_${currentModel}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Elastiekdemo animatie
function setupRubberBandDemo() {
  const ball = document.getElementById('rubber-band-ball');
  const button = document.getElementById('animate-rubber-band');
  let animating = false;

  button.addEventListener('click', () => {
    if (animating) return;
    animating = true;

    // Omhoog animeren (zeepbel)
    ball.style.top = '10%';
    setTimeout(() => {
      // Naar beneden crashen
      ball.style.top = '90%';
      setTimeout(() => {
        // Terug naar trend
        ball.style.top = '50%';
        setTimeout(() => {
          animating = false;
        }, 500);
      }, 800);
    }, 800);
  });
}

// ============================================
// KLOKVORMIGE VERDELING VISUALISATIE
// ============================================

// Log residuen berekenen voor alle historische data
function computeLogResiduals(model) {
  return historicalData.map(d => {
    const trend = PowerLaw.trendPrice(model, new Date(d.date));
    return Math.log(d.price / trend); // Natuurlijk logaritme
  });
}

// Histogram-bins berekenen uit residuen
function binResiduals(residuals, numBins, sigma) {
  const minVal = -3 * sigma;
  const maxVal = 3 * sigma;
  const binWidth = (maxVal - minVal) / numBins;

  // Bins initialiseren
  const bins = [];
  for (let i = 0; i < numBins; i++) {
    const binStart = minVal + i * binWidth;
    const binCenter = binStart + binWidth / 2;
    bins.push({ x: binCenter, count: 0, binStart, binEnd: binStart + binWidth });
  }

  // Residuen in elke bin tellen
  let totalInRange = 0;
  for (const r of residuals) {
    if (r >= minVal && r < maxVal) {
      const binIndex = Math.min(Math.floor((r - minVal) / binWidth), numBins - 1);
      bins[binIndex].count++;
      totalInRange++;
    }
  }

  // Normaliseren naar dagen per jaar (count/totaal * 365,25)
  for (const bin of bins) {
    bin.y = (bin.count / residuals.length) * 365.25;
  }

  return bins;
}

// Gaussische curve punten genereren
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

// Kleur voor histogrambalk op basis van x-positie (residuwaarde)
function getBarColor(x, sigma) {
  if (x < -sigma) return 'rgba(0, 200, 83, 0.6)';      // Groen - ondergewaardeerd
  if (x > sigma) return 'rgba(255, 23, 68, 0.6)';       // Rood - overgewaardeerd
  return 'rgba(117, 117, 117, 0.5)';                     // Grijs - eerlijke waarde
}

// Berekenen in welk percentiel een waarde valt
function calculatePercentile(value, sortedArray) {
  let count = 0;
  for (const v of sortedArray) {
    if (v <= value) count++;
  }
  return (count / sortedArray.length) * 100;
}

// Chart.js plugin: zone-achtergronden tekenen met labels
const zoneLabelsPlugin = {
  id: 'zoneLabels',
  beforeDraw(chart) {
    const { ctx, chartArea, scales: { x } } = chart;
    if (!chartArea) return;
    const { left, right, top, bottom } = chartArea;
    const sigma = bellCurveLnSigma;

    const zones = [
      { min: -3 * sigma, max: -sigma, label: 'Goedkoop', color: 'rgba(0, 200, 83, 0.07)' },
      { min: -sigma, max: sigma, label: 'Eerlijke Waarde', color: 'rgba(117, 117, 117, 0.04)' },
      { min: sigma, max: 3 * sigma, label: 'Duur', color: 'rgba(255, 23, 68, 0.07)' }
    ];

    ctx.save();
    for (const zone of zones) {
      const xStart = Math.max(x.getPixelForValue(zone.min), left);
      const xEnd = Math.min(x.getPixelForValue(zone.max), right);

      // Achtergrondtint
      ctx.fillStyle = zone.color;
      ctx.fillRect(xStart, top, xEnd - xStart, bottom - top);

      // Label bovenaan
      ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.label, (xStart + xEnd) / 2, top + 16);
    }
    ctx.restore();
  }
};

// Chart.js plugin: "VANDAAG" verticale markering met toelichting tekenen
const todayMarkerPlugin = {
  id: 'todayMarker',
  afterDraw(chart) {
    const { ctx, chartArea, scales: { x } } = chart;
    if (!chartArea) return;
    const { left, right, top, bottom } = chartArea;

    const todayX = x.getPixelForValue(bellCurveTodayResidual);
    if (todayX < left || todayX > right) return;

    // Verticale stippellijn
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#F7931A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(todayX, top);
    ctx.lineTo(todayX, bottom);
    ctx.stroke();

    // Toelichtingskader
    const label = bellCurveTodayMultiplier.toFixed(2) + '\u00D7 trend';
    const sublabel = 'VANDAAG';

    ctx.setLineDash([]);
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    const labelWidth = Math.max(ctx.measureText(label).width, ctx.measureText(sublabel).width);
    const boxWidth = labelWidth + 20;
    const boxHeight = 34;

    // Kaderpositie begrenzen zodat het niet buiten grafiekranden valt
    let boxX = todayX - boxWidth / 2;
    if (boxX < left) boxX = left + 2;
    if (boxX + boxWidth > right) boxX = right - boxWidth - 2;
    const boxY = top + 24;

    // Afgeronde rechthoek achtergrond
    ctx.fillStyle = '#F7931A';
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxWidth - r, boxY);
    ctx.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r, r);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
    ctx.arcTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight, r);
    ctx.lineTo(boxX + r, boxY + boxHeight);
    ctx.arcTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r, r);
    ctx.lineTo(boxX, boxY + r);
    ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
    ctx.closePath();
    ctx.fill();

    // Pijl naar beneden
    const arrowX = Math.min(Math.max(todayX, boxX + 8), boxX + boxWidth - 8);
    ctx.beginPath();
    ctx.moveTo(arrowX - 5, boxY + boxHeight);
    ctx.lineTo(arrowX, boxY + boxHeight + 7);
    ctx.lineTo(arrowX + 5, boxY + boxHeight);
    ctx.fill();

    // Tekst
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    const textCenterX = boxX + boxWidth / 2;
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    ctx.fillText(sublabel, textCenterX, boxY + 13);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillText(label, textCenterX, boxY + 26);

    ctx.restore();
  }
};

// Klokvormige verdeling grafiek initialiseren
function initBellCurve() {
  const ctx = document.getElementById('bell-curve-chart').getContext('2d');

  // Natuurlijke-log residuen berekenen
  const residuals = computeLogResiduals(currentModel);
  bellCurveResiduals = residuals;
  const lnMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const lnSigma = Math.sqrt(residuals.reduce((s, r) => s + Math.pow(r - lnMean, 2), 0) / residuals.length);
  bellCurveLnSigma = lnSigma;

  // Residuen binnen (20 bins voor nettere weergave)
  const bins = binResiduals(residuals, 20, lnSigma);
  bellCurveBins = bins;
  const totalYears = residuals.length / 365.25;

  // Residu van vandaag ophalen
  const latestData = historicalData[historicalData.length - 1];
  const todayTrend = PowerLaw.trendPrice(currentModel, new Date());
  bellCurveTodayResidual = Math.log(latestData.price / todayTrend);
  bellCurveTodayMultiplier = latestData.price / todayTrend;

  // Percentiel berekenen
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const percentile = calculatePercentile(bellCurveTodayResidual, sortedResiduals);

  // Statistiekkaarten bijwerken
  const todayMultEl = document.getElementById('today-pct-from-trend');
  todayMultEl.textContent = PowerLaw.formatMultiplier(bellCurveTodayMultiplier);

  // Kleur op basis van waardering
  const valuation = PowerLaw.valuationLabel(bellCurveTodayMultiplier);
  todayMultEl.style.color = valuation.color;
  document.getElementById('today-valuation-label').textContent = valuation.label;

  // Percentielkaart
  const pctile = Math.round(percentile);
  const suffix = 'e';
  document.getElementById('today-percentile-value').textContent = pctile + suffix;
  document.getElementById('pct-cheaper').textContent = (100 - pctile);

  // Typisch bereikkaart — toon ±1σ als vermenigvuldigerbereik
  const upper1s = Math.exp(lnSigma);
  const lower1s = Math.exp(-lnSigma);
  document.getElementById('typical-range-pct').textContent = lower1s.toFixed(2) + '\u00D7 tot ' + upper1s.toFixed(1) + '\u00D7';

  // Balkkleuren
  const barColors = bins.map(bin => getBarColor(bin.x, lnSigma));

  bellCurveChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: bins.map(b => b.x.toFixed(3)),
      datasets: [
        {
          type: 'bar',
          label: 'Historische Verdeling',
          data: bins.map(b => b.y),
          backgroundColor: barColors,
          borderWidth: 0,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 50 }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: '\u2190 Goedkoper dan Trend | Duurder \u2192',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: function(value) {
              const mult = Math.exp(value);
              if (Math.abs(mult - 1) < 0.05) return '1\u00D7 (Eerlijk)';
              if (mult < 1) return mult.toFixed(2) + '\u00D7';
              return mult.toFixed(1) + '\u00D7';
            }
          }
        },
        y: {
          title: {
            display: true,
            text: 'Dagen per Jaar',
            font: { weight: 'bold' }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return Math.round(value);
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
              const x = parseFloat(context[0].label);
              const mult = Math.exp(x);
              return mult.toFixed(2) + '\u00D7 trend';
            },
            label: function(context) {
              if (context.dataset.type === 'bar') {
                const binIndex = context.dataIndex;
                const bin = bellCurveBins[binIndex];
                const dpy = bin.count / bellCurveResiduals.length * 365.25;
                if (dpy < 1) {
                  // Voor zeldzame gebeurtenissen, toon totale telling
                  const years = (bellCurveResiduals.length / 365.25).toFixed(1);
                  return `${bin.count} keer voorgekomen in ${years} jaar`;
                }
                return `~${dpy.toFixed(1)} dagen per jaar op dit niveau`;
              }
              return context.dataset.label;
            }
          }
        }
      }
    },
    plugins: [zoneLabelsPlugin, todayMarkerPlugin]
  });
}

// Klokvormige verdeling bijwerken wanneer model verandert
function updateBellCurve() {
  if (!bellCurveChart) return;

  // Natuurlijke-log residuen en sigma herberekenen
  const residuals = computeLogResiduals(currentModel);
  bellCurveResiduals = residuals;
  const lnMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const lnSigma = Math.sqrt(residuals.reduce((s, r) => s + Math.pow(r - lnMean, 2), 0) / residuals.length);
  bellCurveLnSigma = lnSigma;

  // Opnieuw binnen (20 bins)
  const bins = binResiduals(residuals, 20, lnSigma);
  bellCurveBins = bins;

  // Residu van vandaag ophalen
  const latestData = historicalData[historicalData.length - 1];
  const todayTrend = PowerLaw.trendPrice(currentModel, new Date());
  bellCurveTodayResidual = Math.log(latestData.price / todayTrend);
  bellCurveTodayMultiplier = latestData.price / todayTrend;

  // Percentiel berekenen
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  const percentile = calculatePercentile(bellCurveTodayResidual, sortedResiduals);

  // Statistiekkaarten bijwerken
  const todayMultEl = document.getElementById('today-pct-from-trend');
  todayMultEl.textContent = PowerLaw.formatMultiplier(bellCurveTodayMultiplier);

  const valuation = PowerLaw.valuationLabel(bellCurveTodayMultiplier);
  todayMultEl.style.color = valuation.color;
  document.getElementById('today-valuation-label').textContent = valuation.label;

  const pctile = Math.round(percentile);
  const suffix = 'e';
  document.getElementById('today-percentile-value').textContent = pctile + suffix;
  document.getElementById('pct-cheaper').textContent = (100 - pctile);

  const upper1s = Math.exp(lnSigma);
  const lower1s = Math.exp(-lnSigma);
  document.getElementById('typical-range-pct').textContent = lower1s.toFixed(2) + '\u00D7 tot ' + upper1s.toFixed(1) + '\u00D7';

  // Grafiekdata bijwerken
  const barColors = bins.map(bin => getBarColor(bin.x, lnSigma));

  bellCurveChart.data.labels = bins.map(b => b.x.toFixed(3));
  bellCurveChart.data.datasets[0].data = bins.map(b => b.y);
  bellCurveChart.data.datasets[0].backgroundColor = barColors;

  bellCurveChart.update();
}

// Starten
init();
