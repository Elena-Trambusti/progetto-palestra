#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const buildIndex = path.join(rootDir, "build", "index.html");

console.log("[start] rootDir:", rootDir);
console.log("[start] buildIndex:", buildIndex);
console.log("[start] build esiste:", fs.existsSync(buildIndex));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      GENERATE_SOURCEMAP: process.env.GENERATE_SOURCEMAP || "false",
      DISABLE_ESLINT_PLUGIN: process.env.DISABLE_ESLINT_PLUGIN || "true",
      INLINE_RUNTIME_CHUNK: process.env.INLINE_RUNTIME_CHUNK || "false",
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(buildIndex)) {
  console.log("[start] Frontend build mancante: eseguo npm run build...");
  run("npm", ["run", "build"]);
} else {
  console.log("[start] Frontend build presente.");
}

console.log("[start] Avvio server Node...");
run("node", ["server/index.js"]);
