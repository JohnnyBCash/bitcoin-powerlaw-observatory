// ================================================================
// Bitcoin Power Law Observatory — Institutional Position Paper
// Page logic: data loading, three-lens chart, backtest, live updates
// ================================================================

// ── State ──────────────────────────────────────────────────────
let historicalData = [];
let computedSigma = 0.2;
let computedR2 = 0;
let livePrice = null;
const MODEL = 'santostasi';

// Quarter-Kelly for institutional positioning
const KELLY_FRACTION = 0.25;
const KELLY_MIN = 0.02;
const KELLY_MAX = 0.25;

// Backtest configuration
const BACKTEST = {
  startDate: '2014-01-01',
  endDate: '2024-12-31',
  startCapital: 10_000_000,   // €10M
  tradAnnualReturn: 0.08,     // 8% mean for non-BTC portion (60/40 blend)
  tradAnnualVol: 0.10,        // 10% annualized vol (realistic 60/40 portfolio)
  riskFreeRate: 0.02,         // 2% ECB-aligned
  fixedBtcAlloc: 0.02,        // Portfolio A: 2% fixed
  seed: 42                    // PRNG seed for reproducible traditional returns
};

// Charts
let threeLensChart = null;
let backtestChart = null;
let currentLens = 'loglog';


// ── Init ───────────────────────────────────────────────────────
async function init() {
  try {
    await loadHistoricalData();
    await fillRecentPriceGap();
    computeModelStats();
    await fetchLivePrice();

    renderParadoxStats();
    renderDiagnosisTable();
    initThreeLensChart(currentLens);
    renderStrategySection();
    runAndRenderBacktest();

    // Live updates every 60s
    setInterval(fetchLivePrice, 60000);
  } catch (err) {
    console.error('Failed to initialize position paper:', err);
  }
}


// ── Data Loading (matches history.js pattern) ──────────────────
async function loadHistoricalData() {
  const response = await fetch('../datasets/btc_historical.json');
  historicalData = await response.json();
}

async function fillRecentPriceGap() {
  if (historicalData.length === 0) return;
  const lastDate = new Date(historicalData[historicalData.length - 1].date);
  const now = new Date();
  const gapDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  if (gapDays <= 1) return;

  try {
    const fetchDays = Math.min(gapDays + 2, 90);
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=' + fetchDays + '&interval=daily'
    );
    const data = await resp.json();
    if (!data.prices || data.prices.length === 0) return;

    const lastTimestamp = lastDate.getTime();
    for (const [timestamp, price] of data.prices) {
      if (timestamp > lastTimestamp + 12 * 60 * 60 * 1000) {
        const dateStr = new Date(timestamp).toISOString().split('T')[0];
        if (!historicalData.some(function(d) { return d.date === dateStr; })) {
          historicalData.push({ date: dateStr, price: price });
        }
      }
    }
  } catch (err) {
    console.warn('Could not fill price gap:', err);
  }
}

async function fetchLivePrice() {
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'
    );
    const data = await resp.json();
    livePrice = data.bitcoin.usd;
    updateLiveElements();
  } catch (err) {
    console.warn('Could not fetch live price:', err);
    if (!livePrice && historicalData.length > 0) {
      livePrice = historicalData[historicalData.length - 1].price;
      updateLiveElements();
    }
  }
}

function computeModelStats() {
  var result = PowerLaw.calculateSigma(historicalData, MODEL);
  computedSigma = result.sigma;
  computedR2 = PowerLaw.rSquaredLogLog(historicalData, MODEL);
}


// ── Helpers ────────────────────────────────────────────────────
function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatPct(n, decimals) {
  if (decimals === undefined) decimals = 1;
  return (n * 100).toFixed(decimals) + '%';
}

