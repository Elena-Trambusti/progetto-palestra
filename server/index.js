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
const {
  maybeNotifyWaterLow,
  maybeNotifyWaterRapidDrop,
} = require("./lib/notify");
const { notifyEnvironmentEdges } = require("./lib/envNotifyEdges");
const { activeAlarmsForState } = require("./lib/envAlarms");
const { ZONES, FLOORS, planPathForFloor } = require("./lib/zonesData");
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

const WATER_ETA_LOOKBACK_MS =
  Number(process.env.WATER_ETA_LOOKBACK_MS) || 45 * 60 * 1000;
const WATER_RAPID_WINDOW_MS =
  Number(process.env.WATER_RAPID_WINDOW_MS) || 10 * 60 * 1000;
const WATER_RAPID_DROP_PCT =
  Number(process.env.WATER_RAPID_DROP_PCT) || 12;

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
  return {
    labels: [],
    values: [],
    lastTemp: 24 + seed * 10,
    water: 45 + seed * 45,
    humidityPct: Math.min(68, Math.max(32, 40 + seed * 28)),
    co2Ppm: Math.min(950, Math.max(420, 520 + Math.floor(seed * 380))),
    vocIndex: Math.min(280, Math.max(45, 90 + Math.floor(seed * 160))),
    logLines: [
      `[INFO] ${formatTime(new Date())} · Nodo ${zoneId} online · handshake OK`,
    ],
  };
}

const store = Object.fromEntries(ZONES.map((z) => [z.id, createInitialState(z.id)]));

