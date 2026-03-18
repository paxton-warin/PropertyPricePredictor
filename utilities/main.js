"use strict";

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const crypto = require("crypto");

function argValue(flag, defaultValue = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return defaultValue;
  const v = process.argv[idx + 1];
  return v ?? defaultValue;
}

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function parseSqft(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const digits = value.replace(/[^0-9.]/g, "");
  return safeNumber(digits, 0);
}

function parseBedsBaths(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : 0;
}

function yearFromString(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const y = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(y) ? y : 0;
}

function oneHot(value, vocab) {
  const arr = new Array(vocab.length).fill(0);
  const idx = vocab.indexOf(value);
  if (idx >= 0) arr[idx] = 1;
  return arr;
}

function inflateFactor(daysBetween, annualInflationRate) {
  const years = daysBetween / 365.25;
  return Math.pow(1 + annualInflationRate, years);
}

function inflatePrice(priceAtT0, daysBetween, annualInflationRate) {
  return priceAtT0 * inflateFactor(daysBetween, annualInflationRate);
}

function tsSlug(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function newestRunDirFromRunsFolder(runsDir) {
  if (!fs.existsSync(runsDir)) return null;
  const entries = fs.readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 0) return null;
  const names = entries.map((e) => e.name).sort();
  return path.join(runsDir, names[names.length - 1]);
}

function readLatestRunPointer(dir) {
  const p = path.join(dir, "LATEST_RUN.txt");
  if (!fs.existsSync(p)) return null;
  const raw = String(fs.readFileSync(p, "utf8") || "").trim();
  return raw ? raw : null;
}

function resolveRunDirFromBase(modelBaseDir) {
  if (fs.existsSync(path.join(modelBaseDir, "model.json"))) return modelBaseDir;
  const ptr = readLatestRunPointer(modelBaseDir);
  if (ptr && fs.existsSync(path.join(ptr, "model.json"))) return ptr;
  const latest = newestRunDirFromRunsFolder(path.join(modelBaseDir, "runs"));
  if (latest && fs.existsSync(path.join(latest, "model.json"))) return latest;
  return modelBaseDir;
}

function listAreaDirs(modelBaseDir) {
  const areasDir = path.join(modelBaseDir, "areas");
  if (!fs.existsSync(areasDir)) return [];
  return fs
    .readdirSync(areasDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(areasDir, e.name));
}

function getLatestRunForAreaDir(areaDir) {
  const ptr = readLatestRunPointer(areaDir);
  if (ptr && fs.existsSync(path.join(ptr, "model.json"))) return ptr;
  const latest = newestRunDirFromRunsFolder(path.join(areaDir, "runs"));
  if (latest && fs.existsSync(path.join(latest, "model.json"))) return latest;
  return null;
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w.-]+/g, "_");
}

function tokensFromGuess(guess) {
  const g = String(guess || "");
  const parts = g.split("_").filter(Boolean);
  const zip = parts.find((p) => /^\d{5}$/.test(p)) || null;
  const city = parts.find((p) => !/^\d{5}$/.test(p)) || null;
  return { zip, city };
}

function propertyAreaKeyGuess(prop) {
  const addr = prop?.address || {};
  const pf = prop?.publicFacts || {};
  const zip = String(addr.zip || "").trim();
  const city = String(addr.city || "").trim();
  const county = String(pf["County"] || "").trim();
  if (zip && city) return `${zip}_${city}`.replace(/\s+/g, "");
  if (zip && county) return `${zip}_${county}`.replace(/\s+/g, "");
  if (zip) return zip;
  return null;
}

function pickBestAreaDir(modelBaseDir, guess) {
  if (!guess) return null;
  const guessNorm = normalizeKey(guess);
  const { zip, city } = tokensFromGuess(guess);
  const zipNorm = normalizeKey(zip);
  const cityNorm = normalizeKey(city);
  const areaDirs = listAreaDirs(modelBaseDir);
  if (areaDirs.length === 0) return null;
  let best = null;
  let bestScore = -1;
  for (const ad of areaDirs) {
    const areaKeyRaw = path.basename(ad);
    const k = normalizeKey(areaKeyRaw);
    let score = 0;
    if (k === guessNorm) score = 3;
    else if (k.includes(guessNorm)) score = 2;
    else if (zipNorm && k.includes(zipNorm) && (!cityNorm || k.includes(cityNorm))) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = ad;
    }
  }
  return bestScore >= 1 ? best : null;
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function loadPropertiesFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

