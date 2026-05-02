/**
 * Persistenza PostgreSQL: sensori, misure e aggregati per la dashboard.
 * Se DATABASE_URL non è impostata, questo modulo non viene caricato dal bootstrap.
 *
 * Istanti in `measurements.timestamp` (TIMESTAMPTZ) sono salvati in UTC (stringa ISO da Node);
 * etichette leggibili per grafici JSON usano ISO UTC (`iso` / `label`) e vanno formattate in locale sul client.
 */
const { Pool } = require("pg");

/** Soglia "ritardo uplink" prima dello stato stale (ms). */
const UPLINK_STALE_MS = 3 * 60 * 1000;
/** Heartbeat: oltre questo intervallo senza misure il sensore è OFFLINE (ms). */
const HEARTBEAT_OFFLINE_MS = 30 * 60 * 1000;

let pool = null;

/**
 * Pool PostgreSQL: l'unica origine della stringa di connessione è `process.env.DATABASE_URL`
 * (stessa variabile usata in `index.js` per decidere se caricare questo modulo).
 */
function getPool() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/**
 * All'avvio del processo: una connessione reale, `ensureSchema` (idempotente),
 * poi rilascio. Così a ogni riavvio del server tabelle e indici sono garantiti
 * prima del primo sensore / prima che arrivino richieste HTTP.
 */
async function verifyDatabaseOnStartup() {
  const p = getPool();
  if (!p) {
    return { ok: false, error: new Error("database_not_configured") };
  }
  let client;
  try {
    client = await p.connect();
    await ensureSchema(client);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    if (client) {
      try {
        client.release();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Crea le tabelle se assenti (idempotente, adatto a deploy su Render).
 * Ogni lettura in measurements è legata al sensore tramite sensor_id → sensors.dev_eui in fase di ingest.
 */
async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sensors (
      id SERIAL PRIMARY KEY,
      dev_eui VARCHAR(32) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      type VARCHAR(64) NOT NULL,
      min_threshold DOUBLE PRECISION,
      max_threshold DOUBLE PRECISION,
      total_liters_flowed DOUBLE PRECISION DEFAULT 0,
      night_flow_threshold DOUBLE PRECISION DEFAULT 0.1,
      filter_maintenance_limit DOUBLE PRECISION DEFAULT 10000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS measurements (
      id BIGSERIAL PRIMARY KEY,
      sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
      value DOUBLE PRECISION NOT NULL,
      co2 INTEGER,
      voc INTEGER,
      lux INTEGER,
      sensor_type VARCHAR(32),
      rssi DOUBLE PRECISION,
      snr DOUBLE PRECISION,
      battery DOUBLE PRECISION,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_measurements_sensor_time ON measurements (sensor_id, timestamp DESC);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_measurements_type_time ON measurements (sensor_type, timestamp DESC);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_sensors_location ON sensors (location);`,
  );
}

async function withClient(fn) {
  const p = getPool();
  if (!p) throw new Error("database_not_configured");
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

function normalizeDevEui(raw) {
  const hex = String(raw || "")
    .replace(/\s+/g, "")
    .replace(/0x/gi, "")
    .toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(hex)) return null;
  return hex;
}

/**
 * Soglia opzionale da JSON/form: vuoto → null.
 * Solo numeri (segno opzionale, parte decimale con un solo punto).
 */
function parseOptionalThreshold(raw) {
  if (raw === "" || raw == null) return null;
  const s = String(raw).trim().replace(",", ".");
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    const err = new Error("invalid_threshold");
    err.code = "invalid_threshold";
    throw err;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    const err = new Error("invalid_threshold");
    err.code = "invalid_threshold";
    throw err;
  }
  return n;
}

function throwDevEuiDuplicate() {
  const err = new Error("dev_eui_duplicate");
  err.code = "dev_eui_duplicate";
  throw err;
}

function uplinkStatus(lastIso) {
  if (!lastIso) return "offline";
  const age = Date.now() - new Date(lastIso).getTime();
  if (!Number.isFinite(age) || age < 0) return "offline";
  if (age > HEARTBEAT_OFFLINE_MS) return "offline";
  if (age > UPLINK_STALE_MS) return "stale";
  return "online";
}

function thresholdFlag(value, minT, maxT) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  if (minT != null && Number.isFinite(Number(minT)) && v < Number(minT))
    return "low";
  if (maxT != null && Number.isFinite(Number(maxT)) && v > Number(maxT))
    return "high";
  return null;
}

async function listDistinctLocations() {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT DISTINCT location FROM sensors ORDER BY location ASC`,
    );
    return r.rows.map((row) => String(row.location));
  });
}

async function listSensorsAll() {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT id, dev_eui AS "devEui", name, location, type,
 min_threshold AS "minThreshold", max_threshold AS "maxThreshold",
              created_at AS "createdAt"
       FROM sensors ORDER BY location ASC, name ASC`,
    );
    return r.rows;
  });
}

/** Catalogo sensori di una zona (location) per report PDF e confronti soglie. */
async function listSensorsForLocation(location) {
  const loc = String(location || "").trim();
  if (!loc) return [];
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT dev_eui AS "devEui", name, type, location,
              min_threshold AS "minThreshold", max_threshold AS "maxThreshold"
       FROM sensors WHERE location = $1 ORDER BY name ASC`,
      [loc],
    );
    return r.rows;
  });
}

