---
title: Architecture
nav_order: 5
---


# Architecture

## High-Level Data Flow

```text
input/scrape/ids.json
        ↓
scrape.js (Redfin API)
        ↓
database/*.json
        ↓
train
        ↓
model/
        ↓
predict
````

---

## Filesystem Design

### `database/`

Each JSON file represents **one geographic region**.

Filename = region key.

### `model/`

All trained models live here.

* Immutable runs
* Full metadata
* Latest run pointers

This ensures **scientific reproducibility** and prevents silent overwrites.