function loadAllProperties(dbDir) {
  const files = listJsonFiles(dbDir);
  const all = [];
  for (const f of files) {
    const rows = loadPropertiesFromFile(f);
    if (rows.length) all.push(...rows);
  }
  return all;
}

function fileAreaKeyFromName(filePath) {
  const base = path.basename(filePath).replace(/\.json$/i, "");
  const area = base.replace(/^properties\d+/i, "");
  const areaKey = area.replace(/^_+/, "").trim();
  return areaKey || base;
}

function getListingPrice(propertyObj) {
  const candidates = [
    propertyObj?.priceInfo?.amount,
    propertyObj?.priceInfo?.price,
    propertyObj?.price,
    propertyObj?.listingPrice,
    propertyObj?.listPrice,
    propertyObj?.mlsListingPrice,
    propertyObj?.mlsData?.price,
    propertyObj?.homeDetails?.price,
    propertyObj?.property?.price,
  ];
  for (const c of candidates) {
    const n = safeNumber(c, 0);
    if (n > 0) return n;
  }
  const strCandidates = [
    propertyObj?.priceInfo?.formatted,
    propertyObj?.priceInfo?.displayPrice,
    propertyObj?.listingPriceDisplay,
  ];
  for (const s of strCandidates) {
    if (typeof s === "string" && s.trim()) {
      const digits = s.replace(/[^0-9.]/g, "");
      const n = safeNumber(digits, 0);
      if (n > 0) return n;
    }
  }
  return 0;
}

function isSoldEvent(e) {
  const d = String(e?.eventDescription || "").toLowerCase();
  return d.includes("sold");
}

