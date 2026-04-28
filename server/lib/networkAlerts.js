/**
 * Network Alerts - Monitoraggio stato rete LoRa
 * Avvisa per nodi offline, segnale debole, errori connettività
 */

const { notifyNodeOffline, notifyWeakSignal, notifyRecovery } = require("./telegramNotifier");
const { NODES } = require("./zonesData");

// Configurazione via env
const OFFLINE_TIMEOUT_MS =
  Number(process.env.NODE_OFFLINE_TIMEOUT_MS) || 10 * 60 * 1000; // 10 min
const RSSI_WARNING_DB =
  Number(process.env.RSSI_WARNING_DB) || -115; // dBm
const SNR_WARNING_DB =
  Number(process.env.SNR_WARNING_DB) || 0; // dB
const CHECK_INTERVAL_MS =
  Number(process.env.NETWORK_CHECK_INTERVAL_MS) || 5 * 60 * 1000; // 5 min

/** @type {Map<string, {status: string, since: number}>} */
const lastNetworkState = new Map();
/** @type {Map<string, boolean>} */
const weakSignalLatched = new Map(); // Per evitare spam segnale debole

/**
 * Determina se un nodo è offline
 * @param {Object} nodeState - stato del nodo dal sistema
 * @returns {{offline: boolean, minutes: number}}
 */
function isNodeOffline(nodeState) {
  if (!nodeState || !nodeState.uplinkAt) {
    return { offline: true, minutes: 9999 };
  }

  const lastContact = new Date(nodeState.uplinkAt).getTime();
  const now = Date.now();
  const diffMs = now - lastContact;
  const diffMinutes = Math.floor(diffMs / 60000);

  return {
    offline: diffMs > OFFLINE_TIMEOUT_MS,
    minutes: diffMinutes,
  };
}

/**
 * Determina se il segnale è debole
 * @param {Object} nodeState
 * @returns {{weak: boolean, rssi: number|null, snr: number|null}}
 */
function isSignalWeak(nodeState) {
  if (!nodeState) return { weak: false, rssi: null, snr: null };

  const rssi = nodeState.rssi;
  const snr = nodeState.snr;

  if (!Number.isFinite(rssi) && !Number.isFinite(snr)) {
    return { weak: false, rssi: null, snr: null };
  }

  const weakRssi = Number.isFinite(rssi) && rssi < RSSI_WARNING_DB;
  const weakSnr = Number.isFinite(snr) && snr < SNR_WARNING_DB;

  return {
    weak: weakRssi || weakSnr,
    rssi: Number.isFinite(rssi) ? rssi : null,
    snr: Number.isFinite(snr) ? snr : null,
  };
}

/**
 * Controlla tutti i nodi e invia notifiche se necessario
 * @param {Object} store - stato attuale del sistema
 * @returns {Promise<Array>}
 */
async function checkAllNetworkStatus(store) {
  const results = [];

  for (const node of NODES) {
    const nodeState = store?.[node.id];
    const { offline, minutes } = isNodeOffline(nodeState);
    const { weak, rssi, snr } = isSignalWeak(nodeState);

    const previous = lastNetworkState.get(node.id) || { status: "unknown", since: 0 };

    // 1. NODO OFFLINE
    if (offline) {
      if (previous.status !== "offline") {
        const result = await notifyNodeOffline({
          nodeId: node.id,
          minutesOffline: minutes,
        });
        if (result.ok || result.cooldown) {
          lastNetworkState.set(node.id, {
            status: "offline",
            since: Date.now(),
          });
          results.push({ nodeId: node.id, action: "offline_alert", minutes });
        }
      }
      continue; // Se offline, non controlliamo il segnale
    }

    // 2. SEGNALE DEBOLE
    if (weak && rssi != null) {
      const latched = weakSignalLatched.get(node.id);
      if (!latched) {
        const result = await notifyWeakSignal({
          nodeId: node.id,
          rssi,
          snr: snr || 0,
        });
        if (result.ok) {
          weakSignalLatched.set(node.id, true);
          results.push({ nodeId: node.id, action: "weak_signal_alert", rssi });
        }
      }
    } else if (!weak && weakSignalLatched.get(node.id)) {
      // Segnale tornato ok
      weakSignalLatched.delete(node.id);
      // Non notifichiamo il ripristino segnale per non spammare
    }

    // 3. RIPRISTINO NODO (era offline, ora online)
    if (previous.status === "offline" && !offline) {
      const result = await notifyRecovery({
        nodeId: node.id,
        type: "online",
      });
      if (result.ok) {
        lastNetworkState.set(node.id, { status: "online", since: Date.now() });
        results.push({ nodeId: node.id, action: "recovery_sent" });
      }
    } else {
      // Aggiorna stato normale
      lastNetworkState.set(node.id, { status: "online", since: Date.now() });
    }
  }

  return results;
}

