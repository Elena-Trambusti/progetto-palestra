import React from "react";
import {
  Activity,
  Radio,
  Battery,
  Thermometer,
  Droplets,
  Gauge,
  Sun,
  Wind,
  Cloud,
} from "lucide-react";
import { formatLocalDateTimeShort } from "../utils/localTime";
import "./EnvironmentalPanel.css";

function fmt(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

/** True se il sensore è in anagrafica ma non ha ancora una misura salvata. */
function isAwaitingFirstMeasurement(card) {
  if (card.value == null) return true;
  return !Number.isFinite(Number(card.value));
}

function sensorKind(type) {
  const t = String(type || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/₂/g, "2");
  if (t.includes("co2")) return "co2";
  if (t.includes("livello") || t.includes("level") || t.includes("acqua")) return "level";
  if (t.includes("umid") || t.includes("humid") || t === "rh") return "humidity";
  if (t.includes("voc") || t.includes("iaq") || t.includes("qualit")) return "voc";
  if (t.includes("lux") || t.includes("luce")) return "light";
  if (t.includes("fluss") || t.includes("flow")) return "flow";
  if (t.includes("temp") || t.includes("temperatura")) return "temp";
  return "generic";
}

function metricMeta(kind) {
  switch (kind) {
    case "co2":
      return { unit: "ppm", Icon: Cloud, decimals: 0 };
    case "humidity":
      return { unit: "%", Icon: Droplets, decimals: 1 };
    case "level":
      return { unit: "%", Icon: Gauge, decimals: 1 };
    case "voc":
      return { unit: "indice", Icon: Wind, decimals: 0 };
    case "light":
      return { unit: "lux", Icon: Sun, decimals: 0 };
    case "flow":
      return { unit: "L/min", Icon: Activity, decimals: 2 };
    case "temp":
      return { unit: "°C", Icon: Thermometer, decimals: 2 };
    default:
      return { unit: "", Icon: Activity, decimals: 2 };
  }
}

function uplinkLabel(status, awaiting) {
  if (awaiting) return "IN ATTESA";
  if (status === "offline") return "OFFLINE";
  if (status === "stale") return "RITARDO";
  return "ONLINE";
}

/**
 * Mappa i record `sensorCards` restituiti dall'API in una griglia di tile
 * riusando le classi visive di EnvironmentalPanel (nessun nuovo CSS di tema).
 */
export default function SensorDynamicGrid({ cards, loading }) {
  if (!cards?.length) return null;
  return (
    <section
      className={`env-panel glass-panel animate-in animate-in-delay-2${
        loading ? " env-panel--loading" : ""
      }`}
      aria-labelledby="dynamic-sensors-heading"
    >
      <div className="env-panel__head">
        <Activity className="env-panel__icon" aria-hidden />
        <div>
          <h2 id="dynamic-sensors-heading" className="env-panel__title">
            Telemetria sensori
          </h2>
          <p className="env-panel__hint mono">
            Card generate da anagrafica DB · RSSI/SNR ultimo uplink
          </p>
        </div>
      </div>
      <div className="env-panel__grid">
        {cards.map((c) => {
          const awaiting = isAwaitingFirstMeasurement(c);
          const kind = sensorKind(c.type);
          const { unit, Icon, decimals } = metricMeta(kind);
          return (
            <div key={c.id ?? c.devEui} className="env-panel__tile mono">
              <Icon className="env-panel__tile-icon" aria-hidden />
              <span className="env-panel__label">{c.name}</span>
              <span className="env-panel__unit" style={{ fontSize: "0.72rem", opacity: 0.88 }}>
                {c.type} · {c.devEui}
              </span>
              <strong className="env-panel__value" aria-live="polite">
                {awaiting ? (
                  <span style={{ fontSize: "0.92rem", fontWeight: 600, letterSpacing: "0.02em" }}>
                    In attesa di dati
                  </span>
                ) : (
                  <>
                    {fmt(c.value, decimals)}
                    {unit ? (
                      <span style={{ fontWeight: 600, marginLeft: "0.25rem", opacity: 0.95 }}>
                        {unit}
                      </span>
                    ) : null}
                  </>
                )}
              </strong>
              {c.thresholdAlarm === "low" || c.thresholdAlarm === "high" ? (
                <span className="env-panel__unit" style={{ color: "#f87171" }}>
                  Soglia {c.thresholdAlarm === "low" ? "MIN" : "MAX"}
                </span>
              ) : (
                <span className="env-panel__unit">&nbsp;</span>
              )}
              <div
                className="mono"
                style={{
                  marginTop: "0.45rem",
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  fontSize: "0.72rem",
                  opacity: 0.92,
                }}
              >
                <span title="RSSI">
                  <Radio size={12} style={{ verticalAlign: "middle", marginRight: 2 }} />
                  {fmt(c.rssi, 0)} dBm
                </span>
                <span>SNR {fmt(c.snr, 1)}</span>
                <span>
                  <Battery size={12} style={{ verticalAlign: "middle", marginRight: 2 }} />
                  {fmt(c.battery, 0)}%
                </span>
                <span style={{ fontWeight: 600 }}>{uplinkLabel(c.status, awaiting)}</span>
              </div>
              {!awaiting && c.lastTimestamp ? (
                <span className="env-panel__unit" style={{ marginTop: "0.15rem", fontSize: "0.65rem" }}>
                  Campione: {formatLocalDateTimeShort(c.lastTimestamp)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
