const fs = require('fs');
const Papa = require('papaparse');
const tf = require('@tensorflow/tfjs-node');

const CSV_PATH = './housing.csv';
const TOP_K_ZIPCODES = 10;
const TEST_SPLIT = 0.2;
const BATCH_SIZE = 32;
const EPOCHS = 100;
const MODEL_SAVE_PATH = 'file://./saved-model';

async function main() {
  console.log('Loading CSV...');
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true }).data;

  const rows = parsed.map(r => ({
    price: parseFloat(r.price),
    sqft: parseFloat(r.sqft),
    beds: parseFloat(r.beds),
    baths: parseFloat(r.baths),
    zipcode: r.zipcode ? r.zipcode.trim() : ''
  })).filter(r => isFinite(r.price) && isFinite(r.sqft) && isFinite(r.beds) && isFinite(r.baths) && r.zipcode !== '');

  if (rows.length === 0) {
    console.error('No valid rows found in CSV. Check CSV formatting and required columns.');
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} valid rows.`);

  const zipcodeCounts = {};
  rows.forEach(r => zipcodeCounts[r.zipcode] = (zipcodeCounts[r.zipcode] || 0) + 1);
  const topZipcodes = Object.entries(zipcodeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_K_ZIPCODES)
    .map(p => p[0]);
  console.log('Top zipcodes:', topZipcodes);

  const featureObjects = rows.map(r => {
    const zipcodeOneHot = topZipcodes.map(z => (r.zipcode === z ? 1 : 0));
    const otherFlag = topZipcodes.includes(r.zipcode) ? 0 : 1;
    return {
      features: [r.sqft, r.beds, r.baths, ...zipcodeOneHot, otherFlag],
      label: r.price
    };
  });

  shuffleArray(featureObjects);
  const testSize = Math.round(featureObjects.length * TEST_SPLIT);
  const testSet = featureObjects.slice(0, testSize);
  const trainSet = featureObjects.slice(testSize);

  const X_train = trainSet.map(r => r.features);
  const y_train = trainSet.map(r => r.label);
  const X_test = testSet.map(r => r.features);
  const y_test = testSet.map(r => r.label);

  const { X_train_norm, X_test_norm, normMeta } = normalizeFeatures(X_train, X_test);

  const labelMeta = computeMeanStd(y_train);
  const y_train_norm = y_train.map(v => (v - labelMeta.mean) / labelMeta.std);
  const y_test_norm = y_test.map(v => (v - labelMeta.mean) / labelMeta.std);

  const xTrainTensor = tf.tensor2d(X_train_norm);
  const yTrainTensor = tf.tensor2d(y_train_norm, [y_train_norm.length, 1]);
  const xTestTensor = tf.tensor2d(X_test_norm);
  const yTestTensor = tf.tensor2d(y_test_norm, [y_test_norm.length, 1]);

  const inputDim = X_train_norm[0].length;
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [inputDim], units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: tf.losses.meanSquaredError,
    metrics: [tf.metrics.meanAbsoluteError]
  });

  console.log('Training model...');
  await model.fit(xTrainTensor, yTrainTensor, {
    batchSize: BATCH_SIZE,
    epochs: EPOCHS,
    validationData: [xTestTensor, yTestTensor],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        if ((epoch + 1) % 10 === 0 || epoch === 0) {
          console.log(`Epoch ${epoch + 1}/${EPOCHS} — loss: ${logs.loss.toFixed(4)} — val_loss: ${logs.val_loss.toFixed(4)} — mae: ${logs.meanAbsoluteError?.toFixed(4)}`);
        }
      }
    }
  });

  const evalResult = model.evaluate(xTestTensor, yTestTensor, { batchSize: TEST_SPLIT ? Math.min(BATCH_SIZE, X_test_norm.length) : BATCH_SIZE });
  const [testLossTensor, testMaeTensor] = Array.isArray(evalResult) ? evalResult : [evalResult];
  const testLoss = (await testLossTensor.data())[0];
  const testMae = (await testMaeTensor.data())[0];
  const testMaeDollars = Math.abs(testMae * labelMeta.std);

  console.log(`\nTest MSE (normalized): ${testLoss.toFixed(4)}`);
  console.log(`Test MAE (normalized): ${testMae.toFixed(4)} → approx $${Math.round(testMaeDollars).toLocaleString()}`);

  await model.save(MODEL_SAVE_PATH);
  const meta = {
    topZipcodes,
    normMeta,
    labelMeta
  };
  fs.writeFileSync('./model-metadata.json', JSON.stringify(meta, null, 2));
  console.log(`Model saved to ./saved-model and metadata written to model-metadata.json`);

  tf.dispose([xTrainTensor, yTrainTensor, xTestTensor, yTestTensor]);
  process.exit(0);
}



function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function normalizeFeatures(X_train, X_test) {
  const nFeatures = X_train[0].length;
  const mins = Array(nFeatures).fill(Number.POSITIVE_INFINITY);
  const maxs = Array(nFeatures).fill(Number.NEGATIVE_INFINITY);

  for (const row of X_train) {
    for (let i = 0; i < nFeatures; i++) {
      if (row[i] < mins[i]) mins[i] = row[i];
      if (row[i] > maxs[i]) maxs[i] = row[i];
    }
  }

  const X_train_norm = X_train.map(row => row.map((v, i) => {
    const denom = (maxs[i] - mins[i]) || 1;
    return (v - mins[i]) / denom;
  }));

  const X_test_norm = X_test.map(row => row.map((v, i) => {
    const denom = (maxs[i] - mins[i]) || 1;
    return (v - mins[i]) / denom;
  }));

  return {
    X_train_norm,
    X_test_norm,
    normMeta: { mins, maxs }
  };
}

function computeMeanStd(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std = Math.sqrt(variance) || 1;
  return { mean, std };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});