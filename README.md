# Palestra Dashboard

Monitoraggio smart per ambienti palestra: frontend React con dashboard real-time e backend Node.js con API REST, storico su file e WebSocket.

![License](https://img.shields.io/badge/license-Private-6b7280?style=for-the-badge)
![React](https://img.shields.io/badge/react-18-61dafb?style=for-the-badge&logo=react&logoColor=111827)
![Node](https://img.shields.io/badge/node.js-18%2B-3c873a?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/status-prototype-f59e0b?style=for-the-badge)

---

## Panoramica

Questa applicazione nasce per supervisione tecnica e operativa di una palestra, con focus su:

- temperatura e stato acqua per zona,
- qualità aria (CO2, VOC, umidita),
- storico consultabile ed esportabile,
- integrazione ingest da dispositivi (Arduino / ESP / simulatori).

### Anteprima layout

![Mappa piano palestra](public/plans/piano-1.svg)

---

## Funzionalita principali

- Dashboard React con UI moderna e aggiornamenti live.
- Gateway Node.js/Express con endpoint REST e stream WebSocket.
- Persistenza storico su file per analisi e report.
- Modalita auth opzionale per ambienti protetti.
- Endpoint ingest dedicato per dati da sensori esterni.

---

## Stack Tecnologico

### Frontend

- React 18
- Chart.js + react-chartjs-2
- lucide-react

### Backend

- Node.js + Express
- WebSocket (`ws`)
- Helmet, CORS, dotenv

---

## Quick Start

### Prerequisiti

- [Node.js](https://nodejs.org/) LTS (consigliato 18+)
- npm

### 1) Installazione dipendenze

```bash
npm install
npm --prefix server install
```

### 2) Avvio stack completo (consigliato)

```bash
npm run stack
```

Avvia:

- frontend su `http://localhost:3000`
- backend su `http://localhost:4000`

### 3) Avvio frontend standalone (mock/simulato)

```bash
npm start
```

### 4) Avvio solo backend

```bash
npm run server
```

---

## Configurazione Ambiente

- Frontend: copia `.env.example` in `.env` (se necessario).
- Backend: copia `server/.env.example` in `server/.env`.

Note utili:

- se `REQUIRE_AUTH=true`, `AUTH_PASSWORD` e obbligatoria;
- `CORS_ORIGIN` supporta lista separata da virgole;
- con `npm run stack` il frontend usa il gateway in modalita proxy.

---

## API Rapide

### Ingest sensori

`POST /api/ingest/reading`

Esempio payload:

```json
{
  "zoneId": "docce-p1",
  "temperatureC": 30.5,
  "waterPercent": 68,
  "humidityPercent": 55,
  "co2Ppm": 720,
  "vocIndex": 120,
  "source": "arduino"
}
```

### Storico

- `GET /api/history?zoneId=...&limit=200&from=&to=`
- `GET /api/report/csv?zoneId=...`

---

## Qualita e Build

```bash
npm run lint
npm run test:all
npm run build
```

Build frontend generata in `build/`.

---

## Roadmap Prototype

- hardening sicurezza e gestione segreti,
- storage storico su database (oltre file system),
- alerting automatico su soglie critiche,
- dashboard ruoli/permessi multi-utente.

---

## Contatti

Progetto sviluppato da **Elena Trambusti**.  
Per evoluzioni del prototipo, apri una issue o una pull request.
