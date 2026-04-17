/* eslint-disable no-console */
require("dotenv").config();
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { parse: parseCookie } = require("cookie");
const { WebSocketServer } = require("ws");
const history = require("./lib/history");
const networkEventsStore = require("./lib/networkEvents");
const {
  maybeNotifyWaterLow,
  maybeNotifyWaterRapidDrop,
  maybeNotifyOpsAlert,
} = require("./lib/notify");
const { notifyEnvironmentEdges } = require("./lib/envNotifyEdges");
const { activeAlarmsForState } = require("./lib/envAlarms");
const {
  GATEWAYS,
  ZONES,
  NODES,
  FLOORS,
  planPathForFloor,
  findZone,
  findNode,
  findNodeByZone,
  findGateway,
} = require("./lib/zonesData");
const {
  computeWaterEta,
  detectRapidDrop,
} = require("./lib/waterInsights");
const {
  COOKIE,
  attachAuthRoutes,
  gateMiddleware,
  isValid,
} = require("./lib/sessions");
const { ingestTtnWebhook } = require("./lib/ttnIngest");

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const pgStore = DATABASE_URL ? require("./lib/postgresStore") : null;

const PORT = Number(process.env.PORT) || 4000;
const API_KEY = (process.env.API_KEY || "").trim();
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:3000").trim();
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true";
const AUTH_PASSWORD = String(process.env.AUTH_PASSWORD || "").trim();
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "data")
);
const NOTIFY_WEBHOOK = (process.env.NOTIFY_WEBHOOK_URL || "").trim();
const INGEST_SECRET = (process.env.INGEST_SECRET || "").trim();
const DISABLE_AUTO_TICK =
  String(process.env.DISABLE_AUTO_TICK || "").toLowerCase() === "true";
const NODE_ENV = String(process.env.NODE_ENV || "development").toLowerCase();
const IS_PROD = NODE_ENV === "production";
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").toLowerCase() === "true";
const AUTH_MIN_PASSWORD_LEN = Number(process.env.AUTH_MIN_PASSWORD_LEN) || 12;

const WATER_ETA_LOOKBACK_MS =
  Number(process.env.WATER_ETA_LOOKBACK_MS) || 45 * 60 * 1000;
const WATER_RAPID_WINDOW_MS =
  Number(process.env.WATER_RAPID_WINDOW_MS) || 10 * 60 * 1000;
const WATER_RAPID_DROP_PCT =
  Number(process.env.WATER_RAPID_DROP_PCT) || 12;
const OPS_ALERT_CHECK_EVERY_MS =
  Number(process.env.OPS_ALERT_CHECK_EVERY_MS) || 60 * 1000;
const OPS_ALERT_WINDOW_MS =
  Number(process.env.OPS_ALERT_WINDOW_MS) || 5 * 60 * 1000;
const OPS_ALERT_5XX_RATE_PCT =
  Number(process.env.OPS_ALERT_5XX_RATE_PCT) || 1;
const OPS_ALERT_WS_REJECTS_DELTA =
  Number(process.env.OPS_ALERT_WS_REJECTS_DELTA) || 5;
const OPS_ALERT_INGEST_REJECTS_DELTA =
  Number(process.env.OPS_ALERT_INGEST_REJECTS_DELTA) || 5;
const OPS_ALERT_MIN_REQUESTS =
  Number(process.env.OPS_ALERT_MIN_REQUESTS) || 30;

if (REQUIRE_AUTH && !AUTH_PASSWORD) {
  console.error(
    "[config] REQUIRE_AUTH=true ma AUTH_PASSWORD è vuota. Imposta AUTH_PASSWORD nel file .env del server."
  );
  process.exit(1);
}

if (IS_PROD) {
  if (!REQUIRE_AUTH) {
    console.error("[config] In production REQUIRE_AUTH deve essere true.");
    process.exit(1);
  }
  if (!INGEST_SECRET) {
    console.error("[config] In production devi impostare INGEST_SECRET.");
    process.exit(1);
  }
  if (CORS_ORIGIN === "*") {
    console.error("[config] In production CORS_ORIGIN='*' non è consentito.");
    process.exit(1);
  }
  if (AUTH_PASSWORD.length < AUTH_MIN_PASSWORD_LEN) {
    console.error(
      `[config] AUTH_PASSWORD troppo corta: minimo ${AUTH_MIN_PASSWORD_LEN} caratteri in production.`
    );
    process.exit(1);
  }
}

function logEvent(level, msg, extra = {}) {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...extra,
  };
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }
  console.log(line);
}

