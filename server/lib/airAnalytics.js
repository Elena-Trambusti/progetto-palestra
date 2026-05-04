/**
 * "Misuratore dati LORA Aria" - Analytics Intelligente Qualità Aria
 * Analisi predittiva per qualità aria, illuminazione e comfort ambientale
 */

const { notifyCriticalAlarm, notifyWarning, notifyInfo } = require("./telegramNotifier");

// Configurazione soglie (override da env se necessario)
const CO2_CRITICAL_THRESHOLD = Number(process.env.AIR_CO2_THRESHOLD) || 1200; // ppm
const CO2_WARNING_THRESHOLD = 800; // ppm
const LUX_MIN_THRESHOLD = 50; // lux
const BUSINESS_HOURS_START = 8; // 08:00
const BUSINESS_HOURS_END = 22; // 22:00

/**
 * Analisi intelligente dati aria da nodo LoRa
 * @param {Object} params
 * @param {string} params.nodeId - ID nodo (es: node-air-01)
 * @param {number} params.co2 - Livello CO2 in ppm
 * @param {number} params.voc - Indice VOC
 * @param {number} params.lux - Livello illuminazione in lux
 * @param {Date|string} params.timestamp - Timestamp della misura
 * @returns {Promise<Object>} Risultato analisi con alert e metriche
 */
async function analyzeAirData(params) {
  const { nodeId, co2, voc, lux, timestamp, maxThreshold } = params;
  const alerts = [];
  const metrics = { co2, voc, lux };
  const analysisTime = new Date(timestamp || Date.now());
  const currentHour = analysisTime.getHours();
  
  // Utilizza la soglia specifica del nodo (zona) se presente, altrimenti il default
  const criticalCo2Threshold = maxThreshold && maxThreshold > 0 ? maxThreshold : CO2_CRITICAL_THRESHOLD;
  const warningCo2Threshold = Math.round(criticalCo2Threshold * 0.75); // Avviso al 75% della soglia critica
  
  console.log(`[airAnalytics] Analisi dati aria per ${nodeId}: CO2=${co2}ppm, VOC=${voc}, Lux=${lux} (Soglia CO2: ${criticalCo2Threshold})`);

  // Analisi CO2 - Allarme Critico
  if (co2 !== null && co2 > criticalCo2Threshold) {
    const co2Alert = {
      severity: 'critical',
      type: 'co2_critical',
      title: 'Aria Viziata - Misuratore dati LORA',
      message: `⚠️ Aria viziata! Livello CO2 a ${co2} ppm. Aprire finestre immediatamente.`,
      nodeId,
      timestamp: analysisTime.toISOString(),
      metrics: { co2, threshold: criticalCo2Threshold }
    };
    
    alerts.push(co2Alert);
    
    // Invia notifica Telegram immediata
    await notifyCriticalAlarm({
      title: co2Alert.title,
      message: co2Alert.message,
      nodeId,
      metrics: co2Alert.metrics
    });
  }
  // Analisi CO2 - Avviso
  else if (co2 !== null && co2 > warningCo2Threshold) {
    const co2Warning = {
      severity: 'info',
      type: 'co2_warning',
      title: 'Affollamento Aumentato',
      message: `📢 Affollamento in aumento. Si consiglia ricambio aria. CO2: ${co2} ppm`,
      nodeId,
      timestamp: analysisTime.toISOString(),
      metrics: { co2, threshold: warningCo2Threshold }
    };
    
    alerts.push(co2Warning);
    
    // Invia notifica Telegram informativa
    await notifyInfo({
      title: co2Warning.title,
      message: co2Warning.message,
      nodeId,
      metrics: co2Warning.metrics
    });
  }

  // Analisi Illuminazione (solo durante orario di apertura)
  const isBusinessHours = currentHour >= BUSINESS_HOURS_START && currentHour <= BUSINESS_HOURS_END;
  if (isBusinessHours && lux !== null && lux < LUX_MIN_THRESHOLD) {
    const lightAlert = {
      severity: 'warning',
      type: 'light_insufficient',
      title: 'Illuminazione Insufficiente',
      message: `💡 Livello luce basso (${lux} lux). Controllare illuminazione per comfort ambientale.`,
      nodeId,
      timestamp: analysisTime.toISOString(),
      metrics: { lux, threshold: LUX_MIN_THRESHOLD, hour: currentHour }
    };
    
    alerts.push(lightAlert);
    
    // Invia notifica Telegram di avviso
    await notifyWarning({
      title: lightAlert.title,
      message: lightAlert.message,
      nodeId,
      metrics: lightAlert.metrics
    });
  }

  // Analisi VOC (composti organici volatili)
  if (voc !== null && voc > 200) {
    const vocAlert = {
      severity: 'warning',
      type: 'voc_high',
      title: 'Qualità Aria Degradata',
      message: `🌡️ Livello VOC elevato (${voc}). Verificare fonti di inquinamento interni.`,
      nodeId,
      timestamp: analysisTime.toISOString(),
      metrics: { voc, threshold: 200 }
    };
    
    alerts.push(vocAlert);
    
    // Invia notifica Telegram
    await notifyWarning({
      title: vocAlert.title,
      message: vocAlert.message,
      nodeId,
      metrics: vocAlert.metrics
    });
  }

  // Log di riepilogo
  if (alerts.length > 0) {
    console.log(`[airAnalytics] Generati ${alerts.length} alert per ${nodeId}:`, 
      alerts.map(a => `${a.type} (${a.severity})`));
  }

  return {
    nodeId,
    timestamp: analysisTime.toISOString(),
    alerts,
    metrics,
    status: alerts.length > 0 ? 'alerts' : 'normal',
    summary: {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
      warningAlerts: alerts.filter(a => a.severity === 'warning').length,
      infoAlerts: alerts.filter(a => a.severity === 'info').length
    }
  };
}

/**
 * Calcola indice di qualità aria complessivo (0-100)
 * @param {Object} metrics - Metriche aria {co2, voc, lux}
 * @returns {number} Indice qualità (0=pessimo, 100=ottimo)
 */
function calculateAirQualityIndex(metrics) {
  const { co2, voc, lux } = metrics;
  let score = 100;
  
  // Penalizzazione CO2
  if (co2 > 1200) score -= 40;
  else if (co2 > 800) score -= 20;
  else if (co2 > 600) score -= 10;
  
  // Penalizzazione VOC
  if (voc > 300) score -= 30;
  else if (voc > 200) score -= 15;
  else if (voc > 150) score -= 5;
  
  // Penalizzazione illuminazione (se orario business)
  const currentHour = new Date().getHours();
  const isBusinessHours = currentHour >= 8 && currentHour <= 22;
  if (isBusinessHours && lux < 50) score -= 20;
  else if (isBusinessHours && lux < 100) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

module.exports = {
  analyzeAirData,
  calculateAirQualityIndex,
  CO2_CRITICAL_THRESHOLD,
  CO2_WARNING_THRESHOLD,
  LUX_MIN_THRESHOLD,
  BUSINESS_HOURS_START,
  BUSINESS_HOURS_END
};
