const fs = require('fs');

// Genesis block and Santostasi/Perrenod model parameters
const GENESIS = new Date('2009-01-03T00:00:00Z');
const BETA = 5.8;
const LOG_A = -17;

function daysSinceGenesis(date) {
  return (date.getTime() - GENESIS.getTime()) / (1000 * 60 * 60 * 24);
}

function trendPrice(date) {
  const days = daysSinceGenesis(date);
  return Math.pow(10, LOG_A) * Math.pow(days, BETA);
}

// Read user's CSV
const csvPath = '../../Prices.csv';
const csvData = fs.readFileSync(csvPath, 'utf8');
const lines = csvData.trim().split('\n').slice(1); // Skip header

const weeklyData = [];
const seenDates = new Set();

for (const line of lines) {
  // Handle potential comment at end of line
  const cleanLine = line.split('#')[0].trim();
  if (!cleanLine) continue;

  const [dateStr, priceStr] = cleanLine.split(',');
  if (!dateStr || !priceStr) continue;

  const date = new Date(dateStr.trim() + 'T00:00:00Z');
  const price = parseFloat(priceStr.trim());

  if (isNaN(price) || price <= 0) continue;
  if (seenDates.has(dateStr.trim())) continue; // Skip duplicates
  seenDates.add(dateStr.trim());

  const trend = trendPrice(date);
  const multiple = price / trend;
  const logDev = Math.log10(price / trend);

  weeklyData.push({
    date: dateStr.trim(),
    close: Math.round(price * 100) / 100,
    trend_sp: Math.round(trend * 100) / 100,
    multiple_sp: Math.round(multiple * 1000) / 1000,
    log_dev_sp: Math.round(logDev * 1000) / 1000
  });
}

// Sort by date descending (newest first)
weeklyData.sort((a, b) => new Date(b.date) - new Date(a.date));

console.log(`Generated ${weeklyData.length} weekly records`);
console.log(`Date range: ${weeklyData[weeklyData.length-1].date} to ${weeklyData[0].date}`);

// Sample output
console.log('\nMost recent 5 entries:');
console.log(JSON.stringify(weeklyData.slice(0, 5), null, 2));

console.log('\nOldest 3 entries:');
console.log(JSON.stringify(weeklyData.slice(-3), null, 2));

// Key historical moments
const highlights = ['2017-12-17', '2018-12-16', '2021-11-14', '2022-11-20', '2024-11-17'];
console.log('\nKey dates:');
for (const h of highlights) {
  const entry = weeklyData.find(d => d.date === h);
  if (entry) console.log(`${h}: $${entry.close} | trend $${entry.trend_sp} | ${entry.multiple_sp}x | log ${entry.log_dev_sp}`);
}

// Write to JSON
const outputPath = '../weekly_history.json';
fs.writeFileSync(outputPath, JSON.stringify(weeklyData, null, 2));
console.log(`\nWritten to ${outputPath}`);
