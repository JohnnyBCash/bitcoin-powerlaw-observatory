// Bitcoin Power Law Observatory - Core Calculations
// Genesis block timestamp: January 3, 2009, 00:00:00 UTC
const GENESIS = new Date('2009-01-03T00:00:00Z');

// Model parameters
const MODELS = {
  santostasi: {
    name: 'Santostasi',
    beta: 5.688,
    logA: -16.493,
    sigma: 0.2,
    useYears: false
  }
};

// Get the model's canonical sigma (log10 volatility)
function modelSigma(model) {
  const params = MODELS[model];
  if (!params) throw new Error(`Unknown model: ${model}`);
  return params.sigma;
}

// Calculate days since genesis
function daysSinceGenesis(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return (d.getTime() - GENESIS.getTime()) / (1000 * 60 * 60 * 24);
}

// Calculate years since genesis
function yearsSinceGenesis(date = new Date()) {
  return daysSinceGenesis(date) / 365.25;
}

// Calculate power law trend price for a given model
function trendPrice(model, date = new Date()) {
  const params = MODELS[model];
  if (!params) throw new Error(`Unknown model: ${model}`);

  const t = params.useYears ? yearsSinceGenesis(date) : daysSinceGenesis(date);
  return Math.pow(10, params.logA) * Math.pow(t, params.beta);
}

// Calculate multiplier (current price / trend price)
function multiplier(currentPrice, model, date = new Date()) {
  const trend = trendPrice(model, date);
  return currentPrice / trend;
}

// Get valuation label based on multiplier
function valuationLabel(mult) {
  if (mult < 0.5) return { label: 'Extremely Undervalued', color: '#00C853' };
  if (mult < 0.75) return { label: 'Undervalued', color: '#00C853' };
  if (mult < 1.25) return { label: 'Fair Value', color: '#757575' };
  if (mult < 2) return { label: 'Overvalued', color: '#FF1744' };
  if (mult < 3) return { label: 'Highly Overvalued', color: '#FF1744' };
  return { label: 'Extremely Overvalued', color: '#FF1744' };
}

// Calculate log residuals and standard deviation from historical data
function calculateSigma(historicalData, model) {
  const logResiduals = [];

  for (const point of historicalData) {
    const date = new Date(point.date);
    const trend = trendPrice(model, date);
    if (trend > 0 && point.price > 0) {
      const logResidual = Math.log10(point.price) - Math.log10(trend);
      logResiduals.push(logResidual);
    }
  }

  // Calculate mean
  const mean = logResiduals.reduce((a, b) => a + b, 0) / logResiduals.length;

  // Calculate standard deviation
  const squaredDiffs = logResiduals.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / logResiduals.length;
  const sigma = Math.sqrt(variance);

  return { sigma, mean, count: logResiduals.length };
}

// Calculate band prices (trend * 10^(k*sigma))
function bandPrice(model, sigma, k, date = new Date()) {
  const trend = trendPrice(model, date);
  return trend * Math.pow(10, k * sigma);
}

// Format price for display
function formatPrice(price) {
  if (price >= 1000000) {
    return '$' + (price / 1000000).toFixed(2) + 'M';
  } else if (price >= 1000) {
    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  } else if (price >= 1) {
    return '$' + price.toFixed(2);
  } else {
    return '$' + price.toFixed(4);
  }
}

// Format multiplier for display
function formatMultiplier(mult) {
  return mult.toFixed(2) + '×';
}

// Format date for display
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Calculate milestone date for a target price
function milestoneDateForPrice(targetPrice, model) {
  const params = MODELS[model];
  // targetPrice = 10^logA * t^beta
  // t = (targetPrice / 10^logA)^(1/beta)
  const t = Math.pow(targetPrice / Math.pow(10, params.logA), 1 / params.beta);

  let daysFromGenesis;
  if (params.useYears) {
    daysFromGenesis = t * 365.25;
  } else {
    daysFromGenesis = t;
  }

  const milestoneDate = new Date(GENESIS.getTime() + daysFromGenesis * 24 * 60 * 60 * 1000);
  return milestoneDate;
}

// ── Scenario Definitions ──────────────────────────────────────
// Central registry of all price scenarios used across calculators.
// id: programmatic key, label: display name, k: static sigma-k (null = dynamic/cyclical)
const SCENARIO_MODES = [
  { id: 'smooth_trend',     label: 'Smooth Trend',              k: 0 },
  { id: 'smooth_bear',      label: 'Bear (flat \u22121\u03c3)', k: -1 },
  { id: 'smooth_deep_bear', label: 'Deep Bear (flat \u22122\u03c3)', k: -2 },
  { id: 'cyclical',         label: 'Cyclical (\u00b11\u03c3)',  k: null },
  { id: 'cyclical_bear',    label: 'Bear Bias Cycles',          k: null }
];

