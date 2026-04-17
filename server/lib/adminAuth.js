const crypto = require("crypto");

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || "").trim();
}

function isAdminPasswordConfigured() {
  return Boolean(adminPassword());
}

/** Segreto HMAC: preferisci ADMIN_JWT_SECRET su Render; altrimenti si usa ADMIN_PASSWORD. */
function signingSecret() {
  const jwtSecret = String(process.env.ADMIN_JWT_SECRET || "").trim();
  if (jwtSecret) return jwtSecret;
  return adminPassword();
}

function b64urlEncodeJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/=+/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecodeToString(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function signAdminToken() {
  const secret = signingSecret();
  if (!secret) throw new Error("admin_signing_secret_missing");
  const now = Date.now();
  const payload = { sub: "admin", iat: now, exp: now + TTL_MS };
  const bodyPart = b64urlEncodeJson(payload);
  const sigPart = crypto.createHmac("sha256", secret).update(bodyPart).digest("hex");
  return `${bodyPart}.${sigPart}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const bodyPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  const secret = signingSecret();
  if (!secret) return false;
  if (!/^[0-9a-f]+$/i.test(sigPart)) return false;
  const expected = crypto.createHmac("sha256", secret).update(bodyPart).digest("hex");
  const a = Buffer.from(sigPart, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(bodyPart));
  } catch {
    return false;
  }
  if (payload.sub !== "admin" || typeof payload.exp !== "number") return false;
  if (Date.now() > payload.exp) return false;
  return true;
}

function extractAdminToken(req) {
  const fromHeader = req.get("x-admin-token");
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  return "";
}

/**
 * Richiede token admin firmato se ADMIN_PASSWORD è impostata.
 * Le route pubbliche (/api/admin/auth/*) non usano questo middleware.
 */
function requireAdminAuth(req, res, next) {
  if (!isAdminPasswordConfigured()) return next();
  const token = extractAdminToken(req);
  if (!token || !verifyAdminToken(token)) {
    return res.status(403).json({
      error: "admin_forbidden",
      hint:
        "Pannello configurazione protetto: effettua il login con la password admin oppure invia l'header x-admin-token ottenuto da POST /api/admin/auth/login.",
    });
  }
  return next();
}

module.exports = {
  adminPassword, // () => string da env
  isAdminPasswordConfigured,
  signAdminToken,
  verifyAdminToken,
  extractAdminToken,
  requireAdminAuth,
  ADMIN_TOKEN_TTL_MS: TTL_MS,
};
