import React, { useMemo } from "react";
import { Droplets, Loader2, Timer, Zap } from "lucide-react";
import "./WaterLevelGauge.css";

const R = 52;
const CIRC = 2 * Math.PI * R;

function formatEtaHours(h) {
  if (h == null || !Number.isFinite(h)) return null;
  if (h < 1 / 120) return "< 30 s";
  if (h < 1) return `~${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) {
    const rounded = h < 6 ? Math.round(h * 10) / 10 : Math.round(h);
    return `~${rounded} h`;
  }
  const d = h / 24;
  return `~${d < 14 ? Math.round(d * 10) / 10 : Math.round(d)} giorni`;
}

function confidenceIt(c) {
  if (c === "high") return "affidabilità alta";
  if (c === "medium") return "affidabilità media";
  if (c === "low") return "affidabilità bassa";
  return null;
}

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const bh = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const rh = Math.round(ah + (bh - ah) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  const h = rh.toString(16).padStart(2, "0");
  const g = rg.toString(16).padStart(2, "0");
  const bl = rb.toString(16).padStart(2, "0");
  return `#${h}${g}${bl}`;
}

export default function WaterLevelGauge({
  level,
  loading,
  waterEtaHours = null,
  waterEtaConfidence = null,
  waterDepletionRatePctPerHour = null,
  waterRapidDrop = false,
  waterRapidDropDelta = null,
}) {
  const clamped = Math.max(0, Math.min(100, level));
  const low = clamped < 20;
  const etaText = formatEtaHours(waterEtaHours);
  const confText = confidenceIt(waterEtaConfidence);

  const strokeColor = useMemo(() => {
    if (low) {
      const t = Math.min(1, clamped / 20);
      return lerpColor("#ef4444", "#22d3ee", t);
    }
    const t = Math.min(1, (clamped - 20) / 80);
    return lerpColor("#22d3ee", "#38bdf8", t);
  }, [clamped, low]);

  const offset = CIRC - (clamped / 100) * CIRC;

  return (
    <section
      className={`water-gauge glass-panel animate-in animate-in-delay-2${
        loading ? " water-gauge--loading" : ""
      }`}
      aria-labelledby="water-gauge-heading"
      aria-busy={loading ? "true" : "false"}
    >
      <div className="water-gauge__head">
        <Droplets className="water-gauge__icon" aria-hidden />
        <div>
          <h2 id="water-gauge-heading" className="water-gauge__title">
            Riserva idrica
          </h2>
          <p className="water-gauge__hint mono">
            Soglia critica &lt; 20% · ETA da storico locale
          </p>
        </div>
      </div>
      <div className="water-gauge__body">
        {loading ? (
          <div className="water-gauge__loading" aria-hidden>
            <Loader2 className="water-gauge__spinner" />
            <span className="water-gauge__loading-text mono">Sincronizzazione…</span>
          </div>
        ) : null}
        <div className="water-gauge__ring-wrap">
          <svg
            className="water-gauge__svg"
            viewBox="0 0 120 120"
            role="meter"
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Livello acqua ${Math.round(clamped)} percento`}
          >
            <defs>
              <filter id="gaugeGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle
              className="water-gauge__track"
              cx="60"
              cy="60"
              r={R}
              fill="none"
            />
            <circle
              className={`water-gauge__value ${low ? "water-gauge__value--low" : ""}`}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={strokeColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={offset}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="water-gauge__center mono">
            <span className="water-gauge__percent">{Math.round(clamped)}</span>
            <span className="water-gauge__unit">%</span>
          </div>
        </div>
        {low && (
          <p className="water-gauge__alert mono" role="alert">
            ALLERTA: livello sotto il 20%
          </p>
        )}
        {waterRapidDrop && (
          <p className="water-gauge__alert water-gauge__alert--rapid mono" role="alert">
            <Zap className="water-gauge__alert-icon" aria-hidden />
            Calo rapido rilevato
            {waterRapidDropDelta != null && Number.isFinite(waterRapidDropDelta)
              ? ` (Δ ≈ ${Math.round(waterRapidDropDelta)}%)`
              : ""}
            : possibile perdita o scarico anomalo.
          </p>
        )}
        <div className="water-gauge__insights mono" aria-live="polite">
          <div className="water-gauge__insight-row">
            <Timer className="water-gauge__insight-icon" aria-hidden />
            <div>
              {loading ? (
                <span className="water-gauge__insight-muted">Stima in aggiornamento…</span>
              ) : etaText && !low ? (
                <>
                  <span className="water-gauge__insight-label">
                    Sotto il 20% tra circa{" "}
                    <strong className="water-gauge__insight-strong">{etaText}</strong>
                  </span>
                  {confText ? (
                    <span className="water-gauge__insight-muted"> · {confText}</span>
                  ) : null}
                </>
              ) : low ? (
                <span className="water-gauge__insight-muted">
                  Già sotto soglia: priorità rifornimento.
                </span>
              ) : (
                <span className="water-gauge__insight-muted">
                  Dati insufficienti per una stima (servono alcuni minuti di storico in
                  calo).
                </span>
              )}
            </div>
          </div>
          {!loading &&
            waterDepletionRatePctPerHour != null &&
            Number.isFinite(waterDepletionRatePctPerHour) &&
            waterDepletionRatePctPerHour < -0.05 && (
              <p className="water-gauge__rate">
                Andamento: {waterDepletionRatePctPerHour.toFixed(1)} %/h
              </p>
            )}
        </div>
      </div>
    </section>
  );
}
