import React from "react";
import { LayoutDashboard, LineChart, RadioTower, Cpu, Settings } from "lucide-react";
import "./MainTabs.css";

export default function MainTabs({ value, onChange, showConfigNav, onOpenConfig }) {
  return (
    <div className="main-tabs glass-panel" role="tablist" aria-label="Sezioni dashboard">
      <button
        type="button"
        role="tab"
        aria-selected={value === "dashboard"}
        className={`main-tabs__btn${value === "dashboard" ? " main-tabs__btn--on" : ""}`}
        onClick={() => onChange("dashboard")}
      >
        <LayoutDashboard size={18} aria-hidden />
        Dashboard
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "history"}
        className={`main-tabs__btn${value === "history" ? " main-tabs__btn--on" : ""}`}
        onClick={() => onChange("history")}
      >
        <LineChart size={18} aria-hidden />
        Storico e report
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "network"}
        className={`main-tabs__btn${value === "network" ? " main-tabs__btn--on" : ""}`}
        onClick={() => onChange("network")}
      >
        <RadioTower size={18} aria-hidden />
        Rete LoRa
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "node"}
        className={`main-tabs__btn${value === "node" ? " main-tabs__btn--on" : ""}`}
        onClick={() => onChange("node")}
      >
        <Cpu size={18} aria-hidden />
        Dettaglio nodo
      </button>
      {showConfigNav && onOpenConfig ? (
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="main-tabs__btn"
          onClick={onOpenConfig}
          title="Apri /#configurazione (anagrafica sensori · richiede PostgreSQL sul server)"
        >
          <Settings size={18} aria-hidden />
          Configurazione
        </button>
      ) : null}
    </div>
  );
}