/**
 * Avvia monitoraggio rete periodico
 * @param {Function} getStore - funzione che ritorna lo stato attuale
 * @returns {{stop: Function, isRunning: Function, getLastStates: Function}}
 */
function startNetworkMonitoring(getStore) {
  let intervalId = null;
  let running = false;

  // Primo controllo dopo 10 secondi
  setTimeout(async () => {
    try {
      const store = getStore();
      const results = await checkAllNetworkStatus(store);
      if (results.length > 0) {
        console.log("[networkAlerts] Controllo iniziale:", results);
      }
    } catch (err) {
      console.error("[networkAlerts] Errore controllo iniziale:", err.message);
    }
  }, 10000);

  // Controllo periodico
  intervalId = setInterval(async () => {
    if (!running) {
      running = true;
      try {
        const store = getStore();
        const results = await checkAllNetworkStatus(store);
        if (results.length > 0) {
          console.log("[networkAlerts] Controllo periodico:", results);
        }
      } catch (err) {
        console.error("[networkAlerts] Errore controllo periodico:", err.message);
      } finally {
        running = false;
      }
    }
  }, CHECK_INTERVAL_MS);

  console.log(
    `[networkAlerts] Monitoraggio avviato - ogni ${CHECK_INTERVAL_MS / 1000}s, offline dopo ${OFFLINE_TIMEOUT_MS / 60000}min, RSSI < ${RSSI_WARNING_DB}dBm`
  );

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("[networkAlerts] Monitoraggio fermato");
      }
    },
    isRunning: () => intervalId !== null,
    getLastStates: () => new Map(lastNetworkState),
  };
}

/**
 * Controllo manuale per singolo nodo (es. dopo ingest)
 * @param {string} nodeId
 * @param {Object} nodeState
 * @returns {Promise<{notified: boolean, type: string|null}>}
 */
async function checkSingleNodeNetwork(nodeId, nodeState) {
  const { offline, minutes } = isNodeOffline(nodeState);
  const previous = lastNetworkState.get(nodeId)?.status;

  if (offline && previous !== "offline") {
    const result = await notifyNodeOffline({ nodeId, minutesOffline: minutes });
    if (result.ok) {
      lastNetworkState.set(nodeId, { status: "offline", since: Date.now() });
      return { notified: true, type: "offline" };
    }
  } else if (!offline && previous === "offline") {
    const result = await notifyRecovery({ nodeId, type: "online" });
    if (result.ok) {
      lastNetworkState.set(nodeId, { status: "online", since: Date.now() });
      return { notified: true, type: "recovery" };
    }
  }

  return { notified: false, type: null };
}

module.exports = {
  isNodeOffline,
  isSignalWeak,
  checkAllNetworkStatus,
  startNetworkMonitoring,
  checkSingleNodeNetwork,
  OFFLINE_TIMEOUT_MS,
  RSSI_WARNING_DB,
  SNR_WARNING_DB,
  CHECK_INTERVAL_MS,
};
