const COOLDOWN_MS = Number(process.env.NOTIFY_COOLDOWN_MS) || 5 * 60 * 1000;
const RAPID_COOLDOWN_MS =
  Number(process.env.NOTIFY_WATER_RAPID_COOLDOWN_MS) || 10 * 60 * 1000;

/** @type {Map<string, number>} */
const lastSent = new Map();

/** @type {Map<string, number>} */
const lastRapidSent = new Map();

/** @type {Map<string, boolean>} */
const rapidLatched = new Map();

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
}

/**
 * Allerta quando il livello scende sotto il 20% (con isteresi sul rientro).
 */
function maybeNotifyWaterLow({
  zoneId,
  zoneName,
  prevWater,
  nextWater,
  webhookUrl,
}) {
  if (!webhookUrl) return;

  const crossed =
    prevWater != null && prevWater >= 20 && nextWater != null && nextWater < 20;

  if (!crossed) return;

  const now = Date.now();
  const last = lastSent.get(zoneId) || 0;
  if (now - last < COOLDOWN_MS) return;

  lastSent.set(zoneId, now);

  postJson(webhookUrl, {
    type: "water_low",
    zoneId,
    zoneName,
    waterPercent: nextWater,
    ts: new Date().toISOString(),
    message: `Riserva idrica sotto il 20% in ${zoneName || zoneId}`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[notify] water_low webhook failed", err?.message || err);
  });
}

/**
 * Allerta calo rapido (possibile perdita): una notifica per episodio + cooldown tra invii.
 */
function maybeNotifyWaterRapidDrop({
  zoneId,
  zoneName,
  isRapid,
  deltaPercent,
  webhookUrl,
}) {
  if (!webhookUrl) return;

  if (!isRapid) {
    rapidLatched.delete(zoneId);
    return;
  }

  if (rapidLatched.get(zoneId)) return;

  const now = Date.now();
  const last = lastRapidSent.get(zoneId) || 0;
  if (now - last < RAPID_COOLDOWN_MS) {
    rapidLatched.set(zoneId, true);
    return;
  }

  rapidLatched.set(zoneId, true);
  lastRapidSent.set(zoneId, now);

  postJson(webhookUrl, {
    type: "water_rapid_drop",
    zoneId,
    zoneName,
    deltaPercent,
    ts: new Date().toISOString(),
    message: `Calo rapido riserva idrica in ${zoneName || zoneId} (Δ ≈ ${deltaPercent != null ? Math.round(deltaPercent) : "?"}%)`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[notify] water_rapid_drop webhook failed", err?.message || err);
  });
}

const ENV_COOLDOWN_MS =
  Number(process.env.NOTIFY_ENV_COOLDOWN_MS) || 5 * 60 * 1000;
const OPS_COOLDOWN_MS =
  Number(process.env.NOTIFY_OPS_COOLDOWN_MS) || 5 * 60 * 1000;

/** @type {Map<string, number>} */
const lastEnvSent = new Map();
/** @type {Map<string, number>} */
const lastOpsSent = new Map();

/**
 * Webhook per superamento soglia ambientale (fronte di salita/discesa).
 * @param {{ zoneId: string, zoneName: string, alarmType: string, message: string, value: number, webhookUrl: string, crossed: boolean }} p
 */
function maybeNotifyEnvThreshold(p) {
  const {
    zoneId,
    zoneName,
    alarmType,
    message,
    value,
    webhookUrl,
    crossed,
  } = p;
  if (!webhookUrl || !crossed) return;

  const key = `${zoneId}:${alarmType}`;
  const now = Date.now();
  const last = lastEnvSent.get(key) || 0;
  if (now - last < ENV_COOLDOWN_MS) return;
  lastEnvSent.set(key, now);

  postJson(webhookUrl, {
    type: "env_threshold",
    alarmType,
    zoneId,
    zoneName,
    value,
    ts: new Date().toISOString(),
    message: message || `${alarmType} in ${zoneName || zoneId}`,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[notify] env_threshold webhook failed", err?.message || err);
  });
}

/**
 * Webhook per alert operativi (error rate, reject websocket/ingest, ecc.).
 * @param {{ alertKey: string, severity?: string, message: string, details?: object, webhookUrl: string }} p
 */
function maybeNotifyOpsAlert(p) {
  const {
    alertKey,
    severity = "warning",
    message,
    details = {},
    webhookUrl,
  } = p;
  if (!webhookUrl || !alertKey || !message) return;

  const now = Date.now();
  const last = lastOpsSent.get(alertKey) || 0;
  if (now - last < OPS_COOLDOWN_MS) return;
  lastOpsSent.set(alertKey, now);

  postJson(webhookUrl, {
    type: "ops_alert",
    alertKey,
    severity,
    message,
    details,
    ts: new Date().toISOString(),
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[notify] ops_alert webhook failed", err?.message || err);
  });
}

module.exports = {
  maybeNotifyWaterLow,
  maybeNotifyWaterRapidDrop,
  maybeNotifyEnvThreshold,
  maybeNotifyOpsAlert,
};
