/**
 * Catalogo dominio IoT:
 * - zone = punto fisico mostrato in dashboard
 * - nodes = nodo remoto installato sul campo
 * - gateways = ricevitore centrale LoRa
 */
let GATEWAYS = [
  {
    id: "gw-livorno-01",
    name: "Gateway LoRa centrale",
    floor: "2",
    mapX: 50,
    mapY: 50,
    location: "Tetto",
    uplink: "LoRa",
    backhaul: "Ethernet",
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
    primaryNodeId: "node-tech-01",
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
    hardware: "ESP32 + LoRa",
    sensors: ["flowLmin", "levelPercent", "temperatureC"],
  },
  {
    id: "node-env-01",
    label: "Nodo Palestra",
    zoneId: "palestra",
    gatewayId: "gw-livorno-01",
    floor: "1",
    mapX: 50,
    mapY: 50,
    hardware: "STM32 + LoRa",
    sensors: ["temperatureC", "co2Ppm", "vocIndex"],
  },
  {
    id: "node-tech-01",
    label: "Nodo Controsoffitti",
    zoneId: "controsoffitti",
    gatewayId: "gw-livorno-01",
    floor: "1",
    mapX: 50,
    mapY: 20,
    hardware: "ESP32 + LoRa",
    sensors: ["water_level_mm", "battery", "rssi"],
  },
];

let FLOORS = [
  { id: "0", label: "Piano 0 (Vano Idrico)", planSlug: "0" },
  { id: "1", label: "Piano 1 (Palestra)", planSlug: "1" },
  { id: "2", label: "Piano 2 (Tetto)", planSlug: "2" },
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
