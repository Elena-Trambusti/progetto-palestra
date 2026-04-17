/**
 * Report PDF mensile / di periodo: intestazione, medie da campioni storici,
 * elenco allarmi (eventi rete + superamenti soglie default allineate a env server ALARM_*).
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatLocalDateTimeShort } from "../utils/localTime";

/** Default coerenti con `server/lib/envAlarms.js` (prefisso ALARM_). */
const DEFAULT_THRESHOLDS = {
  tempHighC: 32,
  tempLowC: 17,
  humidityHighPct: 72,
  humidityLowPct: 28,
  co2HighPpm: 1000,
  vocHigh: 350,
  waterLowPct: 25,
  waterCriticalPct: 12,
};

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
 * Periodo report: se l'utente ha indicato Da e A validi, li usa; altrimenti mese solare precedente (UTC).
 */
export function resolveReportPeriod(fromUser, toUser) {
  const from = String(fromUser || "").trim();
  const to = String(toUser || "").trim();
  if (from && to) {
    return { fromIso: from, toIso: to, label: "Periodo selezionato (Da / A)" };
  }
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prevStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const prevEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return {
    fromIso: prevStart.toISOString(),
    toIso: prevEnd.toISOString(),
    label: "Mese solare precedente (UTC)",
  };
}

function inTimeRange(iso, fromMs, toMs) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

function filterSamplesByPeriod(samples, fromIso, toIso) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return samples || [];
  return (samples || []).filter((s) => s && s.iso && inTimeRange(s.iso, fromMs, toMs));
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

/** Superamenti soglie sui campioni (stesse soglie di default del gateway). */
export function collectThresholdAlarmsFromSamples(samples, maxRows = 180) {
  const T = DEFAULT_THRESHOLDS;
  const out = [];
  for (const r of samples || []) {
    if (out.length >= maxRows) break;
    const iso = r.iso;
    if (!iso) continue;
    const ty = String(r.sensorType || "").toLowerCase();
    const name = r.sensorName ? String(r.sensorName) : "Sensore";

    if (r.temp != null && Number.isFinite(Number(r.temp))) {
      const v = Number(r.temp);
      if (v >= T.tempHighC) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `Temp. ${v.toFixed(1)} °C >= soglia alta (${T.tempHighC} °C)`,
        });
      }
      if (v <= T.tempLowC) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `Temp. ${v.toFixed(1)} °C <= soglia bassa (${T.tempLowC} °C)`,
        });
      }
    } else if ((ty.includes("temp") || ty.includes("temperatura")) && r.value != null) {
      const v = Number(r.value);
      if (Number.isFinite(v) && v >= T.tempHighC) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `${name}: ${v.toFixed(1)} °C >= soglia alta (${T.tempHighC} °C)`,
        });
      }
      if (Number.isFinite(v) && v <= T.tempLowC) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `${name}: ${v.toFixed(1)} °C <= soglia bassa (${T.tempLowC} °C)`,
        });
      }
    }

    if (r.humidity != null && Number.isFinite(Number(r.humidity))) {
      const h = Number(r.humidity);
      if (h >= T.humidityHighPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "info",
          message: `Umidita ${Math.round(h)}% >= ${T.humidityHighPct}%`,
        });
      }
      if (h <= T.humidityLowPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "info",
          message: `Umidita ${Math.round(h)}% <= ${T.humidityLowPct}%`,
        });
      }
    } else if ((ty.includes("umid") || ty.includes("humid") || ty === "rh") && r.value != null) {
      const h = Number(r.value);
      if (Number.isFinite(h) && h >= T.humidityHighPct) {
        pushCap(out, maxRows, { iso, severity: "info", message: `${name}: RH ${Math.round(h)}% >= ${T.humidityHighPct}%` });
      }
      if (Number.isFinite(h) && h <= T.humidityLowPct) {
        pushCap(out, maxRows, { iso, severity: "info", message: `${name}: RH ${Math.round(h)}% <= ${T.humidityLowPct}%` });
      }
    }

    if (r.co2 != null && Number.isFinite(Number(r.co2))) {
      const c = Number(r.co2);
      if (c >= T.co2HighPpm) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `CO2 ${Math.round(c)} ppm >= ${T.co2HighPpm} ppm`,
        });
      }
    } else if (ty.includes("co2") && r.value != null) {
      const c = Number(r.value);
      if (Number.isFinite(c) && c >= T.co2HighPpm) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `${name}: CO2 ${Math.round(c)} ppm >= ${T.co2HighPpm} ppm`,
        });
      }
    }

    if (r.voc != null && Number.isFinite(Number(r.voc))) {
      const v = Number(r.voc);
      if (v >= T.vocHigh) {
        pushCap(out, maxRows, { iso, severity: "info", message: `VOC ${Math.round(v)} >= ${T.vocHigh}` });
      }
    } else if ((ty.includes("voc") || ty.includes("iaq")) && r.value != null) {
      const v = Number(r.value);
      if (Number.isFinite(v) && v >= T.vocHigh) {
        pushCap(out, maxRows, { iso, severity: "info", message: `${name}: VOC ${Math.round(v)} >= ${T.vocHigh}` });
      }
    }

    if (r.water != null && Number.isFinite(Number(r.water))) {
      const w = Number(r.water);
      if (w <= T.waterCriticalPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "critical",
          message: `Livello acqua ${w.toFixed(0)}% <= critico (${T.waterCriticalPct}%)`,
        });
      } else if (w <= T.waterLowPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `Livello acqua ${w.toFixed(0)}% <= soglia bassa (${T.waterLowPct}%)`,
        });
      }
    } else if ((ty.includes("livello") || ty.includes("acqua") || ty.includes("water")) && r.value != null) {
      const w = Number(r.value);
      if (Number.isFinite(w) && w <= T.waterCriticalPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "critical",
          message: `${name}: livello ${w.toFixed(0)}% <= critico (${T.waterCriticalPct}%)`,
        });
      } else if (Number.isFinite(w) && w <= T.waterLowPct) {
        pushCap(out, maxRows, {
          iso,
          severity: "warning",
          message: `${name}: livello ${w.toFixed(0)}% <= soglia (${T.waterLowPct}%)`,
        });
      }
    }
  }
  return out;
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

