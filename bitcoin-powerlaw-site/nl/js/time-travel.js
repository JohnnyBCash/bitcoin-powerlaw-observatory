// Bitcoin Machtswet Observatorium – Tijdreizen Visualisatie
// "Wat gebeurt er als Bitcoin 50% ouder wordt? Wat als de leeftijd verdubbelt?"
// Een log-log grafiek met historische prijs + trendcorridor, plus een verschuifbare
// toekomstprojectie die de leeftijdsmultiplicator van 1× naar 3× schuift.

(function () {
  'use strict';

  /* -------------------------------------------------------- configuratie ------------------------------------------------- */
  const AGE_MIN = 1.0;   // 1× = vandaag
  const AGE_MAX = 3.0;   // 3× huidige leeftijd
  const STEP    = 0.01;  // schuifregelaar granulariteit

  // Hoeveel extra punten te tekenen voorbij "nu" voor de geprojecteerde lijnen
  const FUTURE_POINTS = 60;

  /* -------------------------------------------------------- status ------------------------------------------------------- */
  let weeklyData   = [];     // [{date: Date, price: number}]  – geladen uit btc_historical.json
  let ttChart      = null;
  let currentModel = 'santostasi';
  let sigma        = 0;
  let ageMultiplier = 1.0;
  let playing      = false;
  let animFrame    = null;

  // Eenmalig afgeleid na laden data
  let nowDays      = 0;    // dagen sinds genesis VANDAAG (einde van data)
  let nowDate      = null;

  /* -------------------------------------------------------- gedeelde data ophalen ---------------------------------------- */
  // Dagelijkse historische data laden uit btc_historical.json (zelfde dataset als future.js).
  // Downsamplen naar wekelijks voor grafiekprestaties.
  async function ensureData() {
    const res  = await fetch('../../datasets/btc_historical.json');
    const data = await res.json();

    // Downsample dagelijks → wekelijks (elk 7e punt) om de grafiek snel te houden
    for (let i = 0; i < data.length; i += 7) {
      const d = data[i];
      weeklyData.push({
        date:  new Date(d.date + 'T00:00:00Z'),
        price: d.price
      });
    }
    // Altijd het allerlaatste datapunt opnemen
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

  /* -------------------------------------------------------- sigma -------------------------------------------------------- */
  function computeSigma() {
    const hist = weeklyData.map(w => ({
      date:  w.date.toISOString().slice(0, 10),
      price: w.price
    }));
    sigma = PowerLaw.calculateSigma(hist, currentModel).sigma;
  }

  /* -------------------------------------------------------- opmaak ------------------------------------------------------- */
  function formatUSD(n) {
    if (n >= 1e6)  return '$' + (n / 1e6).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e3)  return '$' + n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
    if (n >= 1)    return '$' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '$' + n.toLocaleString('nl-NL', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function fmtDate(d) {
    return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Gegeven een aantal dagen sinds genesis, retourneer de kalenderdatum
  function dateFromDays(days) {
    return new Date(PowerLaw.GENESIS.getTime() + days * 86400000);
  }

  /* -------------------------------------------------------- datasets bouwen ---------------------------------------------- */
  function buildDatasets() {
    const targetDays = nowDays * ageMultiplier;

    // ── historische prijs (alleen tot nowDays) ──
    const priceData = weeklyData.map(w => ({
      x: PowerLaw.daysSinceGenesis(w.date),
      y: w.price
    }));

    // ── gelijkmatig verdeelde x-punten genereren van eerste datapunt tot targetDays
    //    (dekt zowel historisch als geprojecteerd bereik voor trend / banden)
    const firstDays = PowerLaw.daysSinceGenesis(weeklyData[0].date);
    const allX      = [];
    // Gebruik eerst de historische x-punten voor nauwkeurigheid door bekende data
    for (const w of weeklyData) {
      allX.push(PowerLaw.daysSinceGenesis(w.date));
    }
    // Vervolgens uitbreiden naar de toekomst met FUTURE_POINTS gelijkmatig verdeeld
    if (ageMultiplier > 1.0) {
      const step = (targetDays - nowDays) / FUTURE_POINTS;
      for (let i = 1; i <= FUTURE_POINTS; i++) {
        allX.push(nowDays + step * i);
      }
    }

    // ── trend + banden over het volledige x-bereik ──
    const trendData  = allX.map(d => ({ x: d, y: PowerLaw.trendPrice(currentModel, dateFromDays(d)) }));
    const upper1Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma,  1, dateFromDays(d)) }));
    const lower1Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma, -1, dateFromDays(d)) }));
    const upper2Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma,  2, dateFromDays(d)) }));
    const lower2Data = allX.map(d => ({ x: d, y: PowerLaw.bandPrice(currentModel, sigma, -2, dateFromDays(d)) }));

    // ── "Nu" verticale lijn – enkelpunt-scatter met een groot bereik ──
    // We faken een verticale lijn door twee punten te tekenen met dezelfde x op yMin / yMax.
    // Gebruik een scatter-dataset met showLine: true.
    const yMin = 100;  // veilig onder elke BTC-prijs op logschaal
    const yMax = PowerLaw.bandPrice(currentModel, sigma, 2, dateFromDays(targetDays)) * 2;
    const nowLine = [
      { x: nowDays, y: yMin },
      { x: nowDays, y: yMax }
    ];

    // ── "Toekomst" verticale lijn (alleen getoond wanneer leeftijd > 1) ──
    const futureLine = ageMultiplier > 1.001
      ? [{ x: targetDays, y: yMin }, { x: targetDays, y: yMax }]
      : [];

    // ── Toekomstig doelpunt (trendprijs bij doelleeftijd) ──
    const futureTrend = PowerLaw.trendPrice(currentModel, dateFromDays(targetDays));
    const futureDot = [{ x: targetDays, y: futureTrend }];

    // ── datasets (volgorde is belangrijk voor vul-indices) ──
    // [0] +2σ   vul→1
    // [1] +1σ   vul→2
    // [2] trend
    // [3] -1σ   vul→2
    // [4] -2σ   vul→3
    // [5] prijs (zwarte lijn, geen vulling)
    // [6] "Nu" verticaal
    // [7] "Toekomst" verticaal
    // [8] toekomstig doelpunt

    return [
      {
        label: '+2\u03C3',
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
        label: '+1\u03C3',
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
        label: 'Machtswettrend',
        data: trendData,
        borderColor: '#F7931A',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0,
        fill: false
      },
      {
        label: '-1\u03C3',
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
        label: '-2\u03C3',
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
        label: 'BTC Prijs (werkelijk)',
        data: priceData,
        borderColor: '#000000',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        fill: false
      },
      {
        // "Nu" verticale stippellijn
        label: 'Nu',
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
        // "Toekomst" verticale stippellijn
        label: 'Leeftijd ' + ageMultiplier.toFixed(2) + '\u00D7',
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
        // Groot punt bij toekomstige trendprijs
        label: 'Trend bij ' + ageMultiplier.toFixed(2) + '\u00D7',
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

  /* -------------------------------------------------------- grafiekopties ------------------------------------------------ */
  function buildOptions() {
    const targetDays = nowDays * ageMultiplier;

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },   // we animeren via schuifregelaar; schakel Chart.js interne animatie uit
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Dagen Sinds Genesis (log)', font: { weight: 'bold' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          min: PowerLaw.daysSinceGenesis(weeklyData[0].date) * 0.9,
          max: targetDays * 1.05,
          ticks: {
            callback: function (value) {
              if (value >= 365) return (value / 365).toFixed(0) + 'j';
              return value + 'd';
            }
          }
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Prijs USD (log)', font: { weight: 'bold' } },
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
              return fmtDate(dateFromDays(x)) + '  (' + (x / 365).toFixed(1) + 'j)';
            },
            label: function (ctx) {
              return ctx.dataset.label + ': ' + formatUSD(ctx.parsed.y);
            }
          }
        }
      }
    };
  }

  /* -------------------------------------------------------- statistieken bijwerken --------------------------------------- */
  function updateStats() {
    const targetDays   = nowDays * ageMultiplier;
    const targetDate   = dateFromDays(targetDays);
    const trendAtTarget = PowerLaw.trendPrice(currentModel, targetDate);
    const upper1        = PowerLaw.bandPrice(currentModel, sigma,  1, targetDate);
    const lower1        = PowerLaw.bandPrice(currentModel, sigma, -1, targetDate);
    const upper2        = PowerLaw.bandPrice(currentModel, sigma,  2, targetDate);
    const lower2        = PowerLaw.bandPrice(currentModel, sigma, -2, targetDate);

    setText('tt-multiplier',  ageMultiplier.toFixed(2).replace('.', ',') + '\u00D7');
    setText('tt-date',        fmtDate(targetDate));
    setText('tt-trend',       formatUSD(trendAtTarget));
    setText('tt-1sigma',      formatUSD(lower1) + ' \u2013 ' + formatUSD(upper1));
    setText('tt-2sigma',      formatUSD(lower2) + ' \u2013 ' + formatUSD(upper2));

    // Kleur de trendkaart op basis van hoe ver we in de toekomst zijn
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

  /* -------------------------------------------------------- weergeven / bijwerken ---------------------------------------- */
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
    ttChart.update('none');   // 'none' slaat overgang over voor vloeiendheid
    updateStats();
    // Houd de schuifregelaar synchroon
    document.getElementById('tt-slider').value = ageMultiplier;
    document.getElementById('tt-slider-label').textContent = ageMultiplier.toFixed(2).replace('.', ',') + '\u00D7';
  }

  /* -------------------------------------------------------- afspelen / pauze animatie ------------------------------------ */
  function startPlay() {
    if (playing) return;
    playing = true;
    document.getElementById('tt-play-btn').textContent = 'Pauze';

    // Als we al aan het einde zijn, reset naar 1×
    if (ageMultiplier >= AGE_MAX - 0.005) {
      ageMultiplier = AGE_MIN;
      updateChart();
    }

    let lastTime = performance.now();
    const DURATION = 6000; // 6 seconden voor volledige sweep 1× → 3×

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
    document.getElementById('tt-play-btn').textContent = 'Afspelen';
  }

  /* -------------------------------------------------------- bedrading ---------------------------------------------------- */
  function setupControls() {
    // Schuifregelaar
    const slider = document.getElementById('tt-slider');
    slider.addEventListener('input', () => {
      stopPlay();   // handmatig slepen stopt autoplay
      ageMultiplier = parseFloat(slider.value);
      updateChart();
    });

    // Afspelen / Pauze
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

  /* -------------------------------------------------------- initialisatie ------------------------------------------------ */
  async function init() {
    try {
      await ensureData();

      // "Nu" afleiden
      nowDate  = weeklyData[weeklyData.length - 1].date;
      nowDays  = PowerLaw.daysSinceGenesis(nowDate);

      computeSigma();
      renderChart();
      updateStats();
      setupControls();
    } catch (err) {
      console.error('Tijdreizen initialisatie mislukt:', err);
    }
  }

  // Wacht tot de DOM + Chart.js gereed zijn, dan initialiseren.
  window.addEventListener('load', init);
})();
