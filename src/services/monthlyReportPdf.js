/**
 * Report PDF: periodo flessibile, medie, anomalie da min/max anagrafica PostgreSQL,
 * eventi rete, elenco sensori senza letture nel periodo.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatLocalDateTimeShort } from "../utils/localTime";

function meanOf(nums) {
  const xs = (nums || []).filter((n) => Number.isFinite(Number(n))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmtMean(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number(v).toFixed(decimals);
}

/**
 * Calcolo periodo report (stesso intervallo usato per le chiamate API).
 * - Entrambe le date: intervallo esplicito
 * - Solo "Da": da quella data a oggi
 * - Solo "A": dal 1° del mese di calendario corrente (ora locale) alla data "A"
 * - Nessuna data: mese solare precedente (UTC) come default
 */
export function resolveReportPeriod(fromUser, toUser) {
  const from = String(fromUser || "").trim();
  const to = String(toUser || "").trim();
  if (from && to) {
    return {
      fromIso: from,
      toIso: to,
      label: "Periodo personalizzato (Da / A)",
    };
  }
  if (from && !to) {
    return {
      fromIso: from,
      toIso: new Date().toISOString(),
      label: "Da data indicata fino a oggi",
    };
  }
  if (!from && to) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      fromIso: start.toISOString(),
      toIso: to,
      label: "Dal 1° giorno del mese corrente alla data fine (ora locale)",
    };
  }
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prevStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const prevEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return {
    fromIso: prevStart.toISOString(),
    toIso: prevEnd.toISOString(),
    label: "Nessuna data selezionata — mese solare precedente (UTC)",
  };
}

function inTimeRange(iso, fromMs, toMs) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

export function filterSamplesByPeriod(samples, fromIso, toIso) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return samples || [];
  return (samples || []).filter((s) => s && s.iso && inTimeRange(s.iso, fromMs, toMs));
}

/** Valore misurato confrontabile con min/max anagrafica (stesso campo `value` del DB). */
function numericMeasuredValue(r) {
  if (r.value != null && Number.isFinite(Number(r.value))) return Number(r.value);
  if (r.temp != null && Number.isFinite(Number(r.temp))) return Number(r.temp);
  return null;
}

function hasConfiguredThreshold(minT, maxT) {
  const hasMin = minT != null && Number.isFinite(Number(minT));
  const hasMax = maxT != null && Number.isFinite(Number(maxT));
  return hasMin || hasMax;
}

/**
 * Anomalie vs min_threshold / max_threshold sulle righe campione (PostgreSQL).
 */
export function collectDbThresholdAnomalies(samples, maxRows = 220) {
  const out = [];
  for (const r of samples || []) {
    if (out.length >= maxRows) break;
    const v = numericMeasuredValue(r);
    if (v == null) continue;
    const minT = r.minThreshold;
    const maxT = r.maxThreshold;
    if (!hasConfiguredThreshold(minT, maxT)) continue;
    const name = r.sensorName ? String(r.sensorName) : String(r.devEui || "Sensore");
    const iso = r.iso;
    let kind = null;
    if (minT != null && Number.isFinite(Number(minT)) && v < Number(minT)) kind = "min";
    if (maxT != null && Number.isFinite(Number(maxT)) && v > Number(maxT)) kind = "max";
    if (!kind) continue;
    const minStr = minT != null && Number.isFinite(Number(minT)) ? String(minT) : "—";
    const maxStr = maxT != null && Number.isFinite(Number(maxT)) ? String(maxT) : "—";
    const msg =
      kind === "min"
        ? `Anomalia: ${name} valore ${fmtMean(v)} sotto soglia min (${minStr}); max configurato ${maxStr}`
        : `Anomalia: ${name} valore ${fmtMean(v)} sopra soglia max (${maxStr}); min configurato ${minStr}`;
    out.push({ iso, severity: "warning", message: msg, source: "anagrafica" });
  }
  return out;
}

/** Righe tabella: sensori in anagrafica zona senza alcuna lettura nel periodo (per DevEUI). */
export function buildEmptySensorCoverageRows(samples, sensorsCatalog) {
  const seen = new Set();
  for (const s of samples || []) {
    const id = String(s.devEui || "").trim().toUpperCase();
    if (id) seen.add(id);
  }
  const rows = [];
  for (const s of sensorsCatalog || []) {
    const id = String(s.devEui || "").trim().toUpperCase();
    if (!id || seen.has(id)) continue;
    rows.push([
      String(s.name || id),
      id,
      "Nessuna lettura disponibile per questo periodo.",
    ]);
  }
  return rows;
}

