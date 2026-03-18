"use strict";

const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const tfLib = path.join(repoRoot, "node_modules", "@tensorflow", "tfjs-node", "deps", "lib");

const [, , mode, ...restArgs] = process.argv;

if (!mode) {
  console.error("Error: Missing mode. Use: train | predict | scrape");
  process.exit(1);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const MAIN_JS = path.join(repoRoot, "utilities", "main.js");
const SCRAPE_JS = path.join(repoRoot, "utilities", "scrape.js"); 
let scriptToRun = MAIN_JS;
let finalArgs = [...restArgs];

if (mode === "predict") {
  if (!hasFlag(restArgs, "--in")) {
    finalArgs = ["--in", path.join("input", "predict", "input.json"), ...finalArgs];
  }
}

if (mode === "scrape") {
  scriptToRun = SCRAPE_JS;

  if (!hasFlag(restArgs, "--name")) {
    finalArgs = ["--name", `scrape_${safeTimestamp()}`, ...finalArgs];
  }
}

const args =
  mode === "scrape"
    ? [scriptToRun, ...finalArgs]
    : [scriptToRun, mode, ...finalArgs];

const env = { ...process.env };

if (process.platform === "win32") {
  env.PATH = `${tfLib};${env.PATH || ""}`;
}

const child = spawn(process.execPath, args, {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