async function insertSensor(row) {
  const dev = normalizeDevEui(row.devEui);
  if (!dev) {
    const err = new Error("invalid_dev_eui");
    err.code = "invalid_dev_eui";
    throw err;
  }
  const name = String(row.name || "").trim();
  if (!name) {
    const err = new Error("empty_sensor_name");
    err.code = "empty_sensor_name";
    throw err;
  }
  const location = String(row.location || "").trim();
  if (!location) {
    const err = new Error("empty_sensor_location");
    err.code = "empty_sensor_location";
    throw err;
  }
  const type = String(row.type || "").trim();
  if (!type) {
    const err = new Error("empty_sensor_type");
    err.code = "empty_sensor_type";
    throw err;
  }
  const minT = parseOptionalThreshold(row.minThreshold);
  const maxT = parseOptionalThreshold(row.maxThreshold);

  return withClient(async (c) => {
    try {
      const r = await c.query(
        `INSERT INTO sensors (dev_eui, name, location, type, min_threshold, max_threshold)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, dev_eui AS "devEui", name, location, type,
                   min_threshold AS "minThreshold", max_threshold AS "maxThreshold"`,
        [dev, name, location, type, minT, maxT],
      );
      return r.rows[0];
    } catch (e) {
      if (e && e.code === "23505") throwDevEuiDuplicate();
      throw e;
    }
  });
}

async function updateSensor(id, patch) {
  return withClient(async (c) => {
    const cur = await c.query(`SELECT * FROM sensors WHERE id = $1`, [id]);
    if (!cur.rows.length) return null;
    const prev = cur.rows[0];

    const devEui =
      patch.devEui != null ? normalizeDevEui(patch.devEui) : prev.dev_eui;
    if (!devEui) {
      const err = new Error("invalid_dev_eui");
      err.code = "invalid_dev_eui";
      throw err;
    }

    let nextName = prev.name;
    if (patch.name !== undefined) {
      const nm = String(patch.name).trim();
      if (!nm) {
        const err = new Error("empty_sensor_name");
        err.code = "empty_sensor_name";
        throw err;
      }
      nextName = nm;
    }

    let nextLocation = prev.location;
    if (patch.location !== undefined) {
      const loc = String(patch.location).trim();
      if (!loc) {
        const err = new Error("empty_sensor_location");
        err.code = "empty_sensor_location";
        throw err;
      }
      nextLocation = loc;
    }

    let nextType = prev.type;
    if (patch.type !== undefined) {
      const ty = String(patch.type).trim();
      if (!ty) {
        const err = new Error("empty_sensor_type");
        err.code = "empty_sensor_type";
        throw err;
      }
      nextType = ty;
    }

    let nextMin = prev.min_threshold;
    let nextMax = prev.max_threshold;
    if (patch.minThreshold !== undefined) {
      nextMin = parseOptionalThreshold(patch.minThreshold);
    }
    if (patch.maxThreshold !== undefined) {
      nextMax = parseOptionalThreshold(patch.maxThreshold);
    }

    try {
      const r = await c.query(
        `UPDATE sensors SET
           dev_eui = $2,
           name = $3,
           location = $4,
           type = $5,
           min_threshold = $6,
           max_threshold = $7
         WHERE id = $1
         RETURNING id, dev_eui AS "devEui", name, location, type,
                   min_threshold AS "minThreshold", max_threshold AS "maxThreshold"`,
        [id, devEui, nextName, nextLocation, nextType, nextMin, nextMax],
      );
      return r.rows[0] || null;
    } catch (e) {
      if (e && e.code === "23505") throwDevEuiDuplicate();
      throw e;
    }
  });
}