function extractSoldEvents(propertyObj) {
  const events = propertyObj?.propertyHistory?.events;
  if (!Array.isArray(events)) return [];
  const sold = events
    .filter((e) => Number.isFinite(Number(e?.price)) && Number(e?.price) > 0)
    .filter(isSoldEvent)
    .map((e) => ({
      dateMs: safeNumber(e.eventDate, 0),
      price: safeNumber(e.price, 0),
      desc: String(e.eventDescription || ""),
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

function getLastSoldEvent(propertyObj) {
  const sold = extractSoldEvents(propertyObj);
  return sold.length ? sold[sold.length - 1] : null;
}

function buildVocabs(allProps) {
  const styles = new Map();
  const counties = new Map();
  for (const p of allProps) {
    const style = String(p?.publicFacts?.["Style"] || "").trim();
    const county = String(p?.publicFacts?.["County"] || "").trim();
    if (style) styles.set(style, (styles.get(style) || 0) + 1);
    if (county) counties.set(county, (counties.get(county) || 0) + 1);
  }
  const topN = (m, n) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);
  return { styleVocab: topN(styles, 40), countyVocab: topN(counties, 30) };
}

function extractFeatures(propertyObj, styleVocab, countyVocab, lastSalePriceForRatio = 0) {
  const pf = propertyObj?.publicFacts || {};
  const ef = propertyObj?.exteriorFacts || {};
  const ti = propertyObj?.taxInfo || {};
  const addr = propertyObj?.address || {};

  const beds = parseBedsBaths(pf["Beds"]);
  const baths = parseBedsBaths(pf["Baths"]);
  const sqft = parseSqft(pf["Sq. Ft."] || ef["Living Sq. Ft"] || ef["Adjusted Gross Sq. Ft"]);
  const yearBuilt = yearFromString(pf["Year Built"]);
  const lotSqft = parseSqft(pf["Lot Size"] || ef["Land Sq. Ft"]);
  const landValue = safeNumber(ti.taxableLandValue, 0);
  const improvValue = safeNumber(ti.taxableImprovementValue, 0);
  const taxesDue = safeNumber(ti.taxesDue, 0);

  const style = String(pf["Style"] || "").trim();
  const county = String(pf["County"] || "").trim();
  const zip = safeNumber(addr.zip, 0);
  const state = String(addr.state || "").trim();

  const listingPriceNow = getListingPrice(propertyObj);
  const ratio = lastSalePriceForRatio > 0 && listingPriceNow > 0 ? listingPriceNow / lastSalePriceForRatio : 0;

  const styleOH = oneHot(style, styleVocab);
  const countyOH = oneHot(county, countyVocab);

  const numeric = [
    beds,
    baths,
    sqft,
    yearBuilt,
    lotSqft,
    landValue,
    improvValue,
    taxesDue,
    zip,
    state === "VA" ? 1 : 0,
    listingPriceNow,
    ratio,
  ];

  return numeric.concat(styleOH).concat(countyOH);
}

function buildTrainingRows(allProps, vocabs, annualInflationRate) {
  const X = [];
  const y = [];
  let propsWithPairs = 0;
  let totalPairs = 0;

  for (const p of allProps) {
    const sold = extractSoldEvents(p);
    if (sold.length < 2) continue;

    let pairsHere = 0;
    for (let i = 0; i < sold.length - 1; i++) {
      const e0 = sold[i];
      const e1 = sold[i + 1];

      const daysAhead = (e1.dateMs - e0.dateMs) / 86400000;
      if (!Number.isFinite(daysAhead) || daysAhead <= 0) continue;

      const lastPrice = e0.price;
      const futurePrice = e1.price;
      if (!(lastPrice > 0 && futurePrice > 0)) continue;

      const baseFeats = extractFeatures(p, vocabs.styleVocab, vocabs.countyVocab, lastPrice);

      const inflBaseline = inflatePrice(lastPrice, daysAhead, annualInflationRate);
      const excessLogReturn = Math.log(futurePrice / Math.max(1, inflBaseline));

      const row = baseFeats.concat([lastPrice, inflBaseline, daysAhead]);

      X.push(row);
      y.push([excessLogReturn]);
      pairsHere++;
    }

    if (pairsHere > 0) {
      propsWithPairs++;
      totalPairs += pairsHere;
    }
  }

  return { X, y, propsWithPairs, totalPairs };
}

function fitStandardizer(X) {
  const cols = X[0].length;
  const means = new Array(cols).fill(0);
  const stds = new Array(cols).fill(0);

  for (let j = 0; j < cols; j++) {
    let sum = 0;
    for (let i = 0; i < X.length; i++) sum += X[i][j];
    means[j] = sum / X.length;
  }

  for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let i = 0; i < X.length; i++) {
      const d = X[i][j] - means[j];
      s += d * d;
    }
    stds[j] = Math.sqrt(s / X.length) || 1;
  }

  return { means, stds };
}

function applyStandardizer(X, stats) {
  return X.map((row) => row.map((v, j) => (v - stats.means[j]) / stats.stds[j]));
}

function buildModel(inputDim) {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 128,
      activation: "relu",
      inputShape: [inputDim],
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(
    tf.layers.dense({
      units: 64,
      activation: "relu",
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }),
    })
  );
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({
    optimizer: tf.train.adam(1e-3),
    loss: "meanSquaredError",
    metrics: ["mae"],
  });
  return model;
}

function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