function hashZoneSeed(id) {
  let s = 0;
  for (let i = 0; i < id.length; i += 1) s += id.charCodeAt(i);
  return (s % 97) / 97;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function formatTime(d) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function createInitialState(zoneId) {
  const seed = hashZoneSeed(zoneId);
  const zone = findZone(zoneId) || ZONES[0];
  const node = findNodeByZone(zoneId);
  return {
    labels: [],
    values: [],
    lastTemp: 24 + seed * 10,
    water: 45 + seed * 45,
    humidityPct: Math.min(68, Math.max(32, 40 + seed * 28)),
    co2Ppm: Math.min(950, Math.max(420, 520 + Math.floor(seed * 380))),
    vocIndex: Math.min(280, Math.max(45, 90 + Math.floor(seed * 160))),
    lightLux: Math.min(900, Math.max(140, 220 + Math.floor(seed * 520))),
    flowLmin: Math.max(0, 4 + seed * 11),
    batteryPercent: Math.max(54, 93 - Math.floor(seed * 20)),
    rssi: -121 + Math.floor(seed * 18),
    snr: Number((2.1 + seed * 8.2).toFixed(1)),
    nodeId: node?.id || zone.primaryNodeId || zone.id,
    nodeLabel: node?.label || zone.name,
    gatewayId: node?.gatewayId || GATEWAYS[0]?.id || "gw-livorno-01",
    uplinkAt: new Date().toISOString(),
    nodeStatus: zone.kind === "gateway" ? "gateway" : "online",
    zoneKind: zone.kind || "",
    waterRapidDrop: false,
    waterRapidDropDelta: null,
    logLines: [
      `[INFO] ${formatTime(new Date())} · Nodo ${node?.label || zoneId} online · uplink LoRa agganciato`,
    ],
  };
}

const store = Object.fromEntries(ZONES.map((z) => [z.id, createInitialState(z.id)]));

const SENSORS = NODES.map((node) => node.label);

const EVENT_BUFFER_MAX = Number(process.env.NETWORK_EVENT_BUFFER_MAX) || 250;
/** @type {Array<{ iso: string, t: number, type: string, severity: string, nodeId?: string, nodeLabel?: string, zoneId?: string, zoneName?: string, message: string, data?: any }>} */
const networkEvents = networkEventsStore.loadRecent(DATA_DIR, EVENT_BUFFER_MAX);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampFinite(value, min, max, fallback) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeNetworkStatus(lastUplinkIso, fallback = "online") {
  if (!lastUplinkIso) return fallback;
  const ageMs = Date.now() - new Date(lastUplinkIso).getTime();
  if (!Number.isFinite(ageMs)) return fallback;
  if (ageMs > 4 * 60 * 1000) return "offline";
  if (ageMs > 75 * 1000) return "stale";
  return fallback === "gateway" ? "gateway" : "online";
}

function pushNetworkEvent(evt) {
  const iso = new Date().toISOString();
  const row = {
    iso,
    t: Date.now(),
    ...evt,
  };
  networkEvents.push(row);
  if (networkEvents.length > EVENT_BUFFER_MAX) {
    networkEvents.splice(0, networkEvents.length - EVENT_BUFFER_MAX);
  }
  networkEventsStore.appendEvent(DATA_DIR, row);
}

function maybeEmitNodeStatusTransition(zoneId, prevStatus, nextStatus) {
  if (!prevStatus || !nextStatus) return;
  if (prevStatus === nextStatus) return;
  const zone = findZone(zoneId);
  const node = findNodeByZone(zoneId);
  const label = node?.label || zone?.name || zoneId;
  const severity =
    nextStatus === "offline"
      ? "critical"
      : nextStatus === "stale"
        ? "warning"
        : "info";
  pushNetworkEvent({
    type: "node_status",
    severity,
    nodeId: node?.id,
    nodeLabel: label,
    zoneId,
    zoneName: zone?.name || zoneId,
    message: `Nodo ${label}: ${prevStatus} → ${nextStatus}`,
    data: { prevStatus, nextStatus },
  });
}

function networkAlarmsForState(st) {
  const alarms = [];
  if (st.nodeStatus === "offline") {
    alarms.push({
      code: "node_offline",
      severity: "critical",
      message: `Nodo remoto ${st.nodeLabel || st.nodeId} offline`,
      value: null,
    });
  } else if (st.nodeStatus === "stale") {
    alarms.push({
      code: "node_stale",
      severity: "warning",
      message: `Uplink nodo ${st.nodeLabel || st.nodeId} in ritardo`,
      value: null,
    });
  }
  if (Number.isFinite(st.batteryPercent) && st.batteryPercent <= 25) {
    alarms.push({
      code: "battery_low",
      severity: "warning",
      message: `Batteria nodo bassa (${Math.round(st.batteryPercent)} %)`,
      value: Math.round(st.batteryPercent),
    });
  }
  if (Number.isFinite(st.rssi) && st.rssi <= -118) {
    alarms.push({
      code: "signal_weak",
      severity: "info",
      message: `Segnale LoRa debole (${Math.round(st.rssi)} dBm)`,
      value: Math.round(st.rssi),
    });
  }
  return alarms;
}

function activeAlarmsIncludingNetwork(st) {
  return [...activeAlarmsForState(st), ...networkAlarmsForState(st)];
}

function networkStatusSummary() {
  const nodes = NODES.map((node) => {
    const state = store[node.zoneId];
    const gateway = findGateway(node.gatewayId);
    const status = normalizeNetworkStatus(state?.uplinkAt, state?.nodeStatus || "online");
    return {
      id: node.id,
      label: node.label,
      zoneId: node.zoneId,
      zoneName: findZone(node.zoneId)?.name || node.zoneId,
      gatewayId: node.gatewayId,
      gatewayName: gateway?.name || node.gatewayId,
      sensors: node.sensors,
      hardware: node.hardware,
      floor: node.floor,
      mapX: node.mapX,
      mapY: node.mapY,
      batteryPercent: state?.batteryPercent ?? null,
      rssi: state?.rssi ?? null,
      snr: state?.snr ?? null,
      uplinkAt: state?.uplinkAt || null,
      status,
      metrics: {
        temperatureC: state?.lastTemp ?? null,
        humidityPercent: state?.humidityPct ?? null,
        lightLux: state?.lightLux ?? null,
        flowLmin: state?.flowLmin ?? null,
        levelPercent: state?.water ?? null,
        co2Ppm: state?.co2Ppm ?? null,
        vocIndex: state?.vocIndex ?? null,
      },
    };
  });
  return {
    gateway: GATEWAYS[0] || null,
    totals: {
      nodes: nodes.length,
      online: nodes.filter((node) => node.status === "online").length,
      stale: nodes.filter((node) => node.status === "stale").length,
      offline: nodes.filter((node) => node.status === "offline").length,
    },
    nodes,
    events: networkEvents.slice(-80),
  };
}

function normalizeReadingPayload(body) {
  const zoneIdRaw = String(body?.zoneId || "").trim();
  const nodeIdRaw = String(body?.nodeId || "").trim();
  const zone = (zoneIdRaw && findZone(zoneIdRaw)) || (nodeIdRaw && findZone(findNode(nodeIdRaw)?.zoneId)) || null;
  const node =
    (nodeIdRaw && findNode(nodeIdRaw)) ||
    (zone?.primaryNodeId ? findNode(zone.primaryNodeId) : null) ||
    null;
  if (!zone || !node) {
    return {
      error: "invalid_target",
      zones: ZONES.map((item) => item.id),
      nodes: NODES.map((item) => item.id),
    };
  }

  const sensors = body?.sensors && typeof body.sensors === "object" ? body.sensors : {};
  const tempC = body?.temperatureC ?? body?.tempC ?? sensors.temperatureC;
  if (!Number.isFinite(Number(tempC))) {
    return { error: "temperatureC_required" };
  }

  const waterPct =
    body?.waterPercent ??
    body?.levelPercent ??
    sensors.waterPercent ??
    sensors.levelPercent ??
    null;
  const humidityPct =
    body?.humidityPercent ??
    body?.humidityPct ??
    body?.rh ??
    sensors.humidityPercent ??
    sensors.humidityPct ??
    sensors.rh ??
    null;
  const co2Ppm = body?.co2Ppm ?? body?.co2 ?? sensors.co2Ppm ?? sensors.co2 ?? null;
  const vocIndex = body?.vocIndex ?? body?.voc ?? body?.iaq ?? sensors.vocIndex ?? sensors.voc ?? sensors.iaq ?? null;
  const lightLux = body?.lightLux ?? sensors.lightLux ?? null;
  const flowLmin = body?.flowLmin ?? sensors.flowLmin ?? null;
  const batteryPercent = body?.batteryPercent ?? body?.battery ?? null;
  const rssi = body?.rssi ?? null;
  const snr = body?.snr ?? null;
  const gatewayId = String(body?.gatewayId || node.gatewayId || "").trim() || node.gatewayId;
  const timestamp = String(body?.timestamp || new Date().toISOString()).trim();
  const source = String(body?.source || "lora-gateway").slice(0, 64);

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    nodeId: node.id,
    nodeLabel: node.label,
    gatewayId,
    timestamp,
    source,
    tempC: Number(tempC),
    waterPct: waterPct == null ? null : clampFinite(waterPct, 0, 100, null),
    humidityPct: humidityPct == null ? null : clampFinite(humidityPct, 0, 100, null),
    co2Ppm: co2Ppm == null ? null : clampFinite(co2Ppm, 0, 5000, null),
    vocIndex: vocIndex == null ? null : clampFinite(vocIndex, 0, 2000, null),
    lightLux: lightLux == null ? null : clampFinite(lightLux, 0, 20000, null),
    flowLmin: flowLmin == null ? null : clampFinite(flowLmin, 0, 1000, null),
    batteryPercent:
      batteryPercent == null ? null : clampFinite(batteryPercent, 0, 100, null),
    rssi: rssi == null ? null : clampFinite(rssi, -160, -1, null),
    snr: snr == null ? null : clampFinite(snr, -30, 30, null),
  };
}

