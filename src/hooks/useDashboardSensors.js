import { useCallback, useEffect, useRef, useState } from "react";
import {
  alarmLevelFromAlarms,
  computeMockActiveAlarms,
  driftMockSnapshot,
  generateMockSensorTick,
  initMockSnapshot,
  MOCK_MAX_POINTS,
  MOCK_GATEWAYS,
  MOCK_NODES,
  MOCK_ZONES,
} from "../services/mockSensors";
import {
  toUserErrorMessage,
  fetchDashboardSnapshot,
  fetchZonesCatalog,
  getSensorApiRoot,
  LoginRequiredError,
  normalizeDashboardPayload,
  resolveWebSocketUrl,
} from "../services/sensorApi";
import { MOCK_FLOORS, planPathForFloorId } from "../services/facilityFloors";
import {
  computeWaterEta,
  detectRapidDrop,
} from "../services/waterInsightsMath";

const MAX_LOG = 40;

function useLogBuffer() {
  const logId = useRef(0);
  const [logs, setLogs] = useState(() => [
    { id: ++logId.current, text: "[INFO] Sistema avviato · attesa uplink sensori…" },
  ]);

  const pushLine = useCallback((line) => {
    setLogs((prev) => {
      const next = [...prev, { id: ++logId.current, text: line }];
      if (next.length > MAX_LOG) next.splice(0, next.length - MAX_LOG);
      return next;
    });
  }, []);

  const replaceFromApi = useCallback((lines) => {
    if (!lines?.length) return;
    setLogs(
      lines.map((text) => ({
        id: ++logId.current,
        text,
      }))
    );
  }, []);

  return { logs, pushLine, replaceFromApi };
}

function ensureMockSnapshot(mapRef, zoneId) {
  if (!mapRef.current[zoneId]) {
    mapRef.current[zoneId] = initMockSnapshot(zoneId);
    return;
  }
  const cur = mapRef.current[zoneId];
  if (cur.humidityPct == null || cur.co2Ppm == null || cur.vocIndex == null) {
    const b = initMockSnapshot(zoneId);
    mapRef.current[zoneId] = {
      ...b,
      ...cur,
      humidityPct: cur.humidityPct ?? b.humidityPct,
      co2Ppm: cur.co2Ppm ?? b.co2Ppm,
      vocIndex: cur.vocIndex ?? b.vocIndex,
    };
  }
}

function useGatewayMode() {
  const root = getSensorApiRoot();
  const proxyFlag =
    String(process.env.REACT_APP_GATEWAY_MODE || "").toLowerCase() === "proxy";
  const useApi = Boolean(root) || proxyFlag;
  return { apiRoot: root, useApi };
}

