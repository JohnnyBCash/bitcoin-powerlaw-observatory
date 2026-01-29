# Bitcoin Power Law Observatory

A minimalist, data-driven website for viewing Bitcoin's price through the power law lens.

## Features

- **Live Dashboard** - Current BTC price vs. power law trend with real-time valuation status
- **Historical Analysis** - Interactive log-log chart with ±1σ/±2σ mean reversion bands
- **Bell Curve Visualization** - Distribution of historical deviations showing normal behavior
- **Future Projections** - Timeline and milestone tables for long-term trend values
- **Model Comparison** - Toggle between Krueger/Sigman and Perrenod/Santostasi models

## Power Law Models

### Krueger/Sigman (from *Bitcoin One Million*, 2025)
```
trend_price = 10^(-1.847796462) × years^5.616314045
```

### Perrenod/Santostasi
```
trend_price = 10^(-17) × days^5.8
```

## Data Sources

- **Historical prices**: Combined dataset from GitHub (2010-2024) + Bitstamp (2024-present)
- **Live price**: CoinGecko API (60-second refresh)
- **5,674 daily data points** from July 18, 2010 to present

## Running Locally

```bash
cd bitcoin-powerlaw-site
python3 -m http.server 8000
```

Then open http://localhost:8000

## Project Structure

```
├── bitcoin-powerlaw-site/
│   ├── index.html          # Homepage dashboard
│   ├── css/style.css       # Stripe/Strike-inspired styling
│   ├── js/
│   │   ├── powerlaw.js     # Core calculations
│   │   ├── dashboard.js    # Homepage logic
│   │   ├── history.js      # Historical charts + bell curve
│   │   └── future.js       # Projections
│   └── pages/
│       ├── history.html    # Historical analysis
│       ├── future.html     # Future projections
│       └── about.html      # Methodology
└── datasets/
    ├── btc_historical.json # Processed data for site
    └── *.csv               # Raw source files
```

## Disclaimer

This is not financial advice. The power law model is an empirical observation based on historical data, not a guarantee of future performance. Always do your own research.

## License

MIT
