import { planPathForFloorId } from "./facilityFloors";

const SENSOR_LABELS = [
  "Nodo serbatoio",
  "Nodo spogliatoi",
  "Nodo flusso",
  "Nodo qualita aria",
  "Nodo cardio",
];

export const MOCK_MAX_POINTS = 18;

export const MOCK_GATEWAYS = [
  {
    id: "gw-livorno-01",
    name: "Gateway LoRa centrale",
    floor: "T",
    mapX: 50,
    mapY: 50,
    location: "Tetto / centrale tecnica",
    uplink: "LoRa",
    backhaul: "Ethernet",
  },
];

export const MOCK_ZONES = [
  {
    id: "hub-centrale",
    name: "Centrale tecnica · Gateway / UPS",
    floor: "T",
    mapX: 50,
    mapY: 50,
    planPath: planPathForFloorId("T"),
    kind: "gateway",
    primaryNodeId: "gw-livorno-01",
  },
  {
    id: "serbatoio-idrico",
    name: "Serbatoio tecnico · livello / temperatura",
    floor: "-1",
    mapX: 26,
    mapY: 44,
    planPath: planPathForFloorId("-1"),
    kind: "water",
    primaryNodeId: "node-water-01",
  },
  {
    id: "spogliatoi-ambientale",
    name: "Spogliatoi · temperatura / umidita / luce",
    floor: "-1",
    mapX: 71,
    mapY: 39,
    planPath: planPathForFloorId("-1"),
    kind: "environment",
    primaryNodeId: "node-env-01",
  },
  {
    id: "linea-flusso",
    name: "Linea idrica · portata / pressione",
    floor: "0",
    mapX: 46,
    mapY: 63,
    planPath: planPathForFloorId("0"),
    kind: "flow",
    primaryNodeId: "node-flow-01",
  },
  {
    id: "sala-pesi-aria",
    name: "Sala pesi · qualita aria",
    floor: "1",
    mapX: 24,
    mapY: 56,
    planPath: planPathForFloorId("1"),
    kind: "air-quality",
    primaryNodeId: "node-air-01",
  },
  {
    id: "cardio-luce",
    name: "Cardio · luce / temperatura",
    floor: "1",
    mapX: 78,
    mapY: 48,
    planPath: planPathForFloorId("1"),
    kind: "light-climate",
    primaryNodeId: "node-light-01",
  },
];

export const MOCK_NODES = [
  {
    id: "node-water-01",
    label: "Nodo serbatoio",
    zoneId: "serbatoio-idrico",
    gatewayId: "gw-livorno-01",
    sensors: ["levelPercent", "temperatureC"],
  },
  {
    id: "node-env-01",
    label: "Nodo spogliatoi",
    zoneId: "spogliatoi-ambientale",
    gatewayId: "gw-livorno-01",
    sensors: ["temperatureC", "humidityPercent", "lightLux"],
  },
  {
    id: "node-flow-01",
    label: "Nodo flusso linea",
    zoneId: "linea-flusso",
    gatewayId: "gw-livorno-01",
    sensors: ["flowLmin", "levelPercent", "temperatureC"],
  },
  {
    id: "node-air-01",
    label: "Nodo qualita aria",
    zoneId: "sala-pesi-aria",
    gatewayId: "gw-livorno-01",
    sensors: ["temperatureC", "humidityPercent", "co2Ppm", "vocIndex"],
  },
  {
    id: "node-light-01",
    label: "Nodo cardio",
    zoneId: "cardio-luce",
    gatewayId: "gw-livorno-01",
    sensors: ["temperatureC", "lightLux", "humidityPercent"],
  },
];

function hashZoneSeed(id) {
  let s = 0;
  for (let i = 0; i < id.length; i += 1) s += id.charCodeAt(i);
  return (s % 97) / 97;
}

