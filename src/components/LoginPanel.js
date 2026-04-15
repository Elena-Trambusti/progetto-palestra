import React, { useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { loginToGateway } from "../services/sensorApi";
import "./LoginPanel.css";

export default function LoginPanel({ onLoggedIn, onCancel }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginToGateway(password);
      onLoggedIn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Accesso non riuscito. Riprova."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-panel" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <form className="login-panel__card glass-panel" onSubmit={handleSubmit}>
        <div className="login-panel__head">
          <Lock className="login-panel__icon" aria-hidden />
          <div>
            <h2 id="login-title" className="login-panel__title">
              Accesso gateway sensori
            </h2>
            <p className="login-panel__hint mono">
              Sessione server attiva (REQUIRE_AUTH)
            </p>
          </div>
        </div>
        <label className="login-panel__label mono" htmlFor="gw-password">
          PASSWORD
        </label>
        <input
          id="gw-password"
          type="password"
          autoComplete="current-password"
          className="login-panel__input mono"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error ? (
          <p className="login-panel__error mono" role="alert">
            {error}
          </p>
        ) : null}
        <div className="login-panel__actions">
          {onCancel ? (
            <button
              type="button"
              className="login-panel__btn login-panel__btn--ghost mono"
              onClick={onCancel}
              disabled={busy}
            >
              Annulla
            </button>
          ) : null}
          <button
            type="submit"
            className="login-panel__btn login-panel__btn--primary mono"
            disabled={busy || !password}
          >
            <LogIn size={16} aria-hidden />
            {busy ? "Connessione…" : "Entra"}
          </button>
        </div>
      </form>
    </div>
  );
}
