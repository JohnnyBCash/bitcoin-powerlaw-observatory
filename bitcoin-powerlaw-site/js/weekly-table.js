// Bitcoin Power Law Observatory - Weekly History Table
// Displays weekly historical data with intuitive log deviation visualization
// Supports toggle between Santostasi/Perrenod and Krueger/Sigman models

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    jsonPath: '../weekly_history.json',  // Relative to pages/
    maxLogDev: 1.2,  // Max log deviation for bar scaling (covers historical extremes)
    minLogDev: -0.5  // Min log deviation for bar scaling
  };

  // Current model selection
  let currentModel = 'santostasi'; // 'santostasi' or 'krueger'

  // Log deviation thresholds and labels
  const LOG_DEV_ZONES = [
    { max: -0.30, label: 'Deep Value', class: 'extreme-under', action: 'Strong accumulate / borrow fiat' },
    { max: -0.15, label: 'Undervalued', class: 'under', action: 'Accumulate' },
    { max: 0.10, label: 'Fair Value', class: 'fair', action: 'Hold' },
    { max: 0.30, label: 'Overvalued', class: 'over', action: 'Consider taking profits' },
    { max: Infinity, label: 'Extreme', class: 'extreme-over', action: 'Strong sell signal' }
  ];

  // Get zone info for a log deviation value
  function getLogDevZone(logDev) {
    for (const zone of LOG_DEV_ZONES) {
      if (logDev <= zone.max) return zone;
    }
    return LOG_DEV_ZONES[LOG_DEV_ZONES.length - 1];
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

  // Format date for display
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Format log deviation for display
  function formatLogDev(logDev) {
    const sign = logDev >= 0 ? '+' : '';
    return sign + logDev.toFixed(3);
  }

  // Calculate bar width percentage (0-50% on each side of center)
  function getBarWidth(logDev) {
    const absLogDev = Math.abs(logDev);
    const maxRange = Math.max(Math.abs(CONFIG.maxLogDev), Math.abs(CONFIG.minLogDev));
    const percentage = Math.min(absLogDev / maxRange, 1) * 48; // 48% max to leave room for center line
    return percentage;
  }

  // Check if date is within current week
  function isCurrentWeek(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date >= weekAgo && date <= now;
  }

  // Calculate values for a given model
  function getModelValues(item) {
    if (currentModel === 'santostasi') {
      // Use pre-calculated values from JSON
      return {
        trend: item.trend_sp,
        multiple: item.multiple_sp,
        logDev: item.log_dev_sp
      };
    } else {
      // Calculate Krueger/Sigman values on-the-fly
      if (window.PowerLaw) {
        const trend = window.PowerLaw.trendPrice('krueger', new Date(item.date + 'T00:00:00Z'));
        const multiple = item.close / trend;
        const logDev = Math.log10(item.close / trend);
        return {
          trend: Math.round(trend * 100) / 100,
          multiple: Math.round(multiple * 1000) / 1000,
          logDev: Math.round(logDev * 1000) / 1000
        };
      }
      // Fallback to Santostasi if PowerLaw not loaded
      return {
        trend: item.trend_sp,
        multiple: item.multiple_sp,
        logDev: item.log_dev_sp
      };
    }
  }

  // Render a single row
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

  // Filter data by year
  function filterByYear(data, year) {
    if (year === 'all') return data;
    return data.filter(item => item.date.startsWith(year));
  }

  // Search data
  function searchData(data, query) {
    if (!query) return data;
    const q = query.toLowerCase();
    return data.filter(item => {
      return item.date.includes(q) ||
             formatPrice(item.close).toLowerCase().includes(q);
    });
  }

  // Main initialization
  async function initWeeklyTable() {
    const container = document.getElementById('weekly-table-container');
    if (!container) {
      console.log('Weekly table container not found');
      return;
    }

    try {
      const response = await fetch(CONFIG.jsonPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let data = await response.json();

      // Sort by date descending (newest first)
      data.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Get unique years for quick jump
      const years = [...new Set(data.map(d => d.date.substring(0, 4)))].sort().reverse();

      // Get model display name
      function getModelName() {
        return currentModel === 'santostasi' ? 'Perrenod/Santostasi' : 'Krueger/Sigman';
      }

      function getModelShortName() {
        return currentModel === 'santostasi' ? 'S/P' : 'K/S';
      }

      // Render controls
      const controlsHtml = `
        <div class="weekly-table-controls">
          <div class="model-toggle" id="weekly-model-toggle">
            <button class="toggle-btn ${currentModel === 'santostasi' ? 'active' : ''}" data-model="santostasi">Perrenod/Santostasi</button>
            <button class="toggle-btn ${currentModel === 'krueger' ? 'active' : ''}" data-model="krueger">Krueger/Sigman</button>
          </div>
          <input type="text" class="weekly-table-search" id="weekly-search"
                 placeholder="Search by date or price...">
          <div class="quick-jump-btns">
            <button class="quick-jump-btn" data-year="all">All</button>
            ${years.slice(0, 6).map(y => `<button class="quick-jump-btn" data-year="${y}">${y}</button>`).join('')}
          </div>
        </div>
      `;

      // Render table
      function renderTable() {
        return `
        <div class="weekly-table-wrapper">
          <table id="weekly-history-table">
            <thead>
              <tr>
                <th>Week Ending</th>
                <th>Close</th>
                <th id="trend-header">Trend (${getModelShortName()})</th>
                <th>Multiple</th>
                <th>
                  Log Deviation
                  <span class="log-dev-info" data-tooltip="Log deviation = log₁₀(price/trend). Zero means fair value. Negative = undervalued, positive = overvalued. A value of -0.3 means price is ~50% below trend; +0.3 means ~100% above trend.">?</span>
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

      // Add event listeners
      const searchInput = document.getElementById('weekly-search');
      const tbody = document.getElementById('weekly-table-body');
      const trendHeader = document.getElementById('trend-header');
      let currentYear = 'all';

      function updateTable() {
        let filtered = filterByYear(data, currentYear);
        filtered = searchData(filtered, searchInput.value);
        tbody.innerHTML = filtered.map((item, i) => renderRow(item, i === 0 && currentYear === 'all')).join('');
        // Update header to reflect current model
        if (trendHeader) {
          trendHeader.textContent = `Trend (${getModelShortName()})`;
        }
      }

      // Initial table population
      updateTable();

      searchInput.addEventListener('input', updateTable);

      // Model toggle event listeners
      document.querySelectorAll('#weekly-model-toggle .toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#weekly-model-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentModel = btn.dataset.model;
          updateTable();
        });
      });

      document.querySelectorAll('.quick-jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.quick-jump-btn').forEach(b => b.style.borderColor = '');
          btn.style.borderColor = 'var(--orange)';
          currentYear = btn.dataset.year;
          updateTable();
        });
      });

    } catch (error) {
      console.error('Failed to load weekly history:', error);
      container.innerHTML = '<p style="color: var(--red);">Failed to load weekly history data.</p>';
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeeklyTable);
  } else {
    initWeeklyTable();
  }
})();