async function trainOne({ allProps, outDir, annualInflationRate, areaKey = null, sourceFile = null }) {
  if (!allProps.length) throw new Error("No properties to train on.");

  const vocabs = buildVocabs(allProps);
  const { X, y, propsWithPairs, totalPairs } = buildTrainingRows(allProps, vocabs, annualInflationRate);

  if (X.length === 0) {
    throw new Error("No SOLD->SOLD training pairs found.");
  }

  const avgPairs = propsWithPairs ? totalPairs / propsWithPairs : 0;
  const stats = fitStandardizer(X);
  const Xn = applyStandardizer(X, stats);

  const idx = [...Array(Xn.length).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }

  const split = Math.floor(0.85 * idx.length);
  const trainIdx = idx.slice(0, split);
  const valIdx = idx.slice(split);

  const Xtrain = trainIdx.map((i) => Xn[i]);
  const ytrain = trainIdx.map((i) => y[i]);
  const Xval = valIdx.map((i) => Xn[i]);
  const yval = valIdx.map((i) => y[i]);

  const inputDim = Xtrain[0].length;
  const model = buildModel(inputDim);

  const xsTrain = tf.tensor2d(Xtrain);
  const ysTrain = tf.tensor2d(ytrain);
  const xsVal = tf.tensor2d(Xval);
  const ysVal = tf.tensor2d(yval);

  const splitTag = areaKey ? "split" : "nosplit";
  const runId = `${tsSlug()}_${splitTag}_${crypto.randomBytes(3).toString("hex")}`;
  const runDir = path.join(outDir, "runs", runId);
  ensureDir(runDir);

  const history = await model.fit(xsTrain, ysTrain, {
    epochs: 80,
    batchSize: 64,
    validationData: [xsVal, ysVal],
    callbacks: [tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 10 })],
  });

  await model.save(`file://${runDir}`);

  const meta = {
    createdAt: new Date().toISOString(),
    runId,
    runDir,
    areaKey: areaKey || null,
    sourceFile: sourceFile || null,
    annualInflationRate,
    vocabs,
    standardizer: stats,
    target: "excessLogReturn = log( nextSalePrice / (lastSalePrice * inflationFactor(days)) )",
    featureNotes: [
      "numeric: beds, baths, sqft, yearBuilt, lotSqft, taxableLandValue, taxableImprovementValue, taxesDue, zip, isVA, listingPriceNow, listingToLastSaleRatio",
      "onehot: styleVocab, countyVocab",
      "extra: lastSalePrice, inflationAdjustedBaseline, daysAhead",
    ],
    datasetStats: {
      propertiesLoaded: allProps.length,
      propertiesWithPairs: propsWithPairs,
      avgPairsPerPropertyWithPairs: avgPairs,
      rows: X.length,
      inputDim,
      styleVocabSize: vocabs.styleVocab.length,
      countyVocabSize: vocabs.countyVocab.length,
      countyVocabSize: vocabs.countyVocab.length,
    },
    trainingFinal: {
      loss: last(history.history.loss),
      val_loss: last(history.history.val_loss),
      mae: last(history.history.mae),
      val_mae: last(history.history.val_mae),
    },
  };

  fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(outDir, "LATEST_RUN.txt"), runDir, "utf8");

  return meta;
}

