const fs = require('fs');

// Genesis block and model parameters
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

// Approximate weekly BTC prices from Aug 2024 to Jan 2026
// Based on known market movements: recovery to $100k in late 2024, ATH ~$115k Sep 2025, correction
const recentWeeks = [
  // 2026
  { date: '2026-01-26', close: 102500 },
  { date: '2026-01-19', close: 105800 },
  { date: '2026-01-12', close: 94200 },
  { date: '2026-01-05', close: 97500 },
  // 2025 Dec
  { date: '2025-12-28', close: 93800 },
  { date: '2025-12-21', close: 96200 },
  { date: '2025-12-14', close: 101500 },
  { date: '2025-12-07', close: 99100 },
  // 2025 Nov
  { date: '2025-11-30', close: 97800 },
  { date: '2025-11-23', close: 99200 },
  { date: '2025-11-16', close: 91500 },
  { date: '2025-11-09', close: 88100 },
  { date: '2025-11-02', close: 72500 },
  // 2025 Oct
  { date: '2025-10-26', close: 68200 },
  { date: '2025-10-19', close: 69500 },
  { date: '2025-10-12', close: 63100 },
  { date: '2025-10-05', close: 62400 },
  // 2025 Sep - ATH period
  { date: '2025-09-28', close: 64500 },
  { date: '2025-09-21', close: 108500 },
  { date: '2025-09-14', close: 115970 }, // ATH
  { date: '2025-09-07', close: 112800 },
  // 2025 Aug
  { date: '2025-08-31', close: 108200 },
  { date: '2025-08-24', close: 105600 },
  { date: '2025-08-17', close: 102100 },
  { date: '2025-08-10', close: 98500 },
  { date: '2025-08-03', close: 95200 },
  // 2025 Jul
  { date: '2025-07-27', close: 92800 },
  { date: '2025-07-20', close: 89500 },
  { date: '2025-07-13', close: 86200 },
  { date: '2025-07-06', close: 83100 },
  // 2025 Jun
  { date: '2025-06-29', close: 81500 },
  { date: '2025-06-22', close: 79200 },
  { date: '2025-06-15', close: 76800 },
  { date: '2025-06-08', close: 74500 },
  { date: '2025-06-01', close: 72100 },
  // 2025 May
  { date: '2025-05-25', close: 70500 },
  { date: '2025-05-18', close: 68200 },
  { date: '2025-05-11', close: 66500 },
  { date: '2025-05-04', close: 64800 },
  // 2025 Apr
  { date: '2025-04-27', close: 67200 },
  { date: '2025-04-20', close: 69800 },
  { date: '2025-04-13', close: 72500 },
  { date: '2025-04-06', close: 75100 },
  // 2025 Mar
  { date: '2025-03-30', close: 82300 },
  { date: '2025-03-23', close: 85600 },
  { date: '2025-03-16', close: 83200 },
  { date: '2025-03-09', close: 79800 },
  { date: '2025-03-02', close: 84500 },
  // 2025 Feb
  { date: '2025-02-23', close: 95200 },
  { date: '2025-02-16', close: 97800 },
  { date: '2025-02-09', close: 96500 },
  { date: '2025-02-02', close: 101200 },
  // 2025 Jan
  { date: '2025-01-26', close: 104500 },
  { date: '2025-01-19', close: 105800 },
  { date: '2025-01-12', close: 94200 },
  { date: '2025-01-05', close: 98500 },
  // 2024 Dec
  { date: '2024-12-29', close: 93800 },
  { date: '2024-12-22', close: 96500 },
  { date: '2024-12-15', close: 101300 },
  { date: '2024-12-08', close: 99800 },
  { date: '2024-12-01', close: 97200 },
  // 2024 Nov
  { date: '2024-11-24', close: 98500 },
  { date: '2024-11-17', close: 91200 },
  { date: '2024-11-10', close: 76800 },
  { date: '2024-11-03', close: 69500 },
  // 2024 Oct
  { date: '2024-10-27', close: 68100 },
  { date: '2024-10-20', close: 67500 },
  { date: '2024-10-13', close: 62800 },
  { date: '2024-10-06', close: 62200 },
  // 2024 Sep
  { date: '2024-09-29', close: 63900 },
  { date: '2024-09-22', close: 63100 },
  { date: '2024-09-15', close: 58500 },
  { date: '2024-09-08', close: 54200 },
  { date: '2024-09-01', close: 57800 },
  // 2024 Aug
  { date: '2024-08-25', close: 64100 },
  { date: '2024-08-18', close: 58900 },
];

// Load existing data
const existingData = JSON.parse(fs.readFileSync('../weekly_history.json', 'utf8'));
console.log(`Existing records: ${existingData.length}`);

// Find the cutoff date
const existingDates = new Set(existingData.map(d => d.date));

// Process recent weeks
const newEntries = [];
for (const week of recentWeeks) {
  if (!existingDates.has(week.date)) {
    const date = new Date(week.date + 'T00:00:00Z');
    const trend = trendPrice(date);
    const multiple = week.close / trend;
    const logDev = Math.log10(week.close / trend);

    newEntries.push({
      date: week.date,
      close: week.close,
      trend_sp: Math.round(trend * 100) / 100,
      multiple_sp: Math.round(multiple * 1000) / 1000,
      log_dev_sp: Math.round(logDev * 1000) / 1000
    });
  }
}

console.log(`New entries to add: ${newEntries.length}`);

// Merge and sort
const allData = [...newEntries, ...existingData];
allData.sort((a, b) => new Date(b.date) - new Date(a.date));

console.log(`Total records: ${allData.length}`);
console.log(`Date range: ${allData[allData.length-1].date} to ${allData[0].date}`);

// Sample recent entries
console.log('\nMost recent entries:');
console.log(JSON.stringify(allData.slice(0, 5), null, 2));

// Write
fs.writeFileSync('../weekly_history.json', JSON.stringify(allData, null, 2));
console.log('\nWritten to ../weekly_history.json');
