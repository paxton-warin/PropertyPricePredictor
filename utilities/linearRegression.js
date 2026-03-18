
const fs = require("fs");
const path = require("path");

const DB_DIR = path.resolve(__dirname, "..", "database");

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function toPrice(v) {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDateMs(v) {
  if (v == null) return null;

  if (isNum(v)) {
    return v < 2e12 ? Math.trunc(v * 1000) : Math.trunc(v);
  }

  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }

  if (typeof v === "object") {
    if (typeof v.value === "string") {
      const t = Date.parse(v.value);
      return Number.isFinite(t) ? t : null;
    }
    if (isNum(v.value)) return toDateMs(v.value);
  }

  return null;
}

function monthIndexFromMs(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m0 = d.getUTCMonth();
  return y * 12 + m0;
}


function extractPointsFromListing(listing) {
  const points = [];

  const events = listing?.propertyHistory?.events;
  if (!Array.isArray(events)) return points;

  for (const e of events) {
    if (!e || typeof e !== "object") continue;

    const price =
      toPrice(e.price) ??
      toPrice(e.soldPrice) ??
      toPrice(e.listPrice) ??
      toPrice(e.amount) ??
      null;

    const dateMs =
      toDateMs(e.eventDate) ??
      toDateMs(e.eventDateString) ??
      toDateMs(e.timestamp) ??
      toDateMs(e.date) ??
      null;

    if (price != null && price > 0 && dateMs != null) {
      points.push([monthIndexFromMs(dateMs), price]);
    }
  }

  return points;
}

function fitLinear(pointsXY) {
  const n = pointsXY.length;
  if (n < 2) return null;

  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;

  for (const [x, y] of pointsXY) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }

  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;

  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;

  return { m, b };
}

function formatEq(m, b) {
  const fm = Number.isFinite(m) ? m.toFixed(6) : "NaN";
  const fb = Number.isFinite(b) ? b.toFixed(2) : "NaN";
  return `y = ${fm}x + ${fb}`;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function coerceListings(data) {
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    if (Array.isArray(data.listings)) return data.listings;
    if (Array.isArray(data.homes)) return data.homes;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.payload)) return data.payload;

    const vals = Object.values(data);
    if (vals.length && vals.every((v) => v && typeof v === "object")) return vals;
  }

  return [];
}

function main() {
  if (!fs.existsSync(DB_DIR)) {
    console.error("Database dir not found:", DB_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(DB_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort();

  if (!files.length) {
    console.error("No .json files found in:", DB_DIR);
    process.exit(1);
  }

  for (const f of files) {
    const full = path.join(DB_DIR, f);

    let data;
    try {
      data = loadJson(full);
    } catch {
      console.log(`[${f}]: ERROR (failed to parse JSON)`);
      continue;
    }

    const listings = coerceListings(data);

    const rawPoints = [];
    for (const listing of listings) {
      const pts = extractPointsFromListing(listing);
      for (const p of pts) rawPoints.push(p);
    }

    if (rawPoints.length < 2) {
      console.log(`[${f}]: not enough propertyHistory.events price points (${rawPoints.length})`);
      continue;
    }

    let baseMonth = Infinity;
    for (const [mi] of rawPoints) if (mi < baseMonth) baseMonth = mi;

    const pointsXY = rawPoints
      .map(([mi, price]) => [mi - baseMonth, price])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && y > 0);

    const fit = fitLinear(pointsXY);
    if (!fit) {
      console.log(`[${f}]: could not fit regression (degenerate data)`);
      continue;
    }

    console.log(`[${f}]: ${formatEq(fit.m, fit.b)}`);
  }
}

main();
