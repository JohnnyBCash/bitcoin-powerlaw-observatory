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

// Export for use in other scripts
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
  milestoneDateForPrice
};
