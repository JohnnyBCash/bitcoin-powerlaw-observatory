const fs = require('fs');

// Genesis block: January 3, 2009
const GENESIS = new Date('2009-01-03T00:00:00Z');

// Santostasi/Perrenod model parameters
const BETA = 5.8;
const LOG_A = -17;

// Calculate days since genesis
function daysSinceGenesis(date) {
  return (date.getTime() - GENESIS.getTime()) / (1000 * 60 * 60 * 24);
}

// Calculate trend price using Santostasi/Perrenod model
function trendPrice(date) {
  const days = daysSinceGenesis(date);
  return Math.pow(10, LOG_A) * Math.pow(days, BETA);
}

// Read and parse CSV
const csvPath = './btc_historical_full.csv';
const csvData = fs.readFileSync(csvPath, 'utf8');
const lines = csvData.trim().split('\n').slice(1); // Skip header

// Parse all daily data
const dailyData = [];
for (const line of lines) {
  const [dateStr, priceStr] = line.split(',');
  const date = new Date(dateStr + 'T00:00:00Z');
  const price = parseFloat(priceStr);
  if (!isNaN(price) && price > 0) {
    dailyData.push({ date, price });
  }
}

console.log(`Loaded ${dailyData.length} daily records`);

// Get weekly data (Sundays)
const weeklyData = [];
const startDate = new Date('2015-01-04T00:00:00Z'); // First Sunday of 2015

for (const day of dailyData) {
  // Check if it's a Sunday and >= 2015
  if (day.date.getUTCDay() === 0 && day.date >= startDate) {
    const trend = trendPrice(day.date);
    const multiple = day.price / trend;
    const logDev = Math.log10(day.price / trend);

    weeklyData.push({
      date: day.date.toISOString().split('T')[0],
      close: Math.round(day.price * 100) / 100,
      trend_sp: Math.round(trend * 100) / 100,
      multiple_sp: Math.round(multiple * 1000) / 1000,
      log_dev_sp: Math.round(logDev * 1000) / 1000
    });
  }
}

// Sort by date descending (newest first)
weeklyData.sort((a, b) => new Date(b.date) - new Date(a.date));

console.log(`Generated ${weeklyData.length} weekly records`);
console.log(`Date range: ${weeklyData[weeklyData.length-1].date} to ${weeklyData[0].date}`);

// Sample output
console.log('\nFirst 3 entries (most recent):');
console.log(JSON.stringify(weeklyData.slice(0, 3), null, 2));

console.log('\nLast 3 entries (oldest):');
console.log(JSON.stringify(weeklyData.slice(-3), null, 2));

// Write to JSON
const outputPath = '../weekly_history.json';
fs.writeFileSync(outputPath, JSON.stringify(weeklyData, null, 2));
console.log(`\nWritten to ${outputPath}`);
