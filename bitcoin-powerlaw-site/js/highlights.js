// Bitcoin Power Law Observatory - Historical Highlights
// Loads and renders key historical deviation events

(async function initHighlights() {
  const tbody = document.querySelector('#highlights-table tbody');
  if (!tbody) {
    console.error('Highlights: tbody not found');
    return;
  }

  try {
    const response = await fetch('historical_highlights.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const highlights = await response.json();

    // Format date without relying on PowerLaw
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    // Format price without relying on PowerLaw
    const formatPrice = (price) => {
      if (price >= 1000) {
        return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
      }
      return '$' + price.toFixed(2);
    };

    tbody.innerHTML = highlights.map(h => {
      const isOvervalued = h.deviation_sp > 1.5;
      const isUndervalued = h.deviation_sp < 0.6;
      const badgeClass = isOvervalued ? 'overvalued' : (isUndervalued ? 'undervalued' : 'fair');

      return `
        <tr>
          <td>${formatDate(h.date)}</td>
          <td><strong>${h.event}</strong><br><small style="color: var(--gray);">${h.notes}</small></td>
          <td>${formatPrice(h.close)}</td>
          <td>${formatPrice(h.trend_sp)}</td>
          <td><span class="valuation-badge ${badgeClass}">${h.deviation_sp.toFixed(2)}×</span></td>
          <td><small>${h.reversion_outcome}</small></td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Failed to load historical highlights:', error);
    tbody.innerHTML = '<tr><td colspan="6">Failed to load historical data.</td></tr>';
  }
})();
