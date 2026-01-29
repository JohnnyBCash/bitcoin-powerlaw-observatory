const fs = require('fs');

// Read GitHub historical data (2010-2024)
const githubData = fs.readFileSync('btc_historical_full.csv', 'utf8')
  .split('\n')
  .slice(1) // skip header
  .filter(line => line.trim())
  .map(line => {
    const [date, price] = line.split(',');
    return { date, price: parseFloat(price) };
  });

// Read Bitstamp data (2014-2026, newest first)
const bitstampData = fs.readFileSync('btc_bitstamp_daily.csv', 'utf8')
  .split('\n')
  .slice(2) // skip header lines
  .filter(line => line.trim())
  .map(line => {
    const parts = line.split(',');
    const dateStr = parts[1].split(' ')[0]; // "2026-01-28 00:00:00" -> "2026-01-28"
    const close = parseFloat(parts[5]);
    return { date: dateStr, price: close };
  })
  .reverse(); // oldest first

// Find cutoff: use GitHub data up to 2024-08-11, then Bitstamp after
const cutoffDate = '2024-08-11';
const githubFiltered = githubData.filter(d => d.date <= cutoffDate);
const bitstampFiltered = bitstampData.filter(d => d.date > cutoffDate);

// Merge
const merged = [...githubFiltered, ...bitstampFiltered];

// Write output
const header = 'date,price\n';
const rows = merged.map(d => `${d.date},${d.price}`).join('\n');
fs.writeFileSync('btc_historical_combined.csv', header + rows);

console.log(`GitHub data: ${githubData.length} rows (${githubData[0]?.date} to ${githubData[githubData.length-1]?.date})`);
console.log(`Bitstamp data: ${bitstampData.length} rows (${bitstampData[0]?.date} to ${bitstampData[bitstampData.length-1]?.date})`);
console.log(`Combined: ${merged.length} rows (${merged[0]?.date} to ${merged[merged.length-1]?.date})`);
