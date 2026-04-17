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

  it("formats chart axis labels from ISO UTC using browser local time", () => {
    const iso = "2026-06-01T15:30:00.000Z";
    const out = normalizeDashboardPayload({
      temperatureSeries: [{ iso, value: 22.1 }],
      waterLevelPercent: 50,
    });
    const want = new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    expect(out.labels).toEqual([want]);
    expect(out.values).toEqual([22.1]);
  });

  it("falls back to sane defaults for missing series", () => {
    const out = normalizeDashboardPayload({
      waterLevelPercent: 12,
      activeAlarms: [{ code: "co2_high", severity: "critical", message: "x" }],
    });

    expect(out.labels).toEqual(["—"]);
    expect(out.values).toEqual([28]);
    expect(out.water).toBe(12);
    expect(out.activeAlarms).toHaveLength(1);
  });

  it("normalizes telemetry and network nodes", () => {
    const out = normalizeDashboardPayload({
      currentTemperature: 25.1,
      waterLevelPercent: 44,
      telemetry: {
        nodeId: "node-air-01",
        nodeLabel: "Nodo qualita aria",
        gatewayId: "gw-livorno-01",
        batteryPercent: 83,
        rssi: -111,
        snr: 6.5,
        uplinkAt: "2026-04-15T19:30:00.000Z",
        nodeStatus: "online",
        sensors: ["temperatureC", "co2Ppm"],
      },
      network: {
        totals: { nodes: 5, online: 4, stale: 1, offline: 0 },
        nodes: [
          {
            id: "node-air-01",
            label: "Nodo qualita aria",
            zoneId: "sala-pesi-aria",
            gatewayId: "gw-livorno-01",
            batteryPercent: 83,
            rssi: -111,
            snr: 6.5,
            uplinkAt: "2026-04-15T19:30:00.000Z",
            status: "online",
          },
        ],
      },
    });

    expect(out.telemetry.nodeId).toBe("node-air-01");
    expect(out.telemetry.batteryPercent).toBe(83);
    expect(out.network.totals.online).toBe(4);
    expect(out.network.nodes[0].status).toBe("online");
  });
});
