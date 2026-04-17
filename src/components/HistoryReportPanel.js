import React, { useCallback, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { FileDown, FileText, Loader2, RefreshCw } from "lucide-react";
import {
  fetchHistorySamples,
  fetchNetworkEvents,
  reportCsvUrl,
  toUserErrorMessage,
} from "../services/sensorApi";
import {
  generateMonthlyReportPdf,
  resolveReportPeriod,
} from "../services/monthlyReportPdf";
import { formatLocalDateTimeShort, formatLocalTimeHms } from "../utils/localTime";
import "./HistoryReportPanel.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function buildCsv(samples, zoneId) {
  const csvCell = (value) => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
    return s;
  };
  const header = "iso_utc,zone,temp_c,water_pct,humidity_pct,co2_ppm,voc_index\n";
  const body = (samples || [])
    .map((r) =>
      [
        r.iso,
        zoneId,
        r.temp,
        r.water ?? "",
        r.humidity ?? "",
        r.co2 ?? "",
        r.voc ?? "",
      ]
        .map(csvCell)
        .join(",")
    )
    .join("\n");
  return header + body;
}

export default function HistoryReportPanel({
  zoneId,
  zoneLabel,
  zones,
  useApi,
  liveSamples,
  loadingParent,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState(null);

  const resolvedZoneLabel =
    zoneLabel ||
    (Array.isArray(zones) ? zones.find((z) => z.id === zoneId)?.name : null) ||
    zoneId ||
    "—";

  const samples = useMemo(
    () => (useApi ? fetched : liveSamples || []),
    [useApi, fetched, liveSamples]
  );

  const loadApi = useCallback(async () => {
    if (!useApi || !zoneId) return;
    setLoading(true);
    setErr(null);
    try {
      const { samples: rows } = await fetchHistorySamples(zoneId, 400, from, to);
      setFetched(rows);
    } catch (e) {
      setErr(toUserErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [useApi, zoneId, from, to]);

  const chartData = useMemo(() => {
    const rows = samples.length ? samples : [];
    const labels = rows.map((r) => (r.iso ? formatLocalTimeHms(r.iso) : "—"));
    const temps = rows.map((r) => (Number.isFinite(Number(r.temp)) ? Number(r.temp) : null));
    return {
      labels,
      datasets: [
        {
          label: "Temperatura °C",
          data: temps,
          borderColor: "rgba(99, 102, 241, 0.95)",
          backgroundColor: "rgba(99, 102, 241, 0.12)",
          fill: true,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    };
  }, [samples]);

  const chartOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#a1a1aa" } },
        title: {
          display: true,
          text: "Andamento temperatura (campione storico)",
          color: "#d4d4d8",
          font: { size: 13 },
        },
      },
      scales: {
        x: {
          ticks: { color: "#71717a", maxRotation: 45, font: { size: 9 } },
          grid: { color: "rgba(148, 163, 184, 0.06)" },
        },
        y: {
          ticks: { color: "#71717a" },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    }),
    []
  );

  function downloadMockCsv() {
    const csv = buildCsv(samples, zoneId);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `storico-${zoneId}-mock.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const csvHref = useApi ? reportCsvUrl(zoneId, 8000, from, to) : null;

  async function handleMonthlyPdf() {
    if (!zoneId) {
      setErr("Seleziona una zona per generare il report.");
      return;
    }
    setPdfBusy(true);
    setErr(null);
    try {
      const period = resolveReportPeriod(from, to);
      let rowsForPdf = samples;
      let events = [];
      let sensorsCatalog = [];
      if (useApi) {
        const [{ samples: hist, sensorsCatalog: cat }, evs] = await Promise.all([
          fetchHistorySamples(zoneId, 4000, period.fromIso, period.toIso),
          fetchNetworkEvents(500),
        ]);
        rowsForPdf = hist;
        sensorsCatalog = cat || [];
        events = evs;
      } else {
        const fromMs = new Date(period.fromIso).getTime();
        const toMs = new Date(period.toIso).getTime();
        rowsForPdf = (liveSamples || []).filter((r) => {
          const t = new Date(r.iso).getTime();
          return Number.isFinite(t) && t >= fromMs && t <= toMs;
        });
      }
      generateMonthlyReportPdf({
        zoneId,
        zoneLabel: resolvedZoneLabel,
        period,
        samples: rowsForPdf,
        networkEvents: events,
        sensorsCatalog,
      });
    } catch (e) {
      setErr(toUserErrorMessage(e));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <section className="history-panel glass-panel">
      <header className="history-panel__head">
        <h2 className="history-panel__title">Storico e report</h2>
        <p className="history-panel__sub mono">
          Grafico da campioni; CSV; PDF con medie, anomalie da soglie DB, eventi rete. Da solo → fino a oggi; A
          solo → dal 1° del mese alla data; entrambe → intervallo esatto.
        </p>
      </header>

      <div className="history-panel__controls mono">
        <label className="history-panel__field">
          Da (ISO opz.)
          <input
            type="text"
            className="history-panel__input"
            placeholder="2026-01-01T00:00:00.000Z"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="history-panel__field">
          A (ISO opz.)
          <input
            type="text"
            className="history-panel__input"
            placeholder="vuoto = auto (vedi sotto)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {useApi ? (
          <button
            type="button"
            className="history-panel__btn"
            onClick={loadApi}
            disabled={loading || loadingParent}
          >
            {loading ? (
              <Loader2 className="history-panel__spin" aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
            Carica da gateway
          </button>
        ) : (
          <p className="history-panel__mock mono">
            Modalità mock: i campioni si aggiornano in tempo reale dalla dashboard.
          </p>
        )}
        {useApi && csvHref ? (
          <a className="history-panel__link" href={csvHref} download>
            <FileDown size={16} aria-hidden />
            Scarica CSV (server)
          </a>
        ) : (
          <button type="button" className="history-panel__btn" onClick={downloadMockCsv}>
            <FileDown size={16} aria-hidden />
            Scarica CSV (mock)
          </button>
        )}
        <button
          type="button"
          className="history-panel__btn"
          onClick={() => void handleMonthlyPdf()}
          disabled={pdfBusy || loading || loadingParent || !zoneId}
          title={
            from && to
              ? "PDF: intervallo Da / A"
              : from
                ? "PDF: da Da fino a oggi"
                : to
                  ? "PDF: dal 1° del mese corrente alla data A"
                  : "PDF: mese precedente se entrambi vuoti"
          }
        >
          {pdfBusy ? (
            <Loader2 className="history-panel__spin" aria-hidden />
          ) : (
            <FileText size={16} aria-hidden />
          )}
          Genera Report Mensile PDF
        </button>
      </div>

      {err ? <p className="history-panel__err mono">{err}</p> : null}

      <div className="history-panel__chart">
        {samples.length ? (
          <Line data={chartData} options={chartOpts} />
        ) : (
          <p className="history-panel__empty mono">
            Nessun campione: attendi qualche tick (mock) oppure carica dallo storico (API).
          </p>
        )}
      </div>

      {samples.length > 0 ? (
        <div className="history-panel__preview mono">
          <p className="history-panel__preview-title">Ultimi campioni</p>
          <table className="history-panel__table">
            <thead>
              <tr>
                <th>Data/ora (locale)</th>
                <th>°C</th>
                <th>RH%</th>
                <th>CO₂</th>
                <th>VOC</th>
              </tr>
            </thead>
            <tbody>
              {samples.slice(-6).map((r, idx) => (
                <tr key={`${r.iso || "row"}-${idx}`}>
                  <td>{r.iso ? formatLocalDateTimeShort(r.iso) : "—"}</td>
                  <td>{r.temp != null ? Number(r.temp).toFixed(1) : "—"}</td>
                  <td>{r.humidity != null ? Math.round(r.humidity) : "—"}</td>
                  <td>{r.co2 != null ? Math.round(r.co2) : "—"}</td>
                  <td>{r.voc != null ? Math.round(r.voc) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
