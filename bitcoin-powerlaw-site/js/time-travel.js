// Bitcoin Power Law Observatory – Time Travel Visualisation
// "What happens if Bitcoin ages 50% more? What if the age doubles?"
// A log-log chart with historical price + trend corridor, plus a scrubable
// future projection that slides the age multiplier from 1× to 3×.

(function () {
  'use strict';

  /* -------------------------------------------------------- config --------------------------------------------------------- */
  const AGE_MIN = 1.0;   // 1× = today
  const AGE_MAX = 3.0;   // 3× current age
  const STEP    = 0.01;  // slider granularity

  // How many extra points to draw beyond "now" for the projected lines
  const FUTURE_POINTS = 60;

  /* -------------------------------------------------------- state ---------------------------------------------------------- */
  let weeklyData   = [];     // [{date: Date, price: number}]  – loaded from btc_historical.json
  let ttChart      = null;
  let currentModel = 'santostasi';
  let sigma        = 0;
  let ageMultiplier = 1.0;
  let playing      = false;
  let animFrame    = null;

  // Derived once after data loads
  let nowDays      = 0;    // days since genesis TODAY (end of data)
  let nowDate      = null;

  /* -------------------------------------------------------- grab shared data -------------------------------------------- */
  // Load daily historical data from btc_historical.json (same dataset used by future.js).
  // Downsample to weekly for chart performance.
  async function ensureData() {
    const res  = await fetch('../datasets/btc_historical.json');
    const data = await res.json();

    // Downsample daily → weekly (every 7th point) to keep the chart snappy
    for (let i = 0; i < data.length; i += 7) {
      const d = data[i];
      weeklyData.push({
        date:  new Date(d.date + 'T00:00:00Z'),
        price: d.price
      });
    }
    // Always include the very last data point
    const last = data[data.length - 1];
    const lastEntry = weeklyData[weeklyData.length - 1];
    if (last.date !== data[Math.floor((data.length - 1) / 7) * 7]?.date) {
      weeklyData.push({
        date:  new Date(last.date + 'T00:00:00Z'),
        price: last.price
      });
    }
    weeklyData.sort((a, b) => a.date - b.date);
  }

  /* -------------------------------------------------------- sigma --------------------------------------------------------- */
  function computeSigma() {
    // Use canonical model sigma (0.2) for consistent band lines
    sigma = PowerLaw.MODELS[currentModel].sigma;
  }

  /* -------------------------------------------------------- formatting ------------------------------------------------------ */
  function formatUSD(n) {
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 1)    return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Given a number of days since genesis, return the calendar date
  function dateFromDays(days) {
    return new Date(PowerLaw.GENESIS.getTime() + days * 86400000);
  }

  /* -------------------------------------------------------- build datasets -------------------------------------------------- */
  function buildDatasets() {
    const targetDays = nowDays * ageMultiplier;

    // ── historical price (only up to nowDays) ──
    const priceData = weeklyData.map(w => ({
      x: PowerLaw.daysSinceGenesis(w.date),
      y: w.price
    }));

    // ── generate evenly-spaced x points from first data point to targetDays
    //    (covers both historical and projected range for trend / bands)
    const firstDays = PowerLaw.daysSinceGenesis(weeklyData[0].date);
    const allX      = [];
    // Use the historical x points first for accuracy through known data
    for (const w of weeklyData) {
      allX.push(PowerLaw.daysSinceGenesis(w.date));
    }
    // Then extend into the future with FUTURE_POINTS evenly spaced
    if (ageMultiplier > 1.0) {
      const step = (targetDays - nowDays) / FUTURE_POINTS;
      for (let i = 1; i <= FUTURE_POINTS; i++) {
        allX.push(nowDays + step * i);
      }
    }

    // ── trend + bands across the full x range ──
    const trendData  = allX.map(d => ({ x: d, y: PowerLaw.trendPrice(currentModel, dateFromDays(d)) }));
    const upper1Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma,  1, dateFromDays(d)) }));
    const lower1Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma, -1, dateFromDays(d)) }));
    const upper2Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma,  2, dateFromDays(d)) }));
    const lower2Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma, -2, dateFromDays(d)) }));

    // ── "Now" vertical line – single-point scatter with a tall range ──
    // We fake a vertical line by drawing two points with the same x at yMin / yMax.
    // Use a scatter dataset with showLine: true.
    const yMin = 100;  // safely below any BTC price on log scale
    const yMax = PowerLaw.bandPrice(currentModel, sigma, 2, dateFromDays(targetDays)) * 2;
    const nowLine = [
      { x: nowDays, y: yMin },
      { x: nowDays, y: yMax }
    ];

    // ── "Future" vertical line (only shown when age > 1) ──
    const futureLine = ageMultiplier > 1.001
      ? [{ x: targetDays, y: yMin }, { x: targetDays, y: yMax }]
      : [];

    // ── Future target dot (trend price at target age) ──
    const futureTrend = PowerLaw.trendPrice(currentModel, dateFromDays(targetDays));
    const futureDot = [{ x: targetDays, y: futureTrend }];

    // ── datasets (order matters for fill indices) ──
    // [0] +2σ   fill→1
    // [1] +1σ   fill→2
    // [2] trend
    // [3] -1σ   fill→2
    // [4] -2σ   fill→3
    // [5] price (black line, no fill)
    // [6] "Now" vertical
    // [7] "Future" vertical
    // [8] future target dot

    return [
      {
        label: '+2σ',
        data: upper2Data,
        borderColor: 'rgba(255,23,68,0.30)',
        backgroundColor: 'rgba(255,23,68,0.05)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
        fill: { target: 1 }
      },
      {
        label: '+1σ',
        data: upper1Data,
        borderColor: 'rgba(255,23,68,0.22)',
        backgroundColor: 'rgba(255,23,68,0.08)',
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 }
      },
      {
        label: 'Power Law Trend',
        data: trendData,
        borderColor: '#F7931A',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0,
        fill: false
      },
      {
        label: '-1σ',
        data: lower1Data,
        borderColor: 'rgba(0,200,83,0.22)',
        backgroundColor: 'rgba(0,200,83,0.08)',
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0,
        fill: { target: 2 }
      },
      {
        label: '-2σ',
        data: lower2Data,
        borderColor: 'rgba(0,200,83,0.30)',
        backgroundColor: 'rgba(0,200,83,0.05)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
        fill: { target: 3 }
      },
      {
        label: 'BTC Price (actual)',
        data: priceData,
        borderColor: '#000000',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        fill: false
      },
      {
        // "Now" vertical dashed line
        label: 'Now',
        data: nowLine,
        type: 'line',
        borderColor: 'rgba(0,0,0,0.5)',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        showLine: true,
        fill: false
      },
      {
        // "Future" vertical dashed line
        label: 'Age ' + ageMultiplier.toFixed(2) + '×',
        data: futureLine,
        type: 'line',
        borderColor: '#F7931A',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
        fill: false,
        display: ageMultiplier > 1.001
      },
      {
        // Big dot at future trend price
        label: 'Trend at ' + ageMultiplier.toFixed(2) + '×',
        data: futureDot,
        type: 'scatter',
        backgroundColor: '#F7931A',
        borderColor: '#000',
        borderWidth: 2,
        pointRadius: 10,
        pointStyle: 'circle',
        display: ageMultiplier > 1.001
      }
    ];
  }

  /* -------------------------------------------------------- chart options --------------------------------------------------- */
  function buildOptions() {
    const targetDays = nowDays * ageMultiplier;

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },   // we animate via slider; disable Chart.js internal anim
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Days Since Genesis (log)', font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          min: PowerLaw.daysSinceGenesis(weeklyData[0].date) * 0.9,
          max: targetDays * 1.05,
          ticks: {
            callback: function (value) {
              if (value >= 365) return (value / 365).toFixed(0) + 'y';
              return value + 'd';
            }
          }
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Price USD (log)', font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: function (value) { return formatUSD(value); }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { usePointStyle: true, padding: 14 }
        },
        tooltip: {
          callbacks: {
            title: function (ctx) {
              const x = ctx[0].parsed.x;
              return fmtDate(dateFromDays(x)) + '  (' + (x / 365).toFixed(1) + 'y)';
            },
            label: function (ctx) {
              return ctx.dataset.label + ': ' + formatUSD(ctx.parsed.y);
            }
          }
        }
      }
    };
  }

  /* -------------------------------------------------------- update stats ---------------------------------------------------- */
  function updateStats() {
    const targetDays   = nowDays * ageMultiplier;
    const targetDate   = dateFromDays(targetDays);
    const trendAtTarget = PowerLaw.trendPrice(currentModel, targetDate);
    const upper1        = PowerLaw.bandPrice(currentModel, sigma,  1, targetDate);
    const lower1        = PowerLaw.bandPrice(currentModel, sigma, -1, targetDate);
    const upper2        = PowerLaw.bandPrice(currentModel, sigma,  2, targetDate);
    const lower2        = PowerLaw.bandPrice(currentModel, sigma, -2, targetDate);

    setText('tt-multiplier',  ageMultiplier.toFixed(2) + '×');
    setText('tt-date',        fmtDate(targetDate));
    setText('tt-trend',       formatUSD(trendAtTarget));
    setText('tt-1sigma',      formatUSD(lower1) + ' – ' + formatUSD(upper1));
    setText('tt-2sigma',      formatUSD(lower2) + ' – ' + formatUSD(upper2));

    // Colour the trend card based on how far out we are
    const trendEl = document.getElementById('tt-trend');
    if (trendEl) {
      trendEl.className = 'stat-value';
      if (ageMultiplier >= 1.5) trendEl.classList.add('green');
    }
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /* -------------------------------------------------------- render / update ------------------------------------------------- */
  function renderChart() {
    const ctx = document.getElementById('tt-chart').getContext('2d');
    ttChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: buildDatasets() },
      options: buildOptions()
    });
  }

  function updateChart() {
    if (!ttChart) return;
    ttChart.data.datasets = buildDatasets();
    ttChart.options = buildOptions();
    ttChart.update('none');   // 'none' skips transition for smoothness
    updateStats();
    // Keep the slider thumb in sync
    document.getElementById('tt-slider').value = ageMultiplier;
    document.getElementById('tt-slider-label').textContent = ageMultiplier.toFixed(2) + '×';
  }

  /* -------------------------------------------------------- play / pause animation ------------------------------------------ */
  function startPlay() {
    if (playing) return;
    playing = true;
    document.getElementById('tt-play-btn').textContent = 'Pause';

    // If we're already at the end, reset to 1×
    if (ageMultiplier >= AGE_MAX - 0.005) {
      ageMultiplier = AGE_MIN;
      updateChart();
    }

    let lastTime = performance.now();
    const DURATION = 6000; // 6 seconds for full sweep 1× → 3×

    function tick(now) {
      if (!playing) return;
      const elapsed = now - lastTime;
      lastTime = now;

      ageMultiplier += (AGE_MAX - AGE_MIN) * (elapsed / DURATION);

      if (ageMultiplier >= AGE_MAX) {
        ageMultiplier = AGE_MAX;
        updateChart();
        stopPlay();
        return;
      }

      updateChart();
      animFrame = requestAnimationFrame(tick);
    }

    animFrame = requestAnimationFrame(tick);
  }

  function stopPlay() {
    playing = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    document.getElementById('tt-play-btn').textContent = 'Play';
  }

  /* -------------------------------------------------------- wiring ----------------------------------------------------------- */
  function setupControls() {
    // Slider
    const slider = document.getElementById('tt-slider');
    slider.addEventListener('input', () => {
      stopPlay();   // manual drag kills autoplay
      ageMultiplier = parseFloat(slider.value);
      updateChart();
    });

    // Play / Pause
    document.getElementById('tt-play-btn').addEventListener('click', () => {
      if (playing) stopPlay();
      else         startPlay();
    });

    // Reset
    document.getElementById('tt-reset-btn').addEventListener('click', () => {
      stopPlay();
      ageMultiplier = AGE_MIN;
      updateChart();
    });

  }

  /* -------------------------------------------------------- init ---------------------------------------------------------------- */
  async function init() {
    try {
      await ensureData();

      // Derive "now"
      nowDate  = weeklyData[weeklyData.length - 1].date;
      nowDays  = PowerLaw.daysSinceGenesis(nowDate);

      computeSigma();
      renderChart();
      updateStats();
      setupControls();
    } catch (err) {
      console.error('Time Travel init failed:', err);
    }
  }

  // Wait until the DOM + Chart.js are ready, then init.
  window.addEventListener('load', init);
})();
