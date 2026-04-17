import React from "react";
import { Cpu, Battery, Radio, Clock3, ListChecks } from "lucide-react";
import { formatUplinkAgoOrLocal } from "../utils/localTime";
import "./NodeDetailPanel.css";

function fmt(value, digits = 0, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtWhen(value) {
  return formatUplinkAgoOrLocal(value);
}

function statusLabel(status) {
  if (status === "offline") return "OFFLINE";
  if (status === "stale") return "RITARDO";
  if (status === "gateway") return "GATEWAY";
  return "ONLINE";
}

export default function NodeDetailPanel({
  zoneName,
  telemetry,
  metrics,
  alarms,
  loading,
}) {
  return (
    <section
      className={`node-detail glass-panel animate-in animate-in-delay-2${
        loading ? " node-detail--loading" : ""
      }`}
      aria-labelledby="node-detail-heading"
    >
      <div className="node-detail__head">
        <Cpu className="node-detail__icon" aria-hidden />
        <div>
          <h2 id="node-detail-heading" className="node-detail__title">
            Dettaglio nodo
          </h2>
          <p className="node-detail__hint mono">
            {telemetry?.nodeLabel || telemetry?.nodeId || "Nodo"} ·{" "}
            {zoneName || "zona selezionata"}
          </p>
        </div>
      </div>

      <div className="node-detail__chips mono">
        <span className={`node-detail__chip node-detail__chip--${telemetry?.nodeStatus || "unknown"}`}>
          <Radio size={15} aria-hidden /> {statusLabel(telemetry?.nodeStatus)}
        </span>
        <span className="node-detail__chip">
          <Battery size={15} aria-hidden /> {fmt(telemetry?.batteryPercent, 0, "%")}
        </span>
        <span className="node-detail__chip">
          RSSI {fmt(telemetry?.rssi, 0, " dBm")} · SNR {fmt(telemetry?.snr, 1)}
        </span>
        <span className="node-detail__chip">
          <Clock3 size={15} aria-hidden /> uplink {fmtWhen(telemetry?.uplinkAt)}
        </span>
      </div>

      <div className="node-detail__grid">
        <div className="node-detail__tile mono">
          <span className="node-detail__label">Temperatura</span>
          <strong className="node-detail__value">{fmt(metrics?.temperatureC, 1)}</strong>
          <span className="node-detail__unit">°C</span>
        </div>
        <div className="node-detail__tile mono">
          <span className="node-detail__label">Livello</span>
          <strong className="node-detail__value">{fmt(metrics?.levelPercent, 0)}</strong>
          <span className="node-detail__unit">%</span>
        </div>
        <div className="node-detail__tile mono">
          <span className="node-detail__label">Flusso</span>
          <strong className="node-detail__value">{fmt(metrics?.flowLmin, 1)}</strong>
          <span className="node-detail__unit">L/min</span>
        </div>
        <div className="node-detail__tile mono">
          <span className="node-detail__label">Luce</span>
          <strong className="node-detail__value">{fmt(metrics?.lightLux, 0)}</strong>
          <span className="node-detail__unit">lux</span>
        </div>
        <div className="node-detail__tile mono">
          <span className="node-detail__label">Umidita</span>
          <strong className="node-detail__value">{fmt(metrics?.humidityPercent, 0)}</strong>
          <span className="node-detail__unit">%</span>
        </div>
        <div className="node-detail__tile mono">
          <span className="node-detail__label">CO2</span>
          <strong className="node-detail__value">{fmt(metrics?.co2Ppm, 0)}</strong>
          <span className="node-detail__unit">ppm</span>
        </div>
      </div>

      <div className="node-detail__bottom">
        <div className="node-detail__sensors">
          <p className="node-detail__sub mono">
            <ListChecks size={14} aria-hidden /> Sensori dichiarati
          </p>
          <ul className="node-detail__list mono">
            {(telemetry?.sensors || []).length ? (
              telemetry.sensors.map((s) => <li key={s}>{s}</li>)
            ) : (
              <li>—</li>
            )}
          </ul>
        </div>
        <div className="node-detail__alarms">
          <p className="node-detail__sub mono">Allarmi attivi</p>
          <ul className="node-detail__list mono">
            {(alarms || []).length ? (
              alarms.slice(0, 8).map((a) => <li key={`${a.code}-${a.message}`}>{a.message}</li>)
            ) : (
              <li>—</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

