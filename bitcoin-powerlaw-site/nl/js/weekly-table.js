// Bitcoin Machtswet Observatorium - Wekelijkse Geschiedenistabel (NL)
// Toont wekelijkse historische data met intuitieve log-afwijking visualisatie
// Gebruikt Santostasi/Perrenod machtswetmodel

(function() {
  'use strict';

  // Configuratie
  const CONFIG = {
    jsonPath: '../../weekly_history.json',  // Relatief ten opzichte van nl/pages/
    maxLogDev: 1.2,  // Max log afwijking voor balkschaling (dekt historische extremen)
    minLogDev: -0.5  // Min log afwijking voor balkschaling
  };

  // Huidig model selectie
  let currentModel = 'santostasi';

  // Log afwijking drempels en labels
  const LOG_DEV_ZONES = [
    { max: -0.30, label: 'Diepe Waarde', class: 'extreme-under', action: 'Sterk accumuleren / fiat lenen' },
    { max: -0.15, label: 'Ondergewaardeerd', class: 'under', action: 'Accumuleren' },
    { max: 0.10, label: 'Eerlijke Waarde', class: 'fair', action: 'Houden' },
    { max: 0.30, label: 'Overgewaardeerd', class: 'over', action: 'Overweeg winst te nemen' },
    { max: Infinity, label: 'Zeepbel', class: 'extreme-over', action: 'Sterk verkoopsignaal' }
  ];

  // Zone-info ophalen voor een log-afwijkingswaarde
  function getLogDevZone(logDev) {
    for (const zone of LOG_DEV_ZONES) {
      if (logDev <= zone.max) return zone;
    }
    return LOG_DEV_ZONES[LOG_DEV_ZONES.length - 1];
  }

  // Prijs formatteren voor weergave
  function formatPrice(price) {
    if (price >= 1000000) {
      return '$' + (price / 1000000).toFixed(2) + 'M';
    } else if (price >= 1000) {
      return '$' + price.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
    } else if (price >= 1) {
      return '$' + price.toFixed(2);
    } else {
      return '$' + price.toFixed(4);
    }
  }

  // Datum formatteren voor weergave
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Log afwijking formatteren voor weergave
  function formatLogDev(logDev) {
    const sign = logDev >= 0 ? '+' : '';
    return sign + logDev.toFixed(3);
  }

  // Balkbreedte percentage berekenen (0-50% aan elke kant van het midden)
  function getBarWidth(logDev) {
    const absLogDev = Math.abs(logDev);
    const maxRange = Math.max(Math.abs(CONFIG.maxLogDev), Math.abs(CONFIG.minLogDev));
    const percentage = Math.min(absLogDev / maxRange, 1) * 48; // 48% max om ruimte te laten voor middenlijn
    return percentage;
  }

  // Controleren of datum binnen de huidige week valt
  function isCurrentWeek(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date >= weekAgo && date <= now;
  }

  // Modelwaarden ophalen (Santostasi/Perrenod voorberekend uit JSON)
  function getModelValues(item) {
    return {
      trend: item.trend_sp,
      multiple: item.multiple_sp,
      logDev: item.log_dev_sp
    };
  }

  // Een enkele rij renderen
  function renderRow(item, isFirst) {
    const values = getModelValues(item);
    const zone = getLogDevZone(values.logDev);
    const barWidth = getBarWidth(values.logDev);
    const isUnder = values.logDev < 0;
    const multipleClass = values.multiple < 0.8 ? 'under' : (values.multiple > 1.2 ? 'over' : 'fair');
    const currentWeekClass = isFirst ? 'current-week' : '';

    return `
      <tr class="${currentWeekClass}">
        <td>${formatDate(item.date)}</td>
        <td>${formatPrice(item.close)}</td>
        <td>${formatPrice(values.trend)}</td>
        <td class="multiple-cell ${multipleClass}">${values.multiple.toFixed(3)}x</td>
        <td class="log-dev-cell">
          <div class="log-dev-bar-container">
            <div class="log-dev-bar">
              <div class="log-dev-bar-center"></div>
              <div class="log-dev-bar-fill ${isUnder ? 'under' : 'over'}"
                   style="width: ${barWidth}%;">
              </div>
            </div>
            <span class="log-dev-value ${isUnder ? 'under' : (values.logDev > 0.1 ? 'over' : 'fair')}">${formatLogDev(values.logDev)}</span>
          </div>
        </td>
        <td><span class="log-dev-label ${zone.class}">${zone.label}</span></td>
      </tr>
    `;
  }

  // Data filteren op jaar
  function filterByYear(data, year) {
    if (year === 'all') return data;
    return data.filter(item => item.date.startsWith(year));
  }

  // Data doorzoeken
  function searchData(data, query) {
    if (!query) return data;
    const q = query.toLowerCase();
    return data.filter(item => {
      return item.date.includes(q) ||
             formatPrice(item.close).toLowerCase().includes(q);
    });
  }

  // Hoofdinitialisatie
  async function initWeeklyTable() {
    const container = document.getElementById('weekly-table-container');
    if (!container) {
      console.log('Wekelijkse tabelcontainer niet gevonden');
      return;
    }

    try {
      const response = await fetch(CONFIG.jsonPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let data = await response.json();

      // Sorteren op datum aflopend (nieuwste eerst)
      data.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Unieke jaren ophalen voor snelle navigatie
      const years = [...new Set(data.map(d => d.date.substring(0, 4)))].sort().reverse();

      // Bedieningselementen renderen
      const controlsHtml = `
        <div class="weekly-table-controls">
          <input type="text" class="weekly-table-search" id="weekly-search"
                 placeholder="Zoek op datum of prijs...">
          <div class="quick-jump-btns">
            <button class="quick-jump-btn" data-year="all">Alles</button>
            ${years.slice(0, 6).map(y => `<button class="quick-jump-btn" data-year="${y}">${y}</button>`).join('')}
          </div>
        </div>
      `;

      // Tabel renderen
      function renderTable() {
        return `
        <div class="weekly-table-wrapper">
          <table id="weekly-history-table">
            <thead>
              <tr>
                <th>Weekslot</th>
                <th>Slotkoers</th>
                <th id="trend-header">Trend</th>
                <th>Veelvoud</th>
                <th>
                  Log Afwijking
                  <span class="log-dev-info" data-tooltip="Log afwijking = log\u2081\u2080(prijs/trend). Nul betekent eerlijke waarde. Negatief = ondergewaardeerd, positief = overgewaardeerd. Een waarde van -0,3 betekent dat de prijs ~50% onder de trend is; +0,3 betekent ~100% boven de trend.">?</span>
                </th>
                <th>Zone</th>
              </tr>
            </thead>
            <tbody id="weekly-table-body">
            </tbody>
          </table>
        </div>
      `;
      }

      const tableHtml = renderTable();

      container.innerHTML = controlsHtml + tableHtml;

      // Event listeners toevoegen
      const searchInput = document.getElementById('weekly-search');
      const tbody = document.getElementById('weekly-table-body');
      const trendHeader = document.getElementById('trend-header');
      let currentYear = 'all';

      function updateTable() {
        let filtered = filterByYear(data, currentYear);
        filtered = searchData(filtered, searchInput.value);
        tbody.innerHTML = filtered.map((item, i) => renderRow(item, i === 0 && currentYear === 'all')).join('');
      }

      // Eerste tabelvulling
      updateTable();

      searchInput.addEventListener('input', updateTable);

      document.querySelectorAll('.quick-jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.quick-jump-btn').forEach(b => b.style.borderColor = '');
          btn.style.borderColor = 'var(--orange)';
          currentYear = btn.dataset.year;
          updateTable();
        });
      });

    } catch (error) {
      console.error('Wekelijkse geschiedenis laden mislukt:', error);
      container.innerHTML = '<p style="color: var(--red);">Wekelijkse geschiedenisdata laden mislukt.</p>';
    }
  }

  // Initialiseren wanneer DOM gereed is
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeeklyTable);
  } else {
    initWeeklyTable();
  }
})();
