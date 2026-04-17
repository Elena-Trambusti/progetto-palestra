/**
 * Parsing e formattazione timestamp lato browser: il backend invia ISO 8601 in UTC;
 * qui si converte nell'ora locale dell'utente (grafici, tabelle, uplink).
 */

export function parseUtcInstant(raw) {
  if (raw == null || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Asse X grafici: solo ora locale (H:M:S). */
export function formatLocalTimeHms(isoOrDate) {
  const d = parseUtcInstant(isoOrDate);
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Anteprima tabella / tooltip: data e ora locali compatte. */
export function formatLocalDateTimeShort(isoOrDate) {
  const d = parseUtcInstant(isoOrDate);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * "Ultimo uplink: X min fa" / ora locale se più vecchio di ~1 h.
 */
export function formatUplinkAgoOrLocal(isoOrDate) {
  if (!isoOrDate) return "—";
  const ts = new Date(isoOrDate).getTime();
  if (!Number.isFinite(ts)) return "—";
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s fa`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min} min fa`;
  const d = new Date(isoOrDate);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
