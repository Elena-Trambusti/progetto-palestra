import { formatLocalTimeHms } from "../utils/localTime";

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Etichetta asse tempi: preferisce `iso` / `t` UTC dal backend, altrimenti etichetta legacy. */
function chartAxisLabelFromPoint(p) {
  const iso = p.iso ?? p.t ?? null;
  if (iso != null && String(iso).trim() !== "") {
    const formatted = formatLocalTimeHms(iso);
    if (formatted !== "—") return formatted;
  }
  const rawLabel = p.label ?? "";
  const s = String(rawLabel).trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const formatted = formatLocalTimeHms(s);
    if (formatted !== "—") return formatted;
  }
  return s;
}

function parseAlarms(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object")
    .map((a) => ({
      code: String(a.code || ""),
      severity: String(a.severity || "info"),
      message: String(a.message || ""),
      value: a.value != null && Number.isFinite(Number(a.value)) ? Number(a.value) : null,
    }))
    .filter((a) => a.code);
}

function parseNode(node) {
  if (!node || typeof node !== "object") return null;
  return {
    id: String(node.id ?? ""),
    label: String(node.label ?? node.nodeLabel ?? node.id ?? ""),
    zoneId: String(node.zoneId ?? ""),
    zoneName: String(node.zoneName ?? ""),
    gatewayId: String(node.gatewayId ?? ""),
    gatewayName: String(node.gatewayName ?? ""),
    hardware: typeof node.hardware === "string" ? node.hardware : "",
    sensors: Array.isArray(node.sensors) ? node.sensors.map((item) => String(item)) : [],
    floor: node.floor != null ? String(node.floor) : "",
    mapX: num(node.mapX, NaN),
    mapY: num(node.mapY, NaN),
    batteryPercent:
      node.batteryPercent != null && Number.isFinite(Number(node.batteryPercent))
        ? Number(node.batteryPercent)
        : null,
    rssi: node.rssi != null && Number.isFinite(Number(node.rssi)) ? Number(node.rssi) : null,
    snr: node.snr != null && Number.isFinite(Number(node.snr)) ? Number(node.snr) : null,
    uplinkAt: typeof node.uplinkAt === "string" ? node.uplinkAt : null,
    status: typeof node.status === "string" ? node.status : "unknown",
    metrics: node.metrics && typeof node.metrics === "object" ? node.metrics : {},
  };
}

