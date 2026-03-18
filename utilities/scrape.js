"use strict";

const fs = require("fs/promises");
const path = require("path");

const IDS_PATH = path.join(process.cwd(), "input", "scrape", "ids.json");
const DB_DIR = path.join(process.cwd(), "database");

function argValue(flag, defaultValue = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return defaultValue;
  const v = process.argv[idx + 1];
  return v ?? defaultValue;
}

function safeFilePart(s) {
  // keep it filesystem-friendly across Windows/macOS/Linux
  return String(s)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseRedfinBody(raw) {
  const idx = raw.indexOf("&&");
  if (idx === -1) throw new Error("Missing Redfin && prefix");
  const parsed = JSON.parse(raw.slice(idx + 2));
  if (parsed.resultCode !== 0) {
    throw new Error(parsed.errorMessage || `resultCode ${parsed.resultCode}`);
  }
  return parsed.payload;
}

function minimalProperty(propertyId, payload) {
  const amenities = payload.amenitiesInfo || {};
  const publicRecords = payload.publicRecordsInfo || {};
  const history = payload.propertyHistoryInfo || {};

  const address = amenities.addressInfo || publicRecords.addressInfo || null;

  return {
    propertyId,

    address: address
      ? {
          streetLine: address.streetLine || null,
          city: address.city || null,
          state: address.state || null,
          zip: address.zip || null,
        }
      : null,

    publicFacts: payload.publicFactsInfo || {},
    exteriorFacts: payload.exteriorFactsInfo || {},
    taxInfo: publicRecords.taxInfo || null,

    propertyHistory: {
      events: Array.isArray(history.events) ? history.events : [],
    },
  };
}

async function fetchProperty(propertyId) {
  const url = `https://www.redfin.com/stingray/api/home/details/belowTheFold?propertyId=${propertyId}&accessLevel=1`;

  const res = await fetch(url, {
    headers: {
      accept: "*/*",
      referer: "https://www.redfin.com/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const raw = await res.text();
  const payload = parseRedfinBody(raw);
  return minimalProperty(propertyId, payload);
}

async function main() {
  const ids = JSON.parse(await fs.readFile(IDS_PATH, "utf8"));
  if (!Array.isArray(ids)) throw new Error("input/scrape/ids.json must be an array");

  const nameArg = argValue("--name", null);
  const baseName = safeFilePart(nameArg || `scrape_${timestampName()}`);
  const outPath = path.join(DB_DIR, `${baseName}.json`);

  await fs.mkdir(DB_DIR, { recursive: true });

  const results = [];

  for (const id of ids) {
    try {
      const prop = await fetchProperty(id);
      results.push(prop);
      console.log(`✓ ${id}`);
    } catch (err) {
      console.error(`✗ ${id}: ${err.message}`);
    }
  }

  await fs.writeFile(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nSaved ${results.length} properties → ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
