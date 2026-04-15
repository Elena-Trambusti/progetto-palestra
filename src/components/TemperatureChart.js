import React, { useMemo } from "react";
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
import { Loader2 as ChartLoaderIcon, Thermometer } from "lucide-react";
import "./TemperatureChart.css";

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

const chartOptionsBase = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: false },
    title: { display: false },
    tooltip: {
      backgroundColor: "rgba(10, 10, 10, 0.92)",
      borderColor: "rgba(139, 92, 246, 0.5)",
      borderWidth: 1,
      titleFont: { family: "Roboto Mono", size: 11 },
      bodyFont: { family: "Roboto Mono", size: 12 },
      padding: 10,
      callbacks: {
        label: (ctx) => ` ${ctx.parsed.y.toFixed(1)} °C`,
      },
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(148, 163, 184, 0.08)" },
      ticks: {
        color: "#71717a",
        font: { family: "Roboto Mono", size: 10 },
        maxRotation: 0,
      },
    },
    y: {
      min: 18,
      max: 42,
      grid: { color: "rgba(148, 163, 184, 0.08)" },
      ticks: {
        color: "#71717a",
        font: { family: "Roboto Mono", size: 10 },
        callback: (v) => `${v}°`,
      },
    },
  },
};

export default function TemperatureChart({ labels, values, currentTemp, loading }) {
  const chartData = useMemo(() => {
    const areaGradient = (context) => {
      const chart = context.chart;
      const { ctx, chartArea } = chart;
      if (!chartArea) return "rgba(99, 102, 241, 0.2)";
      const g = ctx.createLinearGradient(
        0,
        chartArea.bottom,
        0,
        chartArea.top
      );
      g.addColorStop(0, "rgba(59, 130, 246, 0.45)");
      g.addColorStop(0.45, "rgba(139, 92, 246, 0.35)");
      g.addColorStop(1, "rgba(168, 85, 247, 0.08)");
      return g;
    };

    return {
      labels,
      datasets: [
        {
          label: "Docce",
          data: values,
          fill: true,
          tension: 0.38,
          borderWidth: 2,
          borderColor: "rgba(167, 139, 250, 0.95)",
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#a78bfa",
          backgroundColor: areaGradient,
        },
      ],
    };
  }, [labels, values]);

  return (
    <section
      className="temp-chart glass-panel animate-in animate-in-delay-1"
      aria-labelledby="temp-chart-heading"
    >
      <div className="temp-chart__head">
        <div className="temp-chart__head-left">
          <Thermometer className="temp-chart__icon" aria-hidden />
          <div>
            <h2 id="temp-chart-heading" className="temp-chart__title">
              Andamento termico docce
            </h2>
            <p className="temp-chart__hint mono">
              Ultimi campionamenti · °C
            </p>
          </div>
        </div>
        <div className="temp-chart__badge mono" aria-live="polite">
          <span className="temp-chart__badge-label">ATTUALE</span>
          <span className="temp-chart__badge-value">
            {currentTemp != null ? `${currentTemp.toFixed(1)} °C` : "—"}
          </span>
        </div>
      </div>
      <div
        className={`temp-chart__canvas-wrap${loading ? " temp-chart__canvas-wrap--loading" : ""}`}
        aria-busy={loading ? "true" : "false"}
      >
        <Line data={chartData} options={chartOptionsBase} />
        {loading ? (
          <div className="temp-chart__loading" aria-hidden>
            <ChartLoaderIcon className="temp-chart__spinner" />
            <span className="temp-chart__loading-text mono">Caricamento serie…</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
