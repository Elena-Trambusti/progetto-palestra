/**
 * Client sensori — tutte le chiamate passano da `sensorFetch` / `apiUrl`.
 *
 * Ambiente:
 * - Sviluppo: lascia `REACT_APP_SENSOR_API_URL` vuota → path relativi `/api` e `/ws`
 *   (proxy verso `REACT_APP_PROXY_TARGET`, default http://localhost:4000).
 * - Produzione (es. frontend su Render + API su altro servizio): imposta
 *   `REACT_APP_SENSOR_API_URL=https://tuo-backend.onrender.com` (senza slash finale).
 *   Opzionale: `REACT_APP_SENSOR_WS_URL=wss://tuo-backend.onrender.com/ws` se il WS non è sullo stesso host.
 *
 * Auth: `REACT_APP_SENSOR_API_KEY` (header x-api-key) e/o login `Bearer` in sessionStorage.
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

export class ApiHttpError extends Error {
  constructor(status, code, hint = "") {
    super(code || `HTTP ${status}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code || `HTTP_${status}`;
    this.hint = hint || "";
  }
}

export function toUserErrorMessage(err) {
  const code = String(err?.code || err?.message || "").toLowerCase();
  if (code === "dev_eui_duplicate" || code === "dev_eui_conflict") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "Esiste già un sensore con questo DevEUI. Ogni dispositivo deve avere un DevEUI univoco.";
  }
  if (code === "invalid_threshold") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "Le soglie min/max accettano solo numeri (es. 18 o 22.5), oppure lasciale vuote.";
  }
  if (code === "empty_sensor_name") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "Il nome del sensore non può essere vuoto.";
  }
  if (code === "empty_sensor_location") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "La posizione (zona) non può essere vuota.";
  }
  if (code === "empty_sensor_type") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "Il tipo sensore non può essere vuoto.";
  }
  if (code === "invalid_dev_eui") {
    if (err instanceof ApiHttpError && err.hint) return err.hint;
    return "Il DevEUI deve essere di 16 caratteri esadecimali.";
  }
  if (code === "invalid_node_id") {
    return "Nodo non valido: seleziona un nodo esistente dal catalogo.";
  }
  if (code === "invalid_zone_id") {
    return "Zona non valida: seleziona una zona esistente dal catalogo.";
  }
  if (code === "invalid_time_range") {
    return "Intervallo temporale non valido: controlla formato ISO e ordine Da/A.";
  }
  if (code === "rate_limited" || Number(err?.status) === 429) {
    return "Troppe richieste ravvicinate: attendi qualche secondo e riprova.";
  }
  if (code.includes("failed to fetch") || code.includes("networkerror")) {
    return "Gateway non raggiungibile: verifica che backend e rete siano attivi.";
  }
  if (code === "gateway_timeout") {
    return "Timeout gateway: la richiesta ha impiegato troppo tempo.";
  }
  if (err instanceof ApiHttpError && err.hint) return err.hint;
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return "Errore API non previsto.";
}

async function handleJsonResponse(res) {
  if (res.ok) return res.json();
  const body = await parseJsonError(res);
  if (res.status === 401 && body.error === "login_required") {
    throw new LoginRequiredError();
  }
  const msg = body.error || body.hint || `HTTP ${res.status}`;
  throw new ApiHttpError(
    res.status,
    typeof body.error === "string" ? body.error : `HTTP_${res.status}`,
    typeof body.hint === "string" ? body.hint : typeof msg === "string" ? msg : ""
  );
}

export async function sensorFetch(path, options = {}) {
  const url = apiUrl(path);
  const headers = { ...buildApiHeaders(), ...options.headers };
  const timeoutMs = Number(process.env.REACT_APP_API_TIMEOUT_MS) || 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      credentials: "include",
      headers,
      signal: options.signal || controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new ApiHttpError(408, "gateway_timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  const dataProfile =
    typeof json.dataProfile === "string" ? json.dataProfile : null;
  const mappedZones = zones.map((z) => ({
    id: String(z.id),
    name: String(z.name ?? z.id),
    floor: z.floor != null ? String(z.floor) : "",
    mapX: Number.isFinite(Number(z.mapX)) ? Number(z.mapX) : 50,
    mapY: Number.isFinite(Number(z.mapY)) ? Number(z.mapY) : 50,
    kind: typeof z.kind === "string" ? z.kind : "",
    primaryNodeId: typeof z.primaryNodeId === "string" ? z.primaryNodeId : "",
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
  return { zones: mappedZones, floors, dataProfile };
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

export async function fetchAdminSensors() {
  const res = await sensorFetch("/api/admin/sensors");
  return handleJsonResponse(res);
}

export async function createAdminSensor(body) {
  const res = await sensorFetch("/api/admin/sensors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleJsonResponse(res);
}

export async function updateAdminSensor(id, body) {
  const res = await sensorFetch(`/api/admin/sensors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleJsonResponse(res);
}

export async function deleteAdminSensor(id) {
  const res = await sensorFetch(`/api/admin/sensors/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res);
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