function tickZone(zoneId) {
  const z = findZone(zoneId);
  const st = store[zoneId];
  if (!st || !z) return;
  const node = findNodeByZone(zoneId);
  st.zoneKind = z.kind || st.zoneKind || "";

  const prevWater = st.water;
  const prevEnv = {
    lastTemp: st.lastTemp,
    humidityPct: st.humidityPct,
    co2Ppm: st.co2Ppm,
    vocIndex: st.vocIndex,
  };

  const t = formatTime(new Date());
  const sensor = pick(SENSORS);
  const kinds = ["INFO", "OK", "RX"];
  const kind = pick(kinds);
  const msgs = [
    `Uplink LoRa ${sensor} [${z.name}] validato`,
    `Campione telemetria distribuita ${z.id}`,
    `Payload nodo ${node?.id || z.id} normalizzato`,
    `Gateway centrale ha inoltrato il pacchetto`,
  ];
  const msg = pick(msgs);

  const nextTemp = Math.min(
    40,
    Math.max(21, (st.lastTemp ?? 28) + randomBetween(-1.1, 1.1))
  );
  const nextWater = Math.min(
    100,
    Math.max(4, (st.water ?? 70) + randomBetween(-3.5, 2.8))
  );
  const nextHum = Math.min(
    78,
    Math.max(26, (st.humidityPct ?? 50) + randomBetween(-2.2, 2))
  );
  const nextCo2 = Math.min(
    1550,
    Math.max(380, (st.co2Ppm ?? 650) + randomBetween(-45, 55))
  );
  const nextVoc = Math.min(
    420,
    Math.max(35, (st.vocIndex ?? 120) + randomBetween(-18, 22))
  );
  const nextLight = Math.min(
    1600,
    Math.max(20, (st.lightLux ?? 320) + randomBetween(-60, 85))
  );
  const nextFlow = Math.min(
    26,
    Math.max(0, (st.flowLmin ?? 8) + randomBetween(-1.6, 1.8))
  );
  const nextBattery = Math.max(
    12,
    Math.min(100, (st.batteryPercent ?? 84) + randomBetween(-0.22, 0.05))
  );
  const nextRssi = Math.min(
    -92,
    Math.max(-126, (st.rssi ?? -110) + randomBetween(-2.3, 1.7))
  );
  const nextSnr = Math.min(
    12,
    Math.max(-3, (st.snr ?? 5.4) + randomBetween(-0.8, 0.65))
  );
  const packetRoll = Math.random();
  const nextNodeStatus =
    z.kind === "gateway" ? "gateway" : packetRoll < 0.04 ? "offline" : packetRoll < 0.14 ? "stale" : "online";
  const uplinkLagSec = nextNodeStatus === "offline" ? 380 : nextNodeStatus === "stale" ? 110 : 4;

  const labels = [...st.labels, t];
  const values = [...st.values, nextTemp];
  const maxPoints = 20;
  if (labels.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  const line = `[${kind}] ${t} · ${msg}`;
  const logLines = [...st.logLines, line].slice(-35);

  st.labels = labels;
  st.values = values;
  st.lastTemp = nextTemp;
  st.water = nextWater;
  st.humidityPct = nextHum;
  st.co2Ppm = nextCo2;
  st.vocIndex = nextVoc;
  st.lightLux = nextLight;
  st.flowLmin = nextFlow;
  st.batteryPercent = nextBattery;
  st.rssi = nextRssi;
  st.snr = Number(nextSnr.toFixed(1));
  st.nodeId = node?.id || st.nodeId;
  st.nodeLabel = node?.label || st.nodeLabel;
  st.gatewayId = node?.gatewayId || st.gatewayId;
  st.uplinkAt = new Date(Date.now() - uplinkLagSec * 1000).toISOString();
  const prevStatus = st.nodeStatus;
  st.nodeStatus = normalizeNetworkStatus(st.uplinkAt, nextNodeStatus);
  maybeEmitNodeStatusTransition(zoneId, prevStatus, st.nodeStatus);
  st.logLines = logLines;

  history.appendReading(DATA_DIR, {
    nodeId: st.nodeId,
    zoneId,
    temp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
    lightLux: nextLight,
    flowLmin: nextFlow,
  });

  notifyEnvironmentEdges({
    zoneId,
    zoneName: z.name,
    prev: prevEnv,
    next: {
      lastTemp: nextTemp,
      humidityPct: nextHum,
      co2Ppm: nextCo2,
      vocIndex: nextVoc,
    },
    webhookUrl: NOTIFY_WEBHOOK,
  });

  maybeNotifyWaterLow({
    zoneId,
    zoneName: z.name,
    prevWater,
    nextWater,
    webhookUrl: NOTIFY_WEBHOOK,
  });

  const waterSamples = history.readZoneWaterSamples(DATA_DIR, zoneId, 500);
  const rapid = detectRapidDrop(waterSamples, nextWater, {
    windowMs: WATER_RAPID_WINDOW_MS,
    dropPct: WATER_RAPID_DROP_PCT,
  });
  st.waterRapidDrop = rapid.waterRapidDrop;
  st.waterRapidDropDelta = rapid.waterRapidDropDelta;
  maybeNotifyWaterRapidDrop({
    zoneId,
    zoneName: z.name,
    isRapid: rapid.waterRapidDrop,
    deltaPercent: rapid.waterRapidDropDelta,
    webhookUrl: NOTIFY_WEBHOOK,
  });
}

/**
 * Campione inviato da dispositivo esterno (es. Arduino / ESP32 via HTTP).
 */
function applyManualReading(zoneId, payload) {
  const z = findZone(zoneId);
  const st = store[zoneId];
  if (!st || !z) return false;
  st.zoneKind = z.kind || st.zoneKind || "";

  const {
    tempC,
    waterPct,
    humidityPct: humIn,
    co2Ppm: co2In,
    vocIndex: vocIn,
    lightLux: lightIn,
    flowLmin: flowIn,
    batteryPercent: batteryIn,
    rssi: rssiIn,
    snr: snrIn,
    source,
    nodeId,
    nodeLabel,
    gatewayId,
    timestamp,
  } = payload;

  const prevWater = st.water;
  const prevEnv = {
    lastTemp: st.lastTemp,
    humidityPct: st.humidityPct,
    co2Ppm: st.co2Ppm,
    vocIndex: st.vocIndex,
  };

  const t = formatTime(new Date());
  const nextTemp = Math.min(50, Math.max(15, Number(tempC)));
  const nextWater =
    waterPct != null && Number.isFinite(Number(waterPct))
      ? Math.min(100, Math.max(0, Number(waterPct)))
      : st.water;

  const nextHum =
    humIn != null && Number.isFinite(Number(humIn))
      ? Math.min(100, Math.max(0, Number(humIn)))
      : st.humidityPct;
  const nextCo2 =
    co2In != null && Number.isFinite(Number(co2In))
      ? Math.min(5000, Math.max(0, Number(co2In)))
      : st.co2Ppm;
  const nextVoc =
    vocIn != null && Number.isFinite(Number(vocIn))
      ? Math.min(2000, Math.max(0, Number(vocIn)))
      : st.vocIndex;
  const nextLight =
    lightIn != null && Number.isFinite(Number(lightIn))
      ? Math.min(20000, Math.max(0, Number(lightIn)))
      : st.lightLux;
  const nextFlow =
    flowIn != null && Number.isFinite(Number(flowIn))
      ? Math.min(1000, Math.max(0, Number(flowIn)))
      : st.flowLmin;
  const nextBattery =
    batteryIn != null && Number.isFinite(Number(batteryIn))
      ? Math.min(100, Math.max(0, Number(batteryIn)))
      : st.batteryPercent;
  const nextRssi =
    rssiIn != null && Number.isFinite(Number(rssiIn))
      ? Math.min(-1, Math.max(-160, Number(rssiIn)))
      : st.rssi;
  const nextSnr =
    snrIn != null && Number.isFinite(Number(snrIn))
      ? Math.min(30, Math.max(-30, Number(snrIn)))
      : st.snr;

  const labels = [...st.labels, t];
  const values = [...st.values, nextTemp];
  const maxPoints = 20;
  if (labels.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  const tag = String(source || "device").slice(0, 48);
  const nodeTag = String(nodeLabel || nodeId || z.primaryNodeId || z.id);
  const line = `[INGEST] ${t} · ${tag} · ${nodeTag} · T=${nextTemp.toFixed(1)} °C · RH=${Number(nextHum).toFixed(0)}% · RSSI=${Math.round(nextRssi)} dBm · ${z.name}`;
  const logLines = [...st.logLines, line].slice(-35);

  st.labels = labels;
  st.values = values;
  st.lastTemp = nextTemp;
  st.water = nextWater;
  st.humidityPct = nextHum;
  st.co2Ppm = nextCo2;
  st.vocIndex = nextVoc;
  st.lightLux = nextLight;
  st.flowLmin = nextFlow;
  st.batteryPercent = nextBattery;
  st.rssi = nextRssi;
  st.snr = nextSnr != null ? Number(nextSnr.toFixed(1)) : st.snr;
  st.nodeId = nodeId || st.nodeId;
  st.nodeLabel = nodeLabel || st.nodeLabel;
  st.gatewayId = gatewayId || st.gatewayId;
  st.uplinkAt = timestamp || new Date().toISOString();
  const prevStatus = st.nodeStatus;
  st.nodeStatus = normalizeNetworkStatus(
    st.uplinkAt,
    z.kind === "gateway" ? "gateway" : "online"
  );
  maybeEmitNodeStatusTransition(zoneId, prevStatus, st.nodeStatus);
  st.logLines = logLines;

  history.appendReading(DATA_DIR, {
    nodeId: st.nodeId,
    zoneId,
    temp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
    lightLux: nextLight,
    flowLmin: nextFlow,
  });

  notifyEnvironmentEdges({
    zoneId,
    zoneName: z.name,
    prev: prevEnv,
    next: {
      lastTemp: nextTemp,
      humidityPct: nextHum,
      co2Ppm: nextCo2,
      vocIndex: nextVoc,
    },
    webhookUrl: NOTIFY_WEBHOOK,
  });

  maybeNotifyWaterLow({
    zoneId,
    zoneName: z.name,
    prevWater,
    nextWater,
    webhookUrl: NOTIFY_WEBHOOK,
  });

  const waterSamples = history.readZoneWaterSamples(DATA_DIR, zoneId, 500);
  const rapid = detectRapidDrop(waterSamples, nextWater, {
    windowMs: WATER_RAPID_WINDOW_MS,
    dropPct: WATER_RAPID_DROP_PCT,
  });
  st.waterRapidDrop = rapid.waterRapidDrop;
  st.waterRapidDropDelta = rapid.waterRapidDropDelta;
  maybeNotifyWaterRapidDrop({
    zoneId,
    zoneName: z.name,
    isRapid: rapid.waterRapidDrop,
    deltaPercent: rapid.waterRapidDropDelta,
    webhookUrl: NOTIFY_WEBHOOK,
  });
  return true;
}

function alarmLevelForState(st) {
  const alarms = activeAlarmsIncludingNetwork(st);
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warning")) return "warning";
  if (alarms.length) return "info";
  return "ok";
}

function buildLegacySnapshotPayload(zoneId) {
  const z = findZone(zoneId) || ZONES[0];
  const st = store[z.id];
  const node = findNodeByZone(z.id);
  const gateway = findGateway(st.gatewayId || node?.gatewayId || GATEWAYS[0]?.id);
  const hist = history.readZoneSeries(DATA_DIR, z.id, 100);
  const merged = history.mergeSeries(hist, st.labels, st.values, 120);
  const temperatureSeries = merged;

  const waterSamples = history.readZoneWaterSamples(DATA_DIR, z.id, 500);
  const eta = computeWaterEta(waterSamples, st.water, {
    lookbackMs: WATER_ETA_LOOKBACK_MS,
  });
  const rapid = detectRapidDrop(waterSamples, st.water, {
    windowMs: WATER_RAPID_WINDOW_MS,
    dropPct: WATER_RAPID_DROP_PCT,
  });

  const network = networkStatusSummary();
  const siteZones = ZONES.map((zz) => {
    const s = store[zz.id];
    const zoneNode = findNodeByZone(zz.id);
    return {
      id: zz.id,
      name: zz.name,
      floor: zz.floor,
      mapX: zz.mapX,
      mapY: zz.mapY,
      planPath: planPathForFloor(zz.floor),
      kind: zz.kind,
      primaryNodeId: zz.primaryNodeId || zoneNode?.id || null,
      temperatureC: s.lastTemp,
      waterPercent: s.water,
      humidityPercent: s.humidityPct,
      co2Ppm: s.co2Ppm,
      vocIndex: s.vocIndex,
      lightLux: s.lightLux,
      flowLmin: s.flowLmin,
      batteryPercent: s.batteryPercent,
      rssi: s.rssi,
      snr: s.snr,
      uplinkAt: s.uplinkAt,
      nodeStatus: normalizeNetworkStatus(s.uplinkAt, s.nodeStatus),
      alarmLevel: alarmLevelForState(s),
    };
  });

  return {
    zone: {
      id: z.id,
      name: z.name,
      floor: z.floor,
      mapX: z.mapX,
      mapY: z.mapY,
      planPath: planPathForFloor(z.floor),
    },
    facility: {
      name: "Centrale IoT distribuita · Livorno",
      city: "Livorno",
      zones: ZONES.length,
      nodes: NODES.length,
      gateways: GATEWAYS.length,
    },
    floors: FLOORS.map((f) => ({
      id: f.id,
      label: f.label,
      planPath: planPathForFloor(f.id),
    })),
    siteZones,
    temperatureSeries,
    currentTemperature: st.lastTemp,
    waterLevelPercent: st.water,
    environment: {
      humidityPercent: st.humidityPct,
      co2Ppm: st.co2Ppm,
      vocIndex: st.vocIndex,
      lightLux: st.lightLux,
      flowLmin: st.flowLmin,
    },
    telemetry: {
      nodeId: st.nodeId,
      nodeLabel: st.nodeLabel,
      gatewayId: st.gatewayId,
      gatewayName: gateway?.name || st.gatewayId,
      batteryPercent: st.batteryPercent,
      rssi: st.rssi,
      snr: st.snr,
      uplinkAt: st.uplinkAt,
      nodeStatus: normalizeNetworkStatus(st.uplinkAt, st.nodeStatus),
      flowLmin: st.flowLmin,
      lightLux: st.lightLux,
      sensors: node?.sensors || [],
    },
    network,
    activeAlarms: activeAlarmsIncludingNetwork(st),
    waterEtaHours: eta.waterEtaHours,
    waterEtaConfidence: eta.waterEtaConfidence,
    waterDepletionRatePctPerHour: eta.waterDepletionRatePctPerHour,
    waterRapidDrop: rapid.waterRapidDrop,
    waterRapidDropDelta: rapid.waterRapidDropDelta,
    logLines: st.logLines,
  };
}

/**
 * Associa la stringa richiesta (query string / UI) alla `location` esatta nel DB:
 * uguaglianza diretta, NFC Unicode, spazi compressi e trim — così zone con spazi
 * o caratteri speciali restano allineate tra catalogo e filtro snapshot.
 */
function resolvePostgresLocation(wantRaw, locs) {
  const locList = Array.isArray(locs) ? locs.map((x) => String(x)) : [];
  if (!locList.length) return null;
  const want = String(wantRaw ?? "").trim();
  if (!want) return locList[0];

  if (locList.includes(want)) return want;

  const wantNfc = want.normalize("NFC");
  for (const loc of locList) {
    if (loc.normalize("NFC") === wantNfc) return loc;
  }

  const collapse = (s) => s.replace(/\s+/g, " ").trim();
  const wantC = collapse(want);
  for (const loc of locList) {
    if (collapse(loc) === wantC) return loc;
  }

  return null;
}

/**
 * Snapshot unificato: con PostgreSQL legge zone (location) da tabella sensors;
 * in assenza di DATABASE_URL mantiene il modello legacy in-memory.
 */
async function buildSnapshotPayload(zoneId) {
  if (pgStore) {
    const locs = await pgStore.listDistinctLocations();
    if (!locs.length) {
      return {
        dataProfile: "postgres",
        zone: { id: "", name: "—", floor: "", mapX: 50, mapY: 50, planPath: null },
        facility: {
          name: "Centrale IoT · PostgreSQL",
          city: "",
          zones: 0,
          nodes: 0,
          gateways: 0,
        },
        floors: [],
        siteZones: [],
        temperatureSeries: [],
        currentTemperature: null,
        waterLevelPercent: 0,
        environment: {},
        telemetry: {
          nodeId: "",
          nodeLabel: "",
          gatewayId: "",
          gatewayName: "",
          batteryPercent: null,
          rssi: null,
          snr: null,
          uplinkAt: null,
          nodeStatus: "offline",
          sensors: [],
        },
        network: {
          gateway: { id: "ttn", name: "The Things Network" },
          totals: { nodes: 0, online: 0, stale: 0, offline: 0 },
          nodes: [],
          events: [],
        },
        activeAlarms: [],
        sensorCards: [],
        waterEtaHours: null,
        waterEtaConfidence: null,
        waterDepletionRatePctPerHour: null,
        waterRapidDrop: false,
        waterRapidDropDelta: null,
        logLines: [
          "[WARN] Nessun sensore in anagrafica: usa il pannello #configurazione o l'API admin.",
        ],
      };
    }
    const want = String(zoneId || "").trim();
    const resolved = resolvePostgresLocation(want, locs);
    const effective = resolved ?? locs[0];
    return pgStore.buildDashboardPayload(effective);
  }
  return buildLegacySnapshotPayload(zoneId);
}

async function resolveSnapshotZoneOrError(qZone) {
  if (pgStore) {
    const locs = await pgStore.listDistinctLocations();
    if (!locs.length) {
      return { ok: true, zoneId: "", empty: true };
    }
    const z = String(qZone || "").trim();
    if (!z) return { ok: true, zoneId: locs[0], empty: false };
    const resolved = resolvePostgresLocation(z, locs);
    if (!resolved) return { ok: false, error: "invalid_zone_id" };
    return { ok: true, zoneId: resolved, empty: false };
  }
  const zone = resolveZoneQuery(qZone);
  if (!zone.ok) return { ok: false, error: zone.error };
  return { ok: true, zoneId: zone.zoneId, empty: false };
}

const app = express();
const metrics = {
  startedAt: Date.now(),
  requestsTotal: 0,
  requests4xx: 0,
  requests5xx: 0,
  requests2xx: 0,
  requests3xx: 0,
  requestDurationMsTotal: 0,
  requestDurationMsMax: 0,
  wsConnectionsAccepted: 0,
  wsConnectionsRejected: 0,
  ingestAccepted: 0,
  ingestRejected: 0,
};

/** Popolato dopo creazione WebSocketServer */
let broadcastSnapshots = () => {};
const opsAlertWindowState = {
  ts: Date.now(),
  requestsTotal: 0,
  requests5xx: 0,
  wsRejected: 0,
  ingestRejected: 0,
};

app.disable("x-powered-by");
if (TRUST_PROXY) app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cookieParser());

const ALLOWED_ORIGINS =
  CORS_ORIGIN === "*"
    ? []
    : CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

function corsOriginDelegate(origin, cb) {
  if (CORS_ORIGIN === "*") {
    // Dev fallback only. In production '*' is already blocked at startup.
    cb(null, true);
    return;
  }
  if (!origin) {
    cb(null, true);
    return;
  }
  if (ALLOWED_ORIGINS.includes(origin)) {
    cb(null, true);
    return;
  }
  cb(new Error("cors_origin_denied"));
}

app.use(
  cors({
    origin: corsOriginDelegate,
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  const reqId = req.get("x-request-id") || crypto.randomUUID();
  req.reqId = reqId;
  res.setHeader("x-request-id", reqId);
  const started = Date.now();
  res.on("finish", () => {
    const elapsedMs = Date.now() - started;
    metrics.requestsTotal += 1;
    metrics.requestDurationMsTotal += elapsedMs;
    metrics.requestDurationMsMax = Math.max(metrics.requestDurationMsMax, elapsedMs);
    if (res.statusCode >= 500) metrics.requests5xx += 1;
    else if (res.statusCode >= 400) metrics.requests4xx += 1;
    else if (res.statusCode >= 300) metrics.requests3xx += 1;
    else metrics.requests2xx += 1;
    logEvent("info", "request", {
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: elapsedMs,
    });
  });
  next();
});

function makeRateLimit({ windowMs, max, keyPrefix, maxKeys = 10_000 }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const baseKey = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${baseKey}`;
    const arr = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > maxKeys) {
      for (const [k, vals] of hits) {
        const recent = vals.filter((ts) => now - ts < windowMs);
        if (!recent.length) hits.delete(k);
      }
    }
    if (arr.length > max) {
      return res.status(429).json({ error: "rate_limited", retryAfterMs: windowMs });
    }
    return next();
  };
}

const limitAuthLogin = makeRateLimit({
  windowMs: 60_000,
  max: 8,
  keyPrefix: "auth-login",
});
const limitIngest = makeRateLimit({
  windowMs: 60_000,
  max: 240,
  keyPrefix: "ingest",
});
const limitReport = makeRateLimit({
  windowMs: 60_000,
  max: 30,
  keyPrefix: "report",
});
const limitApiRead = makeRateLimit({
  windowMs: 60_000,
  max: 180,
  keyPrefix: "api-read",
});

function validateIsoRange(fromIso, toIso) {
  if (!fromIso && !toIso) return true;
  const from = fromIso ? new Date(fromIso).getTime() : null;
  const to = toIso ? new Date(toIso).getTime() : null;
  if (fromIso && !Number.isFinite(from)) return false;
  if (toIso && !Number.isFinite(to)) return false;
  if (from != null && to != null && from > to) return false;
  return true;
}

app.use("/api/auth/login", limitAuthLogin);
attachAuthRoutes(app, { requireAuth: REQUIRE_AUTH, authPassword: AUTH_PASSWORD });

const apiGate = gateMiddleware({ requireAuth: REQUIRE_AUTH, apiKey: API_KEY });

function protectDataApis(req, res, next) {
  if (req.method === "OPTIONS") return next();
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/auth")) return next();
  if (req.path.startsWith("/api/ingest")) return next();
  return apiGate(req, res, next);
}

/**
 * Ingest webhook: nessun accesso a PostgreSQL o logica applicativa finché non passa.
 * Con INGEST_SECRET impostato serve l'header `x-ingest-secret` esattamente uguale al valore env;
 * senza INGEST_SECRET ma con API_KEY, equivalente via `x-api-key`.
 */
function ingestAuth(req, res, next) {
  if (INGEST_SECRET) {
    if (req.get("x-ingest-secret") === INGEST_SECRET) return next();
    metrics.ingestRejected += 1;
    return res.status(401).json({ error: "ingest_unauthorized" });
  }
  if (API_KEY) {
    if (req.get("x-api-key") === API_KEY) return next();
    metrics.ingestRejected += 1;
    return res.status(401).json({
      error: "ingest_unauthorized",
      hint: "Imposta x-api-key oppure INGEST_SECRET nel server",
    });
  }
  return next();
}

app.use(protectDataApis);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get("/readyz", (_req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    requireAuth: REQUIRE_AUTH,
    hasIngestSecret: Boolean(INGEST_SECRET),
    hasPostgres: Boolean(pgStore),
    wsPath: "/ws",
  });
});

app.get("/metrics", (_req, res) => {
  const wsClients = wss.clients.size;
  const avgReqMs =
    metrics.requestsTotal > 0
      ? metrics.requestDurationMsTotal / metrics.requestsTotal
      : 0;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.send(
    [
      `process_uptime_seconds ${Math.floor(process.uptime())}`,
      `process_started_at_unix ${Math.floor(metrics.startedAt / 1000)}`,
      `requests_total ${metrics.requestsTotal}`,
      `requests_2xx ${metrics.requests2xx}`,
      `requests_3xx ${metrics.requests3xx}`,
      `requests_4xx ${metrics.requests4xx}`,
      `requests_5xx ${metrics.requests5xx}`,
      `request_duration_avg_ms ${avgReqMs.toFixed(2)}`,
      `request_duration_max_ms ${metrics.requestDurationMsMax}`,
      `websocket_clients ${wsClients}`,
      `websocket_connections_accepted_total ${metrics.wsConnectionsAccepted}`,
      `websocket_connections_rejected_total ${metrics.wsConnectionsRejected}`,
      `ingest_accepted_total ${metrics.ingestAccepted}`,
      `ingest_rejected_total ${metrics.ingestRejected}`,
    ].join("\n")
  );
});

function resolveZoneQuery(qZone) {
  const zoneId = String(qZone || "").trim();
  if (!zoneId) return { ok: true, zoneId: ZONES[0].id };
  if (!ZONES.some((z) => z.id === zoneId)) {
    return { ok: false, error: "invalid_zone_id" };
  }
  return { ok: true, zoneId };
}

function resolveNodeQuery(qNode) {
  const nodeId = String(qNode || "").trim();
  if (!nodeId) return { ok: true, nodeId: "" };
  if (!NODES.some((n) => n.id === nodeId)) {
    return { ok: false, error: "invalid_node_id" };
  }
  return { ok: true, nodeId };
}

app.get("/api/ops/summary", limitApiRead, (_req, res) => {
  const wsClients = wss.clients.size;
  const avgReqMs =
    metrics.requestsTotal > 0
      ? metrics.requestDurationMsTotal / metrics.requestsTotal
      : 0;
  const network = networkStatusSummary();
  res.json({
    ts: new Date().toISOString(),
    requests: {
      total: metrics.requestsTotal,
      byStatus: {
        s2xx: metrics.requests2xx,
        s3xx: metrics.requests3xx,
        s4xx: metrics.requests4xx,
        s5xx: metrics.requests5xx,
      },
      latencyMs: {
        avg: Number(avgReqMs.toFixed(2)),
        max: metrics.requestDurationMsMax,
      },
    },
    websocket: {
      clients: wsClients,
      acceptedTotal: metrics.wsConnectionsAccepted,
      rejectedTotal: metrics.wsConnectionsRejected,
    },
    ingest: {
      acceptedTotal: metrics.ingestAccepted,
      rejectedTotal: metrics.ingestRejected,
    },
    nodes: network.totals,
  });
});

app.get("/api/zones", limitApiRead, async (_req, res) => {
  if (pgStore) {
    const locs = await pgStore.listDistinctLocations();
    return res.json({
      dataProfile: "postgres",
      zones: locs.map((loc) => ({
        id: loc,
        name: loc,
        floor: "",
        mapX: 50,
        mapY: 50,
        planPath: null,
        kind: "area",
        primaryNodeId: null,
      })),
      floors: [],
    });
  }
  res.json({
    zones: ZONES.map((x) => ({
      id: x.id,
      name: x.name,
      floor: x.floor,
      mapX: x.mapX,
      mapY: x.mapY,
      planPath: planPathForFloor(x.floor),
      kind: x.kind,
      primaryNodeId: x.primaryNodeId || null,
    })),
    floors: FLOORS.map((f) => ({
      id: f.id,
      label: f.label,
      planPath: planPathForFloor(f.id),
    })),
  });
});

app.get("/api/network/catalog", limitApiRead, (_req, res) => {
  res.json({
    gateways: GATEWAYS,
    zones: ZONES,
    nodes: NODES,
  });
});

app.get("/api/network/status", limitApiRead, async (_req, res) => {
  if (pgStore) {
    const locs = await pgStore.listDistinctLocations();
    if (!locs.length) {
      return res.json({
        gateway: { id: "ttn", name: "The Things Network" },
        totals: { nodes: 0, online: 0, stale: 0, offline: 0 },
        nodes: [],
        events: [],
      });
    }
    const snap = await pgStore.buildDashboardPayload(locs[0]);
    return res.json(snap.network);
  }
  res.json(networkStatusSummary());
});

app.get("/api/network/events", limitApiRead, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 120));
  res.json({
    limit,
    events: networkEvents.slice(-limit),
  });
});

app.get("/api/dashboard/snapshot", limitApiRead, async (req, res) => {
  const zone = await resolveSnapshotZoneOrError(req.query.zoneId);
  if (!zone.ok) return res.status(400).json({ error: zone.error });
  const payload = await buildSnapshotPayload(zone.zoneId);
  res.json(payload);
});

app.get("/api/history", limitApiRead, async (req, res) => {
  const fromIso = String(req.query.from || "").trim();
  const toIso = String(req.query.to || "").trim();
  if (!validateIsoRange(fromIso, toIso)) {
    return res.status(400).json({ error: "invalid_time_range" });
  }
  const range =
    fromIso || toIso ? { fromIso: fromIso || undefined, toIso: toIso || undefined } : {};

  if (pgStore) {
    const zone = await resolveSnapshotZoneOrError(req.query.zoneId);
    if (!zone.ok) return res.status(400).json({ error: zone.error });
    const { zoneId } = zone;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const samples = await pgStore.historySamplesForLocation(zoneId, limit, range);
    return res.json({ zoneId, nodeId: null, limit, points: [], samples });
  }

  const zone = resolveZoneQuery(req.query.zoneId);
  if (!zone.ok) return res.status(400).json({ error: zone.error });
  const node = resolveNodeQuery(req.query.nodeId);
  if (!node.ok) return res.status(400).json({ error: node.error });
  const { zoneId } = zone;
  const { nodeId } = node;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const points = nodeId
    ? history.readNodeSeries(DATA_DIR, nodeId, limit)
    : history.readZoneSeries(DATA_DIR, zoneId, limit);
  const samples = nodeId
    ? history.readNodeHistoryPoints(DATA_DIR, nodeId, limit, range)
    : history.readZoneHistoryPoints(DATA_DIR, zoneId, limit, range);
  res.json({ zoneId, nodeId: nodeId || null, limit, points, samples });
});

app.get("/api/report/csv", limitReport, async (req, res) => {
  const fromIso = String(req.query.from || "").trim();
  const toIso = String(req.query.to || "").trim();
  if (!validateIsoRange(fromIso, toIso)) {
    return res.status(400).json({ error: "invalid_time_range" });
  }
  const range =
    fromIso || toIso ? { fromIso: fromIso || undefined, toIso: toIso || undefined } : {};
  const cap = Math.min(15000, Math.max(50, Number(req.query.limit) || 4000));

  if (pgStore) {
    const zone = await resolveSnapshotZoneOrError(req.query.zoneId);
    if (!zone.ok) return res.status(400).json({ error: zone.error });
    const { zoneId } = zone;
    const rows = await pgStore.csvRowsForLocation(zoneId, cap, range);
    const safeName = String(zoneId).replace(/[^\w\-]+/g, "_").slice(0, 80) || "export";
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="palestra-${safeName}-misure.csv"`
    );
    const header =
      "timestamp_utc,dev_eui,sensor_name,location,type,value,rssi,snr,battery_pct\n";
    const csvCell = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
      return s;
    };
    const body = rows
      .map((r) =>
        [
          new Date(r.timestamp).toISOString(),
          r.dev_eui,
          r.name,
          r.location,
          r.type,
          r.value,
          r.rssi ?? "",
          r.snr ?? "",
          r.battery ?? "",
        ]
          .map(csvCell)
          .join(",")
      )
      .join("\n");
    return res.send(header + body);
  }

  const zone = resolveZoneQuery(req.query.zoneId);
  if (!zone.ok) return res.status(400).json({ error: zone.error });
  const node = resolveNodeQuery(req.query.nodeId);
  if (!node.ok) return res.status(400).json({ error: node.error });
  const { zoneId } = zone;
  const { nodeId } = node;
  const rows = nodeId
    ? history.readNodeHistoryPoints(DATA_DIR, nodeId, cap, range)
    : history.readZoneHistoryPoints(DATA_DIR, zoneId, cap, range);
  const name = nodeId || (ZONES.find((z) => z.id === zoneId)?.id || zoneId);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="palestra-${name}-storico.csv"`
  );
  const header =
    "iso_utc,target,temp_c,water_pct,humidity_pct,co2_ppm,voc_index,light_lux,flow_lmin\n";
  const csvCell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
    return s;
  };
  const body = rows
    .map((r) =>
      [
        r.iso,
        nodeId || zoneId,
        r.temp,
        r.water,
        r.humidity ?? "",
        r.co2 ?? "",
        r.voc ?? "",
        r.light ?? "",
        r.flow ?? "",
      ]
        .map(csvCell)
        .join(",")
    )
    .join("\n");
  res.send(header + body);
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });

function resolveZoneFromWsUrl(url) {
  try {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("zoneId");
    if (pgStore) {
      return q || "";
    }
    return ZONES.some((z) => z.id === q) ? q : ZONES[0].id;
  } catch {
    return pgStore ? "" : ZONES[0].id;
  }
}

function wsAuthOk(req) {
  const keyHeader = req.headers["x-api-key"];
  const keyMatch =
    Boolean(API_KEY) &&
    (Array.isArray(keyHeader)
      ? keyHeader.some((v) => String(v) === API_KEY)
      : String(keyHeader || "") === API_KEY);

  const cookies = parseCookie(req.headers.cookie || "");
  const tok = cookies[COOKIE] || "";

  if (API_KEY) {
    if (keyMatch) return true;
    if (REQUIRE_AUTH && isValid(tok)) return true;
    return false;
  }

  if (!REQUIRE_AUTH) return true;
  return isValid(tok);
}

wss.on("connection", (ws, req) => {
  if (!wsAuthOk(req)) {
    metrics.wsConnectionsRejected += 1;
    logEvent("warn", "ws_unauthorized", { ip: req.socket?.remoteAddress || "unknown" });
    ws.close(4001, "unauthorized");
    return;
  }
  metrics.wsConnectionsAccepted += 1;

  const zoneId = resolveZoneFromWsUrl(req.url || "");
  ws._zoneId = zoneId;

  const sendOnce = async () => {
    if (ws.readyState !== 1) return;
    try {
      const payload = await buildSnapshotPayload(ws._zoneId);
      ws.send(
        JSON.stringify({
          type: "snapshot",
          zoneId: ws._zoneId,
          data: payload,
        })
      );
    } catch (err) {
      logEvent("error", "ws_snapshot_failed", {
        error: err && err.message ? err.message : String(err),
      });
    }
  };

  void sendOnce();
});

broadcastSnapshots = async () => {
  const clients = [...wss.clients];
  await Promise.all(
    clients.map(async (ws) => {
      if (ws.readyState !== 1) return;
      try {
        const payload = await buildSnapshotPayload(ws._zoneId);
        ws.send(
          JSON.stringify({
            type: "snapshot",
            zoneId: ws._zoneId,
            data: payload,
          })
        );
      } catch (err) {
        logEvent("error", "ws_broadcast_failed", {
          error: err && err.message ? err.message : String(err),
        });
      }
    })
  );
};

app.post("/api/ingest/reading", limitIngest, ingestAuth, async (req, res) => {
  if (pgStore) {
    metrics.ingestRejected += 1;
    return res.status(503).json({
      error: "legacy_ingest_disabled",
      hint: "Con DATABASE_URL configurato usa POST /api/ingest (webhook TTN).",
    });
  }
  const reading = normalizeReadingPayload(req.body || {});
  if (reading.error) {
    return res.status(400).json(reading);
  }
  applyManualReading(reading.zoneId, reading);
  metrics.ingestAccepted += 1;
  await broadcastSnapshots();
  return res.json({
    ok: true,
    zoneId: reading.zoneId,
    nodeId: reading.nodeId,
    gatewayId: reading.gatewayId,
  });
});

/**
 * Webhook The Things Network: accetta il JSON uplink, valida dev_eui in anagrafica,
 * decodifica il payload binario e inserisce una riga in measurements.
 */
app.post("/api/ingest", limitIngest, ingestAuth, async (req, res) => {
  if (!pgStore) {
    return res.status(503).json({
      error: "database_required",
      hint: "Imposta DATABASE_URL (PostgreSQL) per abilitare l'ingest TTN.",
    });
  }
  try {
    const result = await ingestTtnWebhook(req.body || {});
    if (result.detail?.error === "unauthorized_device") {
      logEvent("warn", "Dispositivo non autorizzato", {
        devEui: result.detail?.devEui || "",
      });
      return res.status(200).json({
        ok: false,
        error: "unauthorized_device",
        devEui: result.detail?.devEui,
      });
    }
    if (!result.ok) {
      metrics.ingestRejected += 1;
      if (result.dbError && result.logMessage) {
        logEvent("error", "ingest_database_error", {
          message: result.logMessage,
          ...(result.logExtra || {}),
        });
      }
      return res.status(result.status).json(result.detail);
    }
    metrics.ingestAccepted += 1;
    await broadcastSnapshots();
    return res.status(200).json(result.detail);
  } catch (err) {
    metrics.ingestRejected += 1;
    logEvent("error", "ingest_ttn_failed", {
      error: err && err.message ? err.message : String(err),
    });
    return res.status(500).json({ error: "ingest_failed" });
  }
});

app.get("/api/admin/sensors", limitApiRead, async (_req, res) => {
  if (!pgStore) return res.status(503).json({ error: "database_required" });
  try {
    const sensors = await pgStore.listSensorsAll();
    res.json({ sensors });
  } catch (err) {
    logEvent("error", "admin_list_sensors", {
      error: err && err.message ? err.message : String(err),
    });
    res.status(500).json({ error: "db_error" });
  }
});

function adminSensorErrorResponse(err) {
  const code = err && err.code ? String(err.code) : "";
  const hints = {
    invalid_dev_eui: "Il DevEUI deve essere esattamente 16 caratteri esadecimali (0–9, A–F).",
    empty_sensor_name: "Il nome del sensore non può essere vuoto.",
    empty_sensor_location: "La posizione (zona) non può essere vuota.",
    empty_sensor_type: "Il tipo sensore non può essere vuoto.",
    invalid_threshold:
      "Le soglie min/max accettano solo numeri (es. 18 oppure 22.5). Lasciare vuoto se non servono.",
    dev_eui_duplicate:
      "Esiste già un sensore con questo DevEUI. Ogni dispositivo LoRaWAN deve avere un DevEUI univoco nel database.",
  };
  if (code === "invalid_dev_eui" || code === "empty_sensor_name" || code === "empty_sensor_location" || code === "empty_sensor_type" || code === "invalid_threshold") {
    return { status: 400, body: { error: code, hint: hints[code] || code } };
  }
  if (code === "dev_eui_duplicate") {
    return { status: 409, body: { error: code, hint: hints.dev_eui_duplicate } };
  }
  return null;
}

app.post("/api/admin/sensors", limitApiRead, async (req, res) => {
  if (!pgStore) return res.status(503).json({ error: "database_required" });
  try {
    const row = await pgStore.insertSensor(req.body || {});
    await broadcastSnapshots();
    res.status(201).json(row);
  } catch (err) {
    const mapped = adminSensorErrorResponse(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    const msg = err && err.message ? err.message : String(err);
    if (/unique/i.test(msg)) {
      return res.status(409).json({
        error: "dev_eui_duplicate",
        hint:
          "Esiste già un sensore con questo DevEUI. Ogni dispositivo deve avere un DevEUI univoco nel database.",
      });
    }
    logEvent("error", "admin_insert_sensor", { error: msg });
    res.status(500).json({ error: "db_error" });
  }
});

app.patch("/api/admin/sensors/:id", limitApiRead, async (req, res) => {
  if (!pgStore) return res.status(503).json({ error: "database_required" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const row = await pgStore.updateSensor(id, req.body || {});
    if (!row) return res.status(404).json({ error: "not_found" });
    await broadcastSnapshots();
    res.json(row);
  } catch (err) {
    const mapped = adminSensorErrorResponse(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    const msg = err && err.message ? err.message : String(err);
    if (/unique/i.test(msg)) {
      return res.status(409).json({
        error: "dev_eui_duplicate",
        hint:
          "Esiste già un sensore con questo DevEUI. Ogni dispositivo deve avere un DevEUI univoco nel database.",
      });
    }
    logEvent("error", "admin_update_sensor", { error: msg });
    res.status(500).json({ error: "db_error" });
  }
});

app.delete("/api/admin/sensors/:id", limitApiRead, async (req, res) => {
  if (!pgStore) return res.status(503).json({ error: "database_required" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const ok = await pgStore.deleteSensor(id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    await broadcastSnapshots();
    res.json({ ok: true });
  } catch (err) {
    logEvent("error", "admin_delete_sensor", {
      error: err && err.message ? err.message : String(err),
    });
    res.status(500).json({ error: "db_error" });
  }
});

app.use((err, _req, res, next) => {
  if (err && err.message === "cors_origin_denied") {
    return res.status(403).json({ error: "cors_origin_denied" });
  }
  return next(err);
});

function evaluateOpsAlerts() {
  if (!NOTIFY_WEBHOOK) return;

  const now = Date.now();
  if (now - opsAlertWindowState.ts < OPS_ALERT_WINDOW_MS) return;

  const deltaRequests = metrics.requestsTotal - opsAlertWindowState.requestsTotal;
  const delta5xx = metrics.requests5xx - opsAlertWindowState.requests5xx;
  const deltaWsRejected =
    metrics.wsConnectionsRejected - opsAlertWindowState.wsRejected;
  const deltaIngestRejected =
    metrics.ingestRejected - opsAlertWindowState.ingestRejected;

  const errorRatePct =
    deltaRequests > 0 ? (delta5xx / Math.max(1, deltaRequests)) * 100 : 0;

  if (
    deltaRequests >= OPS_ALERT_MIN_REQUESTS &&
    errorRatePct >= OPS_ALERT_5XX_RATE_PCT
  ) {
    maybeNotifyOpsAlert({
      alertKey: "ops_high_5xx_rate",
      severity: "critical",
      message: `5xx rate elevato: ${errorRatePct.toFixed(2)}% nelle ultime ${Math.round(OPS_ALERT_WINDOW_MS / 60000)} min`,
      details: {
        requests: deltaRequests,
        errors5xx: delta5xx,
        thresholdPct: OPS_ALERT_5XX_RATE_PCT,
        windowMs: OPS_ALERT_WINDOW_MS,
      },
      webhookUrl: NOTIFY_WEBHOOK,
    });
  }

  if (deltaWsRejected >= OPS_ALERT_WS_REJECTS_DELTA) {
    maybeNotifyOpsAlert({
      alertKey: "ops_ws_rejected_spike",
      severity: "warning",
      message: `Spike connessioni WebSocket rifiutate: ${deltaWsRejected} nelle ultime ${Math.round(OPS_ALERT_WINDOW_MS / 60000)} min`,
      details: {
        wsRejected: deltaWsRejected,
        threshold: OPS_ALERT_WS_REJECTS_DELTA,
        windowMs: OPS_ALERT_WINDOW_MS,
      },
      webhookUrl: NOTIFY_WEBHOOK,
    });
  }

  if (deltaIngestRejected >= OPS_ALERT_INGEST_REJECTS_DELTA) {
    maybeNotifyOpsAlert({
      alertKey: "ops_ingest_rejected_spike",
      severity: "warning",
      message: `Spike ingest rifiutati: ${deltaIngestRejected} nelle ultime ${Math.round(OPS_ALERT_WINDOW_MS / 60000)} min`,
      details: {
        ingestRejected: deltaIngestRejected,
        threshold: OPS_ALERT_INGEST_REJECTS_DELTA,
        windowMs: OPS_ALERT_WINDOW_MS,
      },
      webhookUrl: NOTIFY_WEBHOOK,
    });
  }

  opsAlertWindowState.ts = now;
  opsAlertWindowState.requestsTotal = metrics.requestsTotal;
  opsAlertWindowState.requests5xx = metrics.requests5xx;
  opsAlertWindowState.wsRejected = metrics.wsConnectionsRejected;
  opsAlertWindowState.ingestRejected = metrics.ingestRejected;
}

const ticker = setInterval(() => {
  if (!DISABLE_AUTO_TICK && !pgStore) {
    ZONES.forEach((z) => tickZone(z.id));
  }
  broadcastSnapshots().catch((err) =>
    logEvent("error", "broadcast_snapshots", {
      error: err && err.message ? err.message : String(err),
    })
  );
}, 2000);
const opsAlertTicker = setInterval(evaluateOpsAlerts, OPS_ALERT_CHECK_EVERY_MS);

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[fatal] Porta ${PORT} già in uso: probabilmente hai già un gateway attivo. Chiudi l’altra finestra del terminale oppure imposta PORT in server/.env`
    );
  } else {
    console.error("[fatal] server HTTP:", err && err.message ? err.message : err);
  }
  process.exit(1);
});