function mergeAndSortAlarms(networkList, thresholdList, maxTotal = 220) {
  const merged = [];
  for (const e of networkList || []) {
    pushCap(merged, maxTotal, {
      iso: e.iso,
      severity: e.severity || "info",
      message: e.message || e.type || "Evento",
      source: "rete",
    });
  }
  for (const e of thresholdList || []) {
    pushCap(merged, maxTotal, {
      iso: e.iso,
      severity: e.severity,
      message: e.message,
      source: "soglie",
    });
  }
  merged.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  return merged;
}

/**
 * Genera e scarica il PDF nel browser.
 * @param {{ zoneId: string, zoneLabel: string, period: { fromIso: string, toIso: string, label: string }, samples: any[], networkEvents?: any[] }} opts
 */
export function generateMonthlyReportPdf(opts) {
  const {
    zoneId,
    zoneLabel,
    period,
    samples: rawSamples,
    networkEvents = [],
  } = opts;

  const samples = filterSamplesByPeriod(rawSamples, period.fromIso, period.toIso);
  const summaryBody = computeSummaryRows(samples);
  const netAlarms = filterNetworkAlarmEvents(networkEvents, zoneId, period.fromIso, period.toIso);
  const thrAlarms = collectThresholdAlarmsFromSamples(samples);
  const alarmRows = mergeAndSortAlarms(netAlarms, thrAlarms);

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
    "Medie calcolate sui campioni disponibili nel periodo (max ~4000 punti). Soglie allarme ambiente: default ALARM_* gateway se non diversamente configurato.",
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
    doc.text("Nessun dato numerico nel periodo selezionato.", margin, y + 4);
    y += 12;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Allarmi e anomalie nel periodo", margin, y);
  y += 2;

  const alarmTableBody = alarmRows.length
    ? alarmRows.map((a) => [
        formatLocalDateTimeShort(a.iso),
        String(a.severity || ""),
        String(a.message || "").replace(/\u00b0/g, " deg "),
        a.source === "rete" ? "Rete" : "Soglie",
      ])
    : [["—", "—", "Nessun allarme registrato nel periodo (eventi rete + superamenti soglie sui campioni).", "—"]];

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
      3: { cellWidth: 18 },
    },
    margin: { left: margin, right: margin },
  });

  const safeZone = String(zoneId || "zona").replace(/[^\w-]+/g, "_").slice(0, 40);
  const fn = `report-livorno-${safeZone}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fn);
}
