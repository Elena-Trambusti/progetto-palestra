const fs = require("fs");
const path = require("path");

const MAX_CACHE_ROWS_PER_ZONE = 25000;
const MAX_HISTORY_FILE_BYTES =
  Number(process.env.HISTORY_MAX_FILE_BYTES) || 5 * 1024 * 1024;
const HISTORY_ROTATE_KEEP_LINES =
  Number(process.env.HISTORY_ROTATE_KEEP_LINES) || 25000;
/** @type {Map<string, { loaded: boolean, byZone: Map<string, any[]>, byNode: Map<string, any[]> }>} */
const caches = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readingsPath(dataDir) {
  return path.join(dataDir, "readings.jsonl");
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

function parseRow(line) {
  try {
    const row = JSON.parse(line);
    if (row && typeof row.zone === "string") return row;
  } catch {
    /* ignore malformed lines */
  }
  return null;
}

function ensureCache(dataDir) {
  let cache = caches.get(dataDir);
  if (!cache) {
    cache = { loaded: false, byZone: new Map(), byNode: new Map() };
    caches.set(dataDir, cache);
  }
  if (cache.loaded) return cache;

  const file = readingsPath(dataDir);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = parseRow(line);
      if (!row) continue;
      const arr = cache.byZone.get(row.zone) || [];
      arr.push(row);
      if (arr.length > MAX_CACHE_ROWS_PER_ZONE) {
        arr.splice(0, arr.length - MAX_CACHE_ROWS_PER_ZONE);
      }
      cache.byZone.set(row.zone, arr);

      if (typeof row.node === "string" && row.node) {
        const nArr = cache.byNode.get(row.node) || [];
        nArr.push(row);
        if (nArr.length > MAX_CACHE_ROWS_PER_ZONE) {
          nArr.splice(0, nArr.length - MAX_CACHE_ROWS_PER_ZONE);
        }
        cache.byNode.set(row.node, nArr);
      }
    }
  }
  cache.loaded = true;
  return cache;
}

function materializeRow({
  nodeId,
  zoneId,
  temp,
  water,
  humidityPct,
  co2Ppm,
  vocIndex,
  lightLux,
  flowLmin,
}) {
  return {
    iso: new Date().toISOString(),
    node: nodeId || null,
    zone: zoneId,
    temp,
    water,
    humidity:
      humidityPct === undefined || humidityPct === null
        ? null
        : Number(humidityPct),
    co2: co2Ppm === undefined || co2Ppm === null ? null : Number(co2Ppm),
    voc: vocIndex === undefined || vocIndex === null ? null : Number(vocIndex),
    light: lightLux === undefined || lightLux === null ? null : Number(lightLux),
    flow: flowLmin === undefined || flowLmin === null ? null : Number(flowLmin),
  };
}

function appendReading(
  dataDir,
  { nodeId, zoneId, temp, water, humidityPct, co2Ppm, vocIndex, lightLux, flowLmin }
) {
  ensureDir(dataDir);
  const row = materializeRow({
    nodeId,
    zoneId,
    temp,
    water,
    humidityPct,
    co2Ppm,
    vocIndex,
    lightLux,
    flowLmin,
  });
  const line = `${JSON.stringify(row)}\n`;
  const cache = ensureCache(dataDir);
  const arr = cache.byZone.get(zoneId) || [];
  arr.push(row);
  if (arr.length > MAX_CACHE_ROWS_PER_ZONE) {
    arr.splice(0, arr.length - MAX_CACHE_ROWS_PER_ZONE);
  }
  cache.byZone.set(zoneId, arr);

  if (nodeId) {
    const nArr = cache.byNode.get(nodeId) || [];
    nArr.push(row);
    if (nArr.length > MAX_CACHE_ROWS_PER_ZONE) {
      nArr.splice(0, nArr.length - MAX_CACHE_ROWS_PER_ZONE);
    }
    cache.byNode.set(nodeId, nArr);
  }

  fs.appendFile(readingsPath(dataDir), line, "utf8", (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[history] append failed", err.message || err);
      return;
    }
    rotateFileIfNeeded(
      readingsPath(dataDir),
      MAX_HISTORY_FILE_BYTES,
      HISTORY_ROTATE_KEEP_LINES
    );
  });
}

function readRawZoneRows(dataDir, zoneId, limit) {
  const cache = ensureCache(dataDir);
  const rows = cache.byZone.get(zoneId) || [];
  return rows.slice(-limit);
}

