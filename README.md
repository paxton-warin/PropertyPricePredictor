# PropertyPredictor

**Region-Aware, Inflation-Normalized Machine Learning for Residential Price Forecasting**

PropertyPredictor is an experimental machine-learning system that predicts **future residential home prices**, not appraisals.  
It models **real (inflation-adjusted) price appreciation** and trains **separate neural networks per geographic region**.

This project is designed for **educational research**, science fairs, and independent study.

---

## Core Ideas

- Predicts **future value**, not current price
- Learns **excess returns above inflation**
- Trains **one model per region**
- Automatically routes predictions to the best model

---

## Quick Workflow

```text
Scrape Redfin data → Train regional models → Predict future price
````

---

## Example

```bash
npm run scrape -- --name NoVA_22030_Fairfax
npm run train -- --inflation 0.012
npm run predict -- --in ./input/predict/input.json
```

---

## Documentation

Full project documentation is available here:  
[PropertyPredictor Documentation](https://paxton-warin.github.io/PropertyPredictor)

---

## Disclaimer

This software is **experimental and proprietary**.
Predictions are estimates only and **not financial advice**.