async function deleteSensor(id) {
  return withClient(async (c) => {
    const r = await c.query(`DELETE FROM sensors WHERE id = $1 RETURNING id`, [
      id,
    ]);
    return Boolean(r.rows.length);
  });
}

async function findSensorByDevEui(devEui) {
  const dev = normalizeDevEui(devEui);
  if (!dev) return null;
  return withClient(async (c) => {
    const r = await c.query(`SELECT * FROM sensors WHERE dev_eui = $1`, [dev]);
    return r.rows[0] || null;
  });
}

/**
 * Ultima misura per ogni sensore (finestra LATERAL efficiente su Postgres).
 */
/**
 * Ultima misura per ogni sensore. Se `client` è fornito, riusa la connessione (stessa transazione snapshot).
 */
async function fetchLatestMeasurements(sensorIds, client = null) {
  if (!sensorIds.length) return new Map();
  const exec = async (c) => {
    const r = await c.query(
      `SELECT DISTINCT ON (sensor_id)
         sensor_id,
         value,
         rssi,
         snr,
         battery,
         timestamp
       FROM measurements
       WHERE sensor_id = ANY($1::int[])
       ORDER BY sensor_id, timestamp DESC`,
      [sensorIds],
    );
    const m = new Map();
    for (const row of r.rows) {
      m.set(row.sensor_id, row);
    }
    return m;
  };
  if (client) return exec(client);
  return withClient(exec);
}

