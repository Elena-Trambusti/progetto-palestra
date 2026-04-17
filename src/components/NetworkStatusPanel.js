import React, { useMemo, useState } from "react";
import { Cpu, Radio, Battery, Clock3, Router, Search, ArrowDownAZ } from "lucide-react";
import { formatUplinkAgoOrLocal } from "../utils/localTime";
import "./NetworkStatusPanel.css";

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

export default function NetworkStatusPanel({
  telemetry,
  networkSummary,
  networkNodes,
  networkEvents,
  loading,
}) {
  const totals = networkSummary?.totals || {
    nodes: networkNodes?.length || 0,
    online: 0,
    stale: 0,
    offline: 0,
  };
  const gateway = networkSummary?.gateway || null;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("criticality");

  const resetControls = () => {
    setQuery("");
    setStatusFilter("all");
    setSortMode("criticality");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Array.isArray(networkNodes) ? networkNodes : [];
    const byStatus =
      statusFilter === "all"
        ? list
        : list.filter((n) => String(n.status || "") === statusFilter);
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ")
        .trim();

    const byQuery = !q
      ? byStatus
      : byStatus.filter((n) => {
          const hayRaw = `${n.label || ""} ${n.id || ""} ${n.zoneName || ""} ${n.zoneId || ""}`;
          const hay = norm(hayRaw);
          const qq = norm(q);
          return hay.includes(qq);
        });

    const sevScore = (n) => {
      const st = String(n.status || "");
      if (st === "offline") return 300;
      if (st === "stale") return 200;
      let score = 100;
      const bat = Number(n.batteryPercent);
      if (Number.isFinite(bat) && bat <= 25) score += 80;
      const rssi = Number(n.rssi);
      if (Number.isFinite(rssi) && rssi <= -118) score += 35;
      return score;
    };

    const cmp = (a, b) => {
      if (sortMode === "name") {
        return String(a.label || a.id || "").localeCompare(String(b.label || b.id || ""), "it");
      }
      if (sortMode === "uplink") {
        const ta = a.uplinkAt ? new Date(a.uplinkAt).getTime() : 0;
        const tb = b.uplinkAt ? new Date(b.uplinkAt).getTime() : 0;
        return tb - ta;
      }
      // default: criticality
      return sevScore(b) - sevScore(a);
    };

    return [...byQuery].sort(cmp);
  }, [networkNodes, query, statusFilter, sortMode]);

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

      <div className="network-panel__controls mono">
        <label className="network-panel__search">
          <Search size={15} aria-hidden />
          <input
            className="network-panel__search-input mono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca nodo/zona…"
            aria-label="Cerca nodo"
          />
        </label>
        <select
          className="network-panel__select mono"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtro stato"
        >
          <option value="all">Tutti</option>
          <option value="online">Online</option>
          <option value="stale">Ritardo</option>
          <option value="offline">Offline</option>
        </select>
        <label className="network-panel__sort">
          <ArrowDownAZ size={15} aria-hidden />
          <select
            className="network-panel__select mono"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            aria-label="Ordinamento"
          >
            <option value="criticality">Criticità</option>
            <option value="uplink">Ultimo uplink</option>
            <option value="name">Nome</option>
          </select>
        </label>
        <button
          type="button"
          className="network-panel__reset mono"
          onClick={resetControls}
        >
          Reset filtri
        </button>
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
        {filtered.map((node) => (
          <article
            key={node.id}
            className={`network-panel__node network-panel__node--${node.status || "unknown"}${
              telemetry?.nodeId === node.id ? " network-panel__node--selected" : ""
            }`}
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

      <div className="network-panel__timeline">
        <p className="network-panel__timeline-title mono">
          Event timeline (ultimi {Array.isArray(networkEvents) ? networkEvents.length : 0})
        </p>
        <ul className="network-panel__timeline-list mono">
          {(Array.isArray(networkEvents) ? networkEvents : [])
            .slice(-12)
            .reverse()
            .map((e, idx) => (
              <li key={`${e.t || e.iso || idx}`} className={`network-panel__evt network-panel__evt--${e.severity || "info"}`}>
                <span className="network-panel__evt-time">{fmtWhen(e.iso)}</span>
                <span className={`network-panel__evt-badge network-panel__evt-badge--${e.severity || "info"}`}>
                  {String(e.severity || "info").toUpperCase()}
                </span>
                <span className="network-panel__evt-msg">{e.message || "—"}</span>
              </li>
            ))}
          {!networkEvents?.length ? <li className="network-panel__evt">—</li> : null}
        </ul>
      </div>
    </section>
  );
}
