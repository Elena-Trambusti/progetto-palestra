/**
 * Battery Alerts - Monitoraggio intelligente batterie nodi
 * Controlla periodicamente lo stato batteria e invia notifiche Telegram
 */

const { notifyBatteryAlert, notifyRecovery } = require("./telegramNotifier");
const { NODES } = require("./zonesData");

// Soglie configurabili via env
const WARNING_THRESHOLD =
  Number(process.env.BATTERY_WARNING_PCT) || 25;
const CRITICAL_THRESHOLD =
  Number(process.env.BATTERY_CRITICAL_PCT) || 15;
const CHECK_INTERVAL_MS =
  Number(process.env.BATTERY_CHECK_INTERVAL_MS) || 5 * 60 * 1000; // 5 min

/** @type {Map<string, string>} */
const lastBatteryState = new Map(); // 'ok' | 'warning' | 'critical'

/**
 * Controlla lo stato batteria di un singolo nodo
 * @param {Object} node
 * @param {Object} store - stato attuale del sistema
 * @returns {{level: string|null, percent: number|null}}
 */
function checkNodeBattery(node, store) {
  if (!node || !store) return { level: null, percent: null };

  const nodeState = store[node.id];
  if (!nodeState) return { level: null, percent: null };

  const battery = nodeState.batteryPercent;
  if (!Number.isFinite(battery)) return { level: null, percent: null };

  if (battery <= CRITICAL_THRESHOLD) {
    return { level: "critical", percent: battery };
  }
  if (battery <= WARNING_THRESHOLD) {
    return { level: "warning", percent: battery };
  }
  return { level: "ok", percent: battery };
}

/**
 * Esegue controllo batterie di tutti i nodi
 * @param {Object} store - stato attuale del sistema
 * @returns {Promise<Array<{nodeId: string, action: string}>>}
 */
async function checkAllBatteries(store) {
  const results = [];

  for (const node of NODES) {
    const { level, percent } = checkNodeBattery(node, store);
    if (!level) continue;

    const previousLevel = lastBatteryState.get(node.id) || "ok";

    // Se lo stato è peggiorato, invia notifica
    if (level !== previousLevel) {
      if (level === "warning" || level === "critical") {
        const result = await notifyBatteryAlert({
          nodeId: node.id,
          batteryPercent: percent,
          level,
        });
        if (result.ok || result.cooldown) {
          lastBatteryState.set(node.id, level);
          results.push({ nodeId: node.id, action: "alert_sent", level });
        }
      } else if (level === "ok" && (previousLevel === "warning" || previousLevel === "critical")) {
        // Batteria ripristinata
        const result = await notifyRecovery({
          nodeId: node.id,
          type: "battery_ok",
        });
        if (result.ok) {
          lastBatteryState.set(node.id, "ok");
          results.push({ nodeId: node.id, action: "recovery_sent" });
        }
      }
    } else if (level === "ok") {
      // Stato rimasto ok, aggiorna solo la mappa
      lastBatteryState.set(node.id, "ok");
    }
  }

  return results;
}

/**
 * Avvia monitoraggio batterie periodico
 * @param {Function} getStore - funzione che ritorna lo stato attuale
 * @returns {{stop: Function, isRunning: Function}}
 */
function startBatteryMonitoring(getStore) {
  let intervalId = null;
  let running = false;

  // Controllo immediato all'avvio
  setTimeout(async () => {
    try {
      const store = getStore();
      const results = await checkAllBatteries(store);
      if (results.length > 0) {
        console.log("[batteryAlerts] Controllo iniziale:", results);
      }
    } catch (err) {
      console.error("[batteryAlerts] Errore controllo iniziale:", err.message);
    }
  }, 5000);

  // Controllo periodico
  intervalId = setInterval(async () => {
    if (!running) {
      running = true;
      try {
        const store = getStore();
        const results = await checkAllBatteries(store);
        if (results.length > 0) {
          console.log("[batteryAlerts] Controllo periodico:", results);
        }
      } catch (err) {
        console.error("[batteryAlerts] Errore controllo periodico:", err.message);
      } finally {
        running = false;
      }
    }
  }, CHECK_INTERVAL_MS);

  console.log(
    `[batteryAlerts] Monitoraggio avviato - ogni ${CHECK_INTERVAL_MS / 1000}s, soglie: warning=${WARNING_THRESHOLD}%, critical=${CRITICAL_THRESHOLD}%`
  );

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("[batteryAlerts] Monitoraggio fermato");
      }
    },
    isRunning: () => intervalId !== null,
    getLastStates: () => new Map(lastBatteryState),
  };
}

/**
 * Controllo manuale singolo nodo (per test o ingest)
 * @param {string} nodeId
 * @param {number} batteryPercent
 * @returns {Promise<{notified: boolean, level: string|null}>}
 */
async function checkSingleNodeBattery(nodeId, batteryPercent) {
  let level = "ok";
  if (batteryPercent <= CRITICAL_THRESHOLD) level = "critical";
  else if (batteryPercent <= WARNING_THRESHOLD) level = "warning";

  const previousLevel = lastBatteryState.get(nodeId) || "ok";

  if (level !== previousLevel && (level === "warning" || level === "critical")) {
    const result = await notifyBatteryAlert({
      nodeId,
      batteryPercent,
      level,
    });
    if (result.ok) {
      lastBatteryState.set(nodeId, level);
      return { notified: true, level };
    }
  }

  lastBatteryState.set(nodeId, level);
  return { notified: false, level };
}

module.exports = {
  checkNodeBattery,
  checkAllBatteries,
  startBatteryMonitoring,
  checkSingleNodeBattery,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  CHECK_INTERVAL_MS,
};