function scenarioLabel(mode) {
  const found = SCENARIO_MODES.find(s => s.id === mode);
  return found ? found.label : mode;
}

function scenarioModes() {
  return SCENARIO_MODES;
}

// ── Scenario Pricing ──────────────────────────────────────────
// Price at a given sigma-k distance from trend: trend × 10^(sigmaK × sigma)
function scenarioPrice(model, date, sigma, sigmaK) {
  const trend = trendPrice(model, date);
  return trend * Math.pow(10, sigmaK * sigma);
}

// Current market position as sigma-k (how many σ above/below trend)
function currentSigmaK(model, sigma, livePrice, date) {
  const trend = trendPrice(model, date || new Date());
  if (!trend || trend <= 0 || !livePrice || livePrice <= 0) return 0;
  return (Math.log10(livePrice) - Math.log10(trend)) / sigma;
}


// ── Cyclical Price Model (Log-Periodic, Perrenod-calibrated) ──
// Models Bitcoin's cyclical deviation from the power law trend using
// discrete scale invariance: cycles lengthen geometrically (λ ≈ 2.0)
// with power-law amplitude decay for peaks and stable trough depth.
//
// Based on empirical data from Stephen Perrenod's analysis:
//   Trough ages: 1.730, 3.398, 6.713, 13.977 yrs (λ_trough = 2.007)
//   Peak ages:   2.77, 4.33, 8.75 yrs (λ_peak = 2.07)
//   Trough depth: stable at ~-1σ (log residual ≈ -0.39)
//   Peak height:  decays as age^(-0.83)
//
// Returns sigmaK (number of σ above/below trend) for a given year offset.
function cyclicalSigmaK(yearsFromStart, options = {}) {
  const {
    lambda = 2.007,       // geometric cycle scaling factor (Perrenod trough ratio)
    alpha = 0.83,         // peak amplitude power-law decay exponent
    troughDepth = -1.0,   // trough floor in sigma units (constant across cycles)
    peakK0 = 2.0,         // initial peak height at early Bitcoin age (~2σ)
    bearBias = 0,         // shift wave down (>0 = pessimistic bias)
    amplitude = 1.0,      // overall scaling multiplier
    initialK = null,      // starting sigmaK from live price (null = use model phase)
    genesisAge = null      // Bitcoin age in years at t=0 (null = derive from now)
  } = options;

  // Compute absolute Bitcoin age
  const baseAge = genesisAge !== null ? genesisAge : yearsSinceGenesis(new Date());
  const age = baseAge + yearsFromStart;

  // Guard: very early ages (before first trough) — return trough depth
  if (age < 1.0) return amplitude * troughDepth - bearBias;

  // Log-periodic phase: φ(age) = 2π × log(age) / log(λ)
  // This produces a sine wave that is uniform in log-time,
  // meaning equal-looking oscillations on a log-scale time axis.
  // Calibrated so troughs at empirical ages land near sin = -1.
  //
  // Phase calibration: first trough at age 1.730 should be sin ≈ -1
  // → φ(1.730) = -π/2 + 2πn → phaseShift = -π/2 - 2π×log(1.730)/log(λ)
  const T0_trough = 1.730; // first empirical trough age
  const logLambda = Math.log(lambda);
  const phaseShift = -Math.PI / 2 - (2 * Math.PI * Math.log(T0_trough) / logLambda);

  const phase = 2 * Math.PI * Math.log(age) / logLambda + phaseShift;
  let sineVal = Math.sin(phase);

  // Asymmetric amplitude envelope:
  // Troughs: constant depth (troughDepth, typically -1σ)
  // Peaks: decay as age^(-alpha), scaled by peakK0
  // When sine > 0 (above trend): scale by decaying peak envelope
  // When sine < 0 (below trend): scale by constant trough depth
  let sigmaK;
  if (sineVal >= 0) {
    // Peak side: amplitude decays with age
    const peakAmplitude = peakK0 * Math.pow(age, -alpha);
    sigmaK = amplitude * peakAmplitude * sineVal;
  } else {
    // Trough side: constant depth
    sigmaK = amplitude * Math.abs(troughDepth) * sineVal;
  }

  // Apply bear bias (shifts entire wave down)
  sigmaK -= bearBias;

  // Handle initialK: blend from current market position toward model
  // over the first ~2 years for smooth transition
  if (initialK !== null && yearsFromStart < 2.0) {
    const modelK = sigmaK;
    const blend = yearsFromStart / 2.0; // 0 at start → 1 at 2 years
    sigmaK = initialK * (1 - blend) + modelK * blend;
  }

  // Clamp to reasonable range
  return Math.max(-2, Math.min(2, sigmaK));
}

