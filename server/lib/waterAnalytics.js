/**
 * "Sesto Senso" - Analytics Intelligente Acqua
 * Analisi predittiva per prevenzione danni e ottimizzazione consumi
 */

const { incrementTotalLiters, getWaterThresholds, findSensorByDevEui } = require("./postgresStore");
const { notifyCriticalAlarm, notifyWarning } = require("./telegramNotifier");
const { findZone, findNode } = require("./zonesData");

// Configurazione soglie (override da env se necessario)
const NIGHT_HOURS_START = Number(process.env.WATER_NIGHT_START) || 1;  // 01:00
const NIGHT_HOURS_END = Number(process.env.WATER_NIGHT_END) || 5;    // 05:00
const NIGHT_FLOW_MIN_THRESHOLD = Number(process.env.WATER_NIGHT_MIN_FLOW) || 0.1; // L/min
const FLOW_CHECK_INTERVAL_MIN = 1; // minuti per calcolo litri

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
    // Trova sensore nel database
    const node = findNode(nodeId);
    if (!node) {
      console.warn(`[waterAnalytics] Nodo ${nodeId} non trovato in zonesData`);
      return results;
    }

    const sensor = await findSensorByDevEui(nodeId);
    if (!sensor) {
      console.warn(`[waterAnalytics] Sensore ${nodeId} non trovato nel database`);
      return results;
    }

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

    // 4. Analisi livello critico (esistente)
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

    // Invia notifiche Telegram per gli alert
    for (const alert of results.alerts) {
      await sendWaterAlert({ nodeId, alert });
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
  
  // Verifica se è orario notturno (01:00-05:00)
  const isNightTime = hour >= NIGHT_HOURS_START && hour < NIGHT_HOURS_END;
  
  if (!isNightTime || flowLmin <= threshold) {
    return null;
  }

  // Calcola spreco stimato (8 ore notturne * flusso anomalo)
  const nightHours = NIGHT_HOURS_END - NIGHT_HOURS_START;
  const estimatedWaste = flowLmin * nightHours * 60; // litri per notte

  return {
    type: 'night_leak',
    severity: 'critical',
    title: '🚨 POSSIBILE PERDITA NOTTURNA',
    message: `Flusso anomalo rilevato alle ${hour}:${String(timestamp.getMinutes()).padStart(2, '0')} - ${flowLmin.toFixed(2)} L/min`,
    estimatedWaste: Math.round(estimatedWaste),
    action: 'Verificare rubinetti bagni e docce - possibile perdita idrica',
    details: {
      detectionTime: timestamp.toISOString(),
      flowRate: flowLmin,
      threshold: threshold,
      nightHours: nightHours
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
async function sendWaterAlert({ nodeId, alert }) {
  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;
  
  const zoneName = zone?.name || node?.zoneId || 'Zona sconosciuta';
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
        zoneId: node?.zoneId || 'unknown',
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
        zoneId: node?.zoneId || 'unknown',
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
  const node = findNode(nodeId);
  if (!node) {
    throw new Error(`Nodo ${nodeId} non trovato`);
  }

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
