/** Allineato a `server/lib/zonesData.js` (slug planimetrie in /public/plans/) */
export function planPathForFloorId(floorId) {
  const map = {
    T: "t",
    "-1": "m1",
    0: "0",
    1: "1",
    2: "2",
  };
  const slug = map[floorId] != null ? map[floorId] : String(floorId);
  return `/plans/piano-${slug}.svg`;
}

export const MOCK_FLOORS = [
  { id: "T", label: "Tetto / centrale tecnica" },
  { id: "-1", label: "Piano -1" },
  { id: "0", label: "Piano terra" },
  { id: "1", label: "Piano 1" },
  { id: "2", label: "Piano 2" },
];