// Resolve the effective sigmaK for a given year based on scenario mode
function resolveScenarioK(scenarioMode, yearIndex, initialK) {
  switch (scenarioMode) {
    case 'smooth_trend':      return 0;
    case 'smooth_bear':       return -1;
    case 'smooth_deep_bear':  return -2;
    case 'cyclical':
      return cyclicalSigmaK(yearIndex, { bearBias: 0, initialK: initialK != null ? initialK : null });
    case 'cyclical_bear':
      return cyclicalSigmaK(yearIndex, { bearBias: 0.309, initialK: initialK != null ? initialK : null });
    default:
      return 0;
  }
}


// ── Kelly Criterion (Thorp continuous-investment formula) ─────
// f* = μ / σ²  (full Kelly)
// We use quarter-Kelly for institutional risk management.
//
// μ = trend_growth + mean_reversion − risk_free_rate
//   trend_growth: power law CAGR at current BTC age = β × 365.25 / days
//   mean_reversion: expected annual return from reversion to trend
//     = (1/mult)^(1/reversion_horizon) − 1
//   reversion_horizon: derived from Perrenod's λ=2.007 cycle model
//
// σ² = annualized variance of BTC returns (traditional measure)
//
// References:
//   Kelly (1956): "A New Interpretation of Information Rate"
//   Thorp (2006): "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market"
//   Perrenod: log-periodic cycle model with λ ≈ 2.007

const KELLY_DEFAULTS = {
  riskFreeRate: 0.02,       // 2% annual (ECB-aligned)
  btcAnnualSigma: 0.75     // Traditional annualized BTC volatility
};

// Derive mean-reversion horizon from Perrenod's log-periodic cycle model.
// At current BTC age, estimates the expected half-cycle (trough→peak or peak→trough)
// using empirical trough ages scaled by λ = 2.007.
function kellyReversionHorizon(date = new Date()) {
  const lambda = 2.007;
  const troughAges = [1.730, 3.398, 6.713, 13.977]; // Perrenod empirical trough ages
  const age = yearsSinceGenesis(date);

  // Find which cycle we're in (between which troughs)
  let cycleStart = troughAges[troughAges.length - 1];
  let cycleEnd = cycleStart * lambda;

  for (let i = 0; i < troughAges.length - 1; i++) {
    if (age >= troughAges[i] && age < troughAges[i + 1]) {
      cycleStart = troughAges[i];
      cycleEnd = troughAges[i + 1];
      break;
    }
  }

  // If beyond last known trough, extrapolate using λ
  if (age >= troughAges[troughAges.length - 1]) {
    cycleStart = troughAges[troughAges.length - 1];
    cycleEnd = cycleStart * lambda;
    // Keep extrapolating if needed
    while (age >= cycleEnd) {
      cycleStart = cycleEnd;
      cycleEnd = cycleStart * lambda;
    }
  }

  // Half-cycle ≈ half the full cycle period
  const fullCycle = cycleEnd - cycleStart;
  return Math.max(1.0, fullCycle / 2);
}

// Full Kelly-optimal BTC allocation using the real Kelly criterion formula.
// Returns the FULL Kelly fraction (unbounded). Callers apply fractional
// Kelly (half, quarter, etc.) and clamping for their specific use case.
//
// Returns: { fraction, mu, variance, trendGrowth, reversionReturn, horizon }
// fraction = f* = μ / σ²  (can be >1 or negative)
function kellyAllocation(mult, model = 'santostasi', date = new Date(), options = {}) {
  const {
    riskFreeRate = KELLY_DEFAULTS.riskFreeRate,
    btcAnnualSigma = KELLY_DEFAULTS.btcAnnualSigma
  } = options;

  const params = MODELS[model];
  if (!params) throw new Error(`Unknown model: ${model}`);

  const days = daysSinceGenesis(date);
  if (days <= 0 || mult <= 0) return { fraction: 0, mu: 0, variance: 0, trendGrowth: 0, reversionReturn: 0, horizon: 0 };

  // 1. Trend growth rate (annualized power law CAGR at current age)
  //    d/dt[ln(price)] = β/t → annualized = β × 365.25 / days
  const trendGrowth = params.beta * 365.25 / days;

  // 2. Mean-reversion expected return
  //    If mult < 1, price is below trend → expect upward reversion
  //    If mult > 1, price is above trend → expect downward drag
  //    Annual reversion return = (1/mult)^(1/horizon) − 1
  const horizon = kellyReversionHorizon(date);
  const reversionReturn = Math.pow(1 / mult, 1 / horizon) - 1;

  // 3. Expected annual excess return
  const mu = trendGrowth + reversionReturn - riskFreeRate;

  // 4. Variance (σ² of annual BTC returns)
  const variance = btcAnnualSigma * btcAnnualSigma;

  // 5. Full Kelly: f* = μ / σ²
  const fraction = mu / variance;

  return { fraction, mu, variance, trendGrowth, reversionReturn, horizon };
}

