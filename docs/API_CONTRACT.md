# API Contract (Prototype)

Contratto operativo degli endpoint principali della centrale LoRa IoT.

## Base

- Base URL locale: `http://127.0.0.1:4000`
- Content type JSON: `application/json`
- Autenticazione (opzionale): cookie sessione o `Authorization: Bearer ...`
- Ingest autenticato: header `x-ingest-secret` (se configurato)

## Endpoints principali

- `GET /health`
  - Risposta: `{ ok, ts, uptimeSec }`
- `GET /readyz`
  - Risposta: `{ ok, env, requireAuth, hasIngestSecret, wsPath }`
- `GET /api/dashboard/snapshot?zoneId=...`
  - `zoneId` valido richiesto solo se presente; altrimenti default catalogo
  - Errori: `invalid_zone_id`
- `GET /api/history?zoneId=...&nodeId=...&limit=...&from=...&to=...`
  - `nodeId` e `zoneId` validati
  - `limit` clamp: `1..500`
  - Errori: `invalid_zone_id`, `invalid_node_id`, `invalid_time_range`
- `GET /api/report/csv?zoneId=...&nodeId=...&limit=...&from=...&to=...`
  - `limit` clamp: `50..15000`
  - Errori: `invalid_zone_id`, `invalid_node_id`, `invalid_time_range`
- `GET /api/network/catalog`
- `GET /api/network/status`
- `GET /api/network/events?limit=120`
- `GET /api/ops/summary`
  - KPI runtime in JSON (requests, latenza, websocket, ingest, nodi)
- `POST /api/ingest/reading`
  - Payload LoRa-ready o legacy

## Error Contract

Formato standard:

```json
{ "error": "error_code" }
```

Errori noti:

- `login_required`
- `invalid_zone_id`
- `invalid_node_id`
- `invalid_time_range`
- `rate_limited`
- `ingest_unauthorized`
