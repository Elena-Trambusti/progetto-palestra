import React, { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Trash2, Plus, Save, ArrowLeft } from "lucide-react";
import {
  createAdminSensor,
  deleteAdminSensor,
  fetchAdminSensors,
  toUserErrorMessage,
  updateAdminSensor,
} from "../services/sensorApi";
import "./LoginPanel.css";

/** Valori salvati in `sensors.type` (coerenti con il decoder binario lato server). */
const SENSOR_TYPE_OPTIONS = [
  { value: "Temperatura", label: "Temperatura" },
  { value: "CO2", label: "CO₂" },
  { value: "Livello", label: "Livello (serbatoio / %)" },
  { value: "Umidità", label: "Umidità relativa" },
  { value: "VOC", label: "Qualità aria (VOC / IAQ)" },
  { value: "Luce", label: "Luce (lux)" },
  { value: "Flusso", label: "Flusso (L/min)" },
  { value: "__altro__", label: "Altro (personalizzato)" },
];

const emptyForm = {
  devEui: "",
  name: "",
  location: "",
  type: "Temperatura",
  typeCustom: "",
  minThreshold: "",
  maxThreshold: "",
};

const DEV_EUI_RE = /^[0-9A-F]{16}$/;
const THRESHOLD_NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;

/**
 * Durante la digitazione delle soglie: solo cifre, un punto decimale e segno meno iniziale.
 */
function sanitizeThresholdInput(raw) {
  let t = String(raw ?? "").replace(/,/g, ".");
  t = t.replace(/[^\d.-]/g, "");
  if (t === "-" || t === ".") return t;
  const neg = t.startsWith("-");
  let rest = neg ? t.slice(1) : t;
  rest = rest.replace(/-/g, "");
  const dot = rest.indexOf(".");
  if (dot === -1) return neg ? `-${rest}` : rest;
  const head = rest.slice(0, dot + 1);
  const tail = rest.slice(dot + 1).replace(/\./g, "");
  rest = head + tail;
  return neg ? `-${rest}` : rest;
}

/** Valida soglia opzionale: stringa vuota ok, altrimenti solo formato numerico. */
function validateOptionalThreshold(raw, label) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return { ok: true };
  if (!THRESHOLD_NUM_RE.test(s)) {
    return {
      ok: false,
      message: `${label}: inserisci solo numeri (es. 20 o 19.5), senza lettere o simboli.`,
    };
  }
  return { ok: true };
}

function resolvedType(form) {
  if (form.type === "__altro__") {
    return String(form.typeCustom || "").trim() || "Sensore";
  }
  return form.type;
}

/**
 * Pannello amministrativo: CRUD su tabella `sensors` (database es. db-palestra su Render).
 * Protetto dalle stesse credenziali del gateway (sessione / API key).
 */
