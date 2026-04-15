# Runbook Operativo

## Pre-release checklist
- Verifica CI verde (`lint`, `test frontend`, `test backend`, `build`).
- Verifica variabili prod obbligatorie: `REQUIRE_AUTH=true`, `AUTH_PASSWORD`, `INGEST_SECRET`, `CORS_ORIGIN`.
- Verifica endpoint salute: `/health`, `/readyz`, `/metrics`.

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
