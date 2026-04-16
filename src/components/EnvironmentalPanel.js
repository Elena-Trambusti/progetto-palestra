import React from "react";
import { Droplets, Wind, Activity, SunMedium, Waves } from "lucide-react";
import "./EnvironmentalPanel.css";

function fmt(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

export default function EnvironmentalPanel({
  humidityPercent,
  co2Ppm,
  vocIndex,
  lightLux,
  flowLmin,
  loading,
}) {
  return (
    <section
      className={`env-panel glass-panel animate-in animate-in-delay-2${
        loading ? " env-panel--loading" : ""
      }`}
      aria-labelledby="env-panel-heading"
    >
      <div className="env-panel__head">
        <Wind className="env-panel__icon" aria-hidden />
        <div>
          <h2 id="env-panel-heading" className="env-panel__title">
            Telemetria sensori
          </h2>
          <p className="env-panel__hint mono">Umidità · CO₂ · VOC · luce · flusso</p>
        </div>
      </div>
      <div className="env-panel__grid">
        <div className="env-panel__tile mono">
          <Droplets className="env-panel__tile-icon" aria-hidden />
          <span className="env-panel__label">Umidità rel.</span>
          <strong className="env-panel__value">{fmt(humidityPercent, 0)}%</strong>
        </div>
        <div className="env-panel__tile mono">
          <Activity className="env-panel__tile-icon" aria-hidden />
          <span className="env-panel__label">CO₂</span>
          <strong className="env-panel__value">{fmt(co2Ppm, 0)}</strong>
          <span className="env-panel__unit">ppm</span>
        </div>
        <div className="env-panel__tile mono">
          <Wind className="env-panel__tile-icon" aria-hidden />
          <span className="env-panel__label">Indice VOC</span>
          <strong className="env-panel__value">{fmt(vocIndex, 0)}</strong>
        </div>
        <div className="env-panel__tile mono">
          <SunMedium className="env-panel__tile-icon" aria-hidden />
          <span className="env-panel__label">Luce</span>
          <strong className="env-panel__value">{fmt(lightLux, 0)}</strong>
          <span className="env-panel__unit">lux</span>
        </div>
        <div className="env-panel__tile mono">
          <Waves className="env-panel__tile-icon" aria-hidden />
          <span className="env-panel__label">Flusso</span>
          <strong className="env-panel__value">{fmt(flowLmin, 1)}</strong>
          <span className="env-panel__unit">L/min</span>
        </div>
      </div>
    </section>
  );
}
