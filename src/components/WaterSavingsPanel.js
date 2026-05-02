import React, { useState, useEffect } from 'react';
import { 
  Droplets, 
  TrendingDown, 
  Leaf, 
  AlertTriangle, 
  CheckCircle,
  Wrench,
  BarChart3,
  Calculator,
  TreePine
} from 'lucide-react';
import { 
  fetchWaterSavings, 
  formatLiters, 
  formatItalianNumber,
  getEfficiencyColor,
  getSystemStatus,
  calculateSavingsTrend,
  calculateEnvironmentalImpact
} from '../services/waterSavingsApi';
import './WaterSavingsPanel.css';

export default function WaterSavingsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        setUnavailable(false);
        const savingsData = await fetchWaterSavings();
        if (savingsData?.unavailable) {
          setData(null);
          setUnavailable(true);
          return;
        }
        setData(savingsData);
      } catch (err) {
        setError(err.message || 'Errore caricamento dati risparmio');
      } finally {
        setLoading(false);
      }
    };

    loadData();
    
    // Refresh ogni 5 minuti
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <section className="water-savings glass-panel animate-in animate-in-delay-2">
        <div className="water-savings__loading">
          <div className="water-savings__spinner"></div>
          <span>Caricamento dati risparmio...</span>
        </div>
      </section>
    );
  }

  if (error) {
    // Per errori di autenticazione o API non disponibile, nascondi il pannello
    const errorCode = String(error).toLowerCase();
    if (errorCode.includes('401') || errorCode.includes('403') || 
        errorCode.includes('404') || errorCode.includes('503') ||
        errorCode.includes('unauthorized') || errorCode.includes('forbidden')) {
      return null;
    }
    return (
      <section className="water-savings glass-panel animate-in animate-in-delay-2">
        <div className="water-savings__error">
          <AlertTriangle className="water-savings__error-icon" />
          <span>Errore: {error}</span>
        </div>
      </section>
    );
  }

  if (!data) {
    if (unavailable) return null;
    return null;
  }

  const status = getSystemStatus(data.insights?.status);
  const trend = calculateSavingsTrend(data);
  const impact = calculateEnvironmentalImpact(data.insights?.estimatedMonthlySavings || 0);

  return (
    <section 
      className="water-savings glass-panel animate-in animate-in-delay-2"
      aria-labelledby="water-savings-heading"
    >
      <div className="water-savings__head">
        <Droplets className="water-savings__icon" aria-hidden />
        <div>
          <h2 id="water-savings-heading" className="water-savings__title">
            "Sesto Senso" - Risparmio Idrico
          </h2>
          <p className="water-savings__hint mono">
            Monitoraggio intelligente consumi e prevenzione sprechi
          </p>
        </div>
        <div className="water-savings__status" style={{ color: status.color }}>
          <span className="water-savings__status-icon">{status.icon}</span>
          <span className="water-savings__status-label">{status.label}</span>
        </div>
      </div>

      <div className="water-savings__body">
        {/* Metriche Principali */}
        <div className="water-savings__metrics">
          <div className="water-savings__metric water-savings__metric--primary">
            <div className="water-savings__metric-header">
              <TrendingDown className="water-savings__metric-icon" />
              <span className="water-savings__metric-label">Risparmio Stimato</span>
            </div>
            <div className="water-savings__metric-value">
              {formatLiters(data.insights?.estimatedMonthlySavings || 0)}
              <span className="water-savings__metric-period">/mese</span>
            </div>
            <div className="water-savings__metric-trend">
              <span className={`water-savings__trend water-savings__trend--${trend.trend}`}>
                {trend.trend === 'up' ? '↗' : trend.trend === 'down' ? '↘' : '→'} {trend.percentage}%
              </span>
            </div>
          </div>

          <div className="water-savings__metric">
            <div className="water-savings__metric-header">
              <Calculator className="water-savings__metric-icon" />
              <span className="water-savings__metric-label">Consumo Totale</span>
            </div>
            <div className="water-savings__metric-value">
              {formatLiters(data.totals?.totalLitersAllNodes || 0)}
            </div>
          </div>

          <div className="water-savings__metric">
            <div className="water-savings__metric-header">
              <Leaf className="water-savings__metric-icon" />
              <span className="water-savings__metric-label">Riduzione CO₂</span>
            </div>
            <div className="water-savings__metric-value">
              {formatItalianNumber(impact.co2Kg)} kg
            </div>
            <div className="water-savings__metric-sub">
              ≈ {impact.treesEquivalent} alberi/mese
            </div>
          </div>
        </div>

        {/* Dettagli Nodi */}
        <div className="water-savings__nodes">
          <h3 className="water-savings__section-title">
            <BarChart3 className="water-savings__section-icon" />
            Stato Nodi Idrici
          </h3>
          
          <div className="water-savings__nodes-grid">
            {data.nodes?.map((node) => (
              <div key={node.nodeId} className="water-savings__node-card">
                <div className="water-savings__node-header">
                  <span className="water-savings__node-name">{node.sensorName}</span>
                  <span className="water-savings__node-location mono">{node.location}</span>
                </div>
                
                <div className="water-savings__node-metrics">
                  <div className="water-savings__node-metric">
                    <span className="water-savings__node-label">Consumo</span>
                    <span className="water-savings__node-value mono">
                      {formatLiters(node.totalLitersFlowed)}
                    </span>
                  </div>
                  
                  <div className="water-savings__node-metric">
                    <span className="water-savings__node-label">Filtri</span>
                    <div className="water-savings__filter-bar">
                      <div 
                        className="water-savings__filter-fill"
                        style={{ 
                          width: `${Math.min(100, node.filterUsagePercent)}%`,
                          backgroundColor: getEfficiencyColor(node.filterUsagePercent)
                        }}
                      />
                      <span className="water-savings__filter-percent mono">
                        {node.filterUsagePercent}%
                      </span>
                    </div>
                  </div>
                </div>

                {node.filterUsagePercent >= 90 && (
                  <div className="water-savings__node-alert">
                    <Wrench className="water-savings__alert-icon" />
                    <span>Manutenzione filtri richiesta</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Insight e Raccomandazioni */}
        <div className="water-savings__insights">
          <h3 className="water-savings__section-title">
            <CheckCircle className="water-savings__section-icon" />
            Analisi e Raccomandazioni
          </h3>
          
          <div className="water-savings__insight-card">
            <div className="water-savings__insight-header">
              <TreePine className="water-savings__insight-icon" />
              <span className="water-savings__insight-title">Impatto Ambientale</span>
            </div>
            <div className="water-savings__insight-content">
              <p>
                Il sistema ha evitato l'emissione di <strong>{formatItalianNumber(impact.co2Kg)} kg CO₂</strong> 
                questo mese, equivalente alla compensazione di <strong>{impact.treesEquivalent} alberi</strong>.
              </p>
            </div>
          </div>

          <div className="water-savings__insight-card">
            <div className="water-savings__insight-header">
              <AlertTriangle className="water-savings__insight-icon" />
              <span className="water-savings__insight-title">Raccomandazioni</span>
            </div>
            <div className="water-savings__insight-content">
              <p>{data.insights?.recommendation}</p>
              {data.totals?.nodesNeedingMaintenance > 0 && (
                <div className="water-savings__maintenance-alert">
                  <Wrench className="water-savings__maintenance-icon" />
                  <span>
                    {data.totals.nodesNeedingMaintenance} nodi richiedono attenzione 
                    per ottimizzare i consumi
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="water-savings__footer mono">
          Aggiornato: {new Date(data.generated_at).toLocaleString('it-IT')}
        </div>
      </div>
    </section>
  );
}
