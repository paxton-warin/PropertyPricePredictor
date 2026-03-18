---
title: Versioning
parent: Training
nav_order: 2
---

# Model Versioning

Each training run:
- Gets a timestamped directory
- Stores `model.json`, `weights.bin`, `meta.json`
- Updates `LATEST_RUN.txt`

Runs are immutable.

This allows:
- Exact reproducibility
- Chronological comparison
- Scientific logging