export function normalizeDashboardPayload(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Payload non valido");
  }

  const series =
    data.temperatureSeries ||
    data.series ||
    data.showerTemperature?.points ||
    [];

  const cleanSeries = series
    .map((p) => ({
      label: chartAxisLabelFromPoint(p),
      value: num(p.value, NaN),
    }))
    .filter((p) => !Number.isNaN(p.value));

  const labels = cleanSeries.map((p) => p.label);
  const values = cleanSeries.map((p) => p.value);

  const lastFromSeries = values.length ? values[values.length - 1] : null;
  const lastTempSource =
    data.currentTemperature ?? data.currentTemp ?? lastFromSeries;
  const lastTempRaw =
    lastTempSource == null || lastTempSource === ""
      ? NaN
      : num(lastTempSource, NaN);
  const lastTemp = Number.isFinite(lastTempRaw) ? lastTempRaw : null;

  const waterRaw = data.waterLevelPercent ?? data.waterReservePercent ?? data.water;
  const waterParsed =
    waterRaw === null || waterRaw === undefined || waterRaw === ""
      ? NaN
      : num(waterRaw, NaN);
  const water = Number.isFinite(waterParsed)
    ? Math.max(0, Math.min(100, waterParsed))
    : null;

  const waterEtaRaw = data.waterEtaHours;
  const waterEtaHours =
    waterEtaRaw === null || waterEtaRaw === undefined || waterEtaRaw === ""
      ? null
      : num(waterEtaRaw, NaN);
  const waterEtaConfidence =
    typeof data.waterEtaConfidence === "string" ? data.waterEtaConfidence : null;

  const rateRaw = data.waterDepletionRatePctPerHour;
  const waterDepletionRatePctPerHour =
    rateRaw === null || rateRaw === undefined || rateRaw === ""
      ? null
      : num(rateRaw, NaN);
  const waterRapidDrop = Boolean(data.waterRapidDrop);
  const deltaRaw = data.waterRapidDropDelta;
  const waterRapidDropDelta =
    deltaRaw === null || deltaRaw === undefined || deltaRaw === ""
      ? null
      : num(deltaRaw, NaN);

  const env = data.environment && typeof data.environment === "object" ? data.environment : {};
  const humidityPercent = num(env.humidityPercent ?? env.humidity ?? data.humidityPercent, NaN);
  const co2Ppm = num(env.co2Ppm ?? env.co2 ?? data.co2Ppm, NaN);
  const vocIndex = num(env.vocIndex ?? env.voc ?? data.vocIndex, NaN);
  const lightLux = num(env.lightLux ?? data.lightLux, NaN);
  const flowLmin = num(env.flowLmin ?? data.flowLmin, NaN);

  const siteZones = Array.isArray(data.siteZones) ? data.siteZones : [];
  const floors = Array.isArray(data.floors) ? data.floors : [];
  const sensorCards = Array.isArray(data.sensorCards) ? data.sensorCards : [];
  const dataProfile =
    typeof data.dataProfile === "string" ? data.dataProfile : null;
  const telemetry =
    data.telemetry && typeof data.telemetry === "object" ? data.telemetry : {};
  const network =
    data.network && typeof data.network === "object"
      ? {
          gateway:
            data.network.gateway && typeof data.network.gateway === "object"
              ? data.network.gateway
              : null,
          totals:
            data.network.totals && typeof data.network.totals === "object"
              ? data.network.totals
              : null,
          nodes: Array.isArray(data.network.nodes)
            ? data.network.nodes.map(parseNode).filter(Boolean)
            : [],
        }
      : { gateway: null, totals: null, nodes: [] };

  const rawLogs = data.logLines ?? data.events ?? data.terminal ?? [];
  const logLines = Array.isArray(rawLogs)
    ? rawLogs.map((x) => (typeof x === "string" ? x : String(x.text ?? x.message ?? "")))
    : [];

  const postgresEmptyZone =
    dataProfile === "postgres" && sensorCards.length === 0;

  const safeValues = postgresEmptyZone
    ? []
    : values.length > 0
      ? values
      : lastTemp != null
        ? [lastTemp]
        : [28];

  const chartLabels = postgresEmptyZone ? ["—"] : labels.length ? labels : ["—"];

  const z = data.zone && typeof data.zone === "object" ? data.zone : null;

  return {
    labels: chartLabels,
    values: safeValues,
    lastTemp,
    water,
    waterEtaHours: Number.isFinite(waterEtaHours) ? waterEtaHours : null,
    waterEtaConfidence: waterEtaConfidence || null,
    waterDepletionRatePctPerHour: Number.isFinite(waterDepletionRatePctPerHour)
      ? waterDepletionRatePctPerHour
      : null,
    waterRapidDrop,
    waterRapidDropDelta: Number.isFinite(waterRapidDropDelta)
      ? waterRapidDropDelta
      : null,
    humidityPercent: Number.isFinite(humidityPercent) ? humidityPercent : null,
    co2Ppm: Number.isFinite(co2Ppm) ? co2Ppm : null,
    vocIndex: Number.isFinite(vocIndex) ? vocIndex : null,
    lightLux: Number.isFinite(lightLux) ? lightLux : null,
    flowLmin: Number.isFinite(flowLmin) ? flowLmin : null,
    activeAlarms: parseAlarms(data.activeAlarms),
    siteZones,
    floors,
    logLines: logLines.filter(Boolean),
    facility: data.facility ?? null,
    telemetry: {
      nodeId: String(telemetry.nodeId ?? ""),
      nodeLabel: String(telemetry.nodeLabel ?? telemetry.nodeId ?? ""),
      gatewayId: String(telemetry.gatewayId ?? ""),
      gatewayName: String(telemetry.gatewayName ?? telemetry.gatewayId ?? ""),
      batteryPercent:
        telemetry.batteryPercent != null && Number.isFinite(Number(telemetry.batteryPercent))
          ? Number(telemetry.batteryPercent)
          : null,
      rssi:
        telemetry.rssi != null && Number.isFinite(Number(telemetry.rssi))
          ? Number(telemetry.rssi)
          : null,
      snr:
        telemetry.snr != null && Number.isFinite(Number(telemetry.snr))
          ? Number(telemetry.snr)
          : null,
      uplinkAt: typeof telemetry.uplinkAt === "string" ? telemetry.uplinkAt : null,
      nodeStatus:
        typeof telemetry.nodeStatus === "string" ? telemetry.nodeStatus : "unknown",
      sensors: Array.isArray(telemetry.sensors)
        ? telemetry.sensors.map((item) => String(item))
        : [],
    },
    network,
    zone: z
      ? {
          id: String(z.id ?? ""),
          name: String(z.name ?? z.id ?? ""),
          floor: z.floor != null ? String(z.floor) : "",
          mapX: num(z.mapX, NaN),
          mapY: num(z.mapY, NaN),
          planPath:
            typeof z.planPath === "string" && z.planPath
              ? z.planPath
              : null,
        }
      : null,
    sensorCards,
    dataProfile,
  };
}