/** Aggrega medie da righe mock (tutte le grandezze) o PostgreSQL (per tipo sensore). */
export function computeSummaryRows(samples) {
  const temps = [];
  const waters = [];
  const hums = [];
  const co2s = [];
  const vocs = [];
  const lights = [];
  const flows = [];

  for (const r of samples || []) {
    const ty = String(r.sensorType || "").toLowerCase();
    const val = r.value != null && Number.isFinite(Number(r.value)) ? Number(r.value) : null;

    if (r.temp != null && Number.isFinite(Number(r.temp))) {
      temps.push(Number(r.temp));
    } else if ((ty.includes("temp") || ty.includes("temperatura")) && val != null) {
      temps.push(val);
    }

    if (r.water != null && Number.isFinite(Number(r.water))) {
      waters.push(Number(r.water));
    } else if ((ty.includes("livello") || ty.includes("acqua") || ty.includes("water")) && val != null) {
      waters.push(val);
    }

    if (r.humidity != null && Number.isFinite(Number(r.humidity))) {
      hums.push(Number(r.humidity));
    } else if ((ty.includes("umid") || ty.includes("humid") || ty === "rh") && val != null) {
      hums.push(val);
    }

    if (r.co2 != null && Number.isFinite(Number(r.co2))) {
      co2s.push(Number(r.co2));
    } else if (ty.includes("co2") && val != null) {
      co2s.push(val);
    }

    if (r.voc != null && Number.isFinite(Number(r.voc))) {
      vocs.push(Number(r.voc));
    } else if ((ty.includes("voc") || ty.includes("iaq")) && val != null) {
      vocs.push(val);
    }

    if (r.lightLux != null && Number.isFinite(Number(r.lightLux))) {
      lights.push(Number(r.lightLux));
    } else if ((ty.includes("lux") || ty.includes("luce")) && val != null) {
      lights.push(val);
    }

    if (r.flowLmin != null && Number.isFinite(Number(r.flowLmin))) {
      flows.push(Number(r.flowLmin));
    } else if ((ty.includes("fluss") || ty.includes("flow")) && val != null) {
      flows.push(val);
    }
  }

  const rows = [];
  const mT = meanOf(temps);
  if (mT != null) rows.push(["Temperatura", fmtMean(mT), "°C", String(temps.length)]);
  const mW = meanOf(waters);
  if (mW != null) rows.push(["Livello acqua / serbatoio", fmtMean(mW), "%", String(waters.length)]);
  const mH = meanOf(hums);
  if (mH != null) rows.push(["Umidita relativa", fmtMean(mH, 0), "%", String(hums.length)]);
  const mC = meanOf(co2s);
  if (mC != null) rows.push(["CO2", fmtMean(mC, 0), "ppm", String(co2s.length)]);
  const mV = meanOf(vocs);
  if (mV != null) rows.push(["VOC / IAQ", fmtMean(mV, 0), "indice", String(vocs.length)]);
  const mL = meanOf(lights);
  if (mL != null) rows.push(["Luce", fmtMean(mL, 0), "lux", String(lights.length)]);
  const mF = meanOf(flows);
  if (mF != null) rows.push(["Flusso", fmtMean(mF, 2), "L/min", String(flows.length)]);

  return rows;
}

function pushCap(arr, max, item) {
  if (arr.length >= max) return;
  arr.push(item);
}

/** Eventi di rete (nodo offline, uplink in ritardo, ecc.) nel periodo e zona. */
export function filterNetworkAlarmEvents(events, zoneId, fromIso, toIso) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];
  return (events || []).filter((e) => {
    if (!e || !e.iso) return false;
    if (!inTimeRange(e.iso, fromMs, toMs)) return false;
    if (zoneId && e.zoneId && String(e.zoneId) !== String(zoneId)) return false;
    const sev = String(e.severity || "").toLowerCase();
    if (sev === "critical" || sev === "warning" || sev === "error") return true;
    return false;
  });
}

function mergeAndSortEvents(networkList, anomalyList, maxTotal = 240) {
  const merged = [];
  for (const e of networkList || []) {
    pushCap(merged, maxTotal, {
      iso: e.iso,
      severity: e.severity || "info",
      message: e.message || e.type || "Evento",
      source: "rete",
    });
  }
  for (const e of anomalyList || []) {
    pushCap(merged, maxTotal, {
      iso: e.iso,
      severity: e.severity,
      message: e.message,
      source: e.source || "anagrafica",
    });
  }
  merged.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  return merged;
}

