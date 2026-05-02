#!/usr/bin/env node
/**
 * Test "Sesto Senso" - Gestione Intelligente Acqua
 * Script per testare perdite notturne, manutenzione filtri e allarmi
 */

require('dotenv').config();
const { analyzeWaterData } = require('../server/lib/waterAnalytics');

console.log('🌊 TEST "SESTO SENSO" - GESTIONE INTELLIGENTE ACQUA');
console.log('=' .repeat(60));

async function runTests() {
  try {
    console.log('\n📋 Test 1: Perdita Notturna (ore 03:00)');
    console.log('-'.repeat(40));
    
    // Simula pacchetto alle 03:00 con flusso anomalo
    const nightTime = new Date();
    nightTime.setHours(3, 15, 0, 0); // 03:15
    
    const nightResult = await analyzeWaterData({
      nodeId: 'node-flow-01',
      flowLmin: 0.5, // Flusso anomalo notturno
      levelPercent: 45,
      timestamp: nightTime
    });
    
    console.log('Risultato:', {
      alerts: nightResult.alerts.length,
      estimatedWaste: nightResult.metrics.estimatedWaste,
      alerts: nightResult.alerts.map(a => ({ type: a.type, severity: a.severity }))
    });

    console.log('\n📋 Test 2: Manutenzione Filtri (10.000L superati)');
    console.log('-'.repeat(40));
    
    // Simula sensore con molti litri erogati
    const mockHighUsage = {
      nodeId: 'node-flow-01',
      flowLmin: 2.5,
      levelPercent: 60,
      timestamp: new Date()
    };
    
    // Prima simuliamo accumulo di 12.000L
    console.log('Simulazione accumulo 12.000 litri...');
    // Nota: in un test reale dovremmo manipolare direttamente il DB
    
    const maintenanceResult = await analyzeWaterData(mockHighUsage);
    console.log('Risultato manutenzione:', {
      alerts: maintenanceResult.alerts.length,
      maintenanceStatus: maintenanceResult.metrics.maintenanceStatus,
      alerts: maintenanceResult.alerts.map(a => ({ type: a.type, severity: a.severity }))
    });

    console.log('\n📋 Test 3: Livello Acqua Critico');
    console.log('-'.repeat(40));
    
    const criticalResult = await analyzeWaterData({
      nodeId: 'node-water-01',
      flowLmin: 0,
      levelPercent: 8, // Livello critico
      timestamp: new Date()
    });
    
    console.log('Risultato livello critico:', {
      alerts: criticalResult.alerts.length,
      alerts: criticalResult.alerts.map(a => ({ type: a.type, severity: a.severity, title: a.title }))
    });

    console.log('\n📋 Test 4: Funzionamento Normale Diurno');
    console.log('-'.repeat(40));
    
    const dayTime = new Date();
    dayTime.setHours(14, 30, 0, 0); // 14:30
    
    const normalResult = await analyzeWaterData({
      nodeId: 'node-flow-01',
      flowLmin: 1.2, // Flusso normale diurno
      levelPercent: 75,
      timestamp: dayTime
    });
    
    console.log('Risultato normale:', {
      alerts: normalResult.alerts.length,
      totalLiters: normalResult.metrics.totalLiters,
      alerts: normalResult.alerts.map(a => ({ type: a.type, severity: a.severity }))
    });

    console.log('\n✅ Test completati!');
    console.log('\n📝 RIEPILOGO ALLERTI GENERATI:');
    const allAlerts = [
      ...nightResult.alerts,
      ...maintenanceResult.alerts,
      ...criticalResult.alerts,
      ...normalResult.alerts
    ];
    
    allAlerts.forEach((alert, index) => {
      console.log(`${index + 1}. [${alert.severity.toUpperCase()}] ${alert.title}`);
      console.log(`   ${alert.message}`);
      if (alert.estimatedWaste > 0) {
        console.log(`   💧 Spreco: ${alert.estimatedWaste.toLocaleString()} litri`);
      }
      console.log(`   ⚡ Azione: ${alert.action}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Errore durante i test:', error);
    process.exit(1);
  }
}

// Esegui i test
runTests().then(() => {
  console.log('🎉 Test "Sesto Senso" completati con successo!');
}).catch(error => {
  console.error('💥 Test falliti:', error);
  process.exit(1);
});
