/**
 * Soglie allarmi ambientali (override da env sul server).
 */
function baseThresholdsFromEnv(prefix = "ALARM_") {
  const read = (key, fallback) => {
    const raw = process.env[`${prefix}${key}`];
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    tempHighC: read("TEMP_HIGH_C", 32),
    tempLowC: read("TEMP_LOW_C", 17),
    humidityHighPct: read("HUMIDITY_HIGH_PCT", 72),
    humidityLowPct: read("HUMIDITY_LOW_PCT", 28),
    co2HighPpm: read("CO2_HIGH_PPM", 1000),
    vocHigh: read("VOC_HIGH", 350),
    waterLowPct: read("WATER_LOW_PCT", 25),
    waterCriticalPct: read("WATER_CRITICAL_PCT", 12),
    flowLowLmin: read("FLOW_LOW_LMIN", 1.5),
    flowHighLmin: read("FLOW_HIGH_LMIN", 22),
    lightLowLux: read("LIGHT_LOW_LUX", 80),
    lightHighLux: read("LIGHT_HIGH_LUX", 1200),
  };
}

function thresholdsFromEnv() {
  return baseThresholdsFromEnv("ALARM_");
}

/**
 * Override soglie per tipo nodo/zona, via env.
 * Esempi:
 * - ALARM_WATER__WATER_LOW_PCT=30
 * - ALARM_FLOW__FLOW_HIGH_LMIN=18
 * - ALARM_AIR__CO2_HIGH_PPM=900
 * - ALARM_LIGHT__LIGHT_LOW_LUX=120
 */
function thresholdsForKind(kind, base = thresholdsFromEnv()) {
  const k = String(kind || "").toLowerCase();
  const map = {
    water: "WATER__",
    flow: "FLOW__",
    "air-quality": "AIR__",
    environment: "ENV__",
    "light-climate": "LIGHT__",
  };
  const prefix = map[k] ? `ALARM_${map[k]}` : "";
  if (!prefix) return base;
  return { ...base, ...baseThresholdsFromEnv(prefix) };
}

/**
 * Allarmi attivi per UI (nessuna isteresi: stato istantaneo).
 */
function activeAlarmsForState(st, tIn = thresholdsFromEnv()) {
  const t = thresholdsForKind(st?.zoneKind, tIn);
  const alarms = [];
  const temp = st.lastTemp;
  const h = st.humidityPct;
  const co2 = st.co2Ppm;
  const voc = st.vocIndex;
  const water = st.water;
  const flow = st.flowLmin;
  const light = st.lightLux;

  if (Number.isFinite(temp)) {
    if (temp >= t.tempHighC) {
      alarms.push({
        code: "temp_high",
        severity: "warning",
        message: `Temperatura elevata (${temp.toFixed(1)} °C)`,
        value: temp,
      });
    } else if (temp <= t.tempLowC) {
      alarms.push({
        code: "temp_low",
        severity: "info",
        message: `Temperatura bassa (${temp.toFixed(1)} °C)`,
        value: temp,
      });
    }
  }
  if (Number.isFinite(h)) {
    if (h >= t.humidityHighPct) {
      alarms.push({
        code: "humidity_high",
        severity: "warning",
        message: `Umidità elevata (${Math.round(h)} %)`,
        value: h,
      });
    } else if (h <= t.humidityLowPct) {
      alarms.push({
        code: "humidity_low",
        severity: "info",
        message: `Umidità bassa (${Math.round(h)} %)`,
        value: h,
      });
    }
  }
  if (Number.isFinite(co2) && co2 >= t.co2HighPpm) {
    alarms.push({
      code: "co2_high",
      severity: "critical",
      message: `CO₂ elevato (${Math.round(co2)} ppm)`,
      value: co2,
    });
  }
  if (Number.isFinite(voc) && voc >= t.vocHigh) {
    alarms.push({
      code: "voc_high",
      severity: "warning",
      message: `Indice VOC elevato (${Math.round(voc)})`,
      value: voc,
    });
  }
  if (Number.isFinite(water)) {
    if (water <= t.waterCriticalPct) {
      alarms.push({
        code: "water_critical",
        severity: "critical",
        message: `Livello critico (${Math.round(water)} %)`,
        value: water,
      });
    } else if (water <= t.waterLowPct) {
      alarms.push({
        code: "water_low",
        severity: "warning",
        message: `Livello basso (${Math.round(water)} %)`,
        value: water,
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
  if (Number.isFinite(flow)) {
    if (flow >= t.flowHighLmin) {
      alarms.push({
        code: "flow_high",
        severity: "warning",
        message: `Flusso elevato (${flow.toFixed(1)} L/min)`,
        value: flow,
      });
    } else if (flow <= t.flowLowLmin) {
      alarms.push({
        code: "flow_low",
        severity: "info",
        message: `Flusso basso (${flow.toFixed(1)} L/min)`,
        value: flow,
      });
    }
  }
  if (Number.isFinite(light)) {
    if (light >= t.lightHighLux) {
      alarms.push({
        code: "light_high",
        severity: "info",
        message: `Luce elevata (${Math.round(light)} lux)`,
        value: light,
      });
    } else if (light <= t.lightLowLux) {
      alarms.push({
        code: "light_low",
        severity: "info",
        message: `Luce bassa (${Math.round(light)} lux)`,
        value: light,
      });
    }
  }
  return alarms;
}

module.exports = { activeAlarmsForState, thresholdsFromEnv, thresholdsForKind };
