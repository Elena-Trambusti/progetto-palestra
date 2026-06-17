/**
 * "Misuratore dati LORA" - Analytics Intelligente Acqua
 * Analisi predittiva per prevenzione danni e ottimizzazione consumi
 */

const { incrementTotalLiters, getWaterThresholds, findSensorByDevEui, resetTotalLiters } = require("./postgresStore");
const { notifyCriticalAlarm, notifyWarning } = require("./telegramNotifier");
const { findZone, findNode } = require("./zonesData");

// Configurazione soglie (override da env se necessario)
const NIGHT_HOURS_START = Number(process.env.WATER_NIGHT_START) || 2;  // 02:00 (come richiesto)
const NIGHT_HOURS_END = Number(process.env.WATER_NIGHT_END) || 5;    // 05:00
const NIGHT_FLOW_MIN_THRESHOLD = Number(process.env.WATER_NIGHT_MIN_FLOW) || 0.1; // L/min
const NIGHT_LEAK_DURATION_THRESHOLD_MS = 10 * 60 * 1000; // 10 minuti continui
const FLOW_CHECK_INTERVAL_MIN = 1;

// Tracking in-memory per durata flusso notturno
const nightFlowStartMap = new Map();

/**
 * Analisi intelligente dati acqua da nodo LoRa
 * @param {Object} params
 * @param {string} params.nodeId - ID nodo (es: node-water-01)
 * @param {number} params.flowLmin - Portata in L/min
 * @param {number} params.levelPercent - Livello serbatoio %
 * @param {Date} params.timestamp - Timestamp misurazione
 * @returns {Promise<Object>} Risultati analisi
 */
async function analyzeWaterData({ nodeId, flowLmin, levelPercent, timestamp = new Date() }) {
  const results = {
    nodeId,
    timestamp,
    flowLmin,
    levelPercent,
    alerts: [],
    metrics: {
      totalLiters: null,
      estimatedWaste: 0,
      maintenanceStatus: 'ok'
    }
  };

  try {
    const sensor = await findSensorByDevEui(nodeId);
    if (!sensor) {
      console.warn(`[waterAnalytics] Sensore ${nodeId} non trovato nel database`);
      return results;
    }

    const node = findNode(nodeId) || findNode(sensor.dev_eui) || null;
    const zoneId = node?.zoneId || sensor.location || nodeId;

    // Recupera soglie configurate
    const thresholds = await getWaterThresholds(sensor.id);
    if (!thresholds) {
      console.warn(`[waterAnalytics] Soglie non trovate per sensore ${sensor.id}`);
      return results;
    }

    // 1. Incrementa contatore litri totali
    if (flowLmin > 0) {
      const litersIncrement = flowLmin * FLOW_CHECK_INTERVAL_MIN;
      const updated = await incrementTotalLiters(sensor.id, litersIncrement);
      if (updated) {
        results.metrics.totalLiters = updated.total_liters_flowed;
      }
    }

    // 2. Analisi perdita notturna
    const nightLeakAlert = await detectNightLeak({
      nodeId,
      flowLmin,
      timestamp,
      threshold: thresholds.night_flow_threshold
    });
    if (nightLeakAlert) {
      results.alerts.push(nightLeakAlert);
      results.metrics.estimatedWaste = nightLeakAlert.estimatedWaste;
    }

    // 3. Analisi manutenzione filtri
    const maintenanceAlert = await checkMaintenanceStatus({
      nodeId,
      totalLiters: results.metrics.totalLiters,
      threshold: thresholds.filter_maintenance_limit
    });
    if (maintenanceAlert) {
      results.alerts.push(maintenanceAlert);
      results.metrics.maintenanceStatus = maintenanceAlert.severity;
    }

    // 4. Analisi livello e perdite specifiche per zona
    const zoneKey = String(zoneId || "").toLowerCase();
    if (zoneKey.includes("controsoffitti")) {
      // Nei controsoffitti, se il livello (water_level_mm o presence) è > 0, è una perdita!
      if (levelPercent !== null && levelPercent > 0) {
        results.alerts.push({
          type: 'ceiling_leak',
          severity: 'critical',
          title: '🚨 ALLAGAMENTO CONTROSOFFITTI',
          message: `Rilevata presenza di acqua nei controsoffitti (valore: ${levelPercent})!`,
          estimatedWaste: 0,
          action: 'Ispezione immediata controsoffitti e impianto idraulico superiore!'
        });
      }
    } else {
      // Logica standard serbatoi (Vano Idrico)
      if (levelPercent !== null) {
        if (levelPercent <= 12) {
          results.alerts.push({
            type: 'water_critical',
            severity: 'critical',
            title: 'Livello Acqua Critico',
            message: `Livello serbatoio al ${levelPercent}% - rischio esaurimento`,
            estimatedWaste: 0,
            action: 'Rifornimento immediato serbatoio'
          });
        } else if (levelPercent <= 25) {
          results.alerts.push({
            type: 'water_low',
            severity: 'warning',
            title: 'Livello Acqua Basso',
            message: `Livello serbatoio al ${levelPercent}% - pianificare rifornimento`,
            estimatedWaste: 0,
            action: 'Programmare rifornimento entro 48h'
          });
        }
      }
    }

    // Invia notifiche Telegram per gli alert
    for (const alert of results.alerts) {
      await sendWaterAlert({ nodeId, alert, zoneId });
    }

  } catch (error) {
    console.error(`[waterAnalytics] Errore analisi ${nodeId}:`, error);
    results.error = error.message;
  }

  return results;
}

