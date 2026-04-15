const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readingsPath(dataDir) {
  return path.join(dataDir, "readings.jsonl");
}

function appendReading(
  dataDir,
  { zoneId, temp, water, humidityPct, co2Ppm, vocIndex }
) {
  ensureDir(dataDir);
  const line = `${JSON.stringify({
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
  })}\n`;
  fs.appendFileSync(readingsPath(dataDir), line, "utf8");
}

function readRawZoneRows(dataDir, zoneId, limit) {
  const file = readingsPath(dataDir);
  if (!fs.existsSync(file)) return [];

  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r && r.zone === zoneId) rows.push(r);
    } catch {
      /* skip */
    }
  }
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
