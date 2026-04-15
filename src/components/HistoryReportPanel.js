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
import { FileDown, Loader2, RefreshCw } from "lucide-react";
import { fetchHistorySamples, reportCsvUrl } from "../services/sensorApi";
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
      ].join(",")
    )
    .join("\n");
  return header + body;
}

export default function HistoryReportPanel({
  zoneId,
  useApi,
  liveSamples,
  loadingParent,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const samples = useMemo(
    () => (useApi ? fetched : liveSamples || []),
    [useApi, fetched, liveSamples]
  );

  const loadApi = useCallback(async () => {
    if (!useApi || !zoneId) return;
    setLoading(true);
    setErr(null);
    try {
      const rows = await fetchHistorySamples(zoneId, 400, from, to);
      setFetched(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [useApi, zoneId, from, to]);

  const chartData = useMemo(() => {
    const rows = samples.length ? samples : [];
    const labels = rows.map((r) =>
      r.iso ? String(r.iso).slice(11, 19) : "—"
    );
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

  return (
    <section className="history-panel glass-panel">
      <header className="history-panel__head">
        <h2 className="history-panel__title">Storico e report</h2>
        <p className="history-panel__sub mono">
          Grafico da campioni; export CSV completo (tutte le grandezze).
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
            placeholder="vuoto = fino a ora"
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
                <th>ISO</th>
                <th>°C</th>
                <th>RH%</th>
                <th>CO₂</th>
                <th>VOC</th>
              </tr>
            </thead>
            <tbody>
              {samples.slice(-6).map((r) => (
                <tr key={r.iso}>
                  <td>{String(r.iso).slice(11, 22)}</td>
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