const SENSORS = ["Sensore_A", "Sensore_B", "Nodo_DOCCE", "HUB_PALESTRA", "GW_LIVORNO"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tickZone(zoneId) {
  const z = ZONES.find((x) => x.id === zoneId);
  const st = store[zoneId];
  if (!st || !z) return;

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
    `Ricezione dati ${sensor} [${z.name}]... OK`,
    `Campione termico aggregato zona ${z.id}`,
    `Livello compensato · checksum valido`,
    `Ping periferico ${randomBetween(6, 22).toFixed(1)} ms`,
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
  st.logLines = logLines;

  history.appendReading(DATA_DIR, {
    zoneId,
    temp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
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
  const z = ZONES.find((x) => x.id === zoneId);
  const st = store[zoneId];
  if (!st || !z) return false;

  const {
    tempC,
    waterPct,
    humidityPct: humIn,
    co2Ppm: co2In,
    vocIndex: vocIn,
    source,
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

  const labels = [...st.labels, t];
  const values = [...st.values, nextTemp];
  const maxPoints = 20;
  if (labels.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  const tag = String(source || "device").slice(0, 48);
  const line = `[INGEST] ${t} · ${tag} · T=${nextTemp.toFixed(1)} °C · RH=${Number(nextHum).toFixed(0)}% · CO₂=${Math.round(nextCo2)} · ${z.name}`;
  const logLines = [...st.logLines, line].slice(-35);

  st.labels = labels;
  st.values = values;
  st.lastTemp = nextTemp;
  st.water = nextWater;
  st.humidityPct = nextHum;
  st.co2Ppm = nextCo2;
  st.vocIndex = nextVoc;
  st.logLines = logLines;

  history.appendReading(DATA_DIR, {
    zoneId,
    temp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
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
  const alarms = activeAlarmsForState(st);
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warning")) return "warning";
  if (alarms.length) return "info";
  return "ok";
}

function buildSnapshotPayload(zoneId) {
  const z = ZONES.find((x) => x.id === zoneId) || ZONES[0];
  const st = store[z.id];
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

  const siteZones = ZONES.map((zz) => {
    const s = store[zz.id];
    return {
      id: zz.id,
      name: zz.name,
      floor: zz.floor,
      mapX: zz.mapX,
      mapY: zz.mapY,
      planPath: planPathForFloor(zz.floor),
      temperatureC: s.lastTemp,
      waterPercent: s.water,
      humidityPercent: s.humidityPct,
      co2Ppm: s.co2Ppm,
      vocIndex: s.vocIndex,
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
      name: "Hub sensori · Livorno",
      city: "Livorno",
      zones: ZONES.length,
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
    },
    activeAlarms: activeAlarmsForState(st),
    waterEtaHours: eta.waterEtaHours,
    waterEtaConfidence: eta.waterEtaConfidence,
    waterDepletionRatePctPerHour: eta.waterDepletionRatePctPerHour,
    waterRapidDrop: rapid.waterRapidDrop,
    waterRapidDropDelta: rapid.waterRapidDropDelta,
    logLines: st.logLines,
  };
}

const app = express();
const metrics = {
  requestsTotal: 0,
  requests4xx: 0,
  requests5xx: 0,
};

/** Popolato dopo creazione WebSocketServer */
let broadcastSnapshots = () => {};

app.disable("x-powered-by");
if (TRUST_PROXY) app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cookieParser());
app.use(
  cors({
    origin:
      CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((s) => s.trim()),
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
    metrics.requestsTotal += 1;
    if (res.statusCode >= 500) metrics.requests5xx += 1;
    else if (res.statusCode >= 400) metrics.requests4xx += 1;
    logEvent("info", "request", {
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
});

function makeRateLimit({ windowMs, max, keyPrefix }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const baseKey = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${baseKey}`;
    const arr = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    arr.push(now);
    hits.set(key, arr);
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

function ingestAuth(req, res, next) {
  if (INGEST_SECRET) {
    if (req.get("x-ingest-secret") === INGEST_SECRET) return next();
    return res.status(401).json({ error: "ingest_unauthorized" });
  }
  if (API_KEY) {
    if (req.get("x-api-key") === API_KEY) return next();
    return res.status(401).json({
      error: "ingest_unauthorized",
      hint: "Imposta x-api-key oppure INGEST_SECRET nel server",
    });
  }
  return next();
}

app.use(protectDataApis);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/readyz", (_req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    requireAuth: REQUIRE_AUTH,
    hasIngestSecret: Boolean(INGEST_SECRET),
  });
});

app.get("/metrics", (_req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.send(
    [
      `requests_total ${metrics.requestsTotal}`,
      `requests_4xx ${metrics.requests4xx}`,
      `requests_5xx ${metrics.requests5xx}`,
      `websocket_clients ${wss.clients.size}`,
    ].join("\n")
  );
});

app.get("/api/zones", (_req, res) => {
  res.json({
    zones: ZONES.map((x) => ({
      id: x.id,
      name: x.name,
      floor: x.floor,
      mapX: x.mapX,
      mapY: x.mapY,
      planPath: planPathForFloor(x.floor),
    })),
    floors: FLOORS.map((f) => ({
      id: f.id,
      label: f.label,
      planPath: planPathForFloor(f.id),
    })),
  });
});

app.get("/api/dashboard/snapshot", (req, res) => {
  const q = String(req.query.zoneId || "").trim();
  const zoneId = ZONES.some((z) => z.id === q) ? q : ZONES[0].id;
  res.json(buildSnapshotPayload(zoneId));
});

app.get("/api/history", (req, res) => {
  const q = String(req.query.zoneId || "").trim();
  const zoneId = ZONES.some((z) => z.id === q) ? q : ZONES[0].id;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const points = history.readZoneSeries(DATA_DIR, zoneId, limit);
  const fromIso = String(req.query.from || "").trim();
  const toIso = String(req.query.to || "").trim();
  if (!validateIsoRange(fromIso, toIso)) {
    return res.status(400).json({ error: "invalid_time_range" });
  }
  const range =
    fromIso || toIso ? { fromIso: fromIso || undefined, toIso: toIso || undefined } : {};
  const samples = history.readZoneHistoryPoints(
    DATA_DIR,
    zoneId,
    limit,
    range
  );
  res.json({ zoneId, limit, points, samples });
});

app.get("/api/report/csv", limitReport, (req, res) => {
  const q = String(req.query.zoneId || "").trim();
  const zoneId = ZONES.some((z) => z.id === q) ? q : ZONES[0].id;
  const cap = Math.min(15000, Math.max(50, Number(req.query.limit) || 4000));
  const fromIso = String(req.query.from || "").trim();
  const toIso = String(req.query.to || "").trim();
  if (!validateIsoRange(fromIso, toIso)) {
    return res.status(400).json({ error: "invalid_time_range" });
  }
  const range =
    fromIso || toIso ? { fromIso: fromIso || undefined, toIso: toIso || undefined } : {};
  const rows = history.readZoneHistoryPoints(DATA_DIR, zoneId, cap, range);
  const name = ZONES.find((z) => z.id === zoneId)?.id || zoneId;
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="palestra-${name}-storico.csv"`
  );
  const header =
    "iso_utc,zone,temp_c,water_pct,humidity_pct,co2_ppm,voc_index\n";
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
        zoneId,
        r.temp,
        r.water,
        r.humidity ?? "",
        r.co2 ?? "",
        r.voc ?? "",
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
    return ZONES.some((z) => z.id === q) ? q : ZONES[0].id;
  } catch {
    return ZONES[0].id;
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
    ws.close(4001, "unauthorized");
    return;
  }

  const zoneId = resolveZoneFromWsUrl(req.url || "");
  ws._zoneId = zoneId;

  const sendOnce = () => {
    if (ws.readyState !== 1) return;
    const payload = buildSnapshotPayload(ws._zoneId);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        zoneId: ws._zoneId,
        data: payload,
      })
    );
  };

  sendOnce();
});

broadcastSnapshots = () => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    const payload = buildSnapshotPayload(ws._zoneId);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        zoneId: ws._zoneId,
        data: payload,
      })
    );
  });
};