async function startHttpServer() {
  if (pgStore) {
    const dbCheck = await pgStore.verifyDatabaseOnStartup();
    if (dbCheck.ok) {
      console.log("✅ Connessione al database PostgreSQL riuscita");
    } else {
      console.log("❌ Errore di connessione al database");
      const err = dbCheck.error;
      const detail = err && err.message ? err.message : String(err);
      console.error(`   ${detail}`);
      logEvent("error", "postgres_startup_failed", { message: detail });
    }
  }

  server.listen(PORT, () => {
    logEvent("info", "server_started", {
      port: PORT,
      dataDir: DATA_DIR,
      env: NODE_ENV,
      requireAuth: REQUIRE_AUTH,
      hasApiKey: Boolean(API_KEY),
      hasIngestSecret: Boolean(INGEST_SECRET),
    });
    console.log(`Sensor gateway su http://localhost:${PORT}`);
    console.log(`  Dati persistenti in: ${DATA_DIR}`);
    console.log(`  REST  GET /api/zones`);
    console.log(`  REST  GET /api/dashboard/snapshot?zoneId=...`);
    console.log(`  REST  GET /api/history?zoneId=...&limit=200&from=&to=`);
    console.log(`  REST  GET /api/report/csv?zoneId=...&limit=4000&from=&to=`);
    console.log(`  REST  GET /api/ops/summary`);
    console.log(`  REST  GET /health · /readyz · /metrics`);
    console.log(`  WS    ws://localhost:${PORT}/ws?zoneId=...`);
    if (API_KEY) {
      console.log("  API key attiva (REST/ingest via header x-api-key)");
    }
    if (REQUIRE_AUTH) {
      console.log("  Autenticazione attiva (POST /api/auth/login · password da AUTH_PASSWORD)");
    }
    if (NOTIFY_WEBHOOK) {
      console.log(
        "  Webhook allarme (acqua + soglie ambientali env_threshold) configurato"
      );
    }
    console.log("  POST /api/ingest/reading (payload legacy o LoRa-ready)");
    if (pgStore) {
      console.log("  POST /api/ingest (webhook The Things Network · richiede DATABASE_URL)");
      console.log("  REST  CRUD /api/admin/sensors (gestione anagrafica sensori)");
    }
    if (!INGEST_SECRET && !API_KEY) {
      logEvent("warn", "ingest_open_warning", {
        msg: "Ingest aperto: imposta INGEST_SECRET o API_KEY in produzione.",
      });
    }
    if (DISABLE_AUTO_TICK) {
      console.log("  Simulazione random DISATTIVATA (DISABLE_AUTO_TICK=true) — solo ingest/manuale");
    }
  });
}

void startHttpServer().catch((err) => {
  console.error("[fatal] avvio server:", err && err.message ? err.message : err);
  process.exit(1);
});

async function shutdown(signal) {
  logEvent("info", "shutdown_start", { signal });
  clearInterval(ticker);
  clearInterval(opsAlertTicker);
  if (pgStore) {
    try {
      await pgStore.closePool();
    } catch {
      /* ignore */
    }
  }
  wss.clients.forEach((ws) => {
    try {
      ws.close(1001, "server_shutdown");
    } catch {
      /* ignore */
    }
  });
  server.close(() => {
    logEvent("info", "shutdown_done", { signal });
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("unhandledRejection", (reason) => {
  logEvent("error", "unhandled_rejection", {
    reason: reason && reason.message ? reason.message : String(reason),
  });
});
process.on("uncaughtException", (err) => {
  logEvent("error", "uncaught_exception", {
    error: err && err.message ? err.message : String(err),
  });
});