export function initMockSnapshot(zoneId) {
  const seed = hashZoneSeed(zoneId || "hub-centrale");
  const zone = MOCK_ZONES.find((item) => item.id === zoneId) || MOCK_ZONES[0];
  const node = MOCK_NODES.find((item) => item.zoneId === zone.id) || null;
  return {
    labels: [],
    values: [],
    lastTemp: 24 + seed * 10,
    water: 45 + seed * 45,
    humidityPct: Math.min(68, Math.max(32, 40 + seed * 28)),
    co2Ppm: Math.min(950, Math.max(420, 520 + Math.floor(seed * 380))),
    vocIndex: Math.min(280, Math.max(45, 90 + Math.floor(seed * 160))),
    lightLux: Math.min(850, Math.max(120, 220 + Math.floor(seed * 450))),
    flowLmin: Math.max(0, 5 + seed * 14),
    batteryPercent: Math.max(52, 90 - Math.floor(seed * 18)),
    rssi: -122 + Math.floor(seed * 18),
    snr: Number((2.5 + seed * 7).toFixed(1)),
    nodeId: node?.id || "",
    nodeLabel: node?.label || zone.name,
    gatewayId: node?.gatewayId || "gw-livorno-01",
    uplinkAt: new Date().toISOString(),
    nodeStatus: zone.id === "hub-centrale" ? "gateway" : "online",
    waterRapidDrop: false,
    waterRapidDropDelta: null,
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
  if (Number.isFinite(st.water)) {
    if (st.water <= 12) {
      alarms.push({
        code: "water_critical",
        severity: "critical",
        message: `Livello critico (${Math.round(st.water)} %)`,
        value: st.water,
      });
    } else if (st.water <= 25) {
      alarms.push({
        code: "water_low",
        severity: "warning",
        message: `Livello basso (${Math.round(st.water)} %)`,
        value: st.water,
      });
    }
  }
  if (st.waterRapidDrop) {
    alarms.push({
      code: "water_rapid_drop",
      severity: "critical",
      message: `Calo rapido livello acqua (${Math.round(st.waterRapidDropDelta || 0)} %)`,
      value: st.waterRapidDropDelta ?? null,
    });
  }
  if (Number.isFinite(st.flowLmin)) {
    if (st.flowLmin >= 22) {
      alarms.push({
        code: "flow_high",
        severity: "warning",
        message: `Flusso elevato (${st.flowLmin.toFixed(1)} L/min)`,
        value: st.flowLmin,
      });
    } else if (st.flowLmin <= 1.5) {
      alarms.push({
        code: "flow_low",
        severity: "info",
        message: `Flusso basso (${st.flowLmin.toFixed(1)} L/min)`,
        value: st.flowLmin,
      });
    }
  }
  if (Number.isFinite(st.lightLux)) {
    if (st.lightLux >= 1200) {
      alarms.push({
        code: "light_high",
        severity: "info",
        message: `Luce elevata (${Math.round(st.lightLux)} lux)`,
        value: st.lightLux,
      });
    } else if (st.lightLux <= 80) {
      alarms.push({
        code: "light_low",
        severity: "info",
        message: `Luce bassa (${Math.round(st.lightLux)} lux)`,
        value: st.lightLux,
      });
    }
  }
  if (Number.isFinite(st.batteryPercent) && st.batteryPercent <= 25) {
    alarms.push({
      code: "battery_low",
      severity: "warning",
      message: `Batteria nodo bassa (${Math.round(st.batteryPercent)} %)`,
      value: st.batteryPercent,
    });
  }
  if (Number.isFinite(st.rssi) && st.rssi <= -118) {
    alarms.push({
      code: "signal_weak",
      severity: "info",
      message: `Segnale LoRa debole (${Math.round(st.rssi)} dBm)`,
      value: st.rssi,
    });
  }
  if (st.nodeStatus === "offline") {
    alarms.push({
      code: "node_offline",
      severity: "critical",
      message: `Nodo remoto ${st.nodeLabel || st.nodeId || ""} offline`,
      value: null,
    });
  } else if (st.nodeStatus === "stale") {
    alarms.push({
      code: "node_stale",
      severity: "warning",
      message: `Uplink nodo ${st.nodeLabel || st.nodeId || ""} in ritardo`,
      value: null,
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
  const nextLight = Math.min(
    1200,
    Math.max(20, (prev.lightLux ?? 320) + randomBetween(-35, 40))
  );
  const nextFlow = Math.min(
    28,
    Math.max(0, (prev.flowLmin ?? 8) + randomBetween(-1.1, 1.2))
  );
  const nextBattery = Math.max(10, (prev.batteryPercent ?? 82) + randomBetween(-0.15, 0.03));
  const nextRssi = Math.min(-92, Math.max(-126, (prev.rssi ?? -110) + randomBetween(-1.4, 1.1)));
  const nextSnr = Math.min(11, Math.max(-2, (prev.snr ?? 5.5) + randomBetween(-0.5, 0.45)));
  const roll = Math.random();
  const nextStatus = roll < 0.035 ? "offline" : roll < 0.12 ? "stale" : prev.nodeStatus || "online";
  const secondsAgo = nextStatus === "offline" ? 520 : nextStatus === "stale" ? 110 : 8;
  const waterRapidDrop = Number.isFinite(prev.water) && Number.isFinite(nextWater)
    ? prev.water - nextWater >= 10
    : false;
  return {
    ...prev,
    lastTemp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
    lightLux: nextLight,
    flowLmin: nextFlow,
    batteryPercent: nextBattery,
    rssi: nextRssi,
    snr: Number(nextSnr.toFixed(1)),
    nodeStatus: nextStatus,
    uplinkAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    waterRapidDrop,
    waterRapidDropDelta: waterRapidDrop ? prev.water - nextWater : null,
  };
}

export function generateMockSensorTick(
  prev,
  maxPoints = MOCK_MAX_POINTS,
  meta = {}
) {
  const zoneTag = meta.zoneName || meta.zoneId || "ZONA";
  const nodeLabel = meta.nodeLabel || prev.nodeLabel || pick(SENSOR_LABELS);
  const now = new Date();
  const t = formatTime(now);
  const sensor = nodeLabel;
  const kinds = ["INFO", "OK", "RX", "DBG"];
  const kind = pick(kinds);
  const msgs = [
    `Uplink LoRa ${sensor} @ ${zoneTag} acquisito`,
    `Gateway centrale ha validato pacchetto ${sensor}`,
    `Campione telemetria distribuita acquisito`,
    `Pacchetto CRC valido`,
    `Nodo remoto ${sensor} sincronizzato`,
    `Forward payload al backend centrale`,
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
  const nextLight =
    prev.lightLux == null
      ? randomBetween(180, 650)
      : Math.min(1300, Math.max(20, prev.lightLux + randomBetween(-55, 75)));
  const nextFlow =
    prev.flowLmin == null
      ? randomBetween(2, 12)
      : Math.min(28, Math.max(0, prev.flowLmin + randomBetween(-1.6, 1.8)));
  const nextBattery =
    prev.batteryPercent == null
      ? randomBetween(64, 94)
      : Math.max(8, Math.min(100, prev.batteryPercent + randomBetween(-0.35, 0.08)));
  const nextRssi =
    prev.rssi == null
      ? randomBetween(-121, -99)
      : Math.min(-92, Math.max(-126, prev.rssi + randomBetween(-2.2, 1.7)));
  const nextSnr =
    prev.snr == null
      ? randomBetween(0.8, 8.8)
      : Math.min(12, Math.max(-3, prev.snr + randomBetween(-0.7, 0.6)));
  const packetRoll = Math.random();
  const nodeStatus = packetRoll < 0.04 ? "offline" : packetRoll < 0.14 ? "stale" : "online";
  const uplinkLagSec = nodeStatus === "offline" ? 620 : nodeStatus === "stale" ? 95 : 6;
  const waterRapidDrop = Number.isFinite(prev.water) && Number.isFinite(nextWater)
    ? prev.water - nextWater >= 12
    : false;

  const labels = [...prev.labels, t];
  const values = [...prev.values, nextTemp];
  if (labels.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  const logLine = `[${kind}] ${t} · ${msg} · RSSI ${Math.round(nextRssi)} dBm`;

  return {
    labels,
    values,
    lastTemp: nextTemp,
    water: nextWater,
    humidityPct: nextHum,
    co2Ppm: nextCo2,
    vocIndex: nextVoc,
    lightLux: nextLight,
    flowLmin: nextFlow,
    batteryPercent: nextBattery,
    rssi: nextRssi,
    snr: Number(nextSnr.toFixed(1)),
    uplinkAt: new Date(Date.now() - uplinkLagSec * 1000).toISOString(),
    nodeStatus,
    waterRapidDrop,
    waterRapidDropDelta: waterRapidDrop ? prev.water - nextWater : null,
    logLine,
  };
}
