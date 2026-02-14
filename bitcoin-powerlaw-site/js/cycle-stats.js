// Bitcoin Power Law Observatory — Cycle Statistics Module
// Empirical analysis of Bitcoin's cyclical behavior relative to the power law trend
// All residuals and k-values use log10, matching powerlaw.js's calculateSigma
// Depends on: window.PowerLaw (from powerlaw.js)

(function() {
  'use strict';

  var PL = window.PowerLaw;

  // ── Internal Helpers ──────────────────────────────────────

  // Binary search: count of values in sorted array that are <= target
  // Returns percentile as 0–100
  function binarySearchPercentile(sortedArray, value) {
    var lo = 0;
    var hi = sortedArray.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (sortedArray[mid] <= value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return (lo / sortedArray.length) * 100;
  }

  // Descriptive statistics for a numeric array
  function descriptiveStats(arr) {
    if (!arr || arr.length === 0) {
      return { mean: 0, median: 0, min: 0, max: 0, count: 0, stdev: 0 };
    }

    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += sorted[i];
    var mean = sum / n;

    var mid = Math.floor(n / 2);
    var median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    var sqDiffSum = 0;
    for (var j = 0; j < n; j++) {
      var diff = sorted[j] - mean;
      sqDiffSum += diff * diff;
    }
    var stdev = Math.sqrt(sqDiffSum / n);

    return {
      mean: mean,
      median: median,
      min: sorted[0],
      max: sorted[n - 1],
      count: n,
      stdev: stdev
    };
  }

  // Build a histogram from values array
  function buildHistogram(values, numBins, minVal, maxVal) {
    var binWidth = (maxVal - minVal) / numBins;
    var bins = [];
    for (var i = 0; i < numBins; i++) {
      var binStart = minVal + i * binWidth;
      bins.push({
        kCenter: binStart + binWidth / 2,
        count: 0,
        probability: 0
      });
    }

    var inRange = 0;
    for (var j = 0; j < values.length; j++) {
      var v = values[j];
      if (v >= minVal && v < maxVal) {
        var idx = Math.min(Math.floor((v - minVal) / binWidth), numBins - 1);
        bins[idx].count++;
        inRange++;
      }
    }

    // Normalize to probabilities
    if (inRange > 0) {
      for (var b = 0; b < bins.length; b++) {
        bins[b].probability = bins[b].count / inRange;
      }
    }

    return bins;
  }


  // ── Phase & Transition Builders ───────────────────────────

  // Identify consecutive bull/bear phases
  // Bull: k > 0 (above trend), Bear: k < 0 (below trend)
  function computePhases(kValues) {
    var phases = [];
    if (kValues.length === 0) return phases;

    var currentType = kValues[0] >= 0 ? 'bull' : 'bear';
    var startIdx = 0;

    for (var i = 1; i < kValues.length; i++) {
      var type = kValues[i] >= 0 ? 'bull' : 'bear';
      if (type !== currentType) {
        phases.push({
          type: currentType,
          startIdx: startIdx,
          endIdx: i - 1,
          days: i - startIdx
        });
        currentType = type;
        startIdx = i;
      }
    }

    // Close the last phase
    phases.push({
      type: currentType,
      startIdx: startIdx,
      endIdx: kValues.length - 1,
      days: kValues.length - startIdx
    });

    return phases;
  }

  // Build transition pairs for each time horizon
  // For each day i, record (k_i, k_{i+horizon}) for efficient future queries
  function buildTransitions(kValues, horizons) {
    var transitions = {};

    for (var h = 0; h < horizons.length; h++) {
      var horizon = horizons[h];
      var maxStart = kValues.length - horizon;
      var startK = [];
      var endK = [];

      for (var i = 0; i < maxStart; i++) {
        startK.push(kValues[i]);
        endK.push(kValues[i + horizon]);
      }

      transitions[horizon] = { startK: startK, endK: endK };
    }

    return transitions;
  }

  // Filter transition pairs by starting k-value within tolerance
  function filterByKBucket(transitions, horizon, centerK, tolerance) {
    var t = transitions[horizon];
    if (!t) return [];

    var results = [];
    var lo = centerK - tolerance;
    var hi = centerK + tolerance;

    for (var i = 0; i < t.startK.length; i++) {
      if (t.startK[i] >= lo && t.startK[i] <= hi) {
        results.push(t.endK[i]);
      }
    }

    return results;
  }


  // ── Compute band-time statistics ──────────────────────────

  function computeBandDays(kValues) {
    var bands = [
      { band: 'deep_bear', label: 'Below -2\u03c3', min: -Infinity, max: -2, count: 0 },
      { band: 'bear',      label: '-2\u03c3 to -1\u03c3', min: -2, max: -1, count: 0 },
      { band: 'below',     label: '-1\u03c3 to 0',   min: -1, max: 0, count: 0 },
      { band: 'above',     label: '0 to +1\u03c3',   min: 0,  max: 1, count: 0 },
      { band: 'bull',      label: '+1\u03c3 to +2\u03c3', min: 1, max: 2, count: 0 },
      { band: 'euphoria',  label: 'Above +2\u03c3',  min: 2, max: Infinity, count: 0 }
    ];

    var n = kValues.length;
    for (var i = 0; i < n; i++) {
      var k = kValues[i];
      for (var b = 0; b < bands.length; b++) {
        if (k >= bands[b].min && k < bands[b].max) {
          bands[b].count++;
          break;
        }
      }
      // Edge case: k exactly at +Infinity boundary (euphoria captures k >= 2)
      if (k >= 2) bands[5].count++;
    }

    // Fix double-count: the loop already catches k >= 2 in the euphoria band
    // because Infinity > k, so the inner loop finds it. Remove the extra increment.
    // Actually, let's fix the logic: the inner loop checks k < max, so k=2 would
    // NOT match euphoria (2 < Infinity is true, so it DOES match). The extra
    // increment after the loop would double-count. Let me remove it.

    // Recalculate correctly: remove the post-loop euphoria fix
    // Reset and recount properly
    for (var b2 = 0; b2 < bands.length; b2++) bands[b2].count = 0;

    for (var i2 = 0; i2 < n; i2++) {
      var k2 = kValues[i2];
      if (k2 < -2) { bands[0].count++; }
      else if (k2 < -1) { bands[1].count++; }
      else if (k2 < 0) { bands[2].count++; }
      else if (k2 < 1) { bands[3].count++; }
      else if (k2 < 2) { bands[4].count++; }
      else { bands[5].count++; }
    }

    // Compute percentages and days per year
    for (var b3 = 0; b3 < bands.length; b3++) {
      bands[b3].days = bands[b3].count;
      bands[b3].pct = n > 0 ? (bands[b3].count / n) * 100 : 0;
      bands[b3].daysPerYear = n > 0 ? (bands[b3].count / n) * 365.25 : 0;
    }

    return bands;
  }


  // ── Core Analysis Builder ─────────────────────────────────

  function buildAnalysis(historicalData, model) {
    // Use the model's canonical sigma (0.2) for consistent k-values
    var sigma = PL.MODELS[model].sigma;
    // Still compute empirical mean for residual centering
    var sigmaResult = PL.calculateSigma(historicalData, model);
    var mean = sigmaResult.mean;

    // Compute k-values for each day
    var kValues = [];
    var dates = [];

    for (var i = 0; i < historicalData.length; i++) {
      var point = historicalData[i];
      var date = new Date(point.date);
      var trend = PL.trendPrice(model, date);

      if (trend > 0 && point.price > 0) {
        var residual = Math.log10(point.price) - Math.log10(trend);
        var k = residual / sigma;
        kValues.push(k);
        dates.push(point.date);
      }
    }

    // Sort k-values for CDF lookups
    var sortedK = kValues.slice().sort(function(a, b) { return a - b; });

    // Identify bull/bear phases
    var phases = computePhases(kValues);

    // Build transition pairs for standard horizons
    var horizons = [30, 90, 180, 365];
    var transitions = buildTransitions(kValues, horizons);

    // Compute band-time statistics
    var bandDays = computeBandDays(kValues);

    return {
      kValues: kValues,
      dates: dates,
      sigma: sigma,
      mean: mean,
      count: kValues.length,
      sortedK: sortedK,
      phases: phases,
      transitions: transitions,
      bandDays: bandDays
    };
  }


  // ── Percentile Functions (Req #1) ─────────────────────────

  // Given a k-value, return its percentile (0–100) in historical distribution
  function percentileForK(analysis, k) {
    return binarySearchPercentile(analysis.sortedK, k);
  }

  // Given a percentile (0–100), return the corresponding k-value
  // Uses linear interpolation between sorted values
  function kForPercentile(analysis, percentile) {
    var sorted = analysis.sortedK;
    var n = sorted.length;
    if (n === 0) return 0;

    var p = Math.max(0, Math.min(100, percentile));
    var idx = (p / 100) * (n - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);

    if (lo === hi || hi >= n) return sorted[Math.min(lo, n - 1)];

    var frac = idx - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  }


  // ── Time-in-Band Analysis (Req #2) ────────────────────────

  // Returns pre-computed band statistics from the analysis object
  function timeInBands(analysis) {
    return analysis.bandDays;
  }


  // ── Price Level Probabilities (Req #3) ────────────────────

  // Windowed analysis: starting from days near fromK, what fraction of
  // N-year windows touched targetK in the given direction?
  function probReachLevel(analysis, fromK, targetK, direction, windowYears) {
    var kValues = analysis.kValues;
    var windowDays = Math.round(windowYears * 365.25);
    var tolerance = 0.25;
    var lo = fromK - tolerance;
    var hi = fromK + tolerance;

    var qualifying = 0;
    var touched = 0;

    for (var i = 0; i < kValues.length; i++) {
      // Only start windows from days near fromK
      if (kValues[i] < lo || kValues[i] > hi) continue;
      // Ensure window fits in data
      if (i + windowDays > kValues.length) break;

      qualifying++;

      // Scan forward through the window
      for (var j = i + 1; j <= i + windowDays && j < kValues.length; j++) {
        if (direction === 'above' && kValues[j] >= targetK) {
          touched++;
          break;
        }
        if (direction === 'below' && kValues[j] <= targetK) {
          touched++;
          break;
        }
      }
    }

    return qualifying > 0 ? touched / qualifying : 0;
  }

  // Convenience: standard probability queries from current position
  function priceLevelProbabilities(analysis, currentK, windowYears) {
    return {
      reachPlus1: probReachLevel(analysis, currentK, 1, 'above', windowYears),
      reachPlus2: probReachLevel(analysis, currentK, 2, 'above', windowYears),
      dropMinus1: probReachLevel(analysis, currentK, -1, 'below', windowYears),
      dropMinus2: probReachLevel(analysis, currentK, -2, 'below', windowYears)
    };
  }


  // ── Cycle Duration Statistics (Req #4) ────────────────────

  // Statistics on how long bull and bear phases last
  function phaseDurations(analysis) {
    var bullDurations = [];
    var bearDurations = [];

    for (var i = 0; i < analysis.phases.length; i++) {
      var phase = analysis.phases[i];
      if (phase.type === 'bull') {
        bullDurations.push(phase.days);
      } else {
        bearDurations.push(phase.days);
      }
    }

    return {
      bull: descriptiveStats(bullDurations),
      bear: descriptiveStats(bearDurations)
    };
  }

  // Mean reversion time: from a given k-bucket, how many days until k crosses zero?
  function meanReversionTime(analysis, fromKBucket) {
    var kValues = analysis.kValues;
    var tolerance = 0.25;
    var lo = fromKBucket - tolerance;
    var hi = fromKBucket + tolerance;
    var sign = fromKBucket >= 0 ? 1 : -1;

    var reversionDays = [];

    for (var i = 0; i < kValues.length - 1; i++) {
      if (kValues[i] < lo || kValues[i] > hi) continue;

      // Walk forward until k crosses zero
      for (var j = i + 1; j < kValues.length; j++) {
        // Crossed zero: sign changed or k is very close to zero
        if ((sign > 0 && kValues[j] < 0) || (sign < 0 && kValues[j] >= 0)) {
          reversionDays.push(j - i);
          break;
        }
      }
    }

    return descriptiveStats(reversionDays);
  }


  // ── Future Projection (Req #5) ────────────────────────────

  // Given current k, what does k look like after horizonDays?
  // Uses historical transition pairs filtered by starting k
  function futureKDistribution(analysis, currentK, horizonDays) {
    var tolerance = 0.3;

    // Find the closest available horizon
    var availableHorizons = [30, 90, 180, 365];
    var bestHorizon = availableHorizons[0];
    var bestDiff = Math.abs(horizonDays - bestHorizon);

    for (var h = 1; h < availableHorizons.length; h++) {
      var diff = Math.abs(horizonDays - availableHorizons[h]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestHorizon = availableHorizons[h];
      }
    }

    // Get matching end-k values
    var endKValues = filterByKBucket(analysis.transitions, bestHorizon, currentK, tolerance);

    if (endKValues.length === 0) {
      // Widen tolerance if no matches
      endKValues = filterByKBucket(analysis.transitions, bestHorizon, currentK, 0.5);
    }

    if (endKValues.length === 0) {
      return {
        percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        mean: 0,
        sampleSize: 0,
        histogram: []
      };
    }

    var stats = descriptiveStats(endKValues);

    // Compute percentiles
    var sorted = endKValues.slice().sort(function(a, b) { return a - b; });
    var n = sorted.length;

    function pctVal(p) {
      var idx = (p / 100) * (n - 1);
      var lo = Math.floor(idx);
      var hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      var frac = idx - lo;
      return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
    }

    var percentiles = {
      p10: pctVal(10),
      p25: pctVal(25),
      p50: pctVal(50),
      p75: pctVal(75),
      p90: pctVal(90)
    };

    // Build histogram of end-k distribution
    var histogram = buildHistogram(endKValues, 20, -3, 3);

    return {
      percentiles: percentiles,
      mean: stats.mean,
      sampleSize: n,
      histogram: histogram
    };
  }

  // Convenience: projection at all standard horizons
  function futureKProjection(analysis, currentK) {
    return {
      t30:  futureKDistribution(analysis, currentK, 30),
      t90:  futureKDistribution(analysis, currentK, 90),
      t180: futureKDistribution(analysis, currentK, 180),
      t365: futureKDistribution(analysis, currentK, 365)
    };
  }


  // ── Utility ───────────────────────────────────────────────

  // Convert a price to its k-value (sigma-distance from trend)
  function currentK(model, sigma, price, date) {
    var d = date || new Date();
    var trend = PL.trendPrice(model, d);
    var residual = Math.log10(price) - Math.log10(trend);
    return residual / sigma;
  }


  // ── Export ────────────────────────────────────────────────

  window.CycleStats = {
    buildAnalysis: buildAnalysis,
    percentileForK: percentileForK,
    kForPercentile: kForPercentile,
    timeInBands: timeInBands,
    probReachLevel: probReachLevel,
    priceLevelProbabilities: priceLevelProbabilities,
    phaseDurations: phaseDurations,
    meanReversionTime: meanReversionTime,
    futureKDistribution: futureKDistribution,
    futureKProjection: futureKProjection,
    currentK: currentK
  };

})();
