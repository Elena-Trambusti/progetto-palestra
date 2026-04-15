import { normalizeDashboardPayload } from "./sensorNormalize";

describe("normalizeDashboardPayload", () => {
  it("keeps labels and values aligned after filtering invalid points", () => {
    const out = normalizeDashboardPayload({
      temperatureSeries: [
        { label: "10:00:00", value: 24.3 },
        { label: "10:00:02", value: "invalid" },
        { label: "10:00:04", value: 24.8 },
      ],
      currentTemperature: 24.8,
      waterLevelPercent: 51,
      environment: { humidityPercent: 44, co2Ppm: 700, vocIndex: 90 },
    });

    expect(out.labels).toEqual(["10:00:00", "10:00:04"]);
    expect(out.values).toEqual([24.3, 24.8]);
    expect(out.labels).toHaveLength(out.values.length);
  });

  it("falls back to sane defaults for missing series", () => {
    const out = normalizeDashboardPayload({
      waterLevelPercent: 12,
      activeAlarms: [{ code: "co2_high", severity: "critical", message: "x" }],
    });

    expect(out.labels).toEqual(["—"]);
    expect(out.values).toEqual([0]);
    expect(out.water).toBe(12);
    expect(out.activeAlarms).toHaveLength(1);
  });
});
