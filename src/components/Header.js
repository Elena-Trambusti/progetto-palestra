import React from "react";
import { Activity, LogOut } from "lucide-react";
import "./Header.css";

function sourceLabel(dataSource, stream) {
  if (dataSource === "mock") return "SIMULAZIONE";
  if (dataSource === "degraded") {
    return stream === "ws" ? "DEGRADED · WS" : "API · DEGRADED";
  }
  if (stream === "ws") return "DATI LIVE · WS";
  return "DATI LIVE · HTTP";
}

export default function Header({
  facilityLine,
  dataSource = "mock",
  stream = "mock",
  showLogout = false,
  onLogout,
}) {
  return (
    <header className="header glass-panel animate-in">
      <div className="header__row">
        <div className="header__title-wrap">
          <Activity className="header__icon" aria-hidden />
          <h1 className="header__title mono">
            SISTEMA RILEVAZIONE PALESTRA
          </h1>
        </div>
        <div className="header__badges">
          <span
            className={`header__source mono${
              dataSource === "degraded" ? " header__source--warn" : ""
            }`}
            title="Origine dati e canale (REST / WebSocket)"
          >
            {sourceLabel(dataSource, stream)}
          </span>
          <div className="header__live" role="status" aria-live="polite">
            <span className="header__live-dot" />
            <span className="header__live-label mono">LIVE</span>
          </div>
          {showLogout && onLogout ? (
            <button
              type="button"
              className="header__logout mono"
              onClick={onLogout}
              title="Esci dal gateway"
            >
              <LogOut size={14} aria-hidden />
              ESCI
            </button>
          ) : null}
        </div>
      </div>
      <p className="header__subtitle">
        {facilityLine ? `${facilityLine} · ` : ""}
        Monitoraggio ambientale · docce · riserva idrica
      </p>
    </header>
  );
}
