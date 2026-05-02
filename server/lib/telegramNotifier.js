/**
 * Telegram Notifier - Orchestratore intelligente notifiche
 * Centralizza decisioni su quando e cosa inviare via Telegram
 */

const { sendTelegramMessage, isTelegramConfigured } = require("./telegram");
const { findZone, findNode } = require("./zonesData");

// Cooldown per evitare spam
const COOLDOWN_CRITICAL_MS =
  Number(process.env.TELEGRAM_COOLDOWN_CRITICAL_MS) || 5 * 60 * 1000; // 5 min
const COOLDOWN_WARNING_MS =
  Number(process.env.TELEGRAM_COOLDOWN_WARNING_MS) || 15 * 60 * 1000; // 15 min

/** @type {Map<string, number>} */
const lastCriticalSent = new Map();
/** @type {Map<string, number>} */
const lastWarningSent = new Map();

/**
 * Verifica se possiamo inviare (rispetta cooldown)
 * @param {string} key - identificatore univoco allarme
 * @param {number} cooldownMs
 * @returns {boolean}
 */
function canSend(key, cooldownMs, map) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < cooldownMs) return false;
  map.set(key, now);
  return true;
}

/**
 * Formatta orario italiano
 * @returns {string}
 */
function formatItalianTime() {
  const now = new Date();
  return now.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Invia allarme CRITICO (immediato, sempre)
 * @param {Object} params
 * @param {string} params.zoneId
 * @param {string} params.zoneName
 * @param {string} params.type - codice tipo allarme
 * @param {string} params.title - titolo breve
 * @param {string} params.message - descrizione
 * @param {number} [params.value] - valore numerico
 * @param {string} [params.unit] - unità di misura
 * @param {string} [params.action] - azione consigliata
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyCriticalAlarm({
  zoneId,
  zoneName,
  type,
  title,
  message,
  value,
  unit = "",
  action = null,
}) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const key = `${zoneId}:${type}`;
  if (!canSend(key, COOLDOWN_CRITICAL_MS, lastCriticalSent)) {
    console.log(`[telegramNotifier] CRITICO ${type} per ${zoneId} - cooldown attivo`);
    return { ok: false, cooldown: true };
  }

  const zone = findZone(zoneId);
  const locationText = zone
    ? `📍 ${zone.name}\n🗺️ Piano ${zone.floor}`
    : `📍 ${zoneName || zoneId}`;

  const valueText = value != null ? `\n📊 Valore: ${value}${unit}` : "";
  const actionText = action ? `\n\n⚡ <b>Azione consigliata:</b> ${action}` : "";

  const text = [
    `🚨 <b>CRITICO: ${title}</b>`,
    "",
    message,
    valueText,
    "",
    locationText,
    actionText,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] CRITICO inviato: ${type} - ${zoneId}`);
  }
  return result;
}

/**
 * Invia WARNING (con cooldown)
 * @param {Object} params
 * @param {string} params.zoneId
 * @param {string} params.zoneName
 * @param {string} params.type
 * @param {string} params.title
 * @param {string} params.message
 * @param {number} [params.value]
 * @param {string} [params.unit]
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyWarning({
  zoneId,
  zoneName,
  type,
  title,
  message,
  value,
  unit = "",
}) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const key = `${zoneId}:${type}`;
  if (!canSend(key, COOLDOWN_WARNING_MS, lastWarningSent)) {
    console.log(`[telegramNotifier] WARNING ${type} per ${zoneId} - cooldown attivo`);
    return { ok: false, cooldown: true };
  }

  const zone = findZone(zoneId);
  const locationText = zone
    ? `📍 ${zone.name}\n🗺️ Piano ${zone.floor}`
    : `📍 ${zoneName || zoneId}`;

  const valueText = value != null ? `\n📊 Valore: ${value}${unit}` : "";

  const text = [
    `⚠️ <b>WARNING: ${title}</b>`,
    "",
    message,
    valueText,
    "",
    locationText,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] WARNING inviato: ${type} - ${zoneId}`);
  }
  return result;
}