/**
 * Rileva perdite notturne
 */
async function detectNightLeak({ nodeId, flowLmin, timestamp, threshold }) {
  const hour = timestamp.getHours();
  const now = timestamp.getTime();
  
  // Verifica se è orario notturno (02:00-05:00)
  const isNightTime = hour >= NIGHT_HOURS_START && hour < NIGHT_HOURS_END;
  const isFlowing = flowLmin > threshold;

  if (!isNightTime || !isFlowing) {
    nightFlowStartMap.delete(nodeId); // Reset se il flusso si ferma o siamo fuori orario
    return null;
  }

  // Inizio tracking del flusso
  if (!nightFlowStartMap.has(nodeId)) {
    nightFlowStartMap.set(nodeId, now);
    console.log(`[waterAnalytics] Inizio monitoraggio flusso notturno per ${nodeId} alle ${hour}:${timestamp.getMinutes()}`);
    return null;
  }

  const startTime = nightFlowStartMap.get(nodeId);
  const durationMs = now - startTime;

  // Solo se il flusso dura da più di 10 minuti scatta l'allarme
  if (durationMs < NIGHT_LEAK_DURATION_THRESHOLD_MS) {
    return null;
  }

  // Calcola spreco stimato
  const nightHours = NIGHT_HOURS_END - NIGHT_HOURS_START;
  const estimatedWaste = flowLmin * nightHours * 60;

  return {
    type: 'night_leak',
    severity: 'critical',
    title: '🚨 SOSPETTA PERDITA OCCULTA',
    message: `Flusso continuo rilevato da oltre 10 minuti tra le 02:00 e le 05:00 - ${flowLmin.toFixed(2)} L/min`,
    estimatedWaste: Math.round(estimatedWaste),
    action: 'Ispezione urgente: possibile perdita occulta o rubinetto aperto nel Vano Idrico',
    details: {
      detectionTime: timestamp.toISOString(),
      durationMin: Math.round(durationMs / 60000),
      flowRate: flowLmin
    }
  };
}

/**
 * Verifica stato manutenzione filtri
 */
