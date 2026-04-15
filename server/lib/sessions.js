const crypto = require("crypto");

const COOKIE = "palestra_sess";
const TTL_MS = 48 * 60 * 60 * 1000;

/** @type {Map<string, { expires: number }>} */
const sessions = new Map();

function createSession() {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, { expires: Date.now() + TTL_MS });
  return id;
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, v] of sessions) {
    if (v.expires < now) sessions.delete(id);
  }
}

function isValid(token) {
  if (!token) return false;
  purgeExpired();
  const s = sessions.get(String(token));
  return Boolean(s && s.expires > Date.now());
}

function revoke(token) {
  sessions.delete(String(token));
}

function extractToken(req) {
  const auth = req.get("authorization");
  if (auth && auth.startsWith("Bearer "))
    return auth.slice("Bearer ".length).trim();
  if (req.cookies && req.cookies[COOKIE]) return String(req.cookies[COOKIE]);
  return "";
}

function gateMiddleware({ requireAuth, apiKey }) {
  return (req, res, next) => {
    const keyHeader = req.get("x-api-key");
    const keyMatch = Boolean(apiKey) && keyHeader === apiKey;

    if (apiKey) {
      if (keyMatch) return next();
      if (requireAuth && isValid(extractToken(req))) return next();
      if (requireAuth) {
        return res.status(401).json({ error: "login_required" });
      }
      return res.status(401).json({ error: "Unauthorized", hint: "Header x-api-key" });
    }

    if (requireAuth && isValid(extractToken(req))) return next();
    if (requireAuth) {
      return res.status(401).json({ error: "login_required" });
    }
    return next();
  };
}

function extractTokenFromWsUrl(url) {
  try {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function attachAuthRoutes(app, { requireAuth, authPassword }) {
  app.post("/api/auth/login", (req, res) => {
    if (!requireAuth) {
      return res.json({ ok: true, token: "", message: "Auth disattivata sul server" });
    }
    const pwd = String(req.body?.password || "");
    if (pwd !== authPassword) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const id = createSession();
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: TTL_MS,
      path: "/",
    });
    return res.json({ ok: true, token: id });
  });

  app.post("/api/auth/logout", (req, res) => {
    const t = extractToken(req);
    if (t) revoke(t);
    res.clearCookie(COOKIE, { path: "/" });
    return res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!requireAuth) return res.json({ ok: true, auth: false });
    const t = extractToken(req);
    if (isValid(t)) return res.json({ ok: true, auth: true });
    return res.status(401).json({ error: "login_required" });
  });
}

module.exports = {
  COOKIE,
  sessions,
  attachAuthRoutes,
  gateMiddleware,
  extractToken,
  extractTokenFromWsUrl,
  isValid,
  revoke,
};
