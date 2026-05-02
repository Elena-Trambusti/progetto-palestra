import React, { useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import Header from "./components/Header";
import ZoneSelector from "./components/ZoneSelector";
import TemperatureChart from "./components/TemperatureChart";
import WaterLevelGauge from "./components/WaterLevelGauge";
import WaterSavingsPanel from "./components/WaterSavingsPanel";
import EnvironmentalPanel from "./components/EnvironmentalPanel";
import AirQualityPanel from "./components/AirQualityPanel";
import HackerTerminal from "./components/HackerTerminal";
import LoginPanel from "./components/LoginPanel";
import ConnectionBanner from "./components/ConnectionBanner";
import AlarmBar from "./components/AlarmBar";
import FloorPlanMap from "./components/FloorPlanMap";
import MainTabs from "./components/MainTabs";
import HistoryReportPanel from "./components/HistoryReportPanel";
import NetworkStatusPanel from "./components/NetworkStatusPanel";
import NodeDetailPanel from "./components/NodeDetailPanel";
import SensorDynamicGrid from "./components/SensorDynamicGrid";
import ConfigurazionePanel from "./components/ConfigurazionePanel";
import ErrorBoundary from "./components/ErrorBoundary";
import { MOCK_ZONES } from "./services/mockSensors";
import { useDashboardSensors } from "./hooks/useDashboardSensors";
import { getStoredSessionToken, logoutFromGateway } from "./services/sensorApi";
import "./App.css";

/** Supporta `#configurazione` e `/#configurazione` come richiesto. */
function isConfigurazioneHash(hash) {
  const raw = String(hash || "")
    .replace(/^#/, "")
    .trim();
  return raw === "configurazione" || raw === "/configurazione";
}

const facilityLine =
  (process.env.REACT_APP_FACILITY_LINE || "").trim() || "Struttura · Livorno";

export default function App() {
  const [zoneId, setZoneId] = useState(MOCK_ZONES[0].id);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [mainTab, setMainTab] = useState("dashboard");
  const [mapFloor, setMapFloor] = useState(MOCK_ZONES[0].floor);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [routeHash, setRouteHash] = useState(() => window.location.hash || "");

  useEffect(() => {
    const onHash = () => setRouteHash(window.location.hash || "");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const {
    labels,
    values,
    lastTemp,
    water,
    humidityPercent,
    co2Ppm,
    vocIndex,
    lightLux,
    flowLmin,
    activeAlarms,
    siteZones,
    networkNodes,
    networkSummary,
    networkEvents,
    telemetry,
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
    sensorCards,
    dataProfile,
  } = useDashboardSensors(zoneId, authEpoch);

  useEffect(() => {
    if (!zones?.length) {
      if (useApi) setZoneId("");
      return;
    }
    if (!zones.some((z) => z.id === zoneId)) {
      setZoneId(zones[0].id);
    }
  }, [zones, zoneId, useApi]);

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
    useApi &&
    !authRequired &&
    (Boolean(zonesError) || connection === "degraded");
  const bannerDetail =
    zonesError ||
    apiErrorHint ||
    "La dashboard va aperta su http://localhost:3000 (npm start o npm run stack). Il gateway API resta sulla porta 4000: se vedi ERR_CONNECTION_REFUSED, avvia lo stack oppure in un altro terminale npm run server.";

  const mapZones = siteZones?.length ? siteZones : zones;

  const showAdminNav = useApi && dataProfile === "postgres";

  const postgresNoSensors =
    dataProfile === "postgres" && !dashboardLoading && sensorCards.length === 0;

  const emptyDbMessage =
    zones.length === 0
      ? "Nessun sensore registrato. Vai in Configurazione (#/configurazione)."
      : "Nessun sensore in questa posizione. Controlla l’anagrafica in Configurazione.";

  if (isConfigurazioneHash(routeHash)) {
    return (
      <div className="app-shell">
        <ConfigurazionePanel
          onBack={() => {
            window.location.hash = "";
            setRouteHash("");
          }}
        />
      </div>
    );
  }

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
        }${mainTab === "network" ? " dashboard-grid--network" : ""}${
          mainTab === "node" ? " dashboard-grid--node" : ""
        }${
          mainTab === "dashboard" && showFloorPlan
            ? " dashboard-grid--floorplan"
            : ""
        }${
          mainTab === "dashboard" ? " dashboard-grid--no-sensors" : ""
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
          <MainTabs
            value={mainTab}
            onChange={setMainTab}
            showConfigNav={showAdminNav}
            onOpenConfig={() => {
              window.location.hash = "#/configurazione";
              setRouteHash("#/configurazione");
            }}
          />
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
              <ErrorBoundary>
                <TemperatureChart
                  labels={labels}
                  values={values}
                  currentTemp={postgresNoSensors ? null : lastTemp}
                  loading={dashboardLoading}
                  emptyHint={postgresNoSensors ? emptyDbMessage : ""}
                />
              </ErrorBoundary>
            </div>
            <div className="area-rightcol">
              {postgresNoSensors ? (
                <>
                  <ErrorBoundary>
                    <AirQualityPanel
                      humidityPercent={humidityPercent}
                      co2Ppm={co2Ppm}
                      vocIndex={vocIndex}
                      lightLux={lightLux}
                      flowLmin={flowLmin}
                      loading={dashboardLoading}
                    />
                  </ErrorBoundary>
                  <section className="env-panel glass-panel animate-in animate-in-delay-2">
                    <p
                      className="mono"
                      style={{
                        padding: "1.25rem",
                        color: "#d4d4d8",
                        lineHeight: 1.5,
                      }}
                    >
                      {emptyDbMessage}
                    </p>
                  </section>
                </>
              ) : (
                <>
                  {water != null ? (
                    <ErrorBoundary>
                      <WaterLevelGauge
                        level={water}
                        loading={dashboardLoading}
                        waterEtaHours={waterEtaHours}
                        waterEtaConfidence={waterEtaConfidence}
                        waterDepletionRatePctPerHour={
                          waterDepletionRatePctPerHour
                        }
                        waterRapidDrop={waterRapidDrop}
                        waterRapidDropDelta={waterRapidDropDelta}
                      />
                    </ErrorBoundary>
                  ) : null}
                  <ErrorBoundary>
                    <WaterSavingsPanel />
                  </ErrorBoundary>
                  <ErrorBoundary>
                    <AirQualityPanel
                      humidityPercent={humidityPercent}
                      co2Ppm={co2Ppm}
                      vocIndex={vocIndex}
                      lightLux={lightLux}
                      flowLmin={flowLmin}
                      loading={dashboardLoading}
                    />
                  </ErrorBoundary>
                  {sensorCards.length > 0 ? (
                    <ErrorBoundary>
                      <SensorDynamicGrid
                        cards={sensorCards}
                        loading={dashboardLoading}
                      />
                    </ErrorBoundary>
                  ) : (
                    <ErrorBoundary>
                      <EnvironmentalPanel
                        humidityPercent={humidityPercent}
                        co2Ppm={co2Ppm}
                        vocIndex={vocIndex}
                        lightLux={lightLux}
                        flowLmin={flowLmin}
                        loading={dashboardLoading}
                      />
                    </ErrorBoundary>
                  )}
                </>
              )}
            </div>
            <div className="area-terminal">
              <HackerTerminal lines={logs} />
            </div>
          </>
        ) : mainTab === "history" ? (
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
                zones={zones}
                useApi={useApi}
                liveSamples={reportSamples}
                loadingParent={dashboardLoading}
              />
            </div>
          </>
        ) : mainTab === "network" ? (
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
            <div className="area-network">
              <NetworkStatusPanel
                telemetry={telemetry}
                networkSummary={networkSummary}
                networkNodes={networkNodes}
                networkEvents={networkEvents}
                loading={dashboardLoading}
              />
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
            <div className="area-node">
              <NodeDetailPanel
                zoneName={zones.find((z) => z.id === zoneId)?.name || zoneId}
                telemetry={telemetry}
                metrics={{
                  temperatureC: lastTemp,
                  levelPercent: water,
                  flowLmin,
                  lightLux,
                  humidityPercent,
                  co2Ppm,
                  vocIndex,
                }}
                alarms={activeAlarms}
                loading={dashboardLoading}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
