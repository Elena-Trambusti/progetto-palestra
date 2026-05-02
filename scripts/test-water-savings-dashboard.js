#!/usr/bin/env node
/**
 * Test Dashboard "Sesto Senso" - Risparmio Idrico
 * Verifica API endpoint e integrazione frontend
 */

require('dotenv').config();

console.log('🌊 TEST DASHBOARD "SESTO SENSO" - RISPARMIO IDRICO');
console.log('='.repeat(60));

async function testApiEndpoint() {
  console.log('\n📡 Test 1: API Endpoint /api/water/savings');
  console.log('-'.repeat(40));
  
  try {
    const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
    const response = await fetch(`${API_BASE}/api/water/savings`);
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('✅ API Response Structure:');
    console.log('- Success:', data.success);
    console.log('- Data nodes:', data.data?.nodes?.length || 0);
    console.log('- Totals:', Object.keys(data.data?.totals || {}));
    console.log('- Insights:', Object.keys(data.data?.insights || {}));
    
    if (data.data?.nodes) {
      console.log('\n📊 Nodi Acqua:');
      data.data.nodes.forEach((node, index) => {
        console.log(`${index + 1}. ${node.sensorName} (${node.location})`);
        console.log(`   Consumo: ${node.totalLitersFlowed.toLocaleString()} L`);
        console.log(`   Filtri: ${node.filterUsagePercent}%`);
      });
    }
    
    if (data.data?.totals) {
      console.log('\n💰 Metriche Aggregate:');
      console.log(`- Consumo totale: ${data.data.totals.totalLitersAllNodes.toLocaleString()} L`);
      console.log(`- Risparmio potenziale: ${data.data.totals.totalPotentialSavings.toLocaleString()} L`);
      console.log(`- Nodi con manutenzione: ${data.data.totals.nodesNeedingMaintenance}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ API Test failed:', error.message);
    return false;
  }
}

async function testWaterAnalyticsModule() {
  console.log('\n🧠 Test 2: Modulo waterAnalytics');
  console.log('-'.repeat(40));
  
  try {
    // Importiamo il modulo per testarlo
    const { analyzeWaterData, NIGHT_HOURS_START, NIGHT_HOURS_END } = 
      require('../server/lib/waterAnalytics');
    
    console.log('✅ Modulo waterAnalytics caricato');
    console.log(`- Orario notturno: ${NIGHT_HOURS_START}:00 - ${NIGHT_HOURS_END}:00`);
    
    // Test analisi perdita notturna
    const nightTime = new Date();
    nightTime.setHours(3, 30, 0, 0);
    
    console.log('\n🚨 Test Perdita Notturna:');
    const nightResult = await analyzeWaterData({
      nodeId: 'node-flow-01',
      flowLmin: 0.5,
      levelPercent: 45,
      timestamp: nightTime
    });
    
    console.log('- Alert generati:', nightResult.alerts.length);
    nightResult.alerts.forEach(alert => {
      console.log(`  * [${alert.severity}] ${alert.type}: ${alert.title}`);
    });
    
    // Test analisi normale
    const dayTime = new Date();
    dayTime.setHours(14, 30, 0, 0);
    
    console.log('\n💧 Test Consumo Normale:');
    const dayResult = await analyzeWaterData({
      nodeId: 'node-flow-01',
      flowLmin: 2.5,
      levelPercent: 75,
      timestamp: dayTime
    });
    
    console.log('- Alert generati:', dayResult.alerts.length);
    console.log('- Total litri:', dayResult.metrics.totalLiters);
    
    return true;
  } catch (error) {
    console.error('❌ Modulo test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

async function testFrontendIntegration() {
  console.log('\n🎨 Test 3: Integrazione Frontend');
  console.log('-'.repeat(40));
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Verifica esistenza file frontend
    const files = [
      'src/components/WaterSavingsPanel.js',
      'src/components/WaterSavingsPanel.css',
      'src/services/waterSavingsApi.js'
    ];
    
    let allFilesExist = true;
    
    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`✅ ${file} (${stats.size} bytes)`);
      } else {
        console.log(`❌ ${file} - MANCANTE`);
        allFilesExist = false;
      }
    }
    
    // Verifica integrazione in App.js
    const appJsPath = path.join(__dirname, '..', 'src/App.js');
    if (fs.existsSync(appJsPath)) {
      const appContent = fs.readFileSync(appJsPath, 'utf8');
      
      const hasImport = appContent.includes('import WaterSavingsPanel');
      const hasComponent = appContent.includes('<WaterSavingsPanel');
      
      console.log(`✅ Import in App.js: ${hasImport ? 'SÌ' : 'NO'}`);
      console.log(`✅ Componente in App.js: ${hasComponent ? 'SÌ' : 'NO'}`);
      
      if (!hasImport || !hasComponent) {
        allFilesExist = false;
      }
    }
    
    return allFilesExist;
  } catch (error) {
    console.error('❌ Frontend test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Avvio test completi...\n');
  
  const results = {
    api: await testApiEndpoint(),
    module: await testWaterAnalyticsModule(),
    frontend: await testFrontendIntegration()
  };
  
  console.log('\n📋 RIEPILOGO TEST:');
  console.log('='.repeat(60));
  
  Object.entries(results).forEach(([test, passed]) => {
    const status = passed ? '✅ PASSATO' : '❌ FALLITO';
    const name = test.charAt(0).toUpperCase() + test.slice(1);
    console.log(`${status} ${name}`);
  });
  
  const allPassed = Object.values(results).every(Boolean);
  
  if (allPassed) {
    console.log('\n🎉 TUTTI I TEST PASSATI!');
    console.log('✅ Dashboard "Sesto Senso" pronta per l\'uso');
    console.log('\n🚀 Per avviare la dashboard completa:');
    console.log('   npm run demo');
    console.log('\n📱 Il pannello risparmio idrico apparirà nella dashboard principale');
  } else {
    console.log('\n💥 ALCUNI TEST FALLITI');
    console.log('❌ Verificare gli errori sopra e riprovare');
    process.exit(1);
  }
}

// Esegui i test
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests };
