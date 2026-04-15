# Runbook Operativo

## Pre-release checklist
- Verifica CI verde (`lint`, `test frontend`, `test backend`, `build`).
- Verifica variabili prod obbligatorie: `REQUIRE_AUTH=true`, `AUTH_PASSWORD`, `INGEST_SECRET`, `CORS_ORIGIN`.
- Verifica endpoint salute: `/health`, `/readyz`, `/metrics`.

## Osservabilita` minima (SLO operativi)
- **Disponibilita` API**: `/health` deve rispondere `200` con `ok: true`.
- **Prontezza servizio**: `/readyz` deve esporre `requireAuth`, `hasIngestSecret`, `wsPath`.
- **Error budget HTTP**: `requests_5xx / requests_total < 1%` su finestra 15 minuti.
- **Stabilita` WS**: `websocket_connections_rejected_total` deve restare vicino a 0 in condizioni normali.

## Avvio produzione (Docker)
1. Aggiorna credenziali in `docker-compose.yml` o in file `.env`.
2. Esegui `docker compose up -d --build`.
3. Controlla log con `docker compose logs -f gateway`.
4. Verifica `http://localhost:4000/readyz`.

## Incident response rapida
- **API 5xx elevati**: controlla `/metrics`, poi log JSON `request` e `shutdown_*`.
- **Webhook alert non inviati**: cerca warning `[notify]` nei log.
- **Autenticazione fallita**: verifica `REQUIRE_AUTH`, `AUTH_PASSWORD`, cookie HTTP-only e `CORS_ORIGIN`.
- **Ingest rifiutato**: verifica header `x-ingest-secret` e rate limit.

### Comandi diagnostici rapidi
```bash
curl -s http://localhost:4000/health
curl -s http://localhost:4000/readyz
curl -s http://localhost:4000/metrics
docker compose logs --since=15m gateway
```

### Metriche chiave da monitorare
- `requests_total`, `requests_2xx`, `requests_4xx`, `requests_5xx`
- `request_duration_avg_ms`, `request_duration_max_ms`
- `websocket_clients`, `websocket_connections_accepted_total`, `websocket_connections_rejected_total`
- `ingest_accepted_total`, `ingest_rejected_total`

### Alert operativi automatici (webhook `ops_alert`)
- **5xx rate alto**: trigger quando `requests_5xx / requests_total` supera `OPS_ALERT_5XX_RATE_PCT` nella finestra `OPS_ALERT_WINDOW_MS` (solo oltre `OPS_ALERT_MIN_REQUESTS` richieste).
- **Spike WS reject**: trigger se i reject WS nella finestra superano `OPS_ALERT_WS_REJECTS_DELTA`.
- **Spike ingest reject**: trigger se gli ingest rifiutati nella finestra superano `OPS_ALERT_INGEST_REJECTS_DELTA`.
- **Anti-spam**: cooldown per chiave alert con `NOTIFY_OPS_COOLDOWN_MS`.
- **Canale**: usa `NOTIFY_WEBHOOK_URL` (stesso endpoint già usato per water/env alerts).

## Backup e restore
- Dati storici persistono nel volume Docker `gateway_data` (`/app/data/readings.jsonl`).
- Backup: snapshot volume giornaliero.
- Restore: sostituisci `readings.jsonl` a container fermo e riavvia servizio.

## Rotazione segreti
1. Genera nuovi valori per `AUTH_PASSWORD` e `INGEST_SECRET`.
2. Aggiorna configurazione e riavvia `gateway`.
3. Revoca sessioni attive riavviando il servizio (session store in-memory).

## Rollback
1. Tagga immagini prima del deploy.
2. In caso di regressione, redeploy immagine precedente.
3. Verifica `/readyz` e allineamento dashboard.
