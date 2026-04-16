/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.resolve(__dirname, "..", "data");
const targets = ["readings.jsonl", "network-events.jsonl"];

fs.mkdirSync(dataDir, { recursive: true });

for (const name of targets) {
  const filePath = path.join(dataDir, name);
  try {
    fs.unlinkSync(filePath);
    console.log(`[demo-reset] removed ${name}`);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.error(`[demo-reset] failed ${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (!process.exitCode) {
  console.log("[demo-reset] demo data reset complete");
}
