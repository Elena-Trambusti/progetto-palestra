const fs = require("fs");
const path = require("path");

const MAX_EVENTS_FILE_BYTES =
  Number(process.env.NETWORK_EVENTS_MAX_FILE_BYTES) || 2 * 1024 * 1024;
const EVENTS_ROTATE_KEEP_LINES =
  Number(process.env.NETWORK_EVENTS_ROTATE_KEEP_LINES) || 5000;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function eventsPath(dataDir) {
  return path.join(dataDir, "network-events.jsonl");
}

function rotateFileIfNeeded(file, maxBytes, keepLines) {
  try {
    const st = fs.statSync(file);
    if (st.size <= maxBytes) return;
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-keepLines);
    fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* ignore rotation failures */
  }
}

function parseLine(line) {
  try {
    const row = JSON.parse(line);
    if (row && typeof row.message === "string" && typeof row.iso === "string") return row;
  } catch {
    /* ignore */
  }
  return null;
}

function loadRecent(dataDir, limit = 250) {
  const file = eventsPath(dataDir);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = parseLine(trimmed);
    if (!row) continue;
    rows.push(row);
  }
  return rows.slice(-limit);
}

function appendEvent(dataDir, evt) {
  ensureDir(dataDir);
  const file = eventsPath(dataDir);
  const line = `${JSON.stringify(evt)}\n`;
  fs.appendFile(file, line, "utf8", (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[networkEvents] append failed", err.message || err);
      return;
    }
    rotateFileIfNeeded(file, MAX_EVENTS_FILE_BYTES, EVENTS_ROTATE_KEEP_LINES);
  });
}

module.exports = { loadRecent, appendEvent };

