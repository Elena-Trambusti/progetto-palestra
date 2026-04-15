const MS_PER_HOUR = 3600000;

function toPoints(readings) {
  return (readings || [])
    .map((r) => {
      const t =
        typeof r.t === "number" && Number.isFinite(r.t)
          ? r.t
          : new Date(r.iso || r.ts || 0).getTime();
      const water = Number(r.water);
      return { t, water };
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.water));
}

/**
 * Regressione lineare w = a + b*t → b in %/ms.
 * @returns {number|null}
 */
function linearSlopeWPerMs(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumT = 0;
  let sumW = 0;
  let sumTT = 0;
  let sumTW = 0;
  for (const p of points) {
    sumT += p.t;
    sumW += p.water;
    sumTT += p.t * p.t;
    sumTW += p.t * p.water;
  }
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sumTW - sumT * sumW) / denom;
}

/**
 * @param {Array<{t?: number, iso?: string, water: number}>} readings
 * @param {number} currentWater
 * @param {object} [opts]
 */
function computeWaterEta(readings, currentWater, opts = {}) {
  const lookbackMs = Number(opts.lookbackMs) || 45 * 60 * 1000;
  const criticalPct = Number(opts.criticalPct) || 20;
  const minSpanMs = Number(opts.minSpanMs) || 2 * 60 * 1000;
  const minPoints = Number(opts.minPoints) || 3;
  const slopeEpsilon = Number(opts.slopeEpsilon) || 1e-6 / MS_PER_HOUR;

  const now = Date.now();
  if (!Number.isFinite(currentWater)) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: null,
    };
  }
  if (currentWater <= criticalPct) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: null,
    };
  }

  const parsed = toPoints(readings).filter(
    (p) => p.t >= now - lookbackMs && p.t <= now
  );
  parsed.sort((a, b) => a.t - b.t);

  const series =
    parsed.length && parsed[parsed.length - 1].t >= now - 5000
      ? [...parsed]
      : [...parsed, { t: now, water: currentWater }];

  if (series.length < minPoints) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: null,
    };
  }

  const t0 = series[0].t;
  const t1 = series[series.length - 1].t;
  if (t1 - t0 < minSpanMs) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: null,
    };
  }

  const shifted = series.map((p) => ({ t: p.t - t0, water: p.water }));
  const slope = linearSlopeWPerMs(shifted);
  if (slope == null || slope >= -slopeEpsilon) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: slope != null ? slope * MS_PER_HOUR : null,
    };
  }

  const hoursTo =
    (currentWater - criticalPct) / (-slope) / MS_PER_HOUR;

  if (!Number.isFinite(hoursTo) || hoursTo <= 0 || hoursTo > 8760) {
    return {
      waterEtaHours: null,
      waterEtaConfidence: null,
      waterDepletionRatePctPerHour: slope * MS_PER_HOUR,
    };
  }

  const spanMin = (t1 - t0) / 60000;
  const n = series.length;
  let confidence = "low";
  if (n >= 10 && spanMin >= 20) confidence = "high";
  else if (n >= 5 && spanMin >= 8) confidence = "medium";

  return {
    waterEtaHours: hoursTo,
    waterEtaConfidence: confidence,
    waterDepletionRatePctPerHour: slope * MS_PER_HOUR,
  };
}

/**
 * Calo rapido: prima lettura nella finestra vs livello attuale.
 */
function detectRapidDrop(readings, currentWater, opts = {}) {
  const windowMs = Number(opts.windowMs) || 10 * 60 * 1000;
  const dropPct = Number(opts.dropPct) || 12;
  const minSpanMs = Number(opts.minSpanMs) || 3 * 60 * 1000;

  const now = Date.now();
  if (!Number.isFinite(currentWater)) {
    return { waterRapidDrop: false, waterRapidDropDelta: null };
  }

  const parsed = toPoints(readings).filter(
    (p) => p.t >= now - windowMs && p.t <= now
  );
  parsed.sort((a, b) => a.t - b.t);
  if (!parsed.length) {
    return { waterRapidDrop: false, waterRapidDropDelta: null };
  }

  const oldest = parsed[0];
  if (now - oldest.t < minSpanMs) {
    return { waterRapidDrop: false, waterRapidDropDelta: null };
  }

  const delta = oldest.water - currentWater;
  return {
    waterRapidDrop: delta >= dropPct,
    waterRapidDropDelta: delta,
  };
}

module.exports = {
  computeWaterEta,
  detectRapidDrop,
  MS_PER_HOUR,
};
