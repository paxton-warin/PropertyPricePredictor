---
title: Theory
nav_order: 4
---

# Modeling Theory

## Problem

Most housing models fail because they:
- Treat all regions identically
- Ignore time between sales
- Predict raw prices instead of growth

---

## Core Insight

Rather than predicting price directly, the model predicts **real appreciation beyond inflation**.

### Target Variable

```
excessLogReturn = log(
futureSalePrice / (lastSalePrice × inflationFactor(days))
)
```

Where:
- `inflationFactor(days)` compounds an annual inflation rate over time
- The output is **real growth**, not nominal price change

---

## Why This Works

- Normalizes across time horizons
- Prevents inflation leakage
- Stabilizes training with long sale gaps
- Allows reuse across prediction windows

This approach mirrors techniques in:
- Quantitative finance
- Econometrics
- Asset pricing models
