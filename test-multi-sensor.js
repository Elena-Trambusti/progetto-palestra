require('dotenv').config({path: '.env'});
const { analyzeWaterData } = require('./server/lib/waterAnalytics');
const { analyzeAirData } = require('./server/lib/airAnalytics');

console.log('🧪 TEST MULTI-SENSORE - "SESTO SENSO" EVOLUTO');
console.log('Simulazione dati da Nodo Acqua + Nodo Aria\n');

// Funzione per simulare invio dati verso /api/ingest
async function sendIngestData(nodeId, payload) {
  console.log(`\n📡 Inviando dati da ${nodeId}:`);
  console.log(`   Payload:`, payload);
  
  // Simula il processo che avverrebbe in ttnIngest.js
  try {
    if (nodeId === 'node-flow-01') {
      // Analisi acqua
      const result = await analyzeWaterData({
        nodeId: nodeId,
        flowLmin: payload.flowLmin || 0,
        levelPercent: payload.levelPercent || 0,
        timestamp: new Date()
      });
      
      console.log(`   ✅ Analisi acqua completata`);
      console.log(`   📊 Alert generati: ${result.alerts.length}`);
      result.alerts.forEach((alert, i) => {
        console.log(`      ${i+1}. [${alert.severity.toUpperCase()}] ${alert.title}`);
        console.log(`         ${alert.message}`);
        if (alert.estimatedWaste) {
          console.log(`         💧 Spreco: ${alert.estimatedWaste} litri`);
        }
      });
      
    } else if (nodeId === 'node-air-01') {
      // Analisi aria
      const result = await analyzeAirData({
        nodeId: nodeId,
        co2: payload.co2Ppm || null,
        voc: payload.vocIndex || null,
        lux: payload.lux || null,
        timestamp: new Date()
      });
      
      console.log(`   ✅ Analisi aria completata`);
      console.log(`   📊 Alert generati: ${result.alerts.length}`);
      console.log(`   📈 Metriche: CO2=${result.metrics.co2}ppm, VOC=${result.metrics.voc}, Lux=${result.metrics.lux}`);
      
      result.alerts.forEach((alert, i) => {
        console.log(`      ${i+1}. [${alert.severity.toUpperCase()}] ${alert.title}`);
        console.log(`         ${alert.message}`);
      });
      
      console.log(`   📋 Riepilogo:`, result.summary);
    }
    
    console.log(`   🎉 Dati processati con successo!`);
    
  } catch (error) {
    console.error(`   ❌ Errore elaborazione ${nodeId}:`, error.message);
  }
}

// Test 1: Nodo Acqua - Flusso normale (nessun allarme)
async function testWaterNormal() {
  console.log('\n💧 TEST 1: NODO ACQUA - FLUSSO NORMALE');
  await sendIngestData('node-flow-01', {
    flowLmin: 0.2,        // Flusso normale
    levelPercent: 65      // Livello acqua ok
  });
}

// Test 2: Nodo Acqua - Perdita notturna (allarme)
async function testWaterLeak() {
  console.log('\n🚨 TEST 2: NODO ACQUA - PERDITA NOTTURNA');
  
  // Simula orario notturno
  const nightTime = new Date();
  nightTime.setHours(3, 30, 0, 0);
  
  await sendIngestData('node-flow-01', {
    flowLmin: 0.5,        // Flusso anomalo notturno
    levelPercent: 45
  });
}

// Test 3: Nodo Aria - CO2 alta (allarme critico)
async function testAirCritical() {
  console.log('\n⚠️ TEST 3: NODO ARIA - CO2 CRITICO');
  await sendIngestData('node-air-01', {
    co2Ppm: 1500,         // CO2 critica (>1200)
    vocIndex: 180,        // VOC moderato
    lux: 300              // Luce sufficiente
  });
}

// Test 4: Nodo Aria - Affollamento (avviso)
async function testAirWarning() {
  console.log('\n📢 TEST 4: NODO ARIA - AFFOLLAMENTO');
  await sendIngestData('node-air-01', {
    co2Ppm: 950,          // CO2 elevata (>800)
    vocIndex: 120,        // VOC normale
    lux: 200              // Luce ok
  });
}

// Test 5: Nodo Aria - Illuminazione insufficiente
async function testAirLight() {
  console.log('\n💡 TEST 5: NODO ARIA - LUCE INSUFFICIENTE');
  
  // Simula orario di apertura (10:00)
  const dayTime = new Date();
  dayTime.setHours(10, 0, 0, 0);
  
  await sendIngestData('node-air-01', {
    co2Ppm: 600,          // CO2 normale
    vocIndex: 80,         // VOC basso
    lux: 30               // Luce insufficiente (<50)
  });
}

// Test 6: Simulazione simultanea multi-nodo
async function testSimultaneous() {
  console.log('\n🔄 TEST 6: SIMULAZIONE SIMULTANEA MULTI-NODO');
  console.log('Invio dati contemporanei da entrambi i nodi...\n');
  
  // Esegui entrambe le analisi in parallelo
  await Promise.all([
    sendIngestData('node-flow-01', {
      flowLmin: 0.3,
      levelPercent: 70
    }),
    sendIngestData('node-air-01', {
      co2Ppm: 1100,
      vocIndex: 150,
      lux: 250
    })
  ]);
}

// Funzione principale di test
async function runMultiSensorTest() {
  console.log('🚀 Avvio test multi-sensore "Sesto Senso" evoluto...\n');
  
  try {
    await testWaterNormal();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Pausa 1 sec
    
    await testAirWarning();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testWaterLeak();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testAirCritical();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testAirLight();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testSimultaneous();
    
    console.log('\n✅ TEST COMPLETATO CON SUCCESSO!');
    console.log('📱 Controlla la tua chat Telegram per tutte le notifiche inviate');
    console.log('🔍 Chat ID: -5200524561');
    
  } catch (error) {
    console.error('\n❌ Errore durante i test:', error);
  }
}

// Esegui i test
if (require.main === module) {
  runMultiSensorTest();
}

module.exports = {
  runMultiSensorTest,
  sendIngestData,
  testWaterNormal,
  testWaterLeak,
  testAirCritical,
  testAirWarning,
  testAirLight,
  testSimultaneous
};