export function useDashboardSensors(zoneId, authEpoch = 0) {
  const { apiRoot, useApi } = useGatewayMode();
  const pollMs = Number(process.env.REACT_APP_POLL_INTERVAL_MS) || 3000;
  const wsUrl = resolveWebSocketUrl(zoneId);
  const apiKeyConfigured = Boolean(
    String(process.env.REACT_APP_SENSOR_API_KEY || "").trim()
  );
  const useWs = Boolean(useApi && wsUrl && !apiKeyConfigured);

  const [labels, setLabels] = useState([]);
  const [values, setValues] = useState([]);
  const [lastTemp, setLastTemp] = useState(null);
  const [water, setWater] = useState(72);
  const [waterEtaHours, setWaterEtaHours] = useState(null);
  const [waterEtaConfidence, setWaterEtaConfidence] = useState(null);
  const [waterDepletionRatePctPerHour, setWaterDepletionRatePctPerHour] =
    useState(null);
  const [waterRapidDrop, setWaterRapidDrop] = useState(false);
  const [waterRapidDropDelta, setWaterRapidDropDelta] = useState(null);
  const [humidityPercent, setHumidityPercent] = useState(null);
  const [co2Ppm, setCo2Ppm] = useState(null);
  const [vocIndex, setVocIndex] = useState(null);
  const [lightLux, setLightLux] = useState(null);
  const [flowLmin, setFlowLmin] = useState(null);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [siteZones, setSiteZones] = useState([]);
  const [networkNodes, setNetworkNodes] = useState([]);
  const [networkSummary, setNetworkSummary] = useState({
    gateway: MOCK_GATEWAYS[0] || null,
    totals: { nodes: MOCK_NODES.length, online: MOCK_NODES.length, stale: 0, offline: 0 },
  });
  const [networkEvents, setNetworkEvents] = useState([]);
  const [telemetry, setTelemetry] = useState({
    nodeId: "",
    nodeLabel: "",
    gatewayId: "",
    gatewayName: "",
    batteryPercent: null,
    rssi: null,
    snr: null,
    uplinkAt: null,
    nodeStatus: "unknown",
    sensors: [],
  });
  const [floorsCatalog, setFloorsCatalog] = useState(() =>
    MOCK_FLOORS.map((f) => ({
      ...f,
      planPath: planPathForFloorId(f.id),
    }))
  );
  const [reportSamples, setReportSamples] = useState([]);
  const [connection, setConnection] = useState(useApi ? "api" : "mock");
  const [wsConnected, setWsConnected] = useState(false);
  const [zones, setZones] = useState(MOCK_ZONES);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [awaitingSnapshot, setAwaitingSnapshot] = useState(useApi);
  const [apiErrorHint, setApiErrorHint] = useState(null);

  const { logs, pushLine, replaceFromApi } = useLogBuffer();

  const mockSnapshots = useRef({});
  const mockWaterSamples = useRef({});
  const mockReportRows = useRef([]);
  const prevMockZone = useRef(null);

  const applySnap = useCallback(
    (snap) => {
      setLabels(snap.labels);
      setValues(snap.values);
      setLastTemp(snap.lastTemp);
      setWater(snap.water);
      setWaterEtaHours(snap.waterEtaHours ?? null);
      setWaterEtaConfidence(snap.waterEtaConfidence ?? null);
      setWaterDepletionRatePctPerHour(snap.waterDepletionRatePctPerHour ?? null);
      setWaterRapidDrop(Boolean(snap.waterRapidDrop));
      setWaterRapidDropDelta(
        snap.waterRapidDropDelta != null && Number.isFinite(snap.waterRapidDropDelta)
          ? snap.waterRapidDropDelta
          : null
      );
      setHumidityPercent(
        snap.humidityPercent != null && Number.isFinite(snap.humidityPercent)
          ? snap.humidityPercent
          : null
      );
      setCo2Ppm(snap.co2Ppm != null && Number.isFinite(snap.co2Ppm) ? snap.co2Ppm : null);
      setVocIndex(snap.vocIndex != null && Number.isFinite(snap.vocIndex) ? snap.vocIndex : null);
      setLightLux(snap.lightLux != null && Number.isFinite(snap.lightLux) ? snap.lightLux : null);
      setFlowLmin(snap.flowLmin != null && Number.isFinite(snap.flowLmin) ? snap.flowLmin : null);
      setActiveAlarms(Array.isArray(snap.activeAlarms) ? snap.activeAlarms : []);
      setSiteZones(Array.isArray(snap.siteZones) ? snap.siteZones : []);
      setNetworkNodes(snap.network?.nodes || []);
      setNetworkSummary({
        gateway: snap.network?.gateway || null,
        totals: snap.network?.totals || null,
      });
      setNetworkEvents(Array.isArray(snap.network?.events) ? snap.network.events : []);
      setTelemetry(snap.telemetry || {});
      if (snap.floors?.length) {
        setFloorsCatalog(snap.floors);
      }
      if (snap.logLines?.length) replaceFromApi(snap.logLines);
    },
    [replaceFromApi]
  );

  useEffect(() => {
    if (authEpoch > 0) setAuthRequired(false);
  }, [authEpoch]);

  useEffect(() => {
    if (!useApi) {
      setAwaitingSnapshot(false);
      setApiErrorHint(null);
    }
  }, [useApi]);

  useEffect(() => {
    if (!useApi) return;
    setAwaitingSnapshot(true);
  }, [zoneId, useApi, authEpoch]);

  useEffect(() => {
    if (!useApi) {
      setZones(MOCK_ZONES);
      setZonesError(null);
      setZonesLoading(false);
      setAuthRequired(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setZonesLoading(true);
      try {
        const { zones: list, floors: fl } = await fetchZonesCatalog();
        if (cancelled) return;
        setZones(list.length ? list : MOCK_ZONES);
        if (fl.length) {
          setFloorsCatalog(fl);
        }
        setZonesError(null);
        setAuthRequired(false);
        setApiErrorHint(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof LoginRequiredError || e?.code === "LOGIN_REQUIRED") {
          setAuthRequired(true);
          setZonesError(null);
        } else {
          setZones(MOCK_ZONES);
          setZonesError(toUserErrorMessage(e));
          setApiErrorHint(null);
        }
      } finally {
        if (!cancelled) setZonesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useApi, apiRoot, authEpoch]);

  const runMockTick = useCallback(() => {
    MOCK_ZONES.forEach((z) => {
      ensureMockSnapshot(mockSnapshots, z.id);
      if (z.id !== zoneId) {
        mockSnapshots.current[z.id] = driftMockSnapshot(mockSnapshots.current[z.id]);
      }
    });
    const meta = MOCK_ZONES.find((z) => z.id === zoneId);
    const nodeMeta = MOCK_NODES.find((node) => node.zoneId === zoneId);
    const prev = mockSnapshots.current[zoneId];
    const next = generateMockSensorTick(prev, MOCK_MAX_POINTS, {
      zoneName: meta?.name,
      zoneId,
      nodeLabel: nodeMeta?.label,
    });
    mockSnapshots.current[zoneId] = {
      labels: next.labels,
      values: next.values,
      lastTemp: next.lastTemp,
      water: next.water,
      humidityPct: next.humidityPct,
      co2Ppm: next.co2Ppm,
      vocIndex: next.vocIndex,
      lightLux: next.lightLux,
      flowLmin: next.flowLmin,
      batteryPercent: next.batteryPercent,
      rssi: next.rssi,
      snr: next.snr,
      nodeId: nodeMeta?.id || prev.nodeId,
      nodeLabel: nodeMeta?.label || prev.nodeLabel,
      gatewayId: nodeMeta?.gatewayId || prev.gatewayId,
      uplinkAt: next.uplinkAt,
      nodeStatus: next.nodeStatus,
    };
    const prevS = mockWaterSamples.current[zoneId] || [];
    const merged = [...prevS, { t: Date.now(), water: next.water }].slice(-200);
    mockWaterSamples.current[zoneId] = merged;
    const readings = merged.map((s) => ({ t: s.t, water: s.water }));
    const eta = computeWaterEta(readings, next.water, {});
    const rapid = detectRapidDrop(readings, next.water, {});
    setLabels(next.labels);
    setValues(next.values);
    setLastTemp(next.lastTemp);
    setWater(next.water);
    setWaterEtaHours(eta.waterEtaHours ?? null);
    setWaterEtaConfidence(eta.waterEtaConfidence ?? null);
    setWaterDepletionRatePctPerHour(eta.waterDepletionRatePctPerHour ?? null);
    setWaterRapidDrop(Boolean(rapid.waterRapidDrop));
    setWaterRapidDropDelta(
      rapid.waterRapidDropDelta != null && Number.isFinite(rapid.waterRapidDropDelta)
        ? rapid.waterRapidDropDelta
        : null
    );
    setHumidityPercent(next.humidityPct);
    setCo2Ppm(next.co2Ppm);
    setVocIndex(next.vocIndex);
    setLightLux(next.lightLux);
    setFlowLmin(next.flowLmin);
    const curSt = mockSnapshots.current[zoneId];
    setActiveAlarms(computeMockActiveAlarms(curSt));
    const sz = MOCK_ZONES.map((z) => {
      const st = mockSnapshots.current[z.id];
      const al = computeMockActiveAlarms(st);
      return {
        id: z.id,
        name: z.name,
        floor: z.floor,
        mapX: z.mapX,
        mapY: z.mapY,
        planPath: z.planPath,
        temperatureC: st.lastTemp,
        waterPercent: st.water,
        humidityPercent: st.humidityPct,
        co2Ppm: st.co2Ppm,
        vocIndex: st.vocIndex,
        lightLux: st.lightLux,
        flowLmin: st.flowLmin,
        batteryPercent: st.batteryPercent,
        rssi: st.rssi,
        snr: st.snr,
        uplinkAt: st.uplinkAt,
        nodeStatus: st.nodeStatus,
        alarmLevel: alarmLevelFromAlarms(al),
      };
    });
    setSiteZones(sz);
    const nodes = MOCK_NODES.map((node) => {
      const st = mockSnapshots.current[node.zoneId];
      return {
        id: node.id,
        label: node.label,
        zoneId: node.zoneId,
        zoneName: MOCK_ZONES.find((z) => z.id === node.zoneId)?.name || node.zoneId,
        gatewayId: node.gatewayId,
        gatewayName: MOCK_GATEWAYS[0]?.name || node.gatewayId,
        sensors: node.sensors,
        batteryPercent: st.batteryPercent,
        rssi: st.rssi,
        snr: st.snr,
        uplinkAt: st.uplinkAt,
        status: st.nodeStatus,
      };
    });
    setNetworkNodes(nodes);
    setNetworkSummary({
      gateway: MOCK_GATEWAYS[0] || null,
      totals: {
        nodes: nodes.length,
        online: nodes.filter((node) => node.status === "online").length,
        stale: nodes.filter((node) => node.status === "stale").length,
        offline: nodes.filter((node) => node.status === "offline").length,
      },
    });
    const nowIso = new Date().toISOString();
    setNetworkEvents((prev) =>
      [
        ...prev,
        {
          iso: nowIso,
          t: Date.now(),
          type: "tick",
          severity: "info",
          message: `Simulazione: uplink aggiornati (${zoneId})`,
        },
      ].slice(-80)
    );
    setTelemetry({
      nodeId: curSt.nodeId,
      nodeLabel: curSt.nodeLabel,
      gatewayId: curSt.gatewayId,
      gatewayName: MOCK_GATEWAYS[0]?.name || curSt.gatewayId,
      batteryPercent: curSt.batteryPercent,
      rssi: curSt.rssi,
      snr: curSt.snr,
      uplinkAt: curSt.uplinkAt,
      nodeStatus: curSt.nodeStatus,
      sensors: nodeMeta?.sensors || [],
    });
    const row = {
      iso: new Date().toISOString(),
      temp: next.lastTemp,
      water: next.water,
      humidity: next.humidityPct,
      co2: next.co2Ppm,
      voc: next.vocIndex,
    };
    mockReportRows.current = [...mockReportRows.current, row].slice(-500);
    setReportSamples([...mockReportRows.current]);
    pushLine(next.logLine);
    setConnection("mock");
  }, [zoneId, pushLine]);

  useEffect(() => {
    if (useApi) return;
    ensureMockSnapshot(mockSnapshots, zoneId);
    const s = mockSnapshots.current[zoneId];
    setLabels(s.labels);
    setValues(s.values);
    setLastTemp(s.lastTemp);
    setWater(s.water);
    const samples = mockWaterSamples.current[zoneId] || [];
    const readings = samples.map((x) => ({ t: x.t, water: x.water }));
    const eta = computeWaterEta(readings, s.water, {});
    const rapid = detectRapidDrop(readings, s.water, {});
    setWaterEtaHours(eta.waterEtaHours ?? null);
    setWaterEtaConfidence(eta.waterEtaConfidence ?? null);
    setWaterDepletionRatePctPerHour(eta.waterDepletionRatePctPerHour ?? null);
    setWaterRapidDrop(Boolean(rapid.waterRapidDrop));
    setWaterRapidDropDelta(
      rapid.waterRapidDropDelta != null && Number.isFinite(rapid.waterRapidDropDelta)
        ? rapid.waterRapidDropDelta
        : null
    );
    setHumidityPercent(s.humidityPct ?? null);
    setCo2Ppm(s.co2Ppm ?? null);
    setVocIndex(s.vocIndex ?? null);
    setLightLux(s.lightLux ?? null);
    setFlowLmin(s.flowLmin ?? null);
    MOCK_ZONES.forEach((z) => ensureMockSnapshot(mockSnapshots, z.id));
    const sz = MOCK_ZONES.map((z) => {
      const st = mockSnapshots.current[z.id];
      const al = computeMockActiveAlarms(st);
      return {
        id: z.id,
        name: z.name,
        floor: z.floor,
        mapX: z.mapX,
        mapY: z.mapY,
        planPath: z.planPath,
        temperatureC: st.lastTemp,
        waterPercent: st.water,
        humidityPercent: st.humidityPct,
        co2Ppm: st.co2Ppm,
        vocIndex: st.vocIndex,
        lightLux: st.lightLux,
        flowLmin: st.flowLmin,
        batteryPercent: st.batteryPercent,
        rssi: st.rssi,
        snr: st.snr,
        uplinkAt: st.uplinkAt,
        nodeStatus: st.nodeStatus,
        alarmLevel: alarmLevelFromAlarms(al),
      };
    });
    setSiteZones(sz);
    setActiveAlarms(computeMockActiveAlarms(s));
    const nodes = MOCK_NODES.map((node) => {
      const st = mockSnapshots.current[node.zoneId];
      return {
        id: node.id,
        label: node.label,
        zoneId: node.zoneId,
        zoneName: MOCK_ZONES.find((z) => z.id === node.zoneId)?.name || node.zoneId,
        gatewayId: node.gatewayId,
        gatewayName: MOCK_GATEWAYS[0]?.name || node.gatewayId,
        sensors: node.sensors,
        batteryPercent: st.batteryPercent,
        rssi: st.rssi,
        snr: st.snr,
        uplinkAt: st.uplinkAt,
        status: st.nodeStatus,
      };
    });
    const nodeMeta = MOCK_NODES.find((node) => node.zoneId === zoneId);
    setNetworkNodes(nodes);
    setNetworkSummary({
      gateway: MOCK_GATEWAYS[0] || null,
      totals: {
        nodes: nodes.length,
        online: nodes.filter((node) => node.status === "online").length,
        stale: nodes.filter((node) => node.status === "stale").length,
        offline: nodes.filter((node) => node.status === "offline").length,
      },
    });
    setNetworkEvents((prev) => prev.slice(-80));
    setTelemetry({
      nodeId: s.nodeId,
      nodeLabel: s.nodeLabel,
      gatewayId: s.gatewayId,
      gatewayName: MOCK_GATEWAYS[0]?.name || s.gatewayId,
      batteryPercent: s.batteryPercent,
      rssi: s.rssi,
      snr: s.snr,
      uplinkAt: s.uplinkAt,
      nodeStatus: s.nodeStatus,
      sensors: nodeMeta?.sensors || [],
    });

    if (prevMockZone.current && prevMockZone.current !== zoneId) {
      const name = MOCK_ZONES.find((z) => z.id === zoneId)?.name;
      pushLine(
        `[INFO] ${new Date().toLocaleTimeString("it-IT")} · Vista: ${name || zoneId}`
      );
    }
    prevMockZone.current = zoneId;
  }, [zoneId, useApi, pushLine]);

  useEffect(() => {
    if (useApi) return;
    runMockTick();
    const id = setInterval(runMockTick, pollMs);
    return () => clearInterval(id);
  }, [useApi, pollMs, runMockTick]);

  const runApiTick = useCallback(async () => {
    try {
      const snap = await fetchDashboardSnapshot(zoneId);
      applySnap(snap);
      setConnection("api");
      setAuthRequired(false);
      setAwaitingSnapshot(false);
      setApiErrorHint(null);
    } catch (e) {
      if (e instanceof LoginRequiredError || e?.code === "LOGIN_REQUIRED") {
        setAuthRequired(true);
        setConnection("degraded");
        setAwaitingSnapshot(false);
        return;
      }
      const msg = toUserErrorMessage(e);
      setApiErrorHint(msg);
      pushLine(`[WARN] ${new Date().toLocaleTimeString("it-IT")} · API: ${msg}`);
      setConnection("degraded");
      setAwaitingSnapshot(false);
    }
  }, [zoneId, applySnap, pushLine]);

  useEffect(() => {
    if (!useApi) return;
    runApiTick();
    const id = setInterval(runApiTick, pollMs);
    return () => clearInterval(id);
  }, [useApi, pollMs, runApiTick, authEpoch]);

  useEffect(() => {
    if (!useWs || authRequired) {
      setWsConnected(false);
      return;
    }

    let stopped = false;
    let ws;
    let reconnectTimer;
    let backoff = 1200;

    const cleanupTimers = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = () => {
      if (stopped) return;
      cleanupTimers();

      const url = resolveWebSocketUrl(zoneId);
      if (!url) return;

      try {
        ws = new WebSocket(url);
      } catch {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
        return;
      }

      ws.onopen = () => {
        backoff = 1200;
        setWsConnected(true);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "snapshot" && msg.data) {
            const snap = normalizeDashboardPayload(msg.data);
            applySnap(snap);
            setConnection("api");
            setAuthRequired(false);
            setAwaitingSnapshot(false);
            setApiErrorHint(null);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (stopped) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
    };

    connect();

    return () => {
      stopped = true;
      cleanupTimers();
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      else if (ws) ws.close();
    };
  }, [useWs, authRequired, zoneId, applySnap, authEpoch]);

  const stream = !useApi ? "mock" : wsConnected ? "ws" : "http";

  const dashboardLoading =
    useApi && (zonesLoading || awaitingSnapshot) && !authRequired;

  return {
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
  };
}