/**
 * Invia notifica batteria
 * @param {Object} params
 * @param {string} params.nodeId
 * @param {number} params.batteryPercent
 * @param {string} params.level - 'warning' | 'critical'
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyBatteryAlert({ nodeId, batteryPercent, level }) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;

  const nodeName = node?.label || nodeId;
  const zoneName = zone?.name || node?.zoneId || "Zona sconosciuta";
  const floor = zone?.floor || node?.floor || "?";

  const key = `battery:${nodeId}:${level}`;
  const cooldown = level === "critical" ? COOLDOWN_CRITICAL_MS : COOLDOWN_WARNING_MS;
  const map = level === "critical" ? lastCriticalSent : lastWarningSent;

  if (!canSend(key, cooldown, map)) {
    return { ok: false, cooldown: true };
  }

  const isCritical = level === "critical";
  const emoji = isCritical ? "🚨" : "⚠️";
  const title = isCritical ? "CRITICO: Batteria Scarica" : "WARNING: Batteria Bassa";
  const action = isCritical
    ? "Ricaricare ENTRO OGGI per evitare perdita dati"
    : "Pianificare ricarica entro 24-48h";

  const text = [
    `${emoji} <b>${title}</b>`,
    "",
    `🔋 Livello: ${batteryPercent}%`,
    `📡 Nodo: ${nodeName} (${nodeId})`,
    "",
    `📍 ${zoneName}\n🗺️ Piano ${floor}`,
    "",
    `⚡ <b>Azione consigliata:</b> ${action}`,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] Batteria ${level} inviato: ${nodeId} = ${batteryPercent}%`);
  }
  return result;
}

/**
 * Invia notifica nodo offline
 * @param {Object} params
 * @param {string} params.nodeId
 * @param {number} params.minutesOffline - minuti dall'ultimo contatto
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyNodeOffline({ nodeId, minutesOffline }) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;

  const nodeName = node?.label || nodeId;
  const zoneName = zone?.name || node?.zoneId || "Zona sconosciuta";
  const floor = zone?.floor || node?.floor || "?";

  const key = `offline:${nodeId}`;
  if (!canSend(key, COOLDOWN_CRITICAL_MS, lastCriticalSent)) {
    return { ok: false, cooldown: true };
  }

  const text = [
    `❌ <b>CRITICO: Nodo Non Risponde</b>`,
    "",
    `📡 Nodo: ${nodeName} (${nodeId})`,
    `⏱️ Ultimo contatto: ${minutesOffline} minuti fa`,
    "",
    `📍 ${zoneName}\n🗺️ Piano ${floor}`,
    "",
    `⚡ <b>Azione consigliata:</b> Verificare alimentazione e connessione LoRa`,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] Offline inviato: ${nodeId} - ${minutesOffline}min`);
  }
  return result;
}

/**
 * Invia notifica segnale radio debole
 * @param {Object} params
 * @param {string} params.nodeId
 * @param {number} params.rssi - valore RSSI in dBm
 * @param {number} params.snr - valore SNR
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyWeakSignal({ nodeId, rssi, snr }) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;

  const nodeName = node?.label || nodeId;
  const zoneName = zone?.name || node?.zoneId || "Zona sconosciuta";
  const floor = zone?.floor || node?.floor || "?";

  const key = `signal:${nodeId}`;
  if (!canSend(key, COOLDOWN_WARNING_MS, lastWarningSent)) {
    return { ok: false, cooldown: true };
  }

  const text = [
    `📡 <b>WARNING: Segnale Radio Debole</b>`,
    "",
    `📡 Nodo: ${nodeName} (${nodeId})`,
    `📶 RSSI: ${rssi} dBm`,
    `📊 SNR: ${snr} dB`,
    "",
    `📍 ${zoneName}\n🗺️ Piano ${floor}`,
    "",
    `⚡ <b>Azione consigliata:</b> Verificare posizione antenna o aggiungere repeater`,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] Segnale debole inviato: ${nodeId} RSSI=${rssi}`);
  }
  return result;
}

/**
 * Invia notifica ripristino (nodo tornato online / batteria ok)
 * @param {Object} params
 * @param {string} params.nodeId
 * @param {string} params.type - 'online' | 'battery_ok' | 'signal_ok'
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyRecovery({ nodeId, type }) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;

  const nodeName = node?.label || nodeId;
  const zoneName = zone?.name || node?.zoneId || "Zona sconosciuta";

  const titles = {
    online: "✅ Nodo Tornato Online",
    battery_ok: "✅ Batteria Ripristinata",
    signal_ok: "✅ Segnale Ripristinato",
  };

  const messages = {
    online: `Il nodo ${nodeName} ha ripreso a trasmettere regolarmente.`,
    battery_ok: `La batteria del nodo ${nodeName} è tornata a livelli normali.`,
    signal_ok: `Il segnale del nodo ${nodeName} è tornato a livelli accettabili.`,
  };

  const text = [
    `<b>${titles[type]}</b>`,
    "",
    messages[type],
    "",
    `📍 ${zoneName}`,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  // Per i ripristini usiamo cooldown più breve (1 min)
  const key = `recovery:${nodeId}:${type}`;
  const map = new Map(); // cooldown separato per ripristini
  if (!canSend(key, 60000, map)) {
    return { ok: false, cooldown: true };
  }

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] Ripristino inviato: ${nodeId} - ${type}`);
  }
  return result;
}

/**
 * Invia notifica informativa (senza cooldown restrittivo)
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} params.nodeId
 * @param {Object} params.metrics
 * @returns {Promise<{ok: boolean}>}
 */
async function notifyInfo({ title, message, nodeId, metrics }) {
  if (!isTelegramConfigured()) return { ok: false, skipped: true };

  const node = findNode(nodeId);
  const zone = node ? findZone(node.zoneId) : null;

  const nodeName = node?.label || nodeId;
  const zoneName = zone?.name || node?.zoneId || "Zona sconosciuta";
  const floor = zone?.floor || node?.floor || "?";

  // Per notifiche info usiamo cooldown più breve (5 minuti)
  const key = `info:${nodeId}:${title}`;
  if (!canSend(key, 5 * 60 * 1000, lastWarningSent)) {
    return { ok: false, cooldown: true };
  }

  const text = [
    `ℹ️ <b>${title}</b>`,
    "",
    `📡 Nodo: ${nodeName} (${nodeId})`,
    `📍 ${zoneName}\n🗺️ Piano ${floor}`,
    "",
    message,
    "",
    `🕐 ${formatItalianTime()} (ITA)`,
  ].join("\n");

  const result = await sendTelegramMessage(text);
  if (result.ok) {
    console.log(`[telegramNotifier] INFO inviato: ${nodeId} - ${title}`);
  }
  return result;
}

module.exports = {
  notifyCriticalAlarm,
  notifyWarning,
  notifyInfo,
  notifyBatteryAlert,
  notifyNodeOffline,
  notifyWeakSignal,
  notifyRecovery,
  formatItalianTime,
  // Esportiamo anche per testing/debug
  _resetCooldowns: () => {
    lastCriticalSent.clear();
    lastWarningSent.clear();
  },
};
