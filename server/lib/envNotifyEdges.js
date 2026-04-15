const { maybeNotifyEnvThreshold } = require("./notify");
const { thresholdsFromEnv } = require("./envAlarms");

/**
 * Confronta campione precedente e attuale; invia webhook sui fronti di soglia.
 */
function notifyEnvironmentEdges({
  zoneId,
  zoneName,
  prev,
  next,
  webhookUrl,
}) {
  if (!webhookUrl || !prev || !next) return;
  const t = thresholdsFromEnv();

  const pTemp = prev.lastTemp;
  const nTemp = next.lastTemp;
  if (Number.isFinite(pTemp) && Number.isFinite(nTemp)) {
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "temp_high",
      message: `Superata soglia caldo (${t.tempHighC} °C) in ${zoneName || zoneId}`,
      value: nTemp,
      webhookUrl,
      crossed: pTemp < t.tempHighC && nTemp >= t.tempHighC,
    });
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "temp_low",
      message: `Sotto soglia freddo (${t.tempLowC} °C) in ${zoneName || zoneId}`,
      value: nTemp,
      webhookUrl,
      crossed: pTemp > t.tempLowC && nTemp <= t.tempLowC,
    });
  }

  const pH = prev.humidityPct;
  const nH = next.humidityPct;
  if (Number.isFinite(pH) && Number.isFinite(nH)) {
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "humidity_high",
      message: `Umidità sopra ${t.humidityHighPct}% in ${zoneName || zoneId}`,
      value: nH,
      webhookUrl,
      crossed: pH < t.humidityHighPct && nH >= t.humidityHighPct,
    });
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "humidity_low",
      message: `Umidità sotto ${t.humidityLowPct}% in ${zoneName || zoneId}`,
      value: nH,
      webhookUrl,
      crossed: pH > t.humidityLowPct && nH <= t.humidityLowPct,
    });
  }

  const pC = prev.co2Ppm;
  const nC = next.co2Ppm;
  if (Number.isFinite(pC) && Number.isFinite(nC)) {
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "co2_high",
      message: `CO₂ sopra ${t.co2HighPpm} ppm in ${zoneName || zoneId}`,
      value: nC,
      webhookUrl,
      crossed: pC < t.co2HighPpm && nC >= t.co2HighPpm,
    });
  }

  const pV = prev.vocIndex;
  const nV = next.vocIndex;
  if (Number.isFinite(pV) && Number.isFinite(nV)) {
    maybeNotifyEnvThreshold({
      zoneId,
      zoneName,
      alarmType: "voc_high",
      message: `VOC sopra soglia in ${zoneName || zoneId}`,
      value: nV,
      webhookUrl,
      crossed: pV < t.vocHigh && nV >= t.vocHigh,
    });
  }
}

module.exports = { notifyEnvironmentEdges };
