/**
 * Catalogo dominio IoT:
 * - zone = punto fisico mostrato in dashboard
 * - nodes = nodo remoto installato sul campo
 * - gateways = ricevitore centrale LoRa
 */
const GATEWAYS = [
  {
    id: "gw-livorno-01",
    name: "Gateway LoRa centrale",
    floor: "T",
    mapX: 50,
    mapY: 50,
    location: "Tetto / centrale tecnica",
    uplink: "LoRa",
    backhaul: "Ethernet",
  },
];

const ZONES = [
  {
    id: "hub-centrale",
    name: "Centrale tecnica · Gateway / UPS",
    floor: "T",
    mapX: 50,
    mapY: 50,
    kind: "gateway",
    primaryNodeId: "gw-livorno-01",
  },
  {
    id: "serbatoio-idrico",
    name: "Serbatoio tecnico · livello / temperatura",
    floor: "-1",
    mapX: 26,
    mapY: 44,
    kind: "water",
    primaryNodeId: "node-water-01",
  },
  {
    id: "spogliatoi-ambientale",
    name: "Spogliatoi · temperatura / umidita / luce",
    floor: "-1",
    mapX: 71,
    mapY: 39,
    kind: "environment",
    primaryNodeId: "node-env-01",
  },
  {
    id: "linea-flusso",
    name: "Linea idrica · portata / pressione",
    floor: "0",
    mapX: 46,
    mapY: 63,
    kind: "flow",
    primaryNodeId: "node-flow-01",
  },
  {
    id: "sala-pesi-aria",
    name: "Sala pesi · qualita aria",
    floor: "1",
    mapX: 24,
    mapY: 56,
    kind: "air-quality",
    primaryNodeId: "node-air-01",
  },
  {
    id: "cardio-luce",
    name: "Cardio · luce / temperatura",
    floor: "1",
    mapX: 78,
    mapY: 48,
    kind: "light-climate",
    primaryNodeId: "node-light-01",
  },
];

const NODES = [
  {
    id: "node-water-01",
    label: "Nodo serbatoio",
    zoneId: "serbatoio-idrico",
    gatewayId: "gw-livorno-01",
    floor: "-1",
    mapX: 26,
    mapY: 44,
    hardware: "ESP32 + LoRa",
    sensors: ["levelPercent", "temperatureC"],
  },
  {
    id: "node-env-01",
    label: "Nodo spogliatoi",
    zoneId: "spogliatoi-ambientale",
    gatewayId: "gw-livorno-01",
    floor: "-1",
    mapX: 71,
    mapY: 39,
    hardware: "STM32 + LoRa",
    sensors: ["temperatureC", "humidityPercent", "lightLux"],
  },
  {
    id: "node-flow-01",
    label: "Nodo flusso linea",
    zoneId: "linea-flusso",
    gatewayId: "gw-livorno-01",
    floor: "0",
    mapX: 46,
    mapY: 63,
    hardware: "ESP32 + LoRa",
    sensors: ["flowLmin", "levelPercent", "temperatureC"],
  },
  {
    id: "node-air-01",
    label: "Nodo qualita aria",
    zoneId: "sala-pesi-aria",
    gatewayId: "gw-livorno-01",
    floor: "1",
    mapX: 24,
    mapY: 56,
    hardware: "ESP32 + LoRa",
    sensors: ["temperatureC", "humidityPercent", "co2Ppm", "vocIndex"],
  },
  {
    id: "node-light-01",
    label: "Nodo cardio",
    zoneId: "cardio-luce",
    gatewayId: "gw-livorno-01",
    floor: "1",
    mapX: 78,
    mapY: 48,
    hardware: "STM32 + LoRa",
    sensors: ["temperatureC", "lightLux", "humidityPercent"],
  },
];

const FLOORS = [
  { id: "T", label: "Tetto / centrale tecnica", planSlug: "t" },
  { id: "-1", label: "Piano -1", planSlug: "m1" },
  { id: "0", label: "Piano terra", planSlug: "0" },
  { id: "1", label: "Piano 1", planSlug: "1" },
  { id: "2", label: "Piano 2", planSlug: "2" },
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

module.exports = {
  GATEWAYS,
  ZONES,
  NODES,
  FLOORS,
  planPathForFloor,
  findZone,
  findNode,
  findNodeByZone,
  findGateway,
};
