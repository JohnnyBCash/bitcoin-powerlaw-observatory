// Bitcoin Pensioen — UI Bridge
// Wires mockup inputs to the real PowerLaw + RetirementV2 engines
(function() {
  'use strict';

  var PL = window.PowerLaw;
  var R  = window.Retirement;
  var V2 = window.RetirementV2;

  var currentModel = 'santostasi';
  var calculatedSigma = 0.2;

  // Live price state
  var livePrice = null;      // USD
  var livePriceEUR = null;    // EUR (direct from CoinGecko)
  var eurRate = null;         // EUR per 1 USD

  var AOW_AGE = 67;

  // ── DOM Helpers ─────────────────────────────────────────────
  var $ = function(id) { return document.getElementById(id); };

  function parseNum(id) {
    var el = $(id);
    if (!el) return 0;
    var v = el.value.replace(/[^0-9.,]/g, '').replace(',', '.');
    return parseFloat(v) || 0;
  }

  function fmtEUR(val) {
    if (val >= 1e6) return '\u20AC' + (val / 1e6).toFixed(1) + 'M';
    return '\u20AC' + Math.round(val).toLocaleString('nl-NL');
  }

  function fmtBTC(btc) {
    if (btc >= 10) return btc.toFixed(1);
    if (btc >= 1) return btc.toFixed(2);
    if (btc >= 0.01) return btc.toFixed(2);
    return btc.toFixed(4);
  }

  // Create a text element safely
  function makeEl(tag, text, className) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  // Build a span sequence like "text <strong>bold</strong> text <strong>bold</strong> text"
  // segments: [{text:'...'}, {bold:'...'}, {text:'...'}, ...]
  function buildSegments(parent, segments) {
    parent.textContent = '';
    segments.forEach(function(seg) {
      if (seg.bold !== undefined) {
        var strong = document.createElement('strong');
        strong.textContent = seg.bold;
        parent.appendChild(strong);
      } else if (seg.text !== undefined) {
        parent.appendChild(document.createTextNode(seg.text));
      }
    });
  }

  // ── Data Fetching ───────────────────────────────────────────
  function fetchLiveData() {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.bitcoin) {
          livePrice = data.bitcoin.usd;
          livePriceEUR = data.bitcoin.eur;
          if (data.bitcoin.usd && data.bitcoin.eur) {
            eurRate = data.bitcoin.eur / data.bitcoin.usd;
          }
          renderNavPrice();
          renderTrendIndicator();
          runCalculation();
        }
      })
      .catch(function() {
        // Fallback: use trend price and estimated EUR rate
        livePrice = PL.trendPrice(currentModel, new Date());
        eurRate = 0.92;
        livePriceEUR = livePrice * eurRate;
        renderNavPrice();
        runCalculation();
      });
  }

  function renderNavPrice() {
    var el = $('pen-nav-price-text');
    if (!el || !livePriceEUR) return;
    el.textContent = 'BTC ' + fmtEUR(livePriceEUR);
  }

  // ── Trend Indicator ─────────────────────────────────────────
  function renderTrendIndicator() {
    var container = $('pen-trend');
    var textEl = $('pen-trend-text');
    var dotEl = container ? container.querySelector('.trend-dot') : null;
    if (!container || !textEl || !dotEl || !livePrice) return;

    var sigmaK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    var pctOff = Math.abs(Math.round((Math.pow(10, sigmaK * calculatedSigma) - 1) * 100));

    if (sigmaK < 0) {
      container.className = 'trend-indicator';
      dotEl.className = 'trend-dot under';
      buildSegments(textEl, [
        { text: 'Bitcoin staat ' },
        { bold: pctOff + '% onder' },
        { text: ' de power law trendlijn \u2014 historisch gezien een gunstig instapmoment' }
      ]);
    } else {
      container.className = 'trend-indicator over';
      dotEl.className = 'trend-dot over';
      buildSegments(textEl, [
        { text: 'Bitcoin staat ' },
        { bold: pctOff + '% boven' },
        { text: ' de power law trendlijn' }
      ]);
    }
  }

  // ── Gather Parameters ───────────────────────────────────────
  function getParams(retirementAge, stackOverride) {
    var age = parseInt($('pen-age').value) || 38;
    var burnEUR = parseNum('pen-burn');
    var reduce = parseInt($('pen-reduce').value) || 0;
    var growth = (parseFloat(($('pen-growth').value || '6').replace(',', '.')) || 6) / 100;
    var life = parseInt($('pen-life').value) || 100;

    // Convert EUR burn to USD
    var rate = eurRate || 0.92;
    var burnUSD = burnEUR / rate;
    var adjustedBurn = burnUSD * (1 - reduce / 100);

    // Build BTC stack: existing + lump sum investment
    var existingBtc = parseNum('pen-stack');
    var investEUR = parseInt($('pen-invest').value) || 0;
    var investBtc = (livePriceEUR && livePriceEUR > 0) ? investEUR / livePriceEUR : 0;
    var totalStack = stackOverride !== undefined ? stackOverride : (existingBtc + investBtc);

    // Scenario: cyclical with live price calibration
    var scenarioMode = 'cyclical';
    var initialK = null;
    if (livePrice) {
      initialK = R.currentSigmaK(currentModel, calculatedSigma, livePrice);
    }

    return {
      currentAge: age,
      retirementAge: retirementAge || age,
      lifeExpectancy: life,
      annualBurn: adjustedBurn,
      burnGrowth: growth,
      myStack: totalStack,
      model: currentModel,
      sigma: calculatedSigma,
      scenarioMode: scenarioMode,
      initialK: initialK
    };
  }

  // ── DCA Projection ──────────────────────────────────────────
  function estimateDCABtc(params, targetAge, dcaEUR) {
    if (dcaEUR <= 0) return 0;
    var rate = eurRate || 0.92;
    var monthlyUSD = dcaEUR / rate;
    var yearsToTarget = targetAge - params.currentAge;
    if (yearsToTarget <= 0) return 0;
    var totalMonths = yearsToTarget * 12;
    var currentYear = new Date().getFullYear();
    var currentMonth = new Date().getMonth();

    var extraBTC = 0;
    for (var m = 0; m < totalMonths; m++) {
      var date = new Date(currentYear, currentMonth + m, 15);
      var yearOffset = m / 12;
      var effectiveK = R.resolveScenarioK(params.scenarioMode, yearOffset, params.initialK);
      var price = R.scenarioPrice(params.model, date, params.sigma, effectiveK);
      if (price > 0) extraBTC += monthlyUSD / price;
    }
    return extraBTC;
  }

  // ── Find Earliest Retirement Age ────────────────────────────
  function findRetirementAge() {
    var baseParams = getParams();
    var dcaEUR = parseNum('pen-dca');
    var existingBtc = parseNum('pen-stack');
    var investEUR = parseInt($('pen-invest').value) || 0;
    var investBtc = (livePriceEUR && livePriceEUR > 0) ? investEUR / livePriceEUR : 0;
    var baseStack = existingBtc + investBtc;

    var bestAge = null;
    var bestResult = null;

    for (var candidateAge = baseParams.currentAge; candidateAge <= 80; candidateAge++) {
      var dcaBtc = estimateDCABtc(baseParams, candidateAge, dcaEUR);
      var totalStack = baseStack + dcaBtc;

      var params = getParams(candidateAge, totalStack);
      var result = V2.computeLifetimeBTC(params);

      if (!result) continue;

      if (result.canRetireNow) {
        bestAge = candidateAge;
        bestResult = result;
        break;
      }
    }

    return { retireAge: bestAge, result: bestResult };
  }

  // ── Main Calculation ────────────────────────────────────────
  var debounceTimer = null;

  function scheduleCalculation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runCalculation, 150);
  }

  function runCalculation() {
    if (!livePrice && !eurRate) return;

    var found = findRetirementAge();
    var retireAge = found.retireAge;
    var result = found.result;

    updateInvestDisplay();
    updateReduceDisplay();

    renderVerdict(retireAge, result);
    renderBars(result);
    renderStormForever(retireAge, result);
    renderInsight(result);
  }

  // ── Display Updates ─────────────────────────────────────────
  function updateInvestDisplay() {
    var investEUR = parseInt($('pen-invest').value) || 0;
    $('pen-invest-val').textContent = fmtEUR(investEUR);

    var investBtc = (livePriceEUR && livePriceEUR > 0) ? investEUR / livePriceEUR : 0;
    $('pen-invest-btc').textContent = '\u2248 ' + investBtc.toFixed(2) + ' BTC tegen huidige koers';
  }

  function updateReduceDisplay() {
    var reduce = parseInt($('pen-reduce').value) || 0;
    $('pen-reduce-val').textContent = reduce + '%';
  }

  // ── Verdict Rendering ───────────────────────────────────────
  function renderVerdict(retireAge, result) {
    var badge = $('pen-verdict-badge');
    var badgeText = $('pen-badge-text');
    var title = $('pen-verdict-title');
    var sub = $('pen-verdict-sub');
    var saved = $('pen-comp-saved');
    var age = parseInt($('pen-age').value) || 38;

    if (!retireAge || !result) {
      badge.className = 'verdict-badge risk';
      badgeText.textContent = 'Meer nodig';
      title.textContent = 'Verhoog je inleg';
      sub.textContent = 'Met deze input kun je niet voor je 80e stoppen';
      saved.textContent = 'Op AOW-leeftijd';
      return;
    }

    var yearsSaved = AOW_AGE - retireAge;
    var yearsToGo = retireAge - age;

    if (retireAge <= age) {
      badge.className = 'verdict-badge good';
      badgeText.textContent = 'Nu al vrij';
    } else if (yearsSaved >= 15) {
      badge.className = 'verdict-badge good';
      badgeText.textContent = 'Uitstekend';
    } else if (yearsSaved >= 5) {
      badge.className = 'verdict-badge close';
      badgeText.textContent = 'Goed op weg';
    } else if (yearsSaved > 0) {
      badge.className = 'verdict-badge close';
      badgeText.textContent = 'Bijna';
    } else {
      badge.className = 'verdict-badge risk';
      badgeText.textContent = 'Meer nodig';
    }

    if (retireAge <= age) {
      title.textContent = 'Je kunt nu al stoppen!';
    } else {
      title.textContent = 'Stoppen op je ' + retireAge + 'e';
    }

    if (retireAge <= age) {
      sub.textContent = 'Je hebt genoeg \u2014 geniet ervan';
    } else if (yearsToGo <= 3) {
      sub.textContent = 'Nog ' + yearsToGo + ' jaar \u2014 bijna vrij';
    } else {
      sub.textContent = 'Nog ' + yearsToGo + ' jaar \u2014 of verhoog je inleg';
    }

    if (yearsSaved > 0) {
      saved.textContent = yearsSaved + ' jaar eerder';
    } else {
      saved.textContent = 'Op AOW-leeftijd';
    }
  }

  // ── Bar Chart Rendering ─────────────────────────────────────
  function renderBars(result) {
    var container = $('pen-bars');
    if (!container) return;
    container.textContent = '';

    if (!result || !result.fiveYearData || result.fiveYearData.length === 0) {
      var msg = makeEl('div', 'Pas je inleg aan om periodes te zien');
      msg.style.cssText = 'text-align:center;color:var(--muted);padding:40px 0;font-size:13px;';
      container.appendChild(msg);
      return;
    }

    var data = result.fiveYearData;
    var maxBtc = Math.max.apply(null, data.map(function(d) { return d.btcNeeded; }));

    data.forEach(function(d) {
      var group = makeEl('div', null, 'period-bar-group');

      var track = makeEl('div', null, 'period-bar-track');
      var fill = makeEl('div', null, 'period-bar-fill ' + (d.phase === 'storm' ? 'storm-fill' : 'forever-fill'));
      var pct = maxBtc > 0 ? Math.max(1, (d.btcNeeded / maxBtc) * 100) : 1;
      fill.style.height = pct + '%';
      track.appendChild(fill);
      group.appendChild(track);

      var val = makeEl('div', d.btcNeeded < 0.005 ? '<0.01' : d.btcNeeded.toFixed(2), 'period-bar-value');
      group.appendChild(val);

      var label = makeEl('div', d.startAge + '\u2013' + d.endAge, 'period-bar-label');
      group.appendChild(label);

      container.appendChild(group);
    });
  }

  // ── Storm & Forever Rendering ───────────────────────────────
  function renderStormForever(retireAge, result) {
    if (!result || !retireAge) {
      $('pen-storm-btc').textContent = '\u2014';
      $('pen-storm-detail').textContent = '\u00A0';
      $('pen-forever-btc').textContent = '\u2014';
      $('pen-forever-detail').textContent = '\u00A0';
      return;
    }

    var life = parseInt($('pen-life').value) || 100;
    var stormEndAge = result.stormEndAge || (retireAge + result.stormYears);

    $('pen-storm-btc').textContent = fmtBTC(result.stormBTC) + ' \u20BF';
    $('pen-storm-detail').textContent = 'Leeftijd ' + retireAge + '\u2013' + stormEndAge + ' \u00b7 ' + result.stormYears + ' jaar';

    $('pen-forever-btc').textContent = fmtBTC(result.foreverBTC) + ' \u20BF';
    $('pen-forever-detail').textContent = 'Leeftijd ' + stormEndAge + '\u2013' + life + ' \u00b7 Onuitputtelijk';
  }

  // ── Insight Text ────────────────────────────────────────────
  function renderInsight(result) {
    var el = $('pen-insight-text');
    if (!el) return;

    if (!result) {
      el.textContent = '\u00A0';
      return;
    }

    var stormPct = result.totalBTC > 0
      ? Math.round((result.stormBTC / result.totalBTC) * 100)
      : 0;

    buildSegments(el, [
      { bold: stormPct + '%' },
      { text: ' van al je Bitcoin wordt in de eerste ' },
      { bold: result.stormYears + ' jaar' },
      { text: ' uitgegeven. Daarna maakt de power law je stack praktisch onuitputtelijk.' }
    ]);
  }

  // ── Input Listeners ─────────────────────────────────────────
  function setupListeners() {
    var inputs = ['pen-age', 'pen-burn', 'pen-stack', 'pen-dca', 'pen-life', 'pen-growth'];
    inputs.forEach(function(id) {
      var el = $(id);
      if (el) el.addEventListener('input', scheduleCalculation);
    });

    var sliders = ['pen-invest', 'pen-reduce'];
    sliders.forEach(function(id) {
      var el = $(id);
      if (el) el.addEventListener('input', scheduleCalculation);
    });

    // More options toggle
    var moreBtn = $('pen-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', function() {
        var extra = $('pen-extra');
        if (extra) extra.classList.toggle('visible');
        moreBtn.classList.toggle('open');
      });
    }
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    setupListeners();
    updateInvestDisplay();
    updateReduceDisplay();
    fetchLiveData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
