/* eslint-disable no-console */
/**
 * LoRa gateway simulator:
 * - invia payload LoRa-ready al backend (POST /api/ingest/reading)
 * - utile per demo end-to-end senza hardware
 *
 * Uso:
 *   node server/tools/loraGatewaySimulator.js
 *
 * Env:
 *   SIM_API_BASE=http://127.0.0.1:4000
 *   SIM_INGEST_SECRET=...
 *   SIM_API_KEY=...
 *   SIM_INTERVAL_MS=1500
 */

const API_BASE = (process.env.SIM_API_BASE || "http://127.0.0.1:4000").replace(
  /\/$/,
  ""
);
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS) || 1500;
const INGEST_SECRET = String(process.env.SIM_INGEST_SECRET || "").trim();
const API_KEY = String(process.env.SIM_API_KEY || "").trim();

const gatewayId = "gw-livorno-01";

const nodes = [
  { nodeId: "node-water-01", zoneId: "serbatoio-idrico" },
  { nodeId: "node-env-01", zoneId: "spogliatoi-ambientale" },
  { nodeId: "node-flow-01", zoneId: "linea-flusso" },
  { nodeId: "node-air-01", zoneId: "sala-pesi-aria" },
  { nodeId: "node-light-01", zoneId: "cardio-luce" },
];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeReading({ nodeId, zoneId }) {
  const batteryPercent = clamp(Math.round(rand(45, 98)), 0, 100);
  const rssi = Math.round(rand(-124, -96));
  const snr = Number(rand(-1.5, 9.5).toFixed(1));

  const sensors = {};

  // Temperatura sempre presente (server la richiede)
  sensors.temperatureC = Number(rand(21, 33).toFixed(1));

  // "Sesto Senso" Test - Simula perdita notturna alle 03:00
  const currentHour = new Date().getHours();
  const isNightLeakTest = currentHour >= 3 && currentHour < 4; // Test tra 03:00-04:00

  if (nodeId === "node-water-01") {
    sensors.levelPercent = Math.round(rand(10, 92));
  }
  if (nodeId === "node-env-01") {
    sensors.humidityPercent = Math.round(rand(30, 75));
    sensors.lightLux = Math.round(rand(70, 900));
  }
  if (nodeId === "node-flow-01") {
    // TEST PERDITA NOTTURNA: flusso anomalo 0.5 L/min tra 03:00-04:00
    if (isNightLeakTest) {
      sensors.flowLmin = 0.5; // Perdita notturna simulata
      console.log(`[SIMULAZIONE] 🚨 PERDITA NOTTURNA SIMULATA - node-flow-01: 0.5 L/min alle ${currentHour}:00`);
    } else {
      sensors.flowLmin = Number(rand(0.2, 26).toFixed(1));
    }
    sensors.levelPercent = Math.round(rand(15, 95));
  }
  if (nodeId === "node-air-01") {
    sensors.humidityPercent = Math.round(rand(25, 78));
    sensors.co2Ppm = Math.round(rand(420, 1300));
    sensors.vocIndex = Math.round(rand(60, 420));
  }
  if (nodeId === "node-light-01") {
    sensors.humidityPercent = Math.round(rand(25, 78));
    sensors.lightLux = Math.round(rand(40, 1400));
  }

  return {
    nodeId,
    zoneId,
    gatewayId,
    timestamp: new Date().toISOString(),
    source: "lora-gateway-sim",
    batteryPercent,
    rssi,
    snr,
    sensors,
  };
}

async function postIngest(payload) {
  const headers = { "content-type": "application/json" };
  if (INGEST_SECRET) headers["x-ingest-secret"] = INGEST_SECRET;
  if (API_KEY) headers["x-api-key"] = API_KEY;
  const res = await fetch(`${API_BASE}/api/ingest/reading`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ingest_failed HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  console.log(`[sim] LoRa gateway simulator -> ${API_BASE}`);
  console.log(`[sim] gatewayId=${gatewayId} interval=${INTERVAL_MS}ms`);
  console.log(
    `[sim] auth=${INGEST_SECRET ? "ingest-secret" : API_KEY ? "api-key" : "open"}`
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = pick(nodes);
    const payload = makeReading(node);
    try {
      const out = await postIngest(payload);
      const s = payload.sensors;
      console.log(
        `[sim] ok node=${payload.nodeId} zone=${payload.zoneId} T=${s.temperatureC}C bat=${payload.batteryPercent}% rssi=${payload.rssi} snr=${payload.snr} -> ${out.ok ? "ok" : "?"}`
      );
    } catch (e) {
      console.error(`[sim] error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

