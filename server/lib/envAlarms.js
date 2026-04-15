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
  return alarms;
}

module.exports = { activeAlarmsForState, thresholdsFromEnv };
