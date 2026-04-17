import React from "react";
import { Layers } from "lucide-react";
import "./ZoneSelector.css";

export default function ZoneSelector({
  zones,
  value,
  onChange,
  disabled,
  errorText,
}) {
  return (
    <div className="zone-selector glass-panel animate-in animate-in-delay-1">
      <div className="zone-selector__head">
        <Layers className="zone-selector__icon" aria-hidden />
        <div>
          <h2 className="zone-selector__title">Zona impianto</h2>
          <p className="zone-selector__hint mono">
            Posizioni univoche da anagrafica sensori (campo location nel database)
          </p>
        </div>
      </div>
      <div className="zone-selector__controls">
        <label className="zone-selector__label mono" htmlFor="zone-select">
          ZONE_OR_NODE
        </label>
        <select
          id="zone-select"
          className="zone-selector__select mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || !zones.length}
        >
          {!zones.length ? (
            <option value="">— Nessuna location in anagrafica —</option>
          ) : null}
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
              {z.floor ? ` · piano ${z.floor}` : ""}
            </option>
          ))}
        </select>
      </div>
      {errorText ? (
        <p className="zone-selector__error mono" role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
