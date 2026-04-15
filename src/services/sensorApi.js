/**
 * Client sensori:
 * - Se `REACT_APP_SENSOR_API_URL` è vuota, le richieste vanno a `/api` (proxy CRA → server).
 * - Header opzionale `x-api-key` se `REACT_APP_SENSOR_API_KEY`.
 * - Bearer + cookie sessione se login effettuato (`sessionStorage`).
 */

import { normalizeDashboardPayload } from "./sensorNormalize";
import { planPathForFloorId } from "./facilityFloors";

export { normalizeDashboardPayload } from "./sensorNormalize";

const SESSION_KEY = "palestra_session_token";

export function getStoredSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredSessionToken(token) {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function getSensorApiRoot() {
  return (process.env.REACT_APP_SENSOR_API_URL || "").trim().replace(/\/$/, "");
}

export function buildApiHeaders() {
  const headers = {};
  const key = (process.env.REACT_APP_SENSOR_API_KEY || "").trim();
  if (key) headers["x-api-key"] = key;
  const tok = getStoredSessionToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return headers;
}

function apiUrl(path) {
  const root = getSensorApiRoot();
  if (root) return `${root}${path}`;
  return path;
}

async function parseJsonError(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export class LoginRequiredError extends Error {
  constructor() {
    super("LOGIN_REQUIRED");
    this.code = "LOGIN_REQUIRED";
  }
}

async function handleJsonResponse(res) {
  if (res.ok) return res.json();
  const body = await parseJsonError(res);
  if (res.status === 401 && body.error === "login_required") {
    throw new LoginRequiredError();
  }
  const msg = body.error || body.hint || `HTTP ${res.status}`;
  throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
}

export async function sensorFetch(path, options = {}) {
  const url = apiUrl(path);
  const headers = { ...buildApiHeaders(), ...options.headers };
  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
}

export async function loginToGateway(password) {
  const res = await sensorFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await handleJsonResponse(res);
  if (data.token) setStoredSessionToken(data.token);
  return data;
}

export async function logoutFromGateway() {
  try {
    await sensorFetch("/api/auth/logout", { method: "POST" });
  } finally {
    setStoredSessionToken("");
  }
}

export async function fetchZonesCatalog() {
  const res = await sensorFetch("/api/zones");
  const json = await handleJsonResponse(res);
  const zones = Array.isArray(json.zones) ? json.zones : [];
  const mappedZones = zones.map((z) => ({
    id: String(z.id),
    name: String(z.name ?? z.id),
    floor: z.floor != null ? String(z.floor) : "",
    mapX: Number.isFinite(Number(z.mapX)) ? Number(z.mapX) : 50,
    mapY: Number.isFinite(Number(z.mapY)) ? Number(z.mapY) : 50,
    planPath:
      typeof z.planPath === "string" && z.planPath
        ? z.planPath
        : planPathForFloorId(z.floor),
  }));
  const floorsRaw = Array.isArray(json.floors) ? json.floors : [];
  const floors = floorsRaw.map((f) => ({
    id: String(f.id),
    label: String(f.label ?? f.id),
    planPath:
      typeof f.planPath === "string" && f.planPath
        ? f.planPath
        : planPathForFloorId(f.id),
  }));
  return { zones: mappedZones, floors };
}

/** @deprecated usare fetchZonesCatalog */
export async function fetchZones() {
  const { zones } = await fetchZonesCatalog();
  return zones;
}

export async function fetchDashboardSnapshot(zoneId) {
  const q = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : "";
  const res = await sensorFetch(`/api/dashboard/snapshot${q}`);
  const json = await handleJsonResponse(res);
  return normalizeDashboardPayload(json);
}

export async function fetchHistory(zoneId, limit = 200) {
  const q = new URLSearchParams();
  if (zoneId) q.set("zoneId", zoneId);
  q.set("limit", String(limit));
  const res = await sensorFetch(`/api/history?${q.toString()}`);
  const json = await handleJsonResponse(res);
  return Array.isArray(json.points) ? json.points : [];
}

export async function fetchHistorySamples(zoneId, limit = 200, from = "", to = "") {
  const q = new URLSearchParams();
  if (zoneId) q.set("zoneId", zoneId);
  q.set("limit", String(limit));
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const res = await sensorFetch(`/api/history?${q.toString()}`);
  const json = await handleJsonResponse(res);
  return Array.isArray(json.samples) ? json.samples : [];
}

export function reportCsvUrl(zoneId, limit = 4000, from = "", to = "") {
  const q = new URLSearchParams();
  if (zoneId) q.set("zoneId", zoneId);
  q.set("limit", String(limit));
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const root = getSensorApiRoot();
  const path = `/api/report/csv?${q.toString()}`;
  return root ? `${root.replace(/\/$/, "")}${path}` : path;
}

/**
 * URL WebSocket: variabile esplicita, oppure derivata dall'HTTP API, oppure path relativo `/ws` (proxy).
 */
export function resolveWebSocketUrl(zoneId) {
  const wsEnv = (process.env.REACT_APP_SENSOR_WS_URL || "").trim();
  const api = getSensorApiRoot();

  let base = wsEnv;
  if (!base && api) {
    try {
      const u = new URL(api);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws";
      u.search = "";
      base = u.toString();
    } catch {
      base = "";
    }
  }
  if (!base && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.host}/ws`;
  }
  if (!base) return "";

  const u = new URL(base);
  if (zoneId) u.searchParams.set("zoneId", zoneId);
  return u.toString();
}

/** @deprecated usare resolveWebSocketUrl */
export function buildWebSocketUrl(wsBase, zoneId) {
  const raw = String(wsBase || "").trim();
  if (!raw) return resolveWebSocketUrl(zoneId);
  const u = new URL(raw);
  if (zoneId) u.searchParams.set("zoneId", zoneId);
  return u.toString();
}
