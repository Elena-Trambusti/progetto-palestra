import React from "react";
import { Cpu, Radio, Battery, Clock3, Router } from "lucide-react";
import "./NetworkStatusPanel.css";

function fmt(value, digits = 0, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtWhen(value) {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "—";
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s fa`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min} min fa`;
  return new Date(value).toLocaleTimeString("it-IT");
}

function statusLabel(status) {
  if (status === "offline") return "OFFLINE";
  if (status === "stale") return "RITARDO";
  if (status === "gateway") return "GATEWAY";
  return "ONLINE";
}

export default function NetworkStatusPanel({ telemetry, networkSummary, networkNodes, loading }) {
  const totals = networkSummary?.totals || {
    nodes: networkNodes?.length || 0,
    online: 0,
    stale: 0,
    offline: 0,
  };
  const gateway = networkSummary?.gateway || null;

  return (
    <section
      className={`network-panel glass-panel animate-in animate-in-delay-3${
        loading ? " network-panel--loading" : ""
      }`}
      aria-labelledby="network-panel-heading"
    >
      <div className="network-panel__head">
        <Router className="network-panel__icon" aria-hidden />
        <div>
          <h2 id="network-panel-heading" className="network-panel__title">
            Rete LoRa e nodi remoti
          </h2>
          <p className="network-panel__hint mono">
            Gateway centrale, uplink e stato della telemetria distribuita
          </p>
        </div>
      </div>

      <div className="network-panel__summary">
        <div className="network-panel__summary-tile mono">
          <span className="network-panel__summary-label">Gateway</span>
          <strong>{gateway?.name || telemetry?.gatewayName || "Gateway centrale"}</strong>
        </div>
        <div className="network-panel__summary-tile mono">
          <span className="network-panel__summary-label">Nodi online</span>
          <strong>{totals.online ?? 0}</strong>
          <span className="network-panel__summary-meta">/ {totals.nodes ?? networkNodes?.length ?? 0}</span>
        </div>
        <div className="network-panel__summary-tile mono">
          <span className="network-panel__summary-label">Ritardo</span>
          <strong>{totals.stale ?? 0}</strong>
        </div>
        <div className="network-panel__summary-tile mono">
          <span className="network-panel__summary-label">Offline</span>
          <strong>{totals.offline ?? 0}</strong>
        </div>
      </div>

      <div className="network-panel__focus mono">
        <div className="network-panel__focus-chip">
          <Cpu size={15} aria-hidden />
          <span>{telemetry?.nodeLabel || telemetry?.nodeId || "Nodo selezionato"}</span>
        </div>
        <div className={`network-panel__focus-chip network-panel__focus-chip--${telemetry?.nodeStatus || "unknown"}`}>
          <Radio size={15} aria-hidden />
          <span>{statusLabel(telemetry?.nodeStatus)}</span>
        </div>
        <div className="network-panel__focus-chip">
          <Battery size={15} aria-hidden />
          <span>{fmt(telemetry?.batteryPercent, 0, "%")}</span>
        </div>
        <div className="network-panel__focus-chip">
          <Clock3 size={15} aria-hidden />
          <span>{fmtWhen(telemetry?.uplinkAt)}</span>
        </div>
      </div>

      <div className="network-panel__grid">
        {(networkNodes || []).map((node) => (
          <article
            key={node.id}
            className={`network-panel__node network-panel__node--${node.status || "unknown"}`}
          >
            <div className="network-panel__node-head">
              <strong className="network-panel__node-title">{node.label || node.id}</strong>
              <span className={`network-panel__status network-panel__status--${node.status || "unknown"}`}>
                {statusLabel(node.status)}
              </span>
            </div>
            <p className="network-panel__node-zone mono">{node.zoneName || node.zoneId}</p>
            <div className="network-panel__metrics mono">
              <span>BATT {fmt(node.batteryPercent, 0, "%")}</span>
              <span>RSSI {fmt(node.rssi, 0, " dBm")}</span>
              <span>SNR {fmt(node.snr, 1)}</span>
            </div>
            <p className="network-panel__uplink mono">Ultimo uplink: {fmtWhen(node.uplinkAt)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
