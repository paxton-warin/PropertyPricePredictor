---
title: Dependencies
nav_order: 3
---

# Dependencies

This page lists all required and optional dependencies for **PropertyPredictor**, along with their purpose in the system.

---

## Runtime Requirements

- **Node.js** ≥ 18  
  Required to run all scripts (scraping, training, prediction).

- **npm** (bundled with Node.js)  
  Used for dependency management and scripts.

---

## Core Dependencies

- **@tensorflow/tfjs-node**  
  Node.js bindings for TensorFlow.  
  Used for model definition, training, saving, and inference.

- **fs / fs/promises** (Node core)  
  File system access for reading datasets, writing models, and handling JSON inputs/outputs.

- **path** (Node core)  
  Cross-platform path resolution.

- **child_process** (Node core)  
  Used by the wrapper to spawn training and prediction processes with proper environment variables.

---

## Scraping & Data Ingestion

- **node-fetch** (or native fetch in Node ≥ 18)  
  Performs HTTP requests to retrieve property data.

- **https** (Node core)  
  Low-level networking support when required.

---

## Configuration & Utilities

- **dotenv** (optional)  
  Used only if environment-based configuration is enabled (e.g., API keys, flags).

---

## Development Dependencies (Optional)

- **eslint**  
  Code quality and consistency.

- **prettier**  
  Formatting standardization.

---

## Platform Notes

### Windows
- TensorFlow requires `tfjs-node/deps/lib` to be added to `PATH` at runtime.  
  This is handled automatically by the provided wrapper script.

### macOS / Linux
- No manual `PATH` modification required.

---

## Installation

```bash
npm install
````

This installs all required dependencies defined in `package.json`.

---

## Verification

To confirm TensorFlow is correctly installed:

```bash
node -e "require('@tensorflow/tfjs-node'); console.log('tfjs-node loaded')"
```

If no error is thrown, the dependency stack is correctly configured.