async function trainAll({ dbDir, outBaseDir, annualInflationRate, autosplit, minRows }) {
  ensureDir(outBaseDir);

  if (!autosplit) {
    const allProps = loadAllProperties(dbDir);
    if (!allProps.length) throw new Error(`No properties found in ${dbDir}`);
    const meta = await trainOne({ allProps, outDir: outBaseDir, annualInflationRate });
    console.log(`Saved model to ${meta.runDir}`);
    return;
  }

  const files = listJsonFiles(dbDir);
  if (!files.length) throw new Error(`No JSON files found in ${dbDir}`);

  const areasDir = path.join(outBaseDir, "areas");
  ensureDir(areasDir);

  const index = { createdAt: new Date().toISOString(), modelBaseDir: outBaseDir, areas: [] };

  for (const f of files) {
    const props = loadPropertiesFromFile(f);
    if (!props.length) continue;

    const tmpVocabs = buildVocabs(props);
    const tmpRows = buildTrainingRows(props, tmpVocabs, annualInflationRate);
    if (!tmpRows.X.length || tmpRows.X.length < minRows) continue;

    const areaKey = fileAreaKeyFromName(f);
    const areaOutDir = path.join(areasDir, areaKey);
    ensureDir(areaOutDir);

    const meta = await trainOne({
      allProps: props,
      outDir: areaOutDir,
      annualInflationRate,
      areaKey,
      sourceFile: path.basename(f),
    });

    index.areas.push({
      areaKey,
      latestRunDir: meta.runDir,
      runId: meta.runId,
      val_loss: meta.trainingFinal?.val_loss ?? null,
      val_mae: meta.trainingFinal?.val_mae ?? null,
      rows: meta.datasetStats?.rows ?? null,
      sourceFile: meta.sourceFile,
    });

    console.log(`Trained ${areaKey} -> ${meta.runDir}`);
  }

  const indexPath = path.join(outBaseDir, "AREAS_INDEX.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  console.log(`Wrote index: ${indexPath}`);
}

function clip(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function weightFromValLoss(valLoss) {
  const eps = 1e-6;
  const v = Number(valLoss);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return 1 / (v + eps);
}

async function predictWithOneRun({ runDir, prop, daysAhead }) {
  const metaPath = path.join(runDir, "meta.json");
  const modelPath = path.join(runDir, "model.json");
  if (!fs.existsSync(metaPath) || !fs.existsSync(modelPath)) return null;

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const model = await tf.loadLayersModel(`file://${modelPath}`);

  const lastSale = getLastSoldEvent(prop);
  if (!lastSale) return null;

  const lastPrice = lastSale.price;
  const listingPriceNow = getListingPrice(prop);
  const listingToLastSaleRatio = lastPrice > 0 && listingPriceNow > 0 ? listingPriceNow / lastPrice : 0;

  const baseFeats = extractFeatures(prop, meta.vocabs.styleVocab, meta.vocabs.countyVocab, lastPrice);
  const inflBaseline = inflatePrice(lastPrice, daysAhead, meta.annualInflationRate);

  const row = baseFeats.concat([lastPrice, inflBaseline, daysAhead]);
  const rowN = row.map((v, j) => (v - meta.standardizer.means[j]) / meta.standardizer.stds[j]);

  const pred = model.predict(tf.tensor2d([rowN]));
  const excessLogReturnRaw = (await pred.data())[0];

  const excessUsed = clip(excessLogReturnRaw, -1.0, 0.3);
  const excessClipped = excessUsed !== excessLogReturnRaw;

  const predictedPriceRaw = inflBaseline * Math.exp(excessLogReturnRaw);
  const predictedPriceUsed = inflBaseline * Math.exp(excessUsed);

  return {
    runDir,
    runId: meta.runId,
    areaKey: meta.areaKey || path.basename(path.dirname(runDir)),
    annualInflationRate: meta.annualInflationRate,
    val_loss: meta.trainingFinal?.val_loss ?? null,
    val_mae: meta.trainingFinal?.val_mae ?? null,
    listingPriceNow: listingPriceNow || null,
    listingToLastSaleRatio: listingToLastSaleRatio || null,
    excessLogReturn: excessUsed,
    excessLogReturn_raw: excessLogReturnRaw,
    excessClipped,
    predictedPrice: predictedPriceUsed,
    predictedPrice_raw: predictedPriceRaw,
  };
}

/* ============================
   NEW: multi-input predict support
   ============================ */

function buildPredictOutput({
  mode,
  modelBaseDir,
  routedAreaGuess,
  used,
  finalExcess,
  annualInflationRate,
  prop,
  lastSale,
  daysAhead,
}) {
  const lastPrice = lastSale.price;
  const listingPriceNow = getListingPrice(prop);
  const listingToLastSaleRatio = lastPrice > 0 && listingPriceNow > 0 ? listingPriceNow / lastPrice : null;

  const inflBaseline = inflatePrice(lastPrice, daysAhead, annualInflationRate);
  const predictedPrice = inflBaseline * Math.exp(finalExcess);

  const predictedChangeFromLastSale = predictedPrice - lastPrice;
  const predictedPctChangeNominal = predictedChangeFromLastSale / Math.max(1, lastPrice);

  const inflFactor = inflateFactor(daysAhead, annualInflationRate);
  const predictedPctChangeInflationOnly = inflFactor - 1;
  const predictedPctChangeExcess = Math.exp(finalExcess) - 1;

  return {
    modelBaseDir,
    routedAreaGuess: routedAreaGuess || null,
    usedMode: mode,
    propertyId: prop.propertyId,
    address: {
      line1: prop?.address?.streetLine || prop?.address?.addressLine1 || null,
      city: prop?.address?.city || null,
      state: prop?.address?.state || null,
      zip: prop?.address?.zip || null,
    },
    anchorSaleDateMs: lastSale.dateMs,
    anchorSalePrice: lastPrice,
    listingPriceNow: listingPriceNow || null,
    listingToLastSaleRatio,
    daysAhead,
    annualInflationRate,
    inflationAdjustedBaseline: inflBaseline,
    predictedExcessLogReturn: finalExcess,
    predictedFuturePrice: predictedPrice,
    predictedChangeFromLastSale,
    predictedPctChangeNominal,
    predictedPctChangeInflationOnly,
    predictedPctChangeExcess,
    modelsUsed: used.slice(0, 12).map((m) => ({
      areaKey: m.areaKey,
      runId: m.runId,
      val_loss: m.val_loss,
      val_mae: m.val_mae,
      weight: m.weight,
      excessLogReturn_raw: m.excessLogReturn_raw,
      excessLogReturn_used: m.excessLogReturn,
      excessClipped: m.excessClipped,
      predictedFuturePrice_raw: m.predictedPrice_raw,
      routed: m.routed,
    })),
    modelsUsedCount: used.length,
    note: used.length > 12 ? "modelsUsed truncated to 12 for display" : null,
  };
}

async function predictOne({ modelBaseDir, prop, daysAhead, explicitRun = null, explicitArea = null }) {
  if (!prop || typeof prop !== "object") throw new Error("Input must contain a property object.");

  const lastSale = getLastSoldEvent(prop);
  if (!lastSale) {
    throw new Error("No SOLD events found in propertyHistory.events for this property; cannot anchor prediction.");
  }

  if (explicitRun) {
    const runDir = resolveRunDirFromBase(explicitRun);
    const r = await predictWithOneRun({ runDir, prop, daysAhead });
    if (!r) throw new Error(`Could not load model/meta from --run ${explicitRun}`);
    return buildPredictOutput({
      mode: "explicit_run",
      modelBaseDir,
      routedAreaGuess: null,
      used: [{ ...r, weight: 1, routed: true }],
      finalExcess: r.excessLogReturn,
      annualInflationRate: r.annualInflationRate,
      prop,
      lastSale,
      daysAhead,
    });
  }

  if (explicitArea) {
    const areaDir = path.join(modelBaseDir, "areas", explicitArea);
    const runDir = getLatestRunForAreaDir(areaDir);
    if (!runDir) throw new Error(`No latest run found for --area ${explicitArea}`);
    const r = await predictWithOneRun({ runDir, prop, daysAhead });
    if (!r) throw new Error(`Could not load model/meta from area ${explicitArea}`);
    return buildPredictOutput({
      mode: "explicit_area_latest",
      modelBaseDir,
      routedAreaGuess: explicitArea,
      used: [{ ...r, weight: 1, routed: true }],
      finalExcess: r.excessLogReturn,
      annualInflationRate: r.annualInflationRate,
      prop,
      lastSale,
      daysAhead,
    });
  }

  const guess = propertyAreaKeyGuess(prop);
  const bestAreaDir = pickBestAreaDir(modelBaseDir, guess);
  const routedRunDir = bestAreaDir ? getLatestRunForAreaDir(bestAreaDir) : null;

  if (routedRunDir) {
    const r = await predictWithOneRun({ runDir: routedRunDir, prop, daysAhead });
    if (!r) throw new Error("Routed model missing meta/model files.");
    return buildPredictOutput({
      mode: "routed_single_model",
      modelBaseDir,
      routedAreaGuess: guess,
      used: [{ ...r, weight: 1, routed: true }],
      finalExcess: r.excessLogReturn,
      annualInflationRate: r.annualInflationRate,
      prop,
      lastSale,
      daysAhead,
    });
  }

  const globalRun = resolveRunDirFromBase(modelBaseDir);
  if (fs.existsSync(path.join(globalRun, "meta.json")) && fs.existsSync(path.join(globalRun, "model.json"))) {
    const r = await predictWithOneRun({ runDir: globalRun, prop, daysAhead });
    if (r) {
      return buildPredictOutput({
        mode: "global_latest_fallback",
        modelBaseDir,
        routedAreaGuess: guess,
        used: [{ ...r, weight: 1, routed: false }],
        finalExcess: r.excessLogReturn,
        annualInflationRate: r.annualInflationRate,
        prop,
        lastSale,
        daysAhead,
      });
    }
  }

  const areaDirs = listAreaDirs(modelBaseDir);
  const runDirs = areaDirs.map(getLatestRunForAreaDir).filter(Boolean);
  if (!runDirs.length) throw new Error("No trained models found. Train first.");

  const preds = [];
  for (const rd of runDirs) {
    const r = await predictWithOneRun({ runDir: rd, prop, daysAhead });
    if (r) preds.push(r);
  }
  if (!preds.length) throw new Error("No usable models for ensemble.");

  let wSum = 0;
  let exSum = 0;
  const used = [];

  for (const p of preds) {
    const w = weightFromValLoss(p.val_loss);
    wSum += w;
    exSum += w * p.excessLogReturn;
    used.push({ ...p, weight: w, routed: false });
  }

  used.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const finalExcess = exSum / Math.max(1e-9, wSum);
  const annualInflationRateForOutput = used[0].annualInflationRate;

  return buildPredictOutput({
    mode: "ensemble_fallback",
    modelBaseDir,
    routedAreaGuess: guess,
    used,
    finalExcess,
    annualInflationRate: annualInflationRateForOutput,
    prop,
    lastSale,
    daysAhead,
  });
}

async function predictFromFile({ modelBaseDir, inputPath, daysAhead, explicitRun = null, explicitArea = null }) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const obj = JSON.parse(raw);

  const props = Array.isArray(obj) ? obj : [obj];
  if (!props.length) throw new Error("Input JSON must contain a property object or an array of property objects.");

  const outputs = [];
  for (const p of props) {
    const out = await predictOne({ modelBaseDir, prop: p, daysAhead, explicitRun, explicitArea });
    outputs.push(out);
  }

  return Array.isArray(obj) ? outputs : outputs[0];
}

/* ============================
   Exports (for utilities/results.js)
   ============================ */

module.exports = {
  // training
  trainAll,

  // prediction helpers
  predictOne,
  predictFromFile,
  extractSoldEvents,
};

/* ============================
   CLI runner
   ============================ */

if (require.main === module) {
  (async () => {
    const cmd = process.argv[2];

    if (cmd === "train") {
      const dbDir = argValue("--db", path.join(process.cwd(), "database"));
      const outBaseDir = argValue("--out", path.join(process.cwd(), "model"));
      const annualInflationRate = safeNumber(argValue("--inflation", "0.012"), 0.012);
      const autosplit = safeNumber(argValue("--autosplit", "1"), 1) ? 1 : 0;
      const minRows = Math.max(1, safeNumber(argValue("--minRows", "50"), 50));
      await trainAll({ dbDir, outBaseDir, annualInflationRate, autosplit, minRows });
      return;
    }

    if (cmd === "predict") {
      const modelBaseDir = argValue("--model", path.join(process.cwd(), "model"));
      const inputPath = argValue("--in", null);
      const daysAhead = safeNumber(argValue("--days", "90"), 90);
      const explicitRun = argValue("--run", null);
      const explicitArea = argValue("--area", null);
      if (!inputPath) throw new Error("Missing --in path/to/property.json");

      const out = await predictFromFile({ modelBaseDir, inputPath, daysAhead, explicitRun, explicitArea });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    console.log("Pass a command, please.");
  })().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}