// ── Portfolio Backtest Metrics ──────────────────────────────

// Linear interpolation
function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Sharpe ratio from array of periodic returns
// Uses sample standard deviation (n-1) — standard for financial metrics
function sharpeRatio(returns, riskFreeRate, periodsPerYear) {
  if (returns.length < 2) return 0;
  const rfPerPeriod = Math.pow(1 + riskFreeRate, 1 / periodsPerYear) - 1;
  const excess = returns.map(r => r - rfPerPeriod);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / (excess.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(periodsPerYear);
}

// Sortino ratio — only penalizes downside deviation
// Downside variance uses full n denominator (Sortino & van der Meer 1991)
function sortinoRatio(returns, riskFreeRate, periodsPerYear) {
  if (returns.length < 2) return 0;
  const rfPerPeriod = Math.pow(1 + riskFreeRate, 1 / periodsPerYear) - 1;
  const excess = returns.map(r => r - rfPerPeriod);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downsideSquared = excess.filter(r => r < 0).map(r => r * r);
  if (downsideSquared.length === 0) return mean > 0 ? Infinity : 0;
  const downsideVariance = downsideSquared.reduce((a, b) => a + b, 0) / excess.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return mean > 0 ? Infinity : 0;
  return (mean / downsideDev) * Math.sqrt(periodsPerYear);
}

// Maximum drawdown from array of portfolio values
// Returns a negative fraction (e.g., -0.38 for 38% drawdown)
function maxDrawdown(values) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

// Annualized return (CAGR) from start/end values over N years
function annualizedReturn(startValue, endValue, years) {
  if (startValue <= 0 || years <= 0) return 0;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

// Annualized volatility from periodic returns
function annualizedVolatility(returns, periodsPerYear) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * periodsPerYear);
}

// R-squared of the power law fit: how well log10(price) vs log10(days) fits the model
function rSquaredLogLog(historicalData, model) {
  const params = MODELS[model];
  if (!params) return 0;

  const logPrices = [];
  const logPredicted = [];

  for (const point of historicalData) {
    const date = new Date(point.date);
    const days = daysSinceGenesis(date);
    if (days > 0 && point.price > 0) {
      logPrices.push(Math.log10(point.price));
      logPredicted.push(params.logA + params.beta * Math.log10(days));
    }
  }

  if (logPrices.length < 3) return 0;

  // R² = 1 − SS_res / SS_tot
  const meanLogPrice = logPrices.reduce((a, b) => a + b, 0) / logPrices.length;
  const ssTot = logPrices.reduce((s, lp) => s + (lp - meanLogPrice) ** 2, 0);
  const ssRes = logPrices.reduce((s, lp, i) => s + (lp - logPredicted[i]) ** 2, 0);
  if (ssTot === 0) return 0;
  return 1 - ssRes / ssTot;
}


// ── Export ─────────────────────────────────────────────────────
window.PowerLaw = {
  GENESIS,
  MODELS,
  daysSinceGenesis,
  yearsSinceGenesis,
  trendPrice,
  multiplier,
  valuationLabel,
  calculateSigma,
  modelSigma,
  bandPrice,
  formatPrice,
  formatMultiplier,
  formatDate,
  milestoneDateForPrice,
  // Scenario engine (centralized)
  SCENARIO_MODES,
  scenarioLabel,
  scenarioModes,
  scenarioPrice,
  currentSigmaK,
  cyclicalSigmaK,
  resolveScenarioK,
  // Kelly criterion & portfolio metrics
  KELLY_DEFAULTS,
  kellyReversionHorizon,
  kellyAllocation,
  lerp,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown,
  annualizedReturn,
  annualizedVolatility,
  rSquaredLogLog
};