export default function ConfigurazionePanel({ onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  /** Messaggio verde (successo) o rosso (errore) per salvataggio / lista / eliminazione. */
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const successClearTimer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminSensors();
      setRows(Array.isArray(data.sensors) ? data.sensors : []);
    } catch (e) {
      setNotice({ type: "error", text: toUserErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (notice?.type !== "success") return undefined;
    if (successClearTimer.current) clearTimeout(successClearTimer.current);
    successClearTimer.current = setTimeout(() => {
      successClearTimer.current = null;
      setNotice((n) => (n?.type === "success" ? null : n));
    }, 4500);
    return () => {
      if (successClearTimer.current) clearTimeout(successClearTimer.current);
    };
  }, [notice]);

  function scheduleSubmitCooldown() {
    const t0 = Date.now();
    setSaving(true);
    return () => {
      const ms = Math.max(0, 1000 - (Date.now() - t0));
      setTimeout(() => setSaving(false), ms);
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;

    const endCooldown = scheduleSubmitCooldown();
    setNotice(null);

    const name = String(form.name || "").trim();
    if (!name) {
      setNotice({ type: "error", text: "Il nome sensore è obbligatorio e non può essere vuoto." });
      endCooldown();
      return;
    }

    const dev = String(form.devEui || "").replace(/\s+/g, "").toUpperCase();
    if (!dev) {
      setNotice({ type: "error", text: "Il DevEUI è obbligatorio e non può essere vuoto." });
      endCooldown();
      return;
    }
    if (!DEV_EUI_RE.test(dev)) {
      setNotice({
        type: "error",
        text: "DevEUI non valido: servono esattamente 16 caratteri esadecimali (0–9, A–F).",
      });
      endCooldown();
      return;
    }

    const dup = rows.some(
      (r) => String(r.devEui || "").toUpperCase() === dev && Number(r.id) !== Number(editingId)
    );
    if (dup) {
      setNotice({
        type: "error",
        text: "Esiste già un sensore con questo DevEUI nell’anagrafica. Ogni dispositivo deve avere un DevEUI univoco.",
      });
      endCooldown();
      return;
    }

    const minChk = validateOptionalThreshold(form.minThreshold, "Soglia min");
    if (!minChk.ok) {
      setNotice({ type: "error", text: minChk.message });
      endCooldown();
      return;
    }
    const maxChk = validateOptionalThreshold(form.maxThreshold, "Soglia max");
    if (!maxChk.ok) {
      setNotice({ type: "error", text: maxChk.message });
      endCooldown();
      return;
    }

    const typeStr = resolvedType(form);
    if (form.type === "__altro__" && !String(form.typeCustom || "").trim()) {
      setNotice({
        type: "error",
        text: "Specifica il tipo personalizzato oppure scegli un tipo dall’elenco.",
      });
      endCooldown();
      return;
    }

    const location = String(form.location || "").trim();
    if (!location) {
      setNotice({ type: "error", text: "La posizione (zona impianto) non può essere vuota." });
      endCooldown();
      return;
    }

    try {
      const payload = {
        devEui: dev,
        name,
        location,
        type: typeStr,
        minThreshold: String(form.minThreshold || "").trim(),
        maxThreshold: String(form.maxThreshold || "").trim(),
      };

      if (editingId != null) {
        await updateAdminSensor(editingId, payload);
        setNotice({ type: "success", text: "Sensore aggiornato con successo!" });
      } else {
        await createAdminSensor(payload);
        setNotice({ type: "success", text: "Sensore registrato con successo!" });
      }
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (e) {
      setNotice({ type: "error", text: toUserErrorMessage(e) });
    } finally {
      endCooldown();
    }
  }

  function startEdit(row) {
    setNotice(null);
    setEditingId(row.id);
    const known = SENSOR_TYPE_OPTIONS.some(
      (o) => o.value !== "__altro__" && o.value === row.type
    );
    setForm({
      devEui: String(row.devEui || "").toUpperCase(),
      name: row.name || "",
      location: row.location || "",
      type: known ? row.type : "__altro__",
      typeCustom: known ? "" : row.type || "",
      minThreshold: row.minThreshold != null ? String(row.minThreshold) : "",
      maxThreshold: row.maxThreshold != null ? String(row.maxThreshold) : "",
    });
  }

  async function handleDelete(id) {
    if (!window.confirm("Eliminare il sensore e lo storico collegato?")) return;
    setNotice(null);
    try {
      await deleteAdminSensor(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setNotice({ type: "success", text: "Sensore eliminato." });
      await load();
    } catch (e) {
      setNotice({ type: "error", text: toUserErrorMessage(e) });
    }
  }

  return (
    <div className="login-panel login-panel--config">
      <div className="login-panel__card login-panel__card--admin glass-panel">
        <div className="login-panel__head">
          <Settings className="login-panel__icon" aria-hidden />
          <div>
            <h2 className="login-panel__title">Configurazione sensori</h2>
            <p className="login-panel__hint mono">
              Anagrafica PostgreSQL (es. db-palestra): nome, DevEUI TTN, tipo, posizione, soglie
            </p>
          </div>
        </div>

        <button
          type="button"
          className="login-panel__btn login-panel__btn--ghost mono login-panel__btn--back"
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden />
          Torna alla dashboard
        </button>

        {notice ? (
          <p
            className="mono"
            role="status"
            aria-live="polite"
            style={{
              marginBottom: "0.75rem",
              padding: "0.65rem 0.85rem",
              borderRadius: 8,
              fontSize: "0.9rem",
              lineHeight: 1.45,
              border:
                notice.type === "success"
                  ? "1px solid rgba(34, 197, 94, 0.45)"
                  : "1px solid rgba(248, 113, 113, 0.5)",
              color: notice.type === "success" ? "#86efac" : "#fecaca",
              background:
                notice.type === "success"
                  ? "rgba(22, 101, 52, 0.25)"
                  : "rgba(127, 29, 29, 0.28)",
            }}
          >
            {notice.text}
          </p>
        ) : null}

        <form className="mono" onSubmit={handleSubmit} style={{ display: "grid", gap: "0.65rem" }}>
          <label className="login-panel__label" htmlFor="f-name">
            Nome sensore
          </label>
          <input
            id="f-name"
            className="login-panel__input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            disabled={loading || saving}
            placeholder="es. Sensore docce nord"
          />

          <label className="login-panel__label" htmlFor="f-dev">
            DevEUI (16 caratteri esadecimali)
          </label>
          <input
            id="f-dev"
            className="login-panel__input"
            value={form.devEui}
            onChange={(e) => {
              const v = e.target.value
                .replace(/[^0-9A-Fa-f]/gi, "")
                .slice(0, 16)
                .toUpperCase();
              setForm((f) => ({ ...f, devEui: v }));
            }}
            required
            disabled={loading || saving}
            placeholder="0011223344556677"
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
          />

          <label className="login-panel__label" htmlFor="f-type">
            Tipo
          </label>
          <select
            id="f-type"
            className="login-panel__input"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            disabled={loading || saving}
          >
            {SENSOR_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {form.type === "__altro__" ? (
            <>
              <label className="login-panel__label" htmlFor="f-type-custom">
                Tipo personalizzato
              </label>
              <input
                id="f-type-custom"
                className="login-panel__input"
                value={form.typeCustom}
                onChange={(e) => setForm((f) => ({ ...f, typeCustom: e.target.value }))}
                disabled={loading || saving}
                placeholder="es. Pressione, Presenza, …"
              />
            </>
          ) : null}

          <label className="login-panel__label" htmlFor="f-loc">
            Posizione (zona impianto)
          </label>
          <input
            id="f-loc"
            className="login-panel__input"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            required
            disabled={loading || saving}
            placeholder='es. Piano 1 — Docce'
          />

          <div className="config-threshold-grid">
            <div>
              <label className="login-panel__label" htmlFor="f-min">
                Soglia allarme min
              </label>
              <input
                id="f-min"
                type="text"
                inputMode="decimal"
                className="login-panel__input"
                value={form.minThreshold}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minThreshold: sanitizeThresholdInput(e.target.value) }))
                }
                disabled={loading || saving}
                placeholder="solo numeri, opzionale"
              />
            </div>
            <div>
              <label className="login-panel__label" htmlFor="f-max">
                Soglia allarme max
              </label>
              <input
                id="f-max"
                type="text"
                inputMode="decimal"
                className="login-panel__input"
                value={form.maxThreshold}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxThreshold: sanitizeThresholdInput(e.target.value) }))
                }
                disabled={loading || saving}
                placeholder="solo numeri, opzionale"
              />
            </div>
          </div>

          <div className="login-panel__actions">
            {editingId != null ? (
              <button
                type="button"
                className="login-panel__btn login-panel__btn--ghost mono"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                }}
                disabled={loading || saving}
              >
                Annulla modifica
              </button>
            ) : null}
            <button
              type="submit"
              className="login-panel__btn login-panel__btn--primary mono"
              disabled={loading || saving}
              aria-busy={saving ? "true" : "false"}
            >
              {editingId != null ? <Save size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
              {editingId != null ? "Salva modifiche" : "Salva sensore"}
            </button>
          </div>
        </form>

        <div style={{ marginTop: "1.5rem" }}>
          <p className="login-panel__hint mono" style={{ marginBottom: "0.5rem" }}>
            Sensori registrati ({loading ? "…" : rows.length})
          </p>
          <div className="login-panel__table-scroll" style={{ fontSize: "0.82rem" }}>
            <table className="mono">
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.85 }}>
                  <th style={{ padding: "0.35rem" }}>ID</th>
                  <th style={{ padding: "0.35rem" }}>dev_eui</th>
                  <th style={{ padding: "0.35rem" }}>Nome</th>
                  <th style={{ padding: "0.35rem" }}>Posizione</th>
                  <th style={{ padding: "0.35rem" }}>Tipo</th>
                  <th style={{ padding: "0.35rem" }}>Soglie</th>
                  <th style={{ padding: "0.35rem" }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(148,163,184,0.15)" }}>
                    <td style={{ padding: "0.35rem" }}>{r.id}</td>
                    <td style={{ padding: "0.35rem" }}>{r.devEui}</td>
                    <td style={{ padding: "0.35rem" }}>{r.name}</td>
                    <td style={{ padding: "0.35rem" }}>{r.location}</td>
                    <td style={{ padding: "0.35rem" }}>{r.type}</td>
                    <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                      {r.minThreshold != null ? r.minThreshold : "—"} /{" "}
                      {r.maxThreshold != null ? r.maxThreshold : "—"}
                    </td>
                    <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="login-panel__btn login-panel__btn--ghost mono"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                        onClick={() => startEdit(r)}
                        disabled={loading || saving}
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="login-panel__btn login-panel__btn--ghost mono"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", marginLeft: 4 }}
                        onClick={() => handleDelete(r.id)}
                        disabled={loading || saving}
                        title="Elimina"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
