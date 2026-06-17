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

  const nodeState = store[node.zoneId || node.id];
  if (!nodeState) return { level: null, percent: null };

  const battery_level = nodeState.battery_level;
  if (!Number.isFinite(battery_level)) return { level: null, percent: null };

  if (battery_level <= CRITICAL_THRESHOLD) {
    return { level: "critical", percent: battery_level };
  }
  if (battery_level <= WARNING_THRESHOLD) {
    return { level: "warning", percent: battery_level };
  }
  return { level: "ok", percent: battery_level };
}

/**
 * Controllo batterie da PostgreSQL (ultime misure per sensore).
 */
async function checkAllBatteriesFromPg(pgStore) {
  const results = [];
  if (!pgStore) return results;

  const sensors = await pgStore.listSensorsAll();
  if (!sensors.length) return results;

  const latest = await pgStore.fetchLatestMeasurements(sensors.map((s) => s.id));
  for (const sensor of sensors) {
    const row = latest.get(sensor.id);
    const battery_level = row?.battery;
    if (!Number.isFinite(Number(battery_level))) continue;

    const nodeId = sensor.devEui || String(sensor.id);
    let level = "ok";
    if (battery_level <= CRITICAL_THRESHOLD) level = "critical";
    else if (battery_level <= WARNING_THRESHOLD) level = "warning";

    const previousLevel = lastBatteryState.get(nodeId) || "ok";
    if (level !== previousLevel) {
      if (level === "warning" || level === "critical") {
        const result = await notifyBatteryAlert({
          nodeId,
          battery_level: Number(battery_level),
          level,
        });
        if (result.ok || result.cooldown) {
          lastBatteryState.set(nodeId, level);
          results.push({ nodeId, action: "alert_sent", level });
        }
      } else if (
        level === "ok" &&
        (previousLevel === "warning" || previousLevel === "critical")
      ) {
        const result = await notifyRecovery({
          nodeId,
          type: "battery_ok",
        });
        if (result.ok) {
          lastBatteryState.set(nodeId, "ok");
          results.push({ nodeId, action: "recovery_sent" });
        }
      }
    } else if (level === "ok") {
      lastBatteryState.set(nodeId, "ok");
    }
  }

  return results;
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
          battery_level: percent,
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
 * @param {Object|null} [pgStore] - store PostgreSQL per telemetria reale
 * @returns {{stop: Function, isRunning: Function}}
 */
function startBatteryMonitoring(getStore, pgStore = null) {
  let intervalId = null;
  let running = false;

  const runCheck = async () => {
    if (pgStore) return checkAllBatteriesFromPg(pgStore);
    return checkAllBatteries(getStore());
  };

  // Controllo immediato all'avvio
  setTimeout(async () => {
    try {
      const results = await runCheck();
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
        const results = await runCheck();
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
async function checkSingleNodeBattery(nodeId, battery_level) {
  let level = "ok";
  if (battery_level <= CRITICAL_THRESHOLD) level = "critical";
  else if (battery_level <= WARNING_THRESHOLD) level = "warning";

  const previousLevel = lastBatteryState.get(nodeId) || "ok";

  if (level !== previousLevel && (level === "warning" || level === "critical")) {
    const result = await notifyBatteryAlert({
      nodeId,
      battery_level,
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
  checkAllBatteriesFromPg,
  startBatteryMonitoring,
  checkSingleNodeBattery,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  CHECK_INTERVAL_MS,
};
