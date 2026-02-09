// Bitcoin Machtswet Observatorium - Historische Hoogtepunten (Nederlands)
// Laadt en toont belangrijke historische afwijkingsgebeurtenissen

(async function initHighlights() {
  const tbody = document.querySelector('#highlights-table tbody');
  if (!tbody) {
    console.error('Hoogtepunten: tbody niet gevonden');
    return;
  }

  try {
    const response = await fetch('data/historical_highlights_nl.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const highlights = await response.json();

    // Datum formatteren zonder afhankelijkheid van PowerLaw
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    // Prijs formatteren zonder afhankelijkheid van PowerLaw
    const formatPrice = (price) => {
      if (price >= 1000) {
        return '$' + price.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
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
          <td><span class="valuation-badge ${badgeClass}">${h.deviation_sp.toFixed(2)}\u00D7</span></td>
          <td><small>${h.reversion_outcome}</small></td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Kan historische hoogtepunten niet laden:', error);
    tbody.innerHTML = '<tr><td colspan="6">Kan historische data niet laden.</td></tr>';
  }
})();
