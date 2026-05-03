/**
 * Test di integrazione API - Jest + Supertest
 * Copre: health, ingest, admin endpoints
 */
const request = require("supertest");
const express = require("express");

// Mock environment variables for testing
process.env.INGEST_SECRET = "test-secret-123";
process.env.ADMIN_KEY = "test-admin-key";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
process.env.REQUIRE_AUTH = "false";

describe("API Integration Tests", () => {
  let app;

  beforeAll(() => {
    // Import app after setting env vars
    app = require("../index");
  });

  describe("Health Endpoints", () => {
    test("GET /health - dovrebbe rispondere con 200", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ts).toBeDefined();
    });

    test("GET /readyz - dovrebbe restituire status sistema", async () => {
      const res = await request(app).get("/readyz");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.env).toBe("test");
    });

    test("GET /metrics - dovrebbe restituire metriche Prometheus", async () => {
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(res.text).toContain("process_uptime_seconds");
    });
  });

  describe("Authentication", () => {
    test("POST /api/ingest - senza secret dovrebbe dare 401", async () => {
      const res = await request(app)
        .post("/api/ingest")
        .send({
          end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
          uplink_message: { decoded_payload: { temperatureC: 22 } },
        });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("ingest_unauthorized");
    });

    test("POST /api/ingest - con secret invalido dovrebbe dare 401", async () => {
      const res = await request(app)
        .post("/api/ingest")
        .set("x-ingest-secret", "wrong-secret")
        .send({
          end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
          uplink_message: { decoded_payload: { temperatureC: 22 } },
        });
      expect(res.status).toBe(401);
    });
  });

  describe("Admin Endpoints", () => {
    test("GET /api/admin/dbcheck - senza key dovrebbe dare 403", async () => {
      const res = await request(app).get("/api/admin/dbcheck");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("unauthorized");
    });

    test("GET /api/admin/dbcheck - con key valido dovrebbe funzionare", async () => {
      const res = await request(app)
        .get("/api/admin/dbcheck")
        .query({ key: "test-admin-key" });
      expect(res.status).toBe(200);
      expect(res.body.database_url_set).toBeDefined();
    });
  });

  describe("Swagger Docs", () => {
    test("GET /api/docs - dovrebbe servire UI Swagger", async () => {
      const res = await request(app).get("/api/docs");
      expect(res.status).toBe(200);
      expect(res.text).toContain("swagger-ui");
    });
  });
});

describe("Joi Validation Tests", () => {
  const { validateTtnPayload } = require("../lib/ttnIngest");

  test("dovrebbe accettare payload valido", () => {
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      uplink_message: {
        decoded_payload: { temperatureC: 22, batteryPercent: 85 },
        rx_metadata: [{ rssi: -80, snr: 8 }],
      },
      received_at: "2026-05-03T12:00:00Z",
    };
    const result = validateTtnPayload(payload);
    expect(result.valid).toBe(true);
  });

  test("dovrebbe rifiutare dev_eui troppo corto", () => {
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDD" }, // solo 8 char, serve 16
    };
    const result = validateTtnPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("validation_error");
  });

  test("dovrebbe rifiutare temperature fuori range", () => {
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      uplink_message: {
        decoded_payload: { temperatureC: 150 }, // troppo alta
      },
    };
    const result = validateTtnPayload(payload);
    expect(result.valid).toBe(false);
  });

  test("dovrebbe rifiutare batteryPercent > 100", () => {
    const payload = {
      end_device_ids: { dev_eui: "AABBCCDDEEFF0011" },
      uplink_message: {
        decoded_payload: { batteryPercent: 150 },
      },
    };
    const result = validateTtnPayload(payload);
    expect(result.valid).toBe(false);
  });
});
