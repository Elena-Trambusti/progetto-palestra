# Operatività e risoluzione problemi

Guida rapida quando la dashboard non si aggiorna o i dati LoRa non arrivano. Ordine consigliato dei controlli.

## 1. Il server risponde?

- `GET /health` → deve essere `200` e `ok: true`.
- `GET /readyz` → deve essere `200` con `ok: true`.
  - Con **PostgreSQL** configurato (`DATABASE_URL`), se il database non è raggiungibile si ottiene **`503`** e `postgresReachable: false`. I load balancer possono usare questo endpoint per togire traffico dal nodo non sano.

## 2. Webhook The Things Network (TTN)

1. In TTN: **Integrations → Webhooks** (o flusso equivalente): URL deve puntare al tuo backend pubblico, es. `https://tuo-dominio.example/api/ingest`.
2. Header **`x-ingest-secret`** uguale a **`INGEST_SECRET`** nel file `.env` del server.
3. Da casa senza IP pubblico: usare un **tunnel** (ngrok, Cloudflare Tunnel, ecc.) verso la porta del gateway, e configurare quell’URL in TTN.
4. In TTN, controllare i **log dell’integrazione**: errori HTTP 401 (segreto sbagliato), 429 (rate limit ingest), 503 (database irraggiungibile o `database_required` se manca Postgres).

## 3. PostgreSQL e anagrafica sensori

- Senza **`DATABASE_URL`**, `POST /api/ingest` risponde con errore che richiede il database: è il comportamento previsto per il flusso TTN completo.
- Ogni dispositivo deve esistere in tabella **sensori** con **`dev_eui`** corrispondente a TTN (16 caratteri esadecimali, senza spazi). Uplink da EUI sconosciuti vengono scartati (`unauthorized_device`).

## 4. Formato payload

- Se usi **decoder lato TTN**, i campi in `decoded_payload` devono essere riconosciuti dal backend (es. `temperature`, `humidity`, `level`, …) oppure occorre allineare il firmware al **decoder binario** del server.
- Payload troppo corto o byte non coerenti → errori `decode_binary_range` o `decode_failed` nei log.

## 5. Dashboard e WebSocket

- Il frontend deve usare la **stessa origine** consentita da **CORS** (`CORS_ORIGIN`) o proxy verso il backend.
- In produzione non usare `CORS_ORIGIN=*` (il server lo rifiuta in `NODE_ENV=production`).
- Se i dati REST ci sono ma la UI non è “live”, controllare firewall/proxy per **WebSocket** sul path `/ws`.

## 6. Rate limiting ingest

- Variabili opzionali: **`INGEST_RATE_LIMIT_MAX`** (richieste consentite per finestra), **`INGEST_RATE_LIMIT_WINDOW_MS`** (durata finestra in ms). Default in produzione: 120 richieste/minuto per IP; in sviluppo: 240. Se TTN o molti dispositivi superano la soglia, aumentare il limite o allargare la finestra.

## 7. Metriche

- `GET /metrics` (testo Prometheus-like): utili per contare `ingest_accepted_total`, `ingest_rejected_total`, errori HTTP.

## 8. Sicurezza

- Non committare **token**, **password** o `.env` con segreti reali.
- In produzione: **`REQUIRE_AUTH=true`**, password dashboard sufficientemente lunga, **`INGEST_SECRET`** o **`API_KEY`** impostati.
