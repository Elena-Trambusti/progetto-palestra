/**
 * Soglie allarmi ambientali (override da env sul server).
 */
function thresholdsFromEnv() {
  return {
    tempHighC: Number(process.env.ALARM_TEMP_HIGH_C) || 32,
    tempLowC: Number(process.env.ALARM_TEMP_LOW_C) || 17,
    humidityHighPct: Number(process.env.ALARM_HUMIDITY_HIGH_PCT) || 72,
    humidityLowPct: Number(process.env.ALARM_HUMIDITY_LOW_PCT) || 28,
    co2HighPpm: Number(process.env.ALARM_CO2_HIGH_PPM) || 1000,
    vocHigh: Number(process.env.ALARM_VOC_HIGH) || 350,
    waterLowPct: Number(process.env.ALARM_WATER_LOW_PCT) || 25,
    waterCriticalPct: Number(process.env.ALARM_WATER_CRITICAL_PCT) || 12,
    flowLowLmin: Number(process.env.ALARM_FLOW_LOW_LMIN) || 1.5,
    flowHighLmin: Number(process.env.ALARM_FLOW_HIGH_LMIN) || 22,
    lightLowLux: Number(process.env.ALARM_LIGHT_LOW_LUX) || 80,
    lightHighLux: Number(process.env.ALARM_LIGHT_HIGH_LUX) || 1200,
  };
}

/**
 * Allarmi attivi per UI (nessuna isteresi: stato istantaneo).
 */
function activeAlarmsForState(st, t = thresholdsFromEnv()) {
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

module.exports = { activeAlarmsForState, thresholdsFromEnv };