async function checkMaintenanceStatus({ nodeId, totalLiters, threshold }) {
  if (!totalLiters || totalLiters < threshold) {
    return null;
  }

  const overflowLiters = totalLiters - threshold;
  const efficiencyLoss = Math.min(25, Math.round((overflowLiters / threshold) * 100));

  return {
    type: 'filter_maintenance',
    severity: 'warning',
    title: '🔧 MANUTENZIONE FILTRI NECESSARIA',
    message: `Filtri superati: ${Math.round(totalLiters).toLocaleString()}L (soglia ${threshold.toLocaleString()}L)`,
    estimatedWaste: Math.round(overflowLiters * 0.1), // 10% di spreco stimato
    action: 'Sostituire filtri depuratori - efficienza ridotta del ' + efficiencyLoss + '%',
    details: {
      totalLiters: Math.round(totalLiters),
      threshold: threshold,
      overflowLiters: Math.round(overflowLiters),
      efficiencyLoss: efficiencyLoss
    }
  };
}

/**
 * Invia notifica Telegram per allarme acqua
 */
async function sendWaterAlert({ nodeId, alert, zoneId: zoneIdIn }) {
  const sensor = await findSensorByDevEui(nodeId).catch(() => null);
  const node = findNode(nodeId) || (sensor ? findNode(sensor.dev_eui) : null);
  const zone = zoneIdIn
    ? findZone(zoneIdIn)
    : node
      ? findZone(node.zoneId)
      : sensor?.location
        ? findZone(sensor.location)
        : null;

  const zoneName =
    zone?.name || sensor?.location || node?.zoneId || "Zona sconosciuta";
  const effectiveZoneId = zone?.id || zoneIdIn || node?.zoneId || sensor?.location || "unknown";
  const locationText = zone ? `📍 ${zone.name}\n🗺️ Piano ${zone.floor}` : `📍 ${zoneName}`;

  const wasteText = alert.estimatedWaste > 0 
    ? `\n💧 Spreco stimato: ${alert.estimatedWaste.toLocaleString()} litri`
    : '';

  const text = [
    `${alert.severity === 'critical' ? '🚨' : '⚠️'} <b>${alert.title}</b>`,
    "",
    alert.message,
    wasteText,
    "",
    locationText,
    "",
    `⚡ <b>Azione consigliata:</b> ${alert.action}`,
    "",
    `🕐 ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} (ITA)`
  ].join('\n');

  try {
    if (alert.severity === 'critical') {
      await notifyCriticalAlarm({
        zoneId: effectiveZoneId,
        zoneName,
        type: alert.type,
        title: alert.title.replace(/[🚨🔧]/g, '').trim(),
        message: alert.message,
        value: alert.estimatedWaste,
        unit: 'litri',
        action: alert.action
      });
    } else {
      await notifyWarning({
        zoneId: effectiveZoneId,
        zoneName,
        type: alert.type,
        title: alert.title.replace(/[⚠️🔧]/g, '').trim(),
        message: alert.message,
        value: alert.estimatedWaste,
        unit: 'litri'
      });
    }
    
    console.log(`[waterAnalytics] Notifica inviata: ${alert.type} - ${nodeId}`);
  } catch (error) {
    console.error(`[waterAnalytics] Errore invio notifica:`, error);
  }
}

/**
 * Resetta contatori dopo manutenzione
 */
async function resetWaterCounters(nodeId) {
  const sensor = await findSensorByDevEui(nodeId);
  if (!sensor) {
    throw new Error(`Sensore ${nodeId} non trovato nel database`);
  }

  const result = await resetTotalLiters(sensor.id);
  console.log(`[waterAnalytics] Contatori resettati per ${nodeId}:`, result);
  
  return result;
}

module.exports = {
  analyzeWaterData,
  detectNightLeak,
  checkMaintenanceStatus,
  resetWaterCounters,
  NIGHT_HOURS_START,
  NIGHT_HOURS_END,
  FLOW_CHECK_INTERVAL_MIN
};
