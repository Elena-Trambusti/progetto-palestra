"use strict";

const { thresholdFlag } = require("./postgresStore");

function getEnvToken() {
  const t = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  return t || null;
}

function getEnvChatId() {
  const c = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  return c || null;
}

function isTelegramConfigured() {
  return Boolean(getEnvToken() && getEnvChatId());
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Invia un messaggio Telegram. Se token/chat non sono impostati, non fa nulla e scrive un log.
 * Errori di rete/API sono contenuti nel try/catch per non bloccare il chiamante.
 *
 * @param {string} text
 * @returns {Promise<{ ok: boolean, skipped?: boolean }>}
 */
async function sendTelegramMessage(text) {
  const token = getEnvToken();
  const chatId = getEnvChatId();
  if (!token || !chatId) {
    console.log("[telegram] Invio saltato: TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurati.");
    return { ok: false, skipped: true };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      console.warn("[telegram] Risposta API non OK:", res.status, data);
      return { ok: false };
    }

    if (data && data.ok === false) {
      console.warn("[telegram] Invio fallito:", data);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[telegram] Errore durante l'invio (rete o altro):", msg);
    return { ok: false };
  }
}

/**
 * Dopo una nuova misura: se il valore viola min_threshold / max_threshold del sensore,
 * invia un messaggio Telegram (se configurato).
 *
 * @param {object} sensor Riga `sensors` da PostgreSQL (snake_case)
 * @param {number} numericValue
 */
async function maybeNotifyThresholdAlarm(sensor, numericValue) {
  if (!sensor || numericValue == null || !Number.isFinite(Number(numericValue))) return;

  const v = Number(numericValue);
  const minT = sensor.min_threshold;
  const maxT = sensor.max_threshold;

  const flag = thresholdFlag(v, minT, maxT);
  if (!flag) return;

  const name = sensor.name != null ? String(sensor.name) : "Sensore";
  const emoji = flag === "low" ? "📉" : "📈";
  const band =
    flag === "low"
      ? "sotto il minimo consentito"
      : "sopra il massimo consentito";

  const header = `⚠️ <b>ALLARME</b>: ${escapeHtml(name)} — valore <b>${escapeHtml(String(v))}</b> fuori soglia!`;

  const lines = [
    header,
    "",
    `${emoji} <i>${band}</i>`,
    "",
    `📊 Soglie · min ${escapeHtml(formatThreshold(minT))} · max ${escapeHtml(formatThreshold(maxT))}`,
  ];

  if (sensor.location != null && String(sensor.location).trim()) {
    lines.push(`📍 ${escapeHtml(String(sensor.location))}`);
  }
  if (sensor.type != null && String(sensor.type).trim()) {
    lines.push(`🏷️ ${escapeHtml(String(sensor.type))}`);
  }
  if (sensor.dev_eui != null && String(sensor.dev_eui).trim()) {
    lines.push(`🔑 dev_eui: <code>${escapeHtml(String(sensor.dev_eui).trim())}</code>`);
  }

  const now = new Date();
  const timeString = now.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  lines.push("", `🕐 ${timeString} (ITA)`);

  const text = lines.join("\n");

  if (!isTelegramConfigured()) {
    console.log(
      `[telegram] Allarme soglia (${flag}) per sensore id=${sensor.id} — invio Telegram saltato (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID non configurati).`
    );
    return;
  }

  await sendTelegramMessage(text);
}

function formatThreshold(t) {
  if (t == null || !Number.isFinite(Number(t))) return "—";
  return String(Number(t));
}

module.exports = {
  sendTelegramMessage,
  maybeNotifyThresholdAlarm,
  isTelegramConfigured,
};