/** Normalizza l'istante di misura in stringa ISO UTC per la colonna `timestamptz`. */
function measurementTimestampToUtcIso(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

async function insertMeasurement({
  sensorId,
  value,
  co2,
  voc,
  lux,
  sensorType,
  rssi,
  snr,
  battery,
  timestamp,
}) {
  const tsIsoUtc = measurementTimestampToUtcIso(timestamp);
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO measurements (sensor_id, value, co2, voc, lux, sensor_type, rssi, snr, battery, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)`,
      [
        sensorId,
        Number(value),
        co2 == null ? null : Number(co2),
        voc == null ? null : Number(voc),
        lux == null ? null : Number(lux),
        sensorType || null,
        rssi == null ? null : Number(rssi),
        snr == null ? null : Number(snr),
        battery == null ? null : Number(battery),
        tsIsoUtc,
      ],
    );
  });
}

async function historySamplesForLocation(location, limit, range) {
  return withClient(async (c) => {
    const params = [location];
    let whereTime = "";
    if (range?.fromIso) {
      params.push(new Date(range.fromIso));
      whereTime += ` AND m.timestamp >= $${params.length}`;
    }
    if (range?.toIso) {
      params.push(new Date(range.toIso));
      whereTime += ` AND m.timestamp <= $${params.length}`;
    }
    params.push(Math.min(4000, Math.max(1, limit)));
    const limIdx = params.length;
    const r = await c.query(
      `SELECT m.timestamp AS iso,
              m.value AS value,
              m.co2 AS co2,
              m.voc AS voc,
              m.lux AS lux,
              m.sensor_type AS "sensorType",
              s.type AS type,
              s.name AS name,
              s.dev_eui AS "devEui",
              s.min_threshold AS "minThreshold",
              s.max_threshold AS "maxThreshold",
              m.rssi, m.snr, m.battery
       FROM measurements m
       JOIN sensors s ON s.id = m.sensor_id
       WHERE s.location = $1 ${whereTime}
       ORDER BY m.timestamp DESC
       LIMIT $${limIdx}`,
      params,
    );
    return r.rows.map((row) => ({
      iso: new Date(row.iso).toISOString(),
      temp:
        String(row.type || "")
          .toLowerCase()
          .includes("temp") ||
        String(row.type || "")
          .toLowerCase()
          .includes("temperatura")
          ? Number(row.value)
          : null,
      value: Number(row.value),
      co2: row.co2 != null ? Number(row.co2) : null,
      voc: row.voc != null ? Number(row.voc) : null,
      lux: row.lux != null ? Number(row.lux) : null,
      sensorType: row.type,
      sensorData: row.sensorType, // Nuovo campo sensor_type
      sensorName: row.name,
      devEui: row.devEui != null ? String(row.devEui).toUpperCase() : "",
      minThreshold: row.minThreshold != null ? Number(row.minThreshold) : null,
      maxThreshold: row.maxThreshold != null ? Number(row.maxThreshold) : null,
      humidity: null,
      rssi: row.rssi,
      snr: row.snr,
      battery: row.battery,
    }));
  });
}

async function csvRowsForLocation(location, cap, range) {
  return withClient(async (c) => {
    const params = [location];
    let whereTime = "";
    if (range?.fromIso) {
      params.push(new Date(range.fromIso));
      whereTime += ` AND m.timestamp >= $${params.length}`;
    }
    if (range?.toIso) {
      params.push(new Date(range.toIso));
      whereTime += ` AND m.timestamp <= $${params.length}`;
    }
    params.push(Math.min(50_000, Math.max(50, cap)));
    const limIdx = params.length;
    const r = await c.query(
      `SELECT m.timestamp, m.value, m.rssi, m.snr, m.battery,
              s.dev_eui, s.name, s.location, s.type
       FROM measurements m
       JOIN sensors s ON s.id = m.sensor_id
       WHERE s.location = $1 ${whereTime}
       ORDER BY m.timestamp ASC
       LIMIT $${limIdx}`,
      params,
    );
    return r.rows;
  });
}

function buildActiveAlarms(sensorRows, latestMap) {
  const alarms = [];
  for (const s of sensorRows) {
    const last = latestMap.get(s.id);
    const st = uplinkStatus(
      last?.timestamp?.toISOString?.() || last?.timestamp,
    );
    if (st === "offline") {
      alarms.push({
        code: "sensor_offline",
        severity: "critical",
        message: `Sensore ${s.name} (${s.dev_eui}) OFFLINE · nessun uplink entro 30 min`,
        value: null,
      });
    } else if (st === "stale") {
      alarms.push({
        code: "sensor_stale",
        severity: "warning",
        message: `Sensore ${s.name}: uplink in ritardo`,
        value: null,
      });
    }
    if (last && Number.isFinite(Number(last.value))) {
      const tf = thresholdFlag(last.value, s.min_threshold, s.max_threshold);
      if (tf === "low") {
        alarms.push({
          code: "threshold_min",
          severity: "warning",
          message: `${s.name}: valore ${last.value} sotto soglia min (${s.min_threshold})`,
          value: Number(last.value),
        });
      } else if (tf === "high") {
        alarms.push({
          code: "threshold_max",
          severity: "critical",
          message: `${s.name}: valore ${last.value} sopra soglia max (${s.max_threshold})`,
          value: Number(last.value),
        });
      }
    }
    const bat = last?.battery;
    if (bat != null && Number.isFinite(Number(bat)) && Number(bat) <= 25) {
      alarms.push({
        code: "battery_low",
        severity: "warning",
        message: `Batteria bassa su ${s.name} (${Math.round(Number(bat))}%)`,
        value: Math.round(Number(bat)),
      });
    }
    const rssi = last?.rssi;
    if (rssi != null && Number.isFinite(Number(rssi)) && Number(rssi) <= -118) {
      alarms.push({
        code: "signal_weak",
        severity: "info",
        message: `Segnale debole su ${s.name} (${Math.round(Number(rssi))} dBm)`,
        value: Math.round(Number(rssi)),
      });
    }
  }
  return alarms;
}

function pickFirstTempSensor(sensors, latestMap) {
  const temps = sensors.filter(
    (s) =>
      String(s.type || "")
        .toLowerCase()
        .includes("temp") ||
      String(s.type || "")
        .toLowerCase()
        .includes("temperatura"),
  );
  const list = temps.length ? temps : sensors;
  for (const s of list) {
    const last = latestMap.get(s.id);
    if (last && Number.isFinite(Number(last.value))) return Number(last.value);
  }
  return null;
}

function environmentFromSensorCards(cards) {
  const env = {
    humidityPercent: null,
    co2Ppm: null,
    vocIndex: null,
    lightLux: null,
    flowLmin: null,
  };
  for (const c of cards || []) {
    const ty = String(c.type || "").toLowerCase();
    
    // Prima controlla i campi specifici del database (nuova logica multi-sensore)
    if (c.co2 != null && Number.isFinite(Number(c.co2))) {
      env.co2Ppm = Number(c.co2);
    }
    if (c.voc != null && Number.isFinite(Number(c.voc))) {
      env.vocIndex = Number(c.voc);
    }
    if (c.lux != null && Number.isFinite(Number(c.lux))) {
      env.lightLux = Number(c.lux);
    }
    
    // Fallback alla logica basata sul tipo per compatibilità
    if (c.value == null || !Number.isFinite(Number(c.value))) continue;
    const v = Number(c.value);
    if (ty.includes("umid") || ty.includes("humid") || ty === "rh") {
      env.humidityPercent = v;
    } else if (ty.includes("co2") && env.co2Ppm == null) {
      env.co2Ppm = v;
    } else if ((ty.includes("voc") || ty.includes("iaq")) && env.vocIndex == null) {
      env.vocIndex = v;
    } else if ((ty.includes("lux") || ty.includes("luce")) && env.lightLux == null) {
      env.lightLux = v;
    } else if ((ty.includes("fluss") || ty.includes("flow")) && env.flowLmin == null) {
      env.flowLmin = v;
    }
  }
  return env;
}

function pickWaterApprox(sensors, latestMap) {
  const w = sensors.filter((s) => {
    const t = String(s.type || "").toLowerCase();
    return t.includes("acqua") || t.includes("livello");
  });
  const target = w.length ? w : [];
  for (const s of target) {
    const last = latestMap.get(s.id);
    if (last && Number.isFinite(Number(last.value))) {
      const v = Number(last.value);
      return Math.max(0, Math.min(100, v));
    }
  }
  return null;
}

/**
 * Costruisce il payload dashboard completo per una location (Zona impianto).
 */
async function buildDashboardPayload(location) {
  return withClient(async (c) => {
    const allSensors = (
      await c.query(
        `SELECT id, dev_eui, name, location, type, min_threshold, max_threshold
         FROM sensors ORDER BY location ASC, name ASC`,
      )
    ).rows;

    const allIds = allSensors.map((s) => s.id);
    const latestAll =
      allIds.length > 0 ? await fetchLatestMeasurements(allIds, c) : new Map();

    const sensors = allSensors.filter((s) => s.location === location);

    const sensorCards = sensors.map((s) => {
      const last = latestAll.get(s.id);
      const ts = last?.timestamp
        ? new Date(last.timestamp).toISOString()
        : null;
      const st = uplinkStatus(ts);
      const tf = last
        ? thresholdFlag(last.value, s.min_threshold, s.max_threshold)
        : null;
      return {
        id: s.id,
        devEui: s.dev_eui,
        name: s.name,
        type: s.type,
        location: s.location,
        value: last ? Number(last.value) : null,
        rssi: last?.rssi != null ? Number(last.rssi) : null,
        snr: last?.snr != null ? Number(last.snr) : null,
        battery: last?.battery != null ? Number(last.battery) : null,
        lastTimestamp: ts,
        status: st,
        thresholdAlarm: tf,
        minThreshold: s.min_threshold == null ? null : Number(s.min_threshold),
        maxThreshold: s.max_threshold == null ? null : Number(s.max_threshold),
      };
    });

    const seriesR = await c.query(
      `SELECT m.timestamp AS t, m.value AS v
       FROM measurements m
       JOIN sensors s ON s.id = m.sensor_id
       WHERE s.location = $1
         AND (
           lower(s.type) LIKE 'temp%'
           OR lower(s.type) LIKE '%temperatura%'
           OR lower(s.type) = 't'
         )
       ORDER BY m.timestamp DESC
       LIMIT $2`,
      [location, 120],
    );
    const series = seriesR.rows
      .slice()
      .reverse()
      .map((row) => {
        const iso = new Date(row.t).toISOString();
        return {
          label: iso,
          value: Number(row.v),
          iso,
        };
      });

    const lastTemp = pickFirstTempSensor(sensors, latestAll);
    const waterLevel = pickWaterApprox(sensors, latestAll);

    const activeAlarms = buildActiveAlarms(allSensors, latestAll);

    const networkNodes = allSensors.map((s) => {
      const last = latestAll.get(s.id);
      const ts = last?.timestamp
        ? new Date(last.timestamp).toISOString()
        : null;
      return {
        id: String(s.dev_eui),
        label: s.name,
        zoneId: s.location,
        zoneName: s.location,
        gatewayId: "ttn",
        gatewayName: "The Things Network",
        sensors: [s.type],
        hardware: "LoRaWAN",
        floor: "",
        mapX: 50,
        mapY: 50,
        batteryPercent: last?.battery != null ? Number(last.battery) : null,
        rssi: last?.rssi != null ? Number(last.rssi) : null,
        snr: last?.snr != null ? Number(last.snr) : null,
        uplinkAt: ts,
        status: uplinkStatus(ts),
        metrics: {
          temperatureC: String(s.type || "")
            .toLowerCase()
            .includes("temp")
            ? (last?.value ?? null)
            : null,
          levelPercent: String(s.type || "")
            .toLowerCase()
            .includes("water")
            ? (last?.value ?? null)
            : null,
          humidityPercent: null,
          lightLux: last?.lux != null ? Number(last.lux) : null,
          flowLmin: String(s.type || "")
            .toLowerCase()
            .includes("flow")
            ? (last?.value ?? null)
            : null,
          co2Ppm: last?.co2 != null ? Number(last.co2) : null,
          vocIndex: last?.voc != null ? Number(last.voc) : null,
        },
      };
    });

    const totals = {
      nodes: networkNodes.length,
      online: networkNodes.filter((n) => n.status === "online").length,
      stale: networkNodes.filter((n) => n.status === "stale").length,
      offline: networkNodes.filter((n) => n.status === "offline").length,
    };

    const primary = sensors[0];
    const primaryLast = primary ? latestAll.get(primary.id) : null;

    const primaryIso = primaryLast?.timestamp
      ? new Date(primaryLast.timestamp).toISOString()
      : null;
    const telemetry = {
      nodeId: primary ? String(primary.dev_eui) : "",
      nodeLabel: primary ? primary.name : "",
      gatewayId: "ttn",
      gatewayName: "The Things Network",
      batteryPercent:
        primaryLast?.battery != null ? Number(primaryLast.battery) : null,
      rssi: primaryLast?.rssi != null ? Number(primaryLast.rssi) : null,
      snr: primaryLast?.snr != null ? Number(primaryLast.snr) : null,
      uplinkAt: primaryIso,
      nodeStatus: primary ? uplinkStatus(primaryIso) : "offline",
      sensors: primary ? [primary.type] : [],
    };

    const siteZones = (
      await c.query(
        `SELECT location,
                COUNT(*)::int AS cnt
         FROM sensors
         GROUP BY location
         ORDER BY location ASC`,
      )
    ).rows.map((row, idx) => ({
      id: row.location,
      name: row.location,
      floor: "",
      mapX: 40 + (idx % 3) * 15,
      mapY: 40 + Math.floor(idx / 3) * 12,
      planPath: null,
      kind: "area",
      primaryNodeId: null,
      temperatureC: null,
      waterPercent: null,
      humidityPercent: null,
      co2Ppm: null,
      vocIndex: null,
      lightLux: null,
      flowLmin: null,
      batteryPercent: null,
      rssi: null,
      snr: null,
      uplinkAt: null,
      nodeStatus: "online",
      alarmLevel: "ok",
    }));

    return {
      dataProfile: "postgres",
      zone: {
        id: location,
        name: location,
        floor: "",
        mapX: 50,
        mapY: 50,
        planPath: null,
      },
      facility: {
        name: "Centrale IoT · PostgreSQL",
        city: "",
        zones: siteZones.length,
        nodes: allSensors.length,
        gateways: 1,
      },
      floors: [],
      siteZones,
      temperatureSeries: series.map((p) => ({
        label: p.label,
        value: p.value,
      })),
      currentTemperature: lastTemp,
      waterLevelPercent: waterLevel != null ? waterLevel : null,
      environment: environmentFromSensorCards(sensorCards),
      telemetry,
      network: {
        gateway: { id: "ttn", name: "The Things Network" },
        totals,
        nodes: networkNodes,
        events: [],
      },
      activeAlarms,
      sensorCards,
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: null,
      waterRapidDrop: false,
      waterRapidDropDelta: null,
      logLines: [
        `[INFO] ${new Date().toLocaleTimeString("it-IT")} · Snapshot DB · zona ${location} · sensori ${sensors.length}`,
      ],
    };
  });
}

/**
 * Aggiorna il contatore totale litri per un sensore acqua
 */
async function incrementTotalLiters(sensorId, additionalLiters) {
  return withClient(async (c) => {
    const r = await c.query(
      `UPDATE sensors 
       SET total_liters_flowed = total_liters_flowed + $1
       WHERE id = $2
       RETURNING total_liters_flowed, night_flow_threshold, filter_maintenance_limit`,
      [additionalLiters, sensorId]
    );
    return r.rows[0] || null;
  });
}

/**
 * Recupera soglie configurate per sensore acqua
 */
async function getWaterThresholds(sensorId) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT total_liters_flowed, night_flow_threshold, filter_maintenance_limit
       FROM sensors WHERE id = $1`,
      [sensorId]
    );
    return r.rows[0] || null;
  });
}

