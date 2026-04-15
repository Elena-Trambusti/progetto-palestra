import React from "react";
import { AlertTriangle, Info, Flame } from "lucide-react";
import "./AlarmBar.css";

function Icon({ severity }) {
  if (severity === "critical") return <Flame className="alarm-bar__ic alarm-bar__ic--crit" aria-hidden />;
  if (severity === "warning") {
    return <AlertTriangle className="alarm-bar__ic alarm-bar__ic--warn" aria-hidden />;
  }
  return <Info className="alarm-bar__ic alarm-bar__ic--info" aria-hidden />;
}

export default function AlarmBar({ alarms }) {
  if (!alarms?.length) return null;

  return (
    <div className="alarm-bar glass-panel" role="region" aria-label="Allarmi attivi">
      <p className="alarm-bar__title mono">Allarmi e notifiche</p>
      <ul className="alarm-bar__list">
        {alarms.map((a) => (
          <li
            key={`${a.code}-${a.message}`}
            className={`alarm-bar__item alarm-bar__item--${a.severity || "info"}`}
          >
            <Icon severity={a.severity} />
            <span className="alarm-bar__msg mono">{a.message}</span>
            {a.value != null && Number.isFinite(a.value) ? (
              <span className="alarm-bar__val mono">{a.value}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
