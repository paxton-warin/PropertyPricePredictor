---
title: Workflow
nav_order: 2
---

# End-to-End Workflow

## 1. Collect Redfin IDs
Create/edit `input/scrape/ids.json`

## 2. Scrape
```bash
npm run scrape -- --name NoVA_22030_Fairfax
````

## 3. Train

```bash
npm run train -- --inflation 0.012
```

## 4. Predict

```bash
npm run predict
```
