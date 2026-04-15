import { useCallback, useEffect, useRef, useState } from "react";
import {
  alarmLevelFromAlarms,
  computeMockActiveAlarms,
  driftMockSnapshot,
  generateMockSensorTick,
  initMockSnapshot,
  MOCK_MAX_POINTS,
  MOCK_ZONES,
} from "../services/mockSensors";
import {
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
  const useWs = Boolean(useApi && wsUrl);

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
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [siteZones, setSiteZones] = useState([]);
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
      setActiveAlarms(Array.isArray(snap.activeAlarms) ? snap.activeAlarms : []);
      setSiteZones(Array.isArray(snap.siteZones) ? snap.siteZones : []);
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
          setZonesError(e instanceof Error ? e.message : String(e));
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
    const prev = mockSnapshots.current[zoneId];
    const next = generateMockSensorTick(prev, MOCK_MAX_POINTS, {
      zoneName: meta?.name,
      zoneId,
    });
    mockSnapshots.current[zoneId] = {
      labels: next.labels,
      values: next.values,
      lastTemp: next.lastTemp,
      water: next.water,
      humidityPct: next.humidityPct,
      co2Ppm: next.co2Ppm,
      vocIndex: next.vocIndex,
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
        alarmLevel: alarmLevelFromAlarms(al),
      };
    });
    setSiteZones(sz);
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
        alarmLevel: alarmLevelFromAlarms(al),
      };
    });
    setSiteZones(sz);
    setActiveAlarms(computeMockActiveAlarms(s));

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
      const msg = e instanceof Error ? e.message : String(e);
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
  };
}
