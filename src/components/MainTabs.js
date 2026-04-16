import React from "react";
import { LayoutDashboard, LineChart, RadioTower } from "lucide-react";
import "./MainTabs.css";

export default function MainTabs({ value, onChange }) {
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
    </div>
  );
}
