import React, { useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import Header from "./components/Header";
import ZoneSelector from "./components/ZoneSelector";
import TemperatureChart from "./components/TemperatureChart";
import WaterLevelGauge from "./components/WaterLevelGauge";
import EnvironmentalPanel from "./components/EnvironmentalPanel";
import HackerTerminal from "./components/HackerTerminal";
import LoginPanel from "./components/LoginPanel";
import ConnectionBanner from "./components/ConnectionBanner";
import AlarmBar from "./components/AlarmBar";
import FloorPlanMap from "./components/FloorPlanMap";
import MainTabs from "./components/MainTabs";
import HistoryReportPanel from "./components/HistoryReportPanel";
import { MOCK_ZONES } from "./services/mockSensors";
import { useDashboardSensors } from "./hooks/useDashboardSensors";
import { getStoredSessionToken, logoutFromGateway } from "./services/sensorApi";
import "./App.css";

const facilityLine =
  (process.env.REACT_APP_FACILITY_LINE || "").trim() ||
  "Struttura · Livorno";

export default function App() {
  const [zoneId, setZoneId] = useState(MOCK_ZONES[0].id);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [mainTab, setMainTab] = useState("dashboard");
  const [mapFloor, setMapFloor] = useState(MOCK_ZONES[0].floor);
  const [showFloorPlan, setShowFloorPlan] = useState(false);

  const {
    labels,
    values,
    lastTemp,
    water,
    humidityPercent,
    co2Ppm,
    vocIndex,
    activeAlarms,
    siteZones,
    floorsCatalog,
    reportSamples,
    waterEtaHours,
    waterEtaConfidence,
    waterDepletionRatePctPerHour,
    waterRapidDrop,
    waterRapidDropDelta,
    logs,
    connection,
    stream,
    useApi,
    zones,
    zonesLoading,
    zonesError,
    authRequired,
    dashboardLoading,
    apiErrorHint,
  } = useDashboardSensors(zoneId, authEpoch);

  useEffect(() => {
    if (!zones?.length) return;
    if (!zones.some((z) => z.id === zoneId)) {
      setZoneId(zones[0].id);
    }
  }, [zones, zoneId]);

  useEffect(() => {
    const z = zones.find((zz) => zz.id === zoneId);
    if (z && z.floor != null && z.floor !== "") {
      setMapFloor(String(z.floor));
    }
  }, [zoneId, zones]);

  useEffect(() => {
    if (mainTab !== "dashboard") setShowFloorPlan(false);
  }, [mainTab]);

  async function handleLogout() {
    await logoutFromGateway();
    setAuthEpoch((n) => n + 1);
  }

  const showLogin = useApi && authRequired;
  const hasSession = Boolean(getStoredSessionToken());

  const showConnectionBanner =
    useApi && !authRequired && (Boolean(zonesError) || connection === "degraded");
  const bannerDetail =
    zonesError ||
    apiErrorHint ||
    "La dashboard va aperta su http://localhost:3000 (npm start o npm run stack). Il gateway API resta sulla porta 4000: se vedi ERR_CONNECTION_REFUSED, avvia lo stack oppure in un altro terminale npm run server.";

  const mapZones = siteZones?.length ? siteZones : zones;

  return (
    <div className="app-shell">
      <ConnectionBanner
        visible={showConnectionBanner}
        title="Gateway sensori non raggiungibile"
        detail={bannerDetail}
      />
      {showLogin ? (
        <LoginPanel
          onLoggedIn={() => setAuthEpoch((n) => n + 1)}
          onCancel={null}
        />
      ) : null}
      <div
        className={`dashboard-grid${
          mainTab === "history" ? " dashboard-grid--history" : ""
        }${
          mainTab === "dashboard" && showFloorPlan
            ? " dashboard-grid--floorplan"
            : ""
        }`}
      >
        <div className="area-header">
          <Header
            facilityLine={facilityLine}
            dataSource={connection}
            stream={stream}
            showLogout={useApi && hasSession && !showLogin}
            onLogout={handleLogout}
          />
        </div>
        <div className="area-tabs">
          <MainTabs value={mainTab} onChange={setMainTab} />
        </div>
        <div className="area-alarms">
          <AlarmBar alarms={activeAlarms} />
        </div>

        {mainTab === "dashboard" ? (
          <>
            <div className="area-zones">
              <ZoneSelector
                zones={zones}
                value={zoneId}
                onChange={setZoneId}
                disabled={Boolean(useApi && zonesLoading)}
                errorText={useApi ? zonesError : null}
              />
            </div>
            <div className="area-mapbar">
              <button
                type="button"
                className="floorplan-toggle glass-panel mono"
                onClick={() => setShowFloorPlan((v) => !v)}
                aria-expanded={showFloorPlan}
              >
                <MapPinned className="floorplan-toggle__icon" aria-hidden />
                {showFloorPlan
                  ? "Nascondi planimetria per piano"
                  : "Mostra planimetria per piano"}
              </button>
            </div>
            {showFloorPlan ? (
              <div className="area-map">
                <FloorPlanMap
                  floors={floorsCatalog}
                  siteZones={mapZones}
                  selectedFloor={mapFloor}
                  onFloorChange={setMapFloor}
                  selectedZoneId={zoneId}
                  onSelectZone={setZoneId}
                />
              </div>
            ) : null}
            <div className="area-chart">
              <TemperatureChart
                labels={labels.length ? labels : ["—"]}
                values={values.length ? values : [28]}
                currentTemp={lastTemp}
                loading={dashboardLoading}
              />
            </div>
            <div className="area-rightcol">
              <WaterLevelGauge
                level={water}
                loading={dashboardLoading}
                waterEtaHours={waterEtaHours}
                waterEtaConfidence={waterEtaConfidence}
                waterDepletionRatePctPerHour={waterDepletionRatePctPerHour}
                waterRapidDrop={waterRapidDrop}
                waterRapidDropDelta={waterRapidDropDelta}
              />
              <EnvironmentalPanel
                humidityPercent={humidityPercent}
                co2Ppm={co2Ppm}
                vocIndex={vocIndex}
                loading={dashboardLoading}
              />
            </div>
            <div className="area-terminal">
              <HackerTerminal lines={logs} />
            </div>
          </>
        ) : (
          <>
            <div className="area-zones">
              <ZoneSelector
                zones={zones}
                value={zoneId}
                onChange={setZoneId}
                disabled={Boolean(useApi && zonesLoading)}
                errorText={useApi ? zonesError : null}
              />
            </div>
            <div className="area-history">
              <HistoryReportPanel
                zoneId={zoneId}
                useApi={useApi}
                liveSamples={reportSamples}
                loadingParent={dashboardLoading}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
