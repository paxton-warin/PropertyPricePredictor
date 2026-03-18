---
title: CLI Usage
parent: Prediction
nav_order: 1
---

# Prediction

## Command

```bash
npm run predict -- --in ./input/predict/input.json --days 90
````

---

## Routing Logic

1. Infer area from address
2. Match trained regions
3. Load latest run
4. Fallback to global model if needed
