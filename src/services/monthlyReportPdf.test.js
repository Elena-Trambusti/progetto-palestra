/* eslint-disable import/first -- jest.mock deve precedere il modulo che importa jspdf */
jest.mock("jspdf", () => ({
  jsPDF: jest.fn().mockImplementation(() => ({ save: jest.fn() })),
}));
jest.mock("jspdf-autotable", () => jest.fn());

import {
  resolveReportPeriod,
  collectDbThresholdAnomalies,
  buildEmptySensorCoverageRows,
} from "./monthlyReportPdf";

describe("resolveReportPeriod", () => {
  test("uses both dates when provided", () => {
    const r = resolveReportPeriod("2026-03-01T00:00:00.000Z", "2026-03-15T12:00:00.000Z");
    expect(r.fromIso).toBe("2026-03-01T00:00:00.000Z");
    expect(r.toIso).toBe("2026-03-15T12:00:00.000Z");
  });

  test("only From: To is ISO now or later than From", () => {
    const r = resolveReportPeriod("2026-01-01T00:00:00.000Z", "");
    expect(r.fromIso).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(r.toIso).getTime()).toBeGreaterThanOrEqual(new Date(r.fromIso).getTime());
  });

  test("only To: From is first day of current local month", () => {
    const to = "2026-06-15T18:00:00.000Z";
    const r = resolveReportPeriod("", to);
    expect(r.toIso).toBe(to);
    const from = new Date(r.fromIso);
    expect(from.getDate()).toBe(1);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
  });
});

describe("collectDbThresholdAnomalies", () => {
  test("flags value above max", () => {
    const rows = collectDbThresholdAnomalies([
      {
        iso: "2026-01-01T12:00:00.000Z",
        sensorName: "T1",
        value: 30,
        minThreshold: 18,
        maxThreshold: 28,
      },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].message).toMatch(/Anomalia/);
    expect(rows[0].message).toMatch(/sopra soglia max/);
  });

  test("skips when no thresholds configured", () => {
    const rows = collectDbThresholdAnomalies([
      { iso: "2026-01-01T12:00:00.000Z", sensorName: "T1", value: 99, minThreshold: null, maxThreshold: null },
    ]);
    expect(rows.length).toBe(0);
  });
});

describe("buildEmptySensorCoverageRows", () => {
  test("lists catalog sensors without samples", () => {
    const rows = buildEmptySensorCoverageRows([], [
      { devEui: "0011223344556677", name: "Alpha" },
      { devEui: "AABBCCDDEEFF0011", name: "Beta" },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0][2]).toMatch(/Nessuna lettura/);
  });

  test("excludes sensors that have readings", () => {
    const rows = buildEmptySensorCoverageRows(
      [{ iso: "2026-01-01T12:00:00.000Z", devEui: "0011223344556677", value: 20 }],
      [{ devEui: "0011223344556677", name: "Alpha" }]
    );
    expect(rows.length).toBe(0);
  });
});
