/**
 * Zone operative + coordinate % sulla planimetria del piano (0–100).
 * `floor` deve combaciare con un id in FLOORS.
 */
const ZONES = [
  {
    id: "hub-centrale",
    name: "Centrale tecnica · UPS",
    floor: "T",
    mapX: 50,
    mapY: 50,
  },
  {
    id: "docce-p1",
    name: "Docce · Spogliatoi piano -1",
    floor: "-1",
    mapX: 28,
    mapY: 42,
  },
  {
    id: "docce-p2",
    name: "Docce · Area corsi piano 2",
    floor: "2",
    mapX: 72,
    mapY: 38,
  },
  {
    id: "pesi-nord",
    name: "Sala pesi · Ala nord",
    floor: "1",
    mapX: 22,
    mapY: 55,
  },
  {
    id: "cardio",
    name: "Cardio · Panoramica",
    floor: "1",
    mapX: 78,
    mapY: 48,
  },
  {
    id: "wellness",
    name: "Wellness · Vasche tecniche",
    floor: "0",
    mapX: 48,
    mapY: 62,
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

module.exports = { ZONES, FLOORS, planPathForFloor };
