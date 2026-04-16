const test = require("node:test");
const assert = require("node:assert/strict");

const { activeAlarmsForState } = require("./envAlarms");

test("activeAlarmsForState includes process alarms", () => {
  const alarms = activeAlarmsForState({
    lastTemp: 24,
    humidityPct: 45,
    co2Ppm: 700,
    vocIndex: 90,
    water: 10,
    flowLmin: 24,
    lightLux: 40,
    waterRapidDrop: true,
    waterRapidDropDelta: 15,
  });

  const codes = alarms.map((alarm) => alarm.code);
  assert.ok(codes.includes("water_critical"));
  assert.ok(codes.includes("water_rapid_drop"));
  assert.ok(codes.includes("flow_high"));
  assert.ok(codes.includes("light_low"));
});
