---
title: Scraping
parent: Data
nav_order: 1
---

# Data Scraping

## Input File

````
input/scrape/ids.json
````

### Format

```json
[
  12345678,
  23456789,
  34567890
]
````

---

## Important Rules

* IDs **must be Redfin property IDs**
* Zillow / MLS IDs will not work
* All IDs in one scrape should belong to the **same region**

---

## Output

```text
database/<AREA_NAME>.json
```

Each scrape run should correspond to **one geographic area**.

