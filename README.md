# Dashboard monitoraggio palestra

Interfaccia React (tema cyberpunk) + backend Node di esempio con zone, storico su file, autenticazione opzionale e WebSocket.

## Requisiti

- [Node.js](https://nodejs.org/) LTS (consigliato 18+)
- npm (incluso con Node)

## Avvio rapido (solo interfaccia, dati simulati)

```bash
npm install
npm start
```

Apri il browser su **http://localhost:3000**. Non serve il server sulla porta 4000.

## Avvio con backend (consigliato per provare API reali)

1. Installa le dipendenze del server (prima volta):

   ```bash
   cd server
   npm install
   cd ..
   ```

2. Dalla **radice** del progetto:

   ```bash
   npm run stack
   ```

   Partono insieme il gateway (porta **4000**) e, quando è pronto, il frontend (porta **3000**), con proxy già configurato. Apri sempre **http://localhost:3000** per la dashboard: la porta 4000 è solo API/WebSocket.

3. Apri **http://localhost:3000**.

## Solo il server API

```bash
npm run server
```

Le API sono su **http://localhost:4000** (nessuna pagina React su questa porta).

## Variabili d’ambiente

- Esempi per il frontend: **`.env.example`** (copia in `.env` se serve).
- Esempi per il server: **`server/.env.example`** (copia in `server/.env`).

Note:

- Con `REQUIRE_AUTH=true` sul server è **obbligatorio** impostare `AUTH_PASSWORD` (non lasciare vuoto).
- In production `AUTH_PASSWORD` deve rispettare la lunghezza minima (`AUTH_MIN_PASSWORD_LEN`, default 12).
- `CORS_ORIGIN` accetta una lista separata da virgole; origini non in lista ricevono `403 cors_origin_denied`.
- `npm run stack` imposta `REACT_APP_GATEWAY_MODE=proxy` per instradare `/api` e `/ws` verso il backend.

## Build di produzione

```bash
npm run build
```

Output in `build/`. Servi i file statici con un web server e metti dietro un reverse proxy HTTPS verso il processo Node se usi il gateway in produzione.

## Ingest da dispositivo (Arduino / ESP / test)

Il server espone `POST /api/ingest/reading` con JSON ad esempio:

`{"zoneId":"docce-p1","temperatureC":30.5,"waterPercent":68,"humidityPercent":55,"co2Ppm":720,"vocIndex":120,"source":"arduino"}`

Opzionale: `waterPercent`, `humidityPercent` (o `humidityPct` / `rh`), `co2Ppm` (o `co2`), `vocIndex` (o `voc` / `iaq`). In produzione usa `INGEST_SECRET` (header `x-ingest-secret`) o `API_KEY`.

Storico multi-grandezza: `GET /api/history?zoneId=...&limit=200&from=&to=` restituisce anche `samples`. Export: `GET /api/report/csv?zoneId=...`.

Dettagli e checklist: **`docs/PROSSIMI_PASSI.md`**.

## Documentazione operativa estesa

Vedi **`docs/PIANO_PALESTRA_LIVORNO.md`** (requisiti, sopralluogo, sicurezza, roadmap).
