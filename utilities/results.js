"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function isSoldEvent(e) {
  const d = String(e?.eventDescription || "").toLowerCase();
  return d.includes("sold");
}

function extractSoldEvents(propertyObj) {
  const events = propertyObj?.propertyHistory?.events;
  if (!Array.isArray(events)) return [];

  const sold = events
    .filter((e) => Number(e?.price) > 0)
    .filter(isSoldEvent)
    .map((e) => ({
      dateMs: Number(e.eventDate),
      price: Number(e.price),
    }))
    .filter((e) => e.dateMs > 0 && e.price > 0)
    .sort((a, b) => a.dateMs - b.dateMs);

  const byDay = new Map();
  for (const e of sold) {
    const day = Math.floor(e.dateMs / 86400000);
    byDay.set(day, e);
  }

  return Array.from(byDay.values()).sort((a, b) => a.dateMs - b.dateMs);
}

function safeNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function pctErr(pred, actual) {
  const a = safeNum(actual);
  const p = safeNum(pred);
  if (!(a > 0 && p > 0)) return null;
  return (Math.abs(p - a) / a) * 100;
}

function monthIndexFromMs(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function pickEvenSampleCounts(fileCount, total = 30) {
  const base = Math.floor(total / fileCount);
  const rem = total % fileCount;
  return Array.from({ length: fileCount }, (_, i) => base + (i < rem ? 1 : 0));
}

function chooseRandom(arr, k) {
  if (arr.length <= k) return arr.slice();
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

function truncatePropertyToAnchor(prop, anchorEvent) {
  const cloned = JSON.parse(JSON.stringify(prop));
  const events = cloned?.propertyHistory?.events;
  if (!Array.isArray(events)) return null;

  cloned.propertyHistory.events = events.filter(
    (e) => safeNum(e?.eventDate) <= anchorEvent.dateMs
  );

  return cloned;
}

function runPredictCLI(repoRoot, tempInputPath, daysAhead) {
  const res = spawnSync(
    "npm",
    ["run", "predict", "--", "--in", tempInputPath, "--days", String(daysAhead)],
    { cwd: repoRoot, encoding: "utf8", shell: true }
  );

  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");

  const start = Math.min(
    ...[stdout.indexOf("{"), stdout.indexOf("[")].filter((i) => i !== -1)
  );

  if (start === Infinity) {
    throw new Error(`No JSON output\n${stdout}\n${stderr}`);
  }

  return JSON.parse(stdout.slice(start));
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function loadJson(fp) {
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function runLinregAndParse(repoRoot) {
  const res = spawnSync("npm", ["run", "linreg"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
  });

  const out = `${res.stdout}\n${res.stderr}`;
  const map = new Map();

  const re = /^\[(.+?\.json)\]:\s*y\s*=\s*([+-]?\d+\.?\d*)x\s*\+\s*([+-]?\d+\.?\d*)/i;

  for (const line of out.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) map.set(m[1], { m: Number(m[2]), b: Number(m[3]) });
  }

  return { rawOutput: out, eqByFileName: map };
}

function summarizeNumbers(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (!v.length) return null;

  v.sort((a, b) => a - b);

  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const median =
    v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const p90 = v[Math.floor(0.9 * v.length)];

  return { n: v.length, mean, median, p90, min: v[0], max: v[v.length - 1] };
}

function summarizeErrors(arr) {
  return summarizeNumbers(arr);
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const dbDir = path.join(repoRoot, "database");

  const dbFiles = listJsonFiles(dbDir);
  if (!dbFiles.length) throw new Error("No database files found");

  const { rawOutput: linregRaw, eqByFileName } = runLinregAndParse(repoRoot);

  const earliestMonthByFile = new Map();
  const propsByFile = [];

  for (const f of dbFiles) {
    const parsed = loadJson(f);
    const props = Array.isArray(parsed) ? parsed : [parsed];

    const usable = props.filter((p) => extractSoldEvents(p).length >= 2);

    let earliest = Infinity;
    for (const p of usable) {
      for (const e of extractSoldEvents(p)) {
        earliest = Math.min(earliest, monthIndexFromMs(e.dateMs));
      }
    }

    earliestMonthByFile.set(path.basename(f), earliest);
    propsByFile.push({ fileName: path.basename(f), props: usable });
  }

  const counts = pickEvenSampleCounts(propsByFile.length, 30);

  const sampled = [];
  propsByFile.forEach((f, i) => {
    chooseRandom(f.props, counts[i]).forEach((p) =>
      sampled.push({ fileName: f.fileName, prop: p })
    );
  });

  const cases = [];

  for (const { fileName, prop } of sampled) {
    const sold = extractSoldEvents(prop);
    const i = Math.floor(Math.random() * (sold.length - 1));

    const anchor = sold[i];
    const target = sold[i + 1];
    const daysAhead = Math.round((target.dateMs - anchor.dateMs) / 86400000);

    const testProp = truncatePropertyToAnchor(prop, anchor);
    if (!testProp || daysAhead <= 0) continue;

    let modelOut = null;
    try {
      const tmp = path.join(__dirname, "tmp_eval.json");
      fs.writeFileSync(tmp, JSON.stringify(testProp));
      modelOut = runPredictCLI(repoRoot, tmp, daysAhead);
      fs.unlinkSync(tmp);
    } catch {}

    const modelPred = safeNum(modelOut?.predictedFuturePrice);
    const actual = safeNum(target.price);

    const eq = eqByFileName.get(fileName);
    const earliest = earliestMonthByFile.get(fileName);

    let linPred = null;
    if (eq && Number.isFinite(earliest)) {
      const x = monthIndexFromMs(target.dateMs) - earliest;
      linPred = eq.m * x + eq.b;
    }

    cases.push({
      fileName,
      propertyId: prop.propertyId,
      modelPredicted: modelPred,
      linregPredicted: linPred,
      actualPrice: actual,
      modelPctError: pctErr(modelPred, actual),
      linregPctError: pctErr(linPred, actual),
      daysAhead,
    });
  }

  const overall = {
    modelErrors: summarizeErrors(cases.map((c) => c.modelPctError)),
    linregErrors: summarizeErrors(cases.map((c) => c.linregPctError)),

    modelPrices: {
      predicted: summarizeNumbers(cases.map((c) => c.modelPredicted)),
      actual: summarizeNumbers(cases.map((c) => c.actualPrice)),
    },

    linregPrices: {
      predicted: summarizeNumbers(cases.map((c) => c.linregPredicted)),
      actual: summarizeNumbers(cases.map((c) => c.actualPrice)),
    },
  };

  const out = {
    overall,
    cases,
    linregRawOutput: linregRaw,
  };

  fs.writeFileSync("evaluation_results.json", JSON.stringify(out, null, 2));

  console.log("Wrote evaluation_results.json");
}

main().catch(console.error);
