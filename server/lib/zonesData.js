/**
 * Catalogo dominio IoT:
 * - zone = punto fisico mostrato in dashboard
 * - nodes = nodo remoto installato sul campo
 * - gateways = ricevitore centrale LoRa
 */
let GATEWAYS = [
  {
    id: "gw-livorno-01",
    name: "Ebyte E870 – Gateway LoRaWAN Industriale",
    model: "Ebyte E870",
    chip: "SX1302",
    floor: "1",          // Piano 1 – posizione definitiva
    mapX: 50,
    mapY: 15,
    location: "Piano 1 – Locale Tecnico",
    uplink: "LoRaWAN EU868 (Classe A)",
    backhaul: "Ethernet (RJ45)",
    networkServer: "TTN (The Things Network v3)",
    antennaDb: 3,        // dBi antenna inclusa
  },
];

let ZONES = [
  {
    id: "vano-idrico",
    name: "Vano Idrico",
    floor: "0",
    mapX: 20,
    mapY: 20,
    kind: "water",
    primaryNodeId: "node-water-01",
  },
  {
    id: "palestra",
    name: "Palestra",
    floor: "1",
    mapX: 50,
    mapY: 50,
    kind: "environment",
    primaryNodeId: "node-env-01",
  },
  {
    id: "controsoffitti",
    name: "Controsoffitti Palestra",
    floor: "1",
    mapX: 50,
    mapY: 20,
    kind: "technical",
    primaryNodeId: "",
  },
  {
    id: "tetto",
    name: "Tetto",
    floor: "2",
    mapX: 50,
    mapY: 50,
    kind: "gateway",
    primaryNodeId: "gw-livorno-01",
  },
];

let NODES = [
  {
    id: "node-water-01",
    label: "Nodo Vano Idrico",
    zoneId: "vano-idrico",
    gatewayId: "gw-livorno-01",
    floor: "0",
    mapX: 20,
    mapY: 20,
    hardware: "Arduino MKR WAN 1310",      // Hardware definitivo
    module: "CMWX1ZZABZ-093 (Murata)",     // Modulo LoRa integrato
    sensors: ["flowLmin", "levelPercent", "temperatureC"],
    sensorHardware: {
      flow:  "YF-S201 (Flussostato a effetto Hall)",  // Interrupt su D4
      level: "HC-SR04 (Ultrasuoni)  ",
      temp:  "NTC 10k (integrata flussostato)",
    },
    protocol: "LoRaWAN Classe A / EU868",
    payloadFormat: "HEX compresso 8 byte",
    wakeSource: "Interrupt hardware (flusso) o timer 15 min",
  },
  {
    id: "node-env-01",
    label: "Nodo Palestra – Qualità Aria",
    zoneId: "palestra",
    gatewayId: "gw-livorno-01",
    floor: "1",
    mapX: 50,
    mapY: 50,
    hardware: "Arduino MKR WAN 1310",      // Hardware definitivo
    module: "CMWX1ZZABZ-093 (Murata)",
    sensors: ["temperatureC", "humidityPercent", "co2Ppm"],
    sensorHardware: {
      co2:      "Sensirion SCD41 (CO2 + T + RH, I2C)",  // SDA=A4 SCL=A5
      backup_t: "Inclusa in SCD41",
    },
    protocol: "LoRaWAN Classe A / EU868",
    payloadFormat: "HEX compresso 7 byte",
    wakeSource: "Timer 15 min (Deep Sleep LowPower)",
  },
];

let FLOORS = [
  { id: "0", label: "Piano 0 – Vano Idrico / Locale Tecnico", planSlug: "0" },
  { id: "1", label: "Piano 1 – Palestra (Gateway Ebyte E870)", planSlug: "1" },
  { id: "2", label: "Piano 2 – Tetto / Zona Tecnica", planSlug: "2" },
];

function planPathForFloor(floorId) {
  const f = FLOORS.find((x) => x.id === floorId);
  const slug = f ? f.planSlug : "0";
  return `/plans/piano-${slug}.svg`;
}

function findZone(zoneId) {
  return ZONES.find((z) => z.id === zoneId) || null;
}

function findNode(nodeId) {
  return NODES.find((n) => n.id === nodeId) || null;
}

function findNodeByZone(zoneId) {
  return NODES.find((n) => n.zoneId === zoneId) || null;
}

function findGateway(gatewayId) {
  return GATEWAYS.find((g) => g.id === gatewayId) || null;
}

function updateTopology(data) {
  if (data.gateways) GATEWAYS = data.gateways;
  if (data.zones) ZONES = data.zones;
  if (data.nodes) NODES = data.nodes;
  if (data.floors) FLOORS = data.floors;
  console.log(`[zonesData] Topology aggiornata dinamicamente: ${ZONES.length} zone, ${NODES.length} nodi`);
}

module.exports = {
  get GATEWAYS() { return GATEWAYS; },
  get ZONES() { return ZONES; },
  get NODES() { return NODES; },
  get FLOORS() { return FLOORS; },
  planPathForFloor,
  findZone,
  findNode,
  findNodeByZone,
  findGateway,
  updateTopology,
};
