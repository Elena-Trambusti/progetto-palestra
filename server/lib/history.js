const fs = require("fs");
const path = require("path");

const MAX_CACHE_ROWS_PER_ZONE = 25000;
/** @type {Map<string, { loaded: boolean, byZone: Map<string, any[]> }>} */
const caches = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readingsPath(dataDir) {
  return path.join(dataDir, "readings.jsonl");
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
    cache = { loaded: false, byZone: new Map() };
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
    }
  }
  cache.loaded = true;
  return cache;
}

function materializeRow({
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
  { zoneId, temp, water, humidityPct, co2Ppm, vocIndex, lightLux, flowLmin }
) {
  ensureDir(dataDir);
  const row = materializeRow({
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

  fs.appendFile(readingsPath(dataDir), line, "utf8", (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[history] append failed", err.message || err);
    }
  });
}

function readRawZoneRows(dataDir, zoneId, limit) {
  const cache = ensureCache(dataDir);
  const rows = cache.byZone.get(zoneId) || [];
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
  readZoneWaterSamples,
  readZoneHistoryPoints,
  mergeSeries,
};
