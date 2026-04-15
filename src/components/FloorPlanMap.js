import React, { useMemo } from "react";
import { MapPinned } from "lucide-react";
import "./FloorPlanMap.css";

export default function FloorPlanMap({
  floors,
  siteZones,
  selectedFloor,
  onFloorChange,
  selectedZoneId,
  onSelectZone,
}) {
  const floorsInUse = useMemo(() => {
    const set = new Set((siteZones || []).map((z) => String(z.floor)));
    return (floors || []).filter((f) => set.has(String(f.id)));
  }, [floors, siteZones]);

  const tabs = floorsInUse.length ? floorsInUse : floors || [];

  const planPath =
    tabs.find((f) => String(f.id) === String(selectedFloor))?.planPath ||
    tabs[0]?.planPath ||
    "/plans/piano-0.svg";

  const zonesOnFloor = (siteZones || []).filter(
    (z) => String(z.floor) === String(selectedFloor)
  );

  return (
    <section className="floor-map glass-panel animate-in animate-in-delay-1" aria-label="Mappa per piano">
      <div className="floor-map__head">
        <MapPinned className="floor-map__head-icon" aria-hidden />
        <div>
          <h2 className="floor-map__title">Planimetria per piano</h2>
          <p className="floor-map__hint mono">
            Seleziona un pin per aprire la zona nel pannello sotto
          </p>
        </div>
      </div>
      <div className="floor-map__tabs" role="tablist" aria-label="Piani">
        {tabs.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={String(selectedFloor) === String(f.id)}
            className={`floor-map__tab mono${
              String(selectedFloor) === String(f.id) ? " floor-map__tab--on" : ""
            }`}
            onClick={() => onFloorChange(String(f.id))}
          >
            {f.label || `Piano ${f.id}`}
          </button>
        ))}
      </div>
      <div className="floor-map__frame">
        <img className="floor-map__img" src={planPath} alt="" decoding="async" />
        <div className="floor-map__pins" aria-hidden={false}>
          {zonesOnFloor.map((z) => {
            const level = z.alarmLevel || "ok";
            return (
              <button
                key={z.id}
                type="button"
                className={`floor-map__pin floor-map__pin--${level}${
                  selectedZoneId === z.id ? " floor-map__pin--sel" : ""
                }`}
                style={{
                  left: `${Number(z.mapX) || 50}%`,
                  top: `${Number(z.mapY) || 50}%`,
                }}
                title={z.name}
                aria-label={`Zona ${z.name}`}
                onClick={() => onSelectZone(z.id)}
              >
                <span className="floor-map__pin-dot" />
                <span className="floor-map__pin-label mono">{z.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