/**
 * Resetta contatore litri (es. dopo cambio filtri)
 */
async function resetTotalLiters(sensorId) {
  return withClient(async (c) => {
    const r = await c.query(
      `UPDATE sensors 
       SET total_liters_flowed = 0
       WHERE id = $1
       RETURNING total_liters_flowed`,
      [sensorId]
    );
    return r.rows[0] || null;
  });
}


/**
 * Ping leggero per readiness probe (es. load balancer / orchestrator).
 * Non crea schema: assume che verifyDatabaseOnStartup sia già stato eseguito all'avvio.
 */
async function pingDatabase() {
  const p = getPool();
  if (!p) {
    return { ok: false, error: "pool_unavailable" };
  }
  try {
    const r = await p.query("SELECT 1 AS ok");
    const row = r.rows && r.rows[0];
    if (row && Number(row.ok) === 1) {
      return { ok: true };
    }
    return { ok: false, error: "unexpected_ping_result" };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg, code: err && err.code };
  }
}

module.exports = {
  getPool,
  ensureSchema,
  verifyDatabaseOnStartup,
  pingDatabase,
  withClient,
  normalizeDevEui,
  uplinkStatus,
  thresholdFlag,
  HEARTBEAT_OFFLINE_MS,
  UPLINK_STALE_MS,
  listDistinctLocations,
  listSensorsAll,
  listSensorsForLocation,
  insertSensor,
  updateSensor,
  deleteSensor,
  findSensorByDevEui,
  insertMeasurement,
  buildDashboardPayload,
  historySamplesForLocation,
  csvRowsForLocation,
  fetchLatestMeasurements,
  incrementTotalLiters,
  getWaterThresholds,
  resetTotalLiters,
};