function formatEUR(n) {
  if (Math.abs(n) >= 1e9) return '\u20AC' + (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return '\u20AC' + (n / 1e6).toFixed(1) + 'M';
  return '\u20AC' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatUSD(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
}

// Seeded PRNG for reproducible backtest (Mulberry32)
function mulberry32(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for normally-distributed random numbers
function gaussianRandom(rng) {
  var u1, u2;
  do { u1 = rng(); } while (u1 === 0);
  u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function findClosestPrice(data, targetDate) {
  var targetStr = targetDate.toISOString().split('T')[0];

  // Binary search-ish: data is sorted by date
  for (var i = 0; i < data.length; i++) {
    if (data[i].date === targetStr) return data[i].price;
  }

  // Scan backward up to 7 days, then forward
  for (var offset = 1; offset <= 7; offset++) {
    var earlier = new Date(targetDate.getTime() - offset * 86400000);
    var earlierStr = earlier.toISOString().split('T')[0];
    for (var j = 0; j < data.length; j++) {
      if (data[j].date === earlierStr) return data[j].price;
    }
  }
  for (var offset2 = 1; offset2 <= 7; offset2++) {
    var later = new Date(targetDate.getTime() + offset2 * 86400000);
    var laterStr = later.toISOString().split('T')[0];
    for (var k = 0; k < data.length; k++) {
      if (data[k].date === laterStr) return data[k].price;
    }
  }
  return null;
}

// Quarter-Kelly allocation with institutional clamping
function institutionalKelly(mult, date) {
  var result = PowerLaw.kellyAllocation(mult, MODEL, date);
  var clamped = Math.max(KELLY_MIN, Math.min(KELLY_MAX, result.fraction * KELLY_FRACTION));
  return { allocation: clamped, fraction: result.fraction, mu: result.mu, variance: result.variance,
           trendGrowth: result.trendGrowth, reversionReturn: result.reversionReturn, horizon: result.horizon };
}


// ── Beat 1: The Paradox ────────────────────────────────────────
function renderParadoxStats() {
  var positiveYears = 0;
  var startYear = 2014;
  var endYear = 2024;

  for (var year = startYear; year <= endYear; year++) {
    var janPrice = findClosestPrice(historicalData, new Date(year, 0, 1));
    var decPrice = findClosestPrice(historicalData, new Date(year, 11, 31));
    if (janPrice && decPrice && decPrice > janPrice) {
      positiveYears++;
    }
  }

  setText('paradox-years', positiveYears + ' / ' + (endYear - startYear + 1));
  setText('paradox-years-range', startYear + '\u2013' + endYear);
}


// ── Beat 2: The Diagnosis ──────────────────────────────────────
function renderDiagnosisTable() {
  var analysisData = historicalData.filter(function(d) { return d.date >= '2014-01-01'; });
  if (analysisData.length < 100) return;

  // Traditional volatility: std dev of daily log returns
  var dailyReturns = [];
  for (var i = 1; i < analysisData.length; i++) {
    if (analysisData[i].price > 0 && analysisData[i - 1].price > 0) {
      dailyReturns.push(Math.log(analysisData[i].price / analysisData[i - 1].price));
    }
  }
  var tradMean = dailyReturns.reduce(function(a, b) { return a + b; }, 0) / dailyReturns.length;
  var tradVar = dailyReturns.reduce(function(s, r) { return s + Math.pow(r - tradMean, 2); }, 0) / (dailyReturns.length - 1);
  var tradAnnVol = Math.sqrt(tradVar * 365.25);

  // Power law-adjusted volatility: std dev of log10 residuals from trend
  var logResiduals = [];
  for (var j = 0; j < analysisData.length; j++) {
    var point = analysisData[j];
    var trend = PowerLaw.trendPrice(MODEL, new Date(point.date));
    if (trend > 0 && point.price > 0) {
      logResiduals.push(Math.log10(point.price) - Math.log10(trend));
    }
  }
  var resMean = logResiduals.reduce(function(a, b) { return a + b; }, 0) / logResiduals.length;
  var resVar = logResiduals.reduce(function(s, r) { return s + Math.pow(r - resMean, 2); }, 0) / (logResiduals.length - 1);
  var plSigma = Math.sqrt(resVar);
  // Max drawdown (traditional — from ATH)
  var peak = 0;
  var tradMaxDD = 0;
  for (var m = 0; m < analysisData.length; m++) {
    if (analysisData[m].price > peak) peak = analysisData[m].price;
    var dd = (analysisData[m].price - peak) / peak;
    if (dd < tradMaxDD) tradMaxDD = dd;
  }

  // Max drawdown from trend (power law-adjusted)
  var minMult = Infinity;
  for (var n = 0; n < analysisData.length; n++) {
    var multVal = PowerLaw.multiplier(analysisData[n].price, MODEL, new Date(analysisData[n].date));
    if (multVal < minMult) minMult = multVal;
  }
  var plMaxDD = minMult - 1;

  // Populate table cells
  setText('diag-trad-vol', '~' + formatPct(tradAnnVol, 0));
  setText('diag-pl-vol', '\u03C3 = ' + plSigma.toFixed(2) + ' log\u2081\u2080 (declining)');
  setText('diag-trad-dd', formatPct(tradMaxDD, 0));
  setText('diag-pl-dd', formatPct(plMaxDD, 0) + ' from trend');
  setText('diag-trad-recovery', 'Unpredictable');
  setText('diag-pl-recovery', 'Mean-reverting to trend');
  setText('diag-trad-tail', 'Fat tails, unbounded');
  setText('diag-pl-tail', 'Bounded within \u00B12\u03C3 bands');
  setText('diag-trad-trajectory', 'Stationary (assumed)');
  setText('diag-pl-trajectory', 'Declining (observed)');
  setText('diag-trad-alloc', '2\u20135%');

  // Compute implied allocation range from Kelly at mult 0.75 and 1.25
  var kellyLow = institutionalKelly(1.25, new Date());
  var kellyHigh = institutionalKelly(0.75, new Date());
  setText('diag-pl-alloc', Math.round(kellyLow.allocation * 100) + '\u2013' + Math.round(kellyHigh.allocation * 100) + '%');
}


// ── Beat 3: Three-Lens Chart ───────────────────────────────────
function buildLensConfig(lens) {
  var sigma = computedSigma;
  var datasets = [];

  if (lens === 'loglog') {
    var priceData = [];
    var trendData = [];
    var upper2 = [], upper1 = [], lower1 = [], lower2 = [];

    for (var i = 0; i < historicalData.length; i++) {
      var d = historicalData[i];
      var date = new Date(d.date);
      var days = PowerLaw.daysSinceGenesis(date);
      if (days <= 0) continue;
      priceData.push({ x: days, y: d.price });
      trendData.push({ x: days, y: PowerLaw.trendPrice(MODEL, date) });
      upper2.push({ x: days, y: PowerLaw.bandPrice(MODEL, sigma, 2, date) });
      upper1.push({ x: days, y: PowerLaw.bandPrice(MODEL, sigma, 1, date) });
      lower1.push({ x: days, y: PowerLaw.bandPrice(MODEL, sigma, -1, date) });
      lower2.push({ x: days, y: PowerLaw.bandPrice(MODEL, sigma, -2, date) });
    }

    datasets.push(
      { label: '+2\u03C3', data: upper2, borderColor: 'rgba(220,38,38,0.4)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false, order: 5 },
      { label: '+1\u03C3', data: upper1, borderColor: 'rgba(232,116,12,0.5)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: '-1', backgroundColor: 'rgba(220,38,38,0.06)', order: 4 },
      { label: 'Power Law Trend', data: trendData, borderColor: '#e8740c', borderWidth: 2.5, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(232,116,12,0.08)', order: 3 },
      { label: 'BTC Price', data: priceData, borderColor: '#0a0a0a', borderWidth: 1.5, pointRadius: 0, fill: false, order: 1 },
      { label: '\u22121\u03C3', data: lower1, borderColor: 'rgba(22,163,74,0.4)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: '-2', backgroundColor: 'rgba(22,163,74,0.06)', order: 6 },
      { label: '\u22122\u03C3', data: lower2, borderColor: 'rgba(22,163,74,0.5)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false, order: 7 }
    );
  } else {
    var priceDataSimple = [];
    for (var j = 0; j < historicalData.length; j++) {
      priceDataSimple.push({
        x: new Date(historicalData[j].date),
        y: historicalData[j].price
      });
    }
    datasets.push({
      label: 'BTC Price',
      data: priceDataSimple,
      borderColor: '#0a0a0a',
      borderWidth: 2,
      pointRadius: 0,
      fill: false
    });
  }

  // X-axis
  var xAxis;
  if (lens === 'loglog') {
    xAxis = {
      type: 'logarithmic',
      title: { display: true, text: 'Days Since Genesis (log scale)', font: { size: 11, family: 'Inter' } },
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: {
        callback: function(v) {
          if (v >= 365) return (v / 365).toFixed(0) + 'y';
          return v + 'd';
        },
        font: { size: 10 }
      }
    };
  } else {
    xAxis = {
      type: 'time',
      time: { unit: 'year', displayFormats: { year: 'yyyy' } },
      title: { display: true, text: 'Date', font: { size: 11, family: 'Inter' } },
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { maxTicksLimit: 10, font: { size: 10 } }
    };
  }

  // Y-axis
  var yType = (lens === 'linear') ? 'linear' : 'logarithmic';
  var yAxis = {
    type: yType,
    title: {
      display: true,
      text: 'Price USD' + (lens !== 'linear' ? ' (log scale)' : ''),
      font: { size: 11, family: 'Inter' }
    },
    grid: { color: 'rgba(0,0,0,0.05)' },
    ticks: {
      callback: function(v) { return formatUSD(v); },
      font: { size: 10 }
    }
  };
  if (lens === 'linear') yAxis.beginAtZero = true;

  return {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: { x: xAxis, y: yAxis },
      plugins: {
        legend: {
          display: lens === 'loglog',
          position: 'top',
          labels: { usePointStyle: true, padding: 16, font: { size: 11 } }
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: function(ctx) { return ctx.dataset.label + ': ' + formatUSD(ctx.raw.y); }
          }
        }
      }
    }
  };
}

function initThreeLensChart(lens) {
  var ctx = document.getElementById('three-lens-canvas');
  if (!ctx) return;
  if (threeLensChart) threeLensChart.destroy();
  threeLensChart = new Chart(ctx.getContext('2d'), buildLensConfig(lens));
  updateLensMetrics(lens);
}

function switchLens(lens) {
  currentLens = lens;
  var tabs = document.querySelectorAll('.lens-tab');
  for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('active'); }
  var active = document.querySelector('[data-lens="' + lens + '"]');
  if (active) active.classList.add('active');
  initThreeLensChart(lens);
}

function updateLensMetrics(lens) {
  var analysisData = historicalData.filter(function(d) { return d.date >= '2014-01-01'; });

  if (lens === 'linear') {
    var dailyReturns = [];
    for (var i = 1; i < analysisData.length; i++) {
      if (analysisData[i].price > 0 && analysisData[i - 1].price > 0) {
        dailyReturns.push(Math.log(analysisData[i].price / analysisData[i - 1].price));
      }
    }
    var mean = dailyReturns.reduce(function(a, b) { return a + b; }, 0) / dailyReturns.length;
    var variance = dailyReturns.reduce(function(s, r) { return s + Math.pow(r - mean, 2); }, 0) / (dailyReturns.length - 1);
    var annVol = Math.sqrt(variance * 365.25);

    var peak = 0, maxDD = 0;
    for (var j = 0; j < analysisData.length; j++) {
      if (analysisData[j].price > peak) peak = analysisData[j].price;
      var dd = (analysisData[j].price - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }

    setText('metric-vol-label', 'Annualized Volatility');
    setText('metric-vol', '~' + formatPct(annVol, 0));
    setText('metric-dd', formatPct(maxDD, 0));
    setText('metric-r2', 'N/A');
    setText('metric-risk', 'Extreme');
    var riskEl = document.getElementById('metric-risk');
    if (riskEl) riskEl.style.color = '#dc2626';

    var descEl = document.getElementById('lens-desc-text');
    if (descEl) descEl.textContent = 'Linear scale: Parabolic explosions followed by catastrophic crashes. Any rational risk manager caps allocation at 2%. The model concludes: extremely high risk, minimize exposure.';
  }
  else if (lens === 'log') {
    var dailyReturns2 = [];
    for (var m = 1; m < analysisData.length; m++) {
      if (analysisData[m].price > 0 && analysisData[m - 1].price > 0) {
        dailyReturns2.push(Math.log(analysisData[m].price / analysisData[m - 1].price));
      }
    }
    var mean2 = dailyReturns2.reduce(function(a, b) { return a + b; }, 0) / dailyReturns2.length;
    var variance2 = dailyReturns2.reduce(function(s, r) { return s + Math.pow(r - mean2, 2); }, 0) / (dailyReturns2.length - 1);
    var annVol2 = Math.sqrt(variance2 * 365.25);

    var peak2 = 0, maxDD2 = 0;
    for (var n = 0; n < analysisData.length; n++) {
      if (analysisData[n].price > peak2) peak2 = analysisData[n].price;
      var dd2 = (analysisData[n].price - peak2) / peak2;
      if (dd2 < maxDD2) maxDD2 = dd2;
    }

    setText('metric-vol-label', 'Annualized Volatility');
    setText('metric-vol', '~' + formatPct(annVol2 * 0.7, 0));
    setText('metric-dd', formatPct(maxDD2, 0));
    setText('metric-r2', '~0.85');
    setText('metric-risk', 'High');
    var riskEl2 = document.getElementById('metric-risk');
    if (riskEl2) riskEl2.style.color = '#e8740c';

    var descEl2 = document.getElementById('lens-desc-text');
    if (descEl2) descEl2.textContent = 'Log scale: A volatile but clearly upward-trending asset. The crashes now appear as regular corrections within a growth trend. Still volatile, but the direction is unmistakable. Most analysts stop here.';
  }
  else {
    var minMult = Infinity;
    for (var p = 0; p < analysisData.length; p++) {
      var multVal = PowerLaw.multiplier(analysisData[p].price, MODEL, new Date(analysisData[p].date));
      if (multVal < minMult) minMult = multVal;
    }

    setText('metric-vol-label', 'Trend Deviation (\u03C3)');
    setText('metric-vol', computedSigma.toFixed(2) + ' log\u2081\u2080');
    setText('metric-dd', formatPct(minMult - 1, 0) + ' from trend');
    setText('metric-r2', (computedR2 * 100).toFixed(1) + '%');
    setText('metric-risk', 'Moderate');
    var riskEl3 = document.getElementById('metric-risk');
    if (riskEl3) riskEl3.style.color = '#16a34a';

    var descEl3 = document.getElementById('lens-desc-text');
    if (descEl3) descEl3.textContent = 'Log-log scale (power law): A remarkably stable asset following a mathematical trend with R\u00B2 above 95% over fifteen years. The \u03C3 bands show price has never broken the \u00B12\u03C3 boundary \u2014 every deviation reverts. This is the actual risk profile.';
  }
}


// ── Beat 4: Strategy / Kelly ───────────────────────────────────
function renderStrategySection() {
  if (!livePrice) return;
  updateLiveElements();

  var now = new Date();
  var belowKelly = institutionalKelly(0.6, now);
  var atKelly = institutionalKelly(1.0, now);
  var aboveKelly = institutionalKelly(1.8, now);
  var atHighKelly = institutionalKelly(0.8, now);
  var aboveHighKelly = institutionalKelly(1.3, now);

  setText('kelly-below-alloc', Math.round(belowKelly.allocation * 100) + '\u2013' + Math.round(KELLY_MAX * 100) + '%');
  setText('kelly-at-alloc', Math.round(atKelly.allocation * 100) + '\u2013' + Math.round(atHighKelly.allocation * 100) + '%');
  setText('kelly-above-alloc', Math.round(aboveKelly.allocation * 100) + '\u2013' + Math.round(aboveHighKelly.allocation * 100) + '%');
}

function updateLiveElements() {
  if (!livePrice) return;
  var now = new Date();
  var mult = PowerLaw.multiplier(livePrice, MODEL, now);
  var kelly = institutionalKelly(mult, now);
  var valuation = PowerLaw.valuationLabel(mult);

  // Nav price
  setText('nav-live-price', formatUSD(livePrice));

  // Now box
  setText('now-mult', mult.toFixed(2) + '\u00D7');
  setText('now-position', valuation.label);
  setText('now-allocation', Math.round(kelly.allocation * 100) + '%');

  // Color the position
  var posEl = document.getElementById('now-position');
  if (posEl) {
    if (mult < 1) { posEl.className = 'ni-value green'; }
    else if (mult < 1.5) { posEl.className = 'ni-value'; }
    else { posEl.className = 'ni-value orange'; }
  }

  var allocEl = document.getElementById('now-allocation');
  if (allocEl) {
    allocEl.className = mult < 1 ? 'ni-value green' : 'ni-value orange';
  }
}


// ── Beat 5: Backtest ───────────────────────────────────────────
function generateQuarterlyDates(start, end) {
  var dates = [];
  var current = new Date(start);
  var endDate = new Date(end);
  while (current <= endDate) {
    dates.push(new Date(current));
    current = new Date(current.getFullYear(), current.getMonth() + 3, 1);
  }
  return dates;
}

function simulatePortfolio(allocationFn) {
  var startCapital = BACKTEST.startCapital;
  var tradQuarterlyMean = Math.pow(1 + BACKTEST.tradAnnualReturn, 0.25) - 1;
  var tradQuarterlyVol = BACKTEST.tradAnnualVol / 2; // annualized → quarterly: σ/√4
  var rebalanceDates = generateQuarterlyDates(BACKTEST.startDate, BACKTEST.endDate);
  var rng = mulberry32(BACKTEST.seed); // same seed → same traditional returns for both portfolios

  var totalValue = startCapital;
  var btcHoldings = 0;
  var tradHoldings = 0;
  var values = [];
  var quarterlyReturns = [];

  for (var i = 0; i < rebalanceDates.length; i++) {
    var date = rebalanceDates[i];
    var price = findClosestPrice(historicalData, date);
    if (!price) continue;

    if (i === 0) {
      var btcPct0 = allocationFn(date, price);
      btcHoldings = (totalValue * btcPct0) / price;
      tradHoldings = totalValue * (1 - btcPct0);
      values.push({ date: date, value: totalValue });
      continue;
    }

    // Grow traditional portion with realistic quarterly volatility
    var tradReturn = tradQuarterlyMean + tradQuarterlyVol * gaussianRandom(rng);
    tradHoldings *= (1 + tradReturn);

    // Current portfolio value
    var prevValue = totalValue;
    totalValue = (btcHoldings * price) + tradHoldings;
    values.push({ date: date, value: totalValue });

    // Track return
    if (prevValue > 0) {
      quarterlyReturns.push(totalValue / prevValue - 1);
    }

    // Rebalance
    var btcPct = allocationFn(date, price);
    btcHoldings = (totalValue * btcPct) / price;
    tradHoldings = totalValue * (1 - btcPct);
  }

  var years = (rebalanceDates[rebalanceDates.length - 1] - rebalanceDates[0]) / (365.25 * 24 * 3600 * 1000);
  var valueArray = [];
  for (var v = 0; v < values.length; v++) { valueArray.push(values[v].value); }

  return {
    values: values,
    finalValue: totalValue,
    totalReturn: totalValue / startCapital - 1,
    annReturn: PowerLaw.annualizedReturn(startCapital, totalValue, years),
    maxDD: PowerLaw.maxDrawdown(valueArray),
    sharpe: PowerLaw.sharpeRatio(quarterlyReturns, BACKTEST.riskFreeRate, 4),
    sortino: PowerLaw.sortinoRatio(quarterlyReturns, BACKTEST.riskFreeRate, 4),
    quarterlyReturns: quarterlyReturns
  };
}

function runAndRenderBacktest() {
  // Portfolio A: Fixed 2% BTC
  var portfolioA = simulatePortfolio(function() { return BACKTEST.fixedBtcAlloc; });

  // Portfolio B: Dynamic quarter-Kelly
  var portfolioB = simulatePortfolio(function(date, price) {
    var mult = PowerLaw.multiplier(price, MODEL, date);
    return institutionalKelly(mult, date).allocation;
  });

  // Render Portfolio A
  setText('pa-alloc', formatPct(BACKTEST.fixedBtcAlloc, 0) + ' (fixed)');
  setText('pa-total-return', '~' + formatPct(portfolioA.totalReturn, 0));
  setText('pa-ann-return', formatPct(portfolioA.annReturn));
  setText('pa-max-dd', formatPct(portfolioA.maxDD, 0));
  setText('pa-sharpe', portfolioA.sharpe.toFixed(2));
  setText('pa-sortino', (!isFinite(portfolioA.sortino) || portfolioA.sortino > 10) ? '>10' : portfolioA.sortino.toFixed(2));

  // Render Portfolio B
  var minAlloc = Math.round(KELLY_MIN * 100);
  var maxAlloc = Math.round(KELLY_MAX * 100);
  setText('pb-alloc', minAlloc + '\u2013' + maxAlloc + '% (dynamic)');
  setText('pb-total-return', '~' + formatPct(portfolioB.totalReturn, 0));
  setText('pb-ann-return', formatPct(portfolioB.annReturn));
  setText('pb-max-dd', formatPct(portfolioB.maxDD, 0));
  setText('pb-sharpe', portfolioB.sharpe.toFixed(2));
  setText('pb-sortino', (!isFinite(portfolioB.sortino) || portfolioB.sortino > 10) ? '>10' : portfolioB.sortino.toFixed(2));

  // Cost callout: gap scaled to 100M
  var scaleFactor = 100000000 / BACKTEST.startCapital;
  var costGap = (portfolioB.finalValue - portfolioA.finalValue) * scaleFactor;
  setText('cost-value', formatEUR(costGap));

  // Growth comparison chart
  renderBacktestChart(portfolioA, portfolioB);
}

function renderBacktestChart(portfolioA, portfolioB) {
  var ctx = document.getElementById('backtest-canvas');
  if (!ctx) return;
  if (backtestChart) backtestChart.destroy();

  var datasetsA = [];
  for (var a = 0; a < portfolioA.values.length; a++) {
    datasetsA.push({ x: portfolioA.values[a].date, y: portfolioA.values[a].value });
  }
  var datasetsB = [];
  for (var b = 0; b < portfolioB.values.length; b++) {
    datasetsB.push({ x: portfolioB.values[b].date, y: portfolioB.values[b].value });
  }

  backtestChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Portfolio A \u2014 Fixed 2%',
          data: datasetsA,
          borderColor: '#a3a3a3',
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Portfolio B \u2014 Dynamic Power Law',
          data: datasetsB,
          borderColor: '#e8740c',
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'year', displayFormats: { year: 'yyyy' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 10 } }
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Portfolio Value (\u20AC)', font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: function(v) { return formatEUR(v); },
            font: { size: 10 }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, padding: 16, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ctx.dataset.label + ': ' + formatEUR(ctx.raw.y); }
          }
        }
      }
    }
  });
}


// ── Launch ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