function readRawNodeRows(dataDir, nodeId, limit) {
  const cache = ensureCache(dataDir);
  const rows = cache.byNode.get(nodeId) || [];
  return rows.slice(-limit);
}

function readZoneSeries(dataDir, zoneId, limit) {
  return readRawZoneRows(dataDir, zoneId, limit).map((r) => {
    const d = new Date(r.iso);
    const label = Number.isNaN(d.getTime())
      ? String(r.iso).slice(11, 19)
      : d.toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
    return { label, value: Number(r.temp) };
  });
}

function readNodeSeries(dataDir, nodeId, limit) {
  return readRawNodeRows(dataDir, nodeId, limit).map((r) => {
    const d = new Date(r.iso);
    const label = Number.isNaN(d.getTime())
      ? String(r.iso).slice(11, 19)
      : d.toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
    return { label, value: Number(r.temp) };
  });
}

/**
 * Storico completo per grafici / export CSV.
 * @param {{ fromIso?: string, toIso?: string }} [range]
 */
function readZoneHistoryPoints(dataDir, zoneId, limit, range = {}) {
  const rows = readRawZoneRows(dataDir, zoneId, Math.min(20000, limit * 2));
  const fromMs = range.fromIso ? new Date(range.fromIso).getTime() : null;
  const toMs = range.toIso ? new Date(range.toIso).getTime() : null;

  const mapped = rows
    .map((r) => {
      const d = new Date(r.iso);
      const t = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      return {
        iso: String(r.iso || ""),
        t,
        temp: Number(r.temp),
        water: Number(r.water),
        humidity: r.humidity != null ? Number(r.humidity) : null,
        co2: r.co2 != null ? Number(r.co2) : null,
        voc: r.voc != null ? Number(r.voc) : null,
        light: r.light != null ? Number(r.light) : null,
        flow: r.flow != null ? Number(r.flow) : null,
      };
    })
    .filter((row) => {
      if (fromMs != null && Number.isFinite(fromMs) && row.t < fromMs)
        return false;
      if (toMs != null && Number.isFinite(toMs) && row.t > toMs) return false;
      return true;
    });

  return mapped.slice(-limit);
}

function readNodeHistoryPoints(dataDir, nodeId, limit, range = {}) {
  const rows = readRawNodeRows(dataDir, nodeId, Math.min(20000, limit * 2));
  const fromMs = range.fromIso ? new Date(range.fromIso).getTime() : null;
  const toMs = range.toIso ? new Date(range.toIso).getTime() : null;

  const mapped = rows
    .map((r) => {
      const d = new Date(r.iso);
      const t = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      return {
        iso: String(r.iso || ""),
        t,
        temp: Number(r.temp),
        water: Number(r.water),
        humidity: r.humidity != null ? Number(r.humidity) : null,
        co2: r.co2 != null ? Number(r.co2) : null,
        voc: r.voc != null ? Number(r.voc) : null,
        light: r.light != null ? Number(r.light) : null,
        flow: r.flow != null ? Number(r.flow) : null,
      };
    })
    .filter((row) => {
      if (fromMs != null && Number.isFinite(fromMs) && row.t < fromMs) return false;
      if (toMs != null && Number.isFinite(toMs) && row.t > toMs) return false;
      return true;
    });

  return mapped.slice(-limit);
}

/**
 * Ultimi campioni con timestamp e acqua (per ETA e anomalie).
 * @returns {Array<{ iso: string, t: number, water: number, temp?: number }>}
 */
function readZoneWaterSamples(dataDir, zoneId, limit = 400) {
  return readRawZoneRows(dataDir, zoneId, limit).map((r) => {
    const d = new Date(r.iso);
    const t = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
    const water = Number(r.water);
    return {
      iso: String(r.iso || ""),
      t,
      water,
      temp: Number(r.temp),
    };
  });
}

function mergeSeries(historyPoints, liveLabels, liveValues, maxTotal = 120) {
  const live = liveLabels.map((label, i) => ({
    label,
    value: liveValues[i],
  }));
  const merged = [...historyPoints, ...live].filter(
    (p) => p && typeof p.value === "number" && !Number.isNaN(p.value)
  );
  return merged.slice(-maxTotal);
}

module.exports = {
  appendReading,
  readZoneSeries,
  readNodeSeries,
  readZoneWaterSamples,
  readZoneHistoryPoints,
  readNodeHistoryPoints,
  mergeSeries,
};
