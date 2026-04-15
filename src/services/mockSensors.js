import { planPathForFloorId } from "./facilityFloors";

const SENSORS = [
  "Sensore_A",
  "Sensore_B",
  "Sensore_C",
  "Nodo_DOCCE_01",
  "Nodo_DOCCE_02",
  "HUB_PALESTRA",
];

export const MOCK_MAX_POINTS = 18;

/** Allineate a `server/lib/zonesData.js` */
export const MOCK_ZONES = [
  {
    id: "hub-centrale",
    name: "Centrale tecnica · UPS",
    floor: "T",
    mapX: 50,
    mapY: 50,
    planPath: planPathForFloorId("T"),
  },
  {
    id: "docce-p1",
    name: "Docce · Spogliatoi piano -1",
    floor: "-1",
    mapX: 28,
    mapY: 42,
    planPath: planPathForFloorId("-1"),
  },
  {
    id: "docce-p2",
    name: "Docce · Area corsi piano 2",
    floor: "2",
    mapX: 72,
    mapY: 38,
    planPath: planPathForFloorId("2"),
  },
  {
    id: "pesi-nord",
    name: "Sala pesi · Ala nord",
    floor: "1",
    mapX: 22,
    mapY: 55,
    planPath: planPathForFloorId("1"),
  },
  {
    id: "cardio",
    name: "Cardio · Panoramica",
    floor: "1",
    mapX: 78,
    mapY: 48,
    planPath: planPathForFloorId("1"),
  },
  {
    id: "wellness",
    name: "Wellness · Vasche tecniche",
    floor: "0",
    mapX: 48,
    mapY: 62,
    planPath: planPathForFloorId("0"),
  },
];

function hashZoneSeed(id) {
  let s = 0;
  for (let i = 0; i < id.length; i += 1) s += id.charCodeAt(i);
  return (s % 97) / 97;
}

export function initMockSnapshot(zoneId) {
  const seed = hashZoneSeed(zoneId || "hub-centrale");
  return {
    labels: [],
    values: [],
    lastTemp: 24 + seed * 10,
    water: 45 + seed * 45,
    humidityPct: Math.min(68, Math.max(32, 40 + seed * 28)),
    co2Ppm: Math.min(950, Math.max(420, 520 + Math.floor(seed * 380))),
    vocIndex: Math.min(280, Math.max(45, 90 + Math.floor(seed * 160))),
  };
}

function formatTime(d) {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Deriva allarmi mock con soglie coerenti al server di default */
export function computeMockActiveAlarms(st) {
  if (!st) return [];
  const alarms = [];
  const temp = st.lastTemp;
  const h = st.humidityPct;
  const co2 = st.co2Ppm;
  const voc = st.vocIndex;
  if (Number.isFinite(temp)) {
    if (temp >= 32) {
      alarms.push({
        code: "temp_high",
        severity: "warning",
        message: `Temperatura elevata (${temp.toFixed(1)} °C)`,
        value: temp,
      });
    } else if (temp <= 17) {
      alarms.push({
        code: "temp_low",
        severity: "info",
        message: `Temperatura bassa (${temp.toFixed(1)} °C)`,
        value: temp,
      });
    }
  }
  if (Number.isFinite(h)) {
    if (h >= 72) {
      alarms.push({
        code: "humidity_high",
        severity: "warning",
        message: `Umidità elevata (${Math.round(h)} %)`,
        value: h,
      });
    } else if (h <= 28) {
      alarms.push({
        code: "humidity_low",
        severity: "info",
        message: `Umidità bassa (${Math.round(h)} %)`,
        value: h,
      });
    }
  }
  if (Number.isFinite(co2) && co2 >= 1000) {
    alarms.push({
      code: "co2_high",
      severity: "critical",
      message: `CO₂ elevato (${Math.round(co2)} ppm)`,
      value: co2,
    });
  }
  if (Number.isFinite(voc) && voc >= 350) {
    alarms.push({
      code: "voc_high",
      severity: "warning",
      message: `Indice VOC elevato (${Math.round(voc)})`,
      value: voc,
    });
  }
  return alarms;
}

export function alarmLevelFromAlarms(alarms) {
  if (!alarms?.length) return "ok";
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warning")) return "warning";
  return "info";
}

/**
 * Piccolo aggiornamento per zone non selezionate (mappa multi-zona).
 */
export function driftMockSnapshot(prev) {
  const nextTemp = Math.min(
    40,
    Math.max(21, (prev.lastTemp ?? 28) + randomBetween(-0.35, 0.35))
  );
  const nextWater = Math.min(
    100,
    Math.max(5, (prev.water ?? 70) + randomBetween(-1.2, 1))
  );
  const nextHum = Math.min(
    78,
    Math.max(26, (prev.humidityPct ?? 50) + randomBetween(-0.8, 0.8))
  );
  const nextCo2 = Math.min(
    1550,
    Math.max(380, (prev.co2Ppm ?? 650) + randomBetween(-20, 22))
  );
  const nextVoc = Math.min(
    420,
    Math.max(35, (prev.vocIndex ?? 120) + randomBetween(-8, 10))
  );
  return {
    ...prev,
    lastTemp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
  };
}

export function generateMockSensorTick(
  prev,
  maxPoints = MOCK_MAX_POINTS,
  meta = {}
) {
  const zoneTag = meta.zoneName || meta.zoneId || "ZONA";
  const now = new Date();
  const t = formatTime(now);
  const sensor = pick(SENSORS);
  const kinds = ["INFO", "OK", "RX", "DBG"];
  const kind = pick(kinds);
  const msgs = [
    `Ricezione dati ${sensor} @ ${zoneTag}... OK`,
    `Handshake ${sensor} completato`,
    `Campione termico aggregato`,
    `Livello vasca compensato`,
    `Checksum pacchetto valido`,
    `Campione ambientale RH/CO₂/VOC`,
    `Ping nodo periferico ${randomBetween(8, 28).toFixed(1)} ms`,
  ];
  const msg = pick(msgs);

  const nextTemp =
    prev.lastTemp == null
      ? randomBetween(26, 34)
      : Math.min(40, Math.max(22, prev.lastTemp + randomBetween(-1.2, 1.2)));

  const nextWater =
    prev.water == null
      ? randomBetween(45, 92)
      : Math.min(100, Math.max(5, prev.water + randomBetween(-4, 3)));

  const nextHum =
    prev.humidityPct == null
      ? randomBetween(38, 62)
      : Math.min(78, Math.max(26, prev.humidityPct + randomBetween(-2.2, 2)));

  const nextCo2 =
    prev.co2Ppm == null
      ? randomBetween(480, 820)
      : Math.min(1550, Math.max(380, prev.co2Ppm + randomBetween(-45, 55)));

  const nextVoc =
    prev.vocIndex == null
      ? randomBetween(70, 200)
      : Math.min(420, Math.max(35, prev.vocIndex + randomBetween(-18, 22)));

  const labels = [...prev.labels, t];
  const values = [...prev.values, nextTemp];
  if (labels.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  const logLine = `[${kind}] ${t} · ${msg}`;

  return {
    labels,
    values,
    lastTemp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
    logLine,
  };
}
