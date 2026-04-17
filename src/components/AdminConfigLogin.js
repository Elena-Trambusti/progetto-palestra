import React, { useState } from "react";
import { Shield, ArrowLeft } from "lucide-react";
import { loginAdminConfig, toUserErrorMessage } from "../services/sensorApi";
import "./AdminConfigLogin.css";

/**
 * Login dedicato al pannello #configurazione (ADMIN_PASSWORD sul server).
 */
export default function AdminConfigLogin({ onBack, onLoggedIn }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await loginAdminConfig(password);
      setPassword("");
      onLoggedIn();
    } catch (ex) {
      setErr(toUserErrorMessage(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-cyber-login">
      <div className="admin-cyber-login__card glass-panel">
        <Shield
          size={28}
          style={{ color: "#22d3ee", marginBottom: "0.65rem", filter: "drop-shadow(0 0 8px rgba(34,211,238,0.5))" }}
          aria-hidden
        />
        <h1 className="admin-cyber-login__title mono">Accesso configurazione</h1>
        <p className="admin-cyber-login__sub mono">
          Autenticazione richiesta per gestire l&apos;anagrafica sensori. La sessione resta attiva nel browser fino a
          scadenza del token.
        </p>
        {err ? (
          <p className="admin-cyber-login__err mono" role="alert">
            {err}
          </p>
        ) : null}
        <form onSubmit={handleSubmit}>
          <label className="admin-cyber-login__label mono" htmlFor="admin-pw">
            Password amministratore
          </label>
          <input
            id="admin-pw"
            type="password"
            className="admin-cyber-login__input mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            placeholder="ADMIN_PASSWORD (server)"
          />
          <div className="admin-cyber-login__actions">
            <button
              type="button"
              className="admin-cyber-login__btn admin-cyber-login__btn--ghost mono"
              onClick={onBack}
              disabled={busy}
            >
              <ArrowLeft size={16} style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden />
              Dashboard
            </button>
            <button type="submit" className="admin-cyber-login__btn admin-cyber-login__btn--primary mono" disabled={busy}>
              Entra
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
