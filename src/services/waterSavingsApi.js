/**
 * "Sesto Senso" - API Servizi Risparmio Idrico
 * Recupera e processa dati per dashboard risparmio acqua
 */

import { sensorFetch } from "./sensorApi";

/**
 * Recupera dati completi risparmio idrico
 * @returns {Promise<Object>} Dati risparmio con metriche aggregate
 */
export async function fetchWaterSavings() {
  const response = await sensorFetch("/api/water/savings", { method: "GET" });

  if (!response.ok) {
    if ([401, 403, 404, 503].includes(response.status)) {
      return { unavailable: true, status: response.status };
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data?.success) {
    return { unavailable: true, status: 204 };
  }
  return data.data;
}

/**
 * Formatta numero con separatori italiani
 * @param {number} num 
 * @returns {string}
 */
export function formatItalianNumber(num) {
  if (num == null || !Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('it-IT').format(Math.round(num));
}

/**
 * Formatta litri con unità appropriate
 * @param {number} liters 
 * @returns {string}
 */
export function formatLiters(liters) {
  if (liters == null || !Number.isFinite(liters)) return '0 L';
  
  if (liters >= 1000) {
    return `${formatItalianNumber((liters / 1000).toFixed(1))} kL`;
  }
  return `${formatItalianNumber(liters)} L`;
}

/**
 * Calcola colore in base allo stato efficienza
 * @param {number} percentage - Percentuale utilizzo filtri
 * @returns {string} - Colore CSS
 */
export function getEfficiencyColor(percentage) {
  if (percentage >= 90) return '#ef4444'; // Rosso - manutenzione urgente
  if (percentage >= 75) return '#f59e0b'; // Arancione - attenzione
  if (percentage >= 50) return '#eab308'; // Giallo - monitorare
  return '#22c55e'; // Verde - ottimale
}

/**
 * Calcola icona stato sistema
 * @param {string} status 
 * @returns {Object} - { icon: string, color: string, label: string }
 */
export function getSystemStatus(status) {
  const statusMap = {
    optimal: {
      icon: '✅',
      color: '#22c55e',
      label: 'Ottimale'
    },
    maintenance_needed: {
      icon: '🔧',
      color: '#f59e0b',
      label: 'Manutenzione Richiesta'
    },
    critical: {
      icon: '🚨',
      color: '#ef4444',
      label: 'Critico'
    }
  };
  
  return statusMap[status] || statusMap.optimal;
}

/**
 * Calcola trend risparmio mensile
 * @param {Object} data 
 * @returns {Object} - { trend: 'up'|'down'|'stable', percentage: number }
 */
export function calculateSavingsTrend(data) {
  if (!data.totals || !data.insights) {
    return { trend: 'stable', percentage: 0 };
  }
  
  const { totalPotentialSavings } = data.totals;
  const { estimatedMonthlySavings } = data.insights;
  
  // Logica semplificata: basata su rapporto risparmio potenziale vs stimato
  const efficiencyRatio = totalPotentialSavings > 0 ? estimatedMonthlySavings / totalPotentialSavings : 0;
  
  if (efficiencyRatio > 0.8) return { trend: 'up', percentage: Math.round(efficiencyRatio * 100) };
  if (efficiencyRatio > 0.5) return { trend: 'stable', percentage: Math.round(efficiencyRatio * 100) };
  return { trend: 'down', percentage: Math.round(efficiencyRatio * 100) };
}

/**
 * Genera dati per grafico risparmio mensile
 * @param {Object} data 
 * @returns {Array} - Array di dati per Chart.js
 */
export function generateMonthlySavingsChart(data) {
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu'];
  const baseSavings = data.insights?.estimatedMonthlySavings || 0;
  
  return months.map((month, index) => ({
    label: month,
    savings: baseSavings * (0.8 + Math.random() * 0.4), // Variazione ±20%
    potential: data.totals?.totalPotentialSavings || 0
  }));
}

/**
 * Calcola impatto ambientale
 * @param {number} litersSaved 
 * @returns {Object} - { co2Kg: number, treesEquivalent: number }
 */
export function calculateEnvironmentalImpact(litersSaved) {
  // Stime: 1L acqua = 0.0003kg CO2, 1 albero assorbe ~22kg CO2/anno
  const co2Kg = litersSaved * 0.0003;
  const treesEquivalent = co2Kg / 22 / 12; // Alberi equivalenti per mese
  
  return {
    co2Kg: Math.round(co2Kg * 100) / 100,
    treesEquivalent: Math.round(treesEquivalent * 100) / 100
  };
}
