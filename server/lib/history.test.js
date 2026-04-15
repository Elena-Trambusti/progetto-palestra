const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

const {
  appendReading,
  readZoneSeries,
  readZoneHistoryPoints,
  readZoneWaterSamples,
} = require("./history");

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "palestra-history-"));
}

test("appendReading updates in-memory history readers", async () => {
  const dataDir = mkTempDir();
  appendReading(dataDir, { zoneId: "z1", temp: 25, water: 80, humidityPct: 40 });
  appendReading(dataDir, { zoneId: "z1", temp: 26, water: 78, humidityPct: 42 });
  await new Promise((r) => setTimeout(r, 25));

  const series = readZoneSeries(dataDir, "z1", 10);
  assert.equal(series.length, 2);
  assert.equal(series[1].value, 26);

  const points = readZoneHistoryPoints(dataDir, "z1", 10);
  assert.equal(points.length, 2);
  assert.equal(points[0].water, 80);

  const water = readZoneWaterSamples(dataDir, "z1", 10);
  assert.equal(water.length, 2);
  assert.equal(water[1].water, 78);
});
