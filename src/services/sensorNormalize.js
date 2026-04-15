function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
      label: String(p.label ?? p.t ?? ""),
      value: num(p.value, NaN),
    }))
    .filter((p) => !Number.isNaN(p.value));

  const labels = cleanSeries.map((p) => p.label);
  const values = cleanSeries.map((p) => p.value);

  const lastFromSeries = values.length ? values[values.length - 1] : null;
  const lastTempRaw = num(
    data.currentTemperature ?? data.currentTemp ?? lastFromSeries,
    NaN
  );
  const lastTemp = Number.isFinite(lastTempRaw) ? lastTempRaw : null;

  const water = num(data.waterLevelPercent ?? data.waterReservePercent ?? data.water, 0);

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

  const siteZones = Array.isArray(data.siteZones) ? data.siteZones : [];
  const floors = Array.isArray(data.floors) ? data.floors : [];

  const rawLogs = data.logLines ?? data.events ?? data.terminal ?? [];
  const logLines = Array.isArray(rawLogs)
    ? rawLogs.map((x) => (typeof x === "string" ? x : String(x.text ?? x.message ?? "")))
    : [];

  const safeValues =
    values.length > 0
      ? values
      : lastTemp != null
        ? [lastTemp]
        : [28];

  const z = data.zone && typeof data.zone === "object" ? data.zone : null;

  return {
    labels: labels.length ? labels : ["—"],
    values: safeValues,
    lastTemp,
    water: Math.max(0, Math.min(100, water)),
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
    activeAlarms: parseAlarms(data.activeAlarms),
    siteZones,
    floors,
    logLines: logLines.filter(Boolean),
    facility: data.facility ?? null,
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
  };
}
