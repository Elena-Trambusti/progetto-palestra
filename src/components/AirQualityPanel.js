import React from "react";
import { Wind, AlertTriangle, AlertCircle, Sun, Droplets, Activity } from "lucide-react";
import "./AirQualityPanel.css";

function fmt(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

/**
 * Calcola indice qualità aria (0-100) basato su CO2 e VOC
 */
function calculateAirQualityIndex(co2, voc) {
  let score = 100;
  
  // Penalizzazione CO2
  if (co2 > 1200) score -= 40;
  else if (co2 > 800) score -= 20;
  else if (co2 > 600) score -= 10;
  
  // Penalizzazione VOC
  if (voc > 300) score -= 30;
  else if (voc > 200) score -= 15;
  else if (voc > 150) score -= 5;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Determina stato qualità aria
 */
function getAirQualityStatus(index) {
  if (index >= 80) return { level: 'excellent', color: '#10b981', text: 'Eccellente' };
  if (index >= 60) return { level: 'good', color: '#22c55e', text: 'Buona' };
  if (index >= 40) return { level: 'moderate', color: '#f59e0b', text: 'Moderata' };
  if (index >= 20) return { level: 'poor', color: '#f97316', text: 'Scarsa' };
  return { level: 'hazardous', color: '#ef4444', text: 'Pericolosa' };
}

/**
 * Determina allarme CO2
 */
function getCo2Alert(co2) {
  if (co2 == null) return null;
  if (co2 > 1200) return { 
    level: 'critical', 
    icon: AlertTriangle, 
    message: 'Aria viziata! Aprire finestre',
    color: '#ef4444'
  };
  if (co2 > 800) return { 
    level: 'warning', 
    icon: AlertCircle, 
    message: 'Affollamento aumentato',
    color: '#f59e0b'
  };
  return null;
}

/**
 * Determina allarme illuminazione
 */
function getLightAlert(lux) {
  if (lux == null) return null;
  const hour = new Date().getHours();
  const isBusinessHours = hour >= 8 && hour <= 22;
  
  if (isBusinessHours && lux < 50) {
    return {
      level: 'warning',
      icon: Sun,
      message: 'Illuminazione insufficiente',
      color: '#f59e0b'
    };
  }
  return null;
}

export default function AirQualityPanel({
  co2Ppm,
  vocIndex,
  lightLux,
  humidityPercent,
  flowLmin,
  loading,
}) {
  const airQualityIndex = calculateAirQualityIndex(co2Ppm, vocIndex);
  const airQualityStatus = getAirQualityStatus(airQualityIndex);
  const co2Alert = getCo2Alert(co2Ppm);
  const lightAlert = getLightAlert(lightLux);

  return (
    <section
      className={`air-quality-panel glass-panel animate-in animate-in-delay-2${
        loading ? " air-quality-panel--loading" : ""
      }`}
      aria-labelledby="air-quality-panel-heading"
    >
      <div className="air-quality-panel__head">
        <Wind className="air-quality-panel__icon" aria-hidden />
        <div>
          <h2 id="air-quality-panel-heading" className="air-quality-panel__title">
            Qualità Aria - Sesto Senso
          </h2>
          <p className="air-quality-panel__hint mono">
            CO₂ · VOC · Illuminazione · Flusso
          </p>
        </div>
      </div>

      {/* Indice Qualità Aria */}
      <div className="air-quality-panel__index">
        <div className="air-quality-panel__index-circle" style={{ borderColor: airQualityStatus.color }}>
          <div 
            className="air-quality-panel__index-fill" 
            style={{ 
              background: `conic-gradient(${airQualityStatus.color} ${airQualityIndex * 3.6}deg, #e5e7eb ${airQualityIndex * 3.6}deg)` 
            }}
          >
            <div className="air-quality-panel__index-inner">
              <span className="air-quality-panel__index-value">{fmt(airQualityIndex)}</span>
              <span className="air-quality-panel__index-label">AQI</span>
            </div>
          </div>
        </div>
        <div className="air-quality-panel__index-info">
          <span 
            className="air-quality-panel__index-status" 
            style={{ color: airQualityStatus.color }}
          >
            {airQualityStatus.text}
          </span>
          <span className="air-quality-panel__index-desc">
            Qualità aria generale
          </span>
        </div>
      </div>

      {/* Metriche Principali */}
      <div className="air-quality-panel__grid">
        <div className="air-quality-panel__tile mono">
          <Activity className="air-quality-panel__tile-icon" aria-hidden />
          <span className="air-quality-panel__label">CO₂</span>
          <strong 
            className="air-quality-panel__value"
            style={{ 
              color: co2Alert ? co2Alert.color : 'inherit' 
            }}
          >
            {fmt(co2Ppm, 0)}
          </strong>
          <span className="air-quality-panel__unit">ppm</span>
          {co2Alert && (
            <div className="air-quality-panel__alert" style={{ color: co2Alert.color }}>
              <co2Alert.icon size={12} />
              <span>{co2Alert.message}</span>
            </div>
          )}
        </div>

        <div className="air-quality-panel__tile mono">
          <Wind className="air-quality-panel__tile-icon" aria-hidden />
          <span className="air-quality-panel__label">VOC</span>
          <strong className="air-quality-panel__value">{fmt(vocIndex, 0)}</strong>
          <span className="air-quality-panel__unit">indice</span>
          {vocIndex > 200 && (
            <div className="air-quality-panel__alert" style={{ color: '#f59e0b' }}>
              <AlertCircle size={12} />
              <span>Qualità aria degradata</span>
            </div>
          )}
        </div>

        <div className="air-quality-panel__tile mono">
          <Sun className="air-quality-panel__tile-icon" aria-hidden />
          <span className="air-quality-panel__label">Illuminazione</span>
          <strong 
            className="air-quality-panel__value"
            style={{ 
              color: lightAlert ? lightAlert.color : 'inherit' 
            }}
          >
            {fmt(lightLux, 0)}
          </strong>
          <span className="air-quality-panel__unit">lux</span>
          {lightAlert && (
            <div className="air-quality-panel__alert" style={{ color: lightAlert.color }}>
              <lightAlert.icon size={12} />
              <span>{lightAlert.message}</span>
            </div>
          )}
        </div>

        <div className="air-quality-panel__tile mono">
          <Droplets className="air-quality-panel__tile-icon" aria-hidden />
          <span className="air-quality-panel__label">Umidità</span>
          <strong className="air-quality-panel__value">{fmt(humidityPercent, 0)}%</strong>
        </div>

        <div className="air-quality-panel__tile mono">
          <Activity className="air-quality-panel__tile-icon" aria-hidden />
          <span className="air-quality-panel__label">Flusso Acqua</span>
          <strong className="air-quality-panel__value">{fmt(flowLmin, 1)}</strong>
          <span className="air-quality-panel__unit">L/min</span>
        </div>
      </div>

      {/* Allarmi Attivi */}
      {(co2Alert || lightAlert) && (
        <div className="air-quality-panel__alerts">
          <h3 className="air-quality-panel__alerts-title">
            <AlertTriangle size={16} />
            Allarmi Attivi
          </h3>
          <div className="air-quality-panel__alerts-list">
            {co2Alert && (
              <div className="air-quality-panel__alert-item" style={{ borderColor: co2Alert.color }}>
                <co2Alert.icon size={16} style={{ color: co2Alert.color }} />
                <div>
                  <strong>CO₂ {co2Alert.level === 'critical' ? 'Critico' : 'Elevato'}</strong>
                  <p>{co2Alert.message}</p>
                </div>
              </div>
            )}
            {lightAlert && (
              <div className="air-quality-panel__alert-item" style={{ borderColor: lightAlert.color }}>
                <lightAlert.icon size={16} style={{ color: lightAlert.color }} />
                <div>
                  <strong>Illuminazione Insufficiente</strong>
                  <p>{lightAlert.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stato Sistema */}
      <div className="air-quality-panel__status">
        <div className="air-quality-panel__status-item">
          <div className={`air-quality-panel__status-dot ${airQualityStatus.level}`} />
          <span>Sistema operativo</span>
        </div>
        <div className="air-quality-panel__status-item">
          <span className="mono">
            Ultimo aggiornamento: {new Date().toLocaleTimeString('it-IT')}
          </span>
        </div>
      </div>
    </section>
  );
}