app.post("/api/ingest/reading", limitIngest, ingestAuth, (req, res) => {
  const q = String(req.body?.zoneId || "").trim();
  const zoneId = ZONES.some((z) => z.id === q) ? q : "";
  if (!zoneId) {
    return res.status(400).json({
      error: "invalid_zone",
      zones: ZONES.map((z) => z.id),
    });
  }
  const tempC = req.body?.temperatureC ?? req.body?.tempC;
  if (!Number.isFinite(Number(tempC))) {
    return res.status(400).json({ error: "temperatureC_required" });
  }
  const waterPct = req.body?.waterPercent;
  if (waterPct != null && !Number.isFinite(Number(waterPct))) {
    return res.status(400).json({ error: "invalid_waterPercent" });
  }
  const humidityPct =
    req.body?.humidityPercent ?? req.body?.humidityPct ?? req.body?.rh;
  if (humidityPct != null && !Number.isFinite(Number(humidityPct))) {
    return res.status(400).json({ error: "invalid_humidityPercent" });
  }
  const co2Ppm = req.body?.co2Ppm ?? req.body?.co2;
  if (co2Ppm != null && !Number.isFinite(Number(co2Ppm))) {
    return res.status(400).json({ error: "invalid_co2Ppm" });
  }
  const vocIndex = req.body?.vocIndex ?? req.body?.voc ?? req.body?.iaq;
  if (vocIndex != null && !Number.isFinite(Number(vocIndex))) {
    return res.status(400).json({ error: "invalid_vocIndex" });
  }
  const source = req.body?.source;
  applyManualReading(zoneId, {
    tempC: Number(tempC),
    waterPct:
      waterPct === undefined || waterPct === null
        ? null
        : Number(waterPct),
    humidityPct:
      humidityPct === undefined || humidityPct === null
        ? null
        : Number(humidityPct),
    co2Ppm:
      co2Ppm === undefined || co2Ppm === null ? null : Number(co2Ppm),
    vocIndex:
      vocIndex === undefined || vocIndex === null ? null : Number(vocIndex),
    source,
  });
  broadcastSnapshots();
  return res.json({ ok: true, zoneId });
});

const ticker = setInterval(() => {
  if (!DISABLE_AUTO_TICK) {
    ZONES.forEach((z) => tickZone(z.id));
  }
  broadcastSnapshots();
}, 2000);

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

server.listen(PORT, () => {
  console.log(`Sensor gateway su http://localhost:${PORT}`);
  console.log(`  Dati persistenti in: ${DATA_DIR}`);
  console.log(`  REST  GET /api/zones`);
  console.log(`  REST  GET /api/dashboard/snapshot?zoneId=...`);
  console.log(`  REST  GET /api/history?zoneId=...&limit=200&from=&to=`);
  console.log(`  REST  GET /api/report/csv?zoneId=...&limit=4000&from=&to=`);
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
  console.log("  POST /api/ingest/reading (Arduino / ESP — vedi docs/PROSSIMI_PASSI.md)");
  if (!INGEST_SECRET && !API_KEY) {
    console.warn(
      "  [warn] Ingest aperto: imposta INGEST_SECRET o API_KEY in produzione."
    );
  }
  if (DISABLE_AUTO_TICK) {
    console.log("  Simulazione random DISATTIVATA (DISABLE_AUTO_TICK=true) — solo ingest/manuale");
  }
});

function shutdown(signal) {
  logEvent("info", "shutdown_start", { signal });
  clearInterval(ticker);
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

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
