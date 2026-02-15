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
  resolveScenarioK
};
