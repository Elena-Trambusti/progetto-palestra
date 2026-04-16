const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const SERVER_DIR = path.resolve(__dirname, "..");

function randomPort() {
  return 4600 + Math.floor(Math.random() * 800);
}

async function waitForHealth(baseUrl, timeoutMs = 12_000) {
  const started = Date.now();
  // Poll until the process responds, avoiding brittle fixed sleeps.
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server not healthy after ${timeoutMs}ms`);
}

async function startGateway(extraEnv = {}) {
  const port = randomPort();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DISABLE_AUTO_TICK: "true",
    ...extraEnv,
  };
  const child = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  const stop = async () => {
    if (child.killed) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 1500);
    });
  };

  return { baseUrl, stop, getStderr: () => stderr };
}

test("health and ingest auth flow with ingest secret", async () => {
  const { baseUrl, stop } = await startGateway({
    REQUIRE_AUTH: "false",
    AUTH_PASSWORD: "",
    INGEST_SECRET: "test-ingest-secret",
    NOTIFY_WEBHOOK_URL: "",
  });

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal(typeof healthBody.uptimeSec, "number");

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200);
    const readyBody = await ready.json();
    assert.equal(readyBody.wsPath, "/ws");

    const noSecret = await fetch(`${baseUrl}/api/ingest/reading`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId: "serbatoio-idrico", temperatureC: 29.4 }),
    });
    assert.equal(noSecret.status, 401);

    const okIngest = await fetch(`${baseUrl}/api/ingest/reading`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ingest-secret": "test-ingest-secret",
      },
      body: JSON.stringify({
        nodeId: "node-water-01",
        zoneId: "serbatoio-idrico",
        gatewayId: "gw-livorno-01",
        temperatureC: 29.4,
        levelPercent: 61,
        batteryPercent: 82,
      }),
    });
    assert.equal(okIngest.status, 200);
    const ingestBody = await okIngest.json();
    assert.equal(ingestBody.ok, true);
    assert.equal(ingestBody.nodeId, "node-water-01");

    const nodeHistory = await fetch(
      `${baseUrl}/api/history?nodeId=node-water-01&limit=20`
    );
    assert.equal(nodeHistory.status, 200);
    const nodeHistoryBody = await nodeHistory.json();
    assert.equal(nodeHistoryBody.nodeId, "node-water-01");
    assert.ok(Array.isArray(nodeHistoryBody.samples));
    assert.ok(nodeHistoryBody.samples.length >= 1);

    const events = await fetch(`${baseUrl}/api/network/events?limit=10`);
    assert.equal(events.status, 200);
    const eventsBody = await events.json();
    assert.ok(Array.isArray(eventsBody.events));

    const nodeCsv = await fetch(
      `${baseUrl}/api/report/csv?nodeId=node-water-01&limit=20`
    );
    assert.equal(nodeCsv.status, 200);
    const csv = await nodeCsv.text();
    assert.ok(csv.includes("iso_utc,target,temp_c"));
    assert.ok(csv.includes("node-water-01"));
  } finally {
    await stop();
  }
});

test("dashboard snapshot requires login when REQUIRE_AUTH=true", async () => {
  const { baseUrl, stop } = await startGateway({
    REQUIRE_AUTH: "true",
    AUTH_PASSWORD: "StrongPassword123!",
    INGEST_SECRET: "test-ingest-secret",
    NOTIFY_WEBHOOK_URL: "",
  });

  try {
    const unauthorized = await fetch(`${baseUrl}/api/dashboard/snapshot`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "StrongPassword123!" }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("palestra_sess="));
    const sessionCookie = setCookie.split(";")[0];

    const authorized = await fetch(`${baseUrl}/api/dashboard/snapshot`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(authorized.status, 200);
    const payload = await authorized.json();
    assert.equal(typeof payload.currentTemperature, "number");
  } finally {
    await stop();
  }
});
