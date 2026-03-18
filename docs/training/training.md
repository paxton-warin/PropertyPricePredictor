---
title: Model Training
parent: Training
nav_order: 1
---

# Training

## Regional Training (Autosplit)

Each file in `database/` becomes its **own model**.

Best for:
- Production use
- Localized learning

---

## Global Training (No Split)

All regions merged into one model.

Best for:
- Baselines
- Experiments