function originLabel(source) {
  if (source === "rete") return "Rete";
  if (source === "anagrafica") return "Anagrafica";
  return String(source || "");
}

/**
 * @param {{ zoneId: string, zoneLabel: string, period: object, samples: any[], networkEvents?: any[], sensorsCatalog?: any[] }} opts
 */
export function generateMonthlyReportPdf(opts) {
  const {
    zoneId,
    zoneLabel,
    period,
    samples: rawSamples,
    networkEvents = [],
    sensorsCatalog = [],
  } = opts;

  const samples = filterSamplesByPeriod(rawSamples, period.fromIso, period.toIso);
  const summaryBody = computeSummaryRows(samples);
  const netAlarms = filterNetworkAlarmEvents(networkEvents, zoneId, period.fromIso, period.toIso);
  const dbAnomalies = collectDbThresholdAnomalies(samples);
  const alarmRows = mergeAndSortEvents(netAlarms, dbAnomalies);
  const emptySensorRows = buildEmptySensorCoverageRows(samples, sensorsCatalog);

  const generatedAt = new Date();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(248, 250, 252);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Centrale Supervisione IoT - Livorno", margin, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Zona: ${zoneLabel || zoneId || "—"}`, margin, 19);
  doc.text(`Documento generato: ${formatLocalDateTimeShort(generatedAt)}`, margin, 24);

  y = 34;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Report storico sensori", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`${period.label}`, margin, y);
  y += 4;
  doc.text(`Da: ${formatLocalDateTimeShort(period.fromIso)}  |  A: ${formatLocalDateTimeShort(period.toIso)}`, margin, y);
  y += 6;
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);
  doc.text(
    "Medie sui campioni disponibili nel periodo (massimo ~4000 punti per richiesta). Le anomalie usano min/max configurati sul database per ogni sensore.",
    margin,
    y,
    { maxWidth: pageW - 2 * margin }
  );
  y += 10;

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Valori medi nel periodo", margin, y);
  y += 2;

  if (summaryBody.length) {
    autoTable(doc, {
      startY: y,
      head: [["Grandezza", "Media", "Unita", "N. campioni"]],
      body: summaryBody,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 138], textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 8;
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(
      "Nessun dato numerico nel periodo selezionato (nessuna lettura nei campioni recuperati).",
      margin,
      y + 4,
      { maxWidth: pageW - 2 * margin }
    );
    y += 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Sensori della zona senza letture nel periodo", margin, y);
  y += 2;

  if (emptySensorRows.length) {
    autoTable(doc, {
      startY: y,
      head: [["Sensore", "DevEUI", "Nota"]],
      body: emptySensorRows,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 8;
  } else if ((sensorsCatalog || []).length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      "Tutti i sensori registrati in anagrafica per questa zona hanno almeno una lettura nel periodo (nei campioni recuperati).",
      margin,
      y + 4,
      { maxWidth: pageW - 2 * margin }
    );
    y += 12;
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(
      "Catalogo sensori zona non disponibile (modalità senza PostgreSQL / dati locali): non e possibile elencare i sensori senza letture.",
      margin,
      y + 4,
      { maxWidth: pageW - 2 * margin }
    );
    y += 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Anomalie (soglie DB) ed eventi di rete", margin, y);
  y += 2;

  const alarmTableBody = alarmRows.length
    ? alarmRows.map((a) => [
        formatLocalDateTimeShort(a.iso),
        String(a.severity || ""),
        String(a.message || "").replace(/\u00b0/g, " deg "),
        originLabel(a.source),
      ])
    : [
        [
          "—",
          "—",
          "Nessuna anomalia rispetto alle soglie min/max salvate sul database per i sensori con soglie impostate; nessun evento di rete nel periodo.",
          "—",
        ],
      ];

  autoTable(doc, {
    startY: y,
    head: [["Data/ora (locale)", "Severita", "Descrizione", "Origine"]],
    body: alarmTableBody,
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 18 },
      3: { cellWidth: 22 },
    },
    margin: { left: margin, right: margin },
  });

  const safeZone = String(zoneId || "zona").replace(/[^\w-]+/g, "_").slice(0, 40);
  const fn = `report-livorno-${safeZone}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fn);
}
