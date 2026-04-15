# Piano operativo — palestra grande (Livorno)

Documento di lavoro per allineare impianto, IT e gestione. Completare le sezioni A–B in sede; C–E guidano implementazione tecnica (già parzialmente automatizzata nel repository).

---

## A. Requisiti (funzionali e organizzativi)

### Grandezze da monitorare (spuntare e prioritizzare)

- [ ] Temperatura / comfort docce e spogliatoi (per piano o per blocco)
- [ ] Livello riserva idrica (serbatoio, vasca compensazione, torre di raffreddamento se presente)
- [ ] Umidità relativa e/o CO₂ nelle sale corsi (comfort e ricambio aria)
- [ ] Temperature tecniche (sala macchine, locale pompe, quadri elettrici)
- [ ] Allagamenti / perdite (sonde punto o multisensoriale)
- [ ] UPS / continuità elettrica (stato, batteria %)
- [ ] Accessi / presenza (solo se policy privacy e finalità sono chiare)

### Allarmi e responsabilità

- Chi riceve SMS/push/email fuori orario? (incaricato tecnico + backup)
- Soglie allarme (es. acqua &lt; 20%, docce &gt; 38 °C) e tempi di escalation
- Orari di manutenzione programmata (silenziare notifiche)

### Vincoli

- Budget hardware e canoni manutenzione annui
- Obbligo di non modificare impianti in garanzia senza fornitore

---

## B. Sopralluogo impiantistico (checklist)

### Elettrico e quadri

- [ ] Ubicazione quadri BT, gruppi di misura, eventuale BMS esistente
- [ ] Disponibilità alimentazioni dedicate per gateway e switch PoE
- [ ] Messa a terra e SPD (sovratensioni) in locale tecnico

### Idraulico

- [ ] Schema vasche/serbatoi, posizione sonde livello esistenti o da installare
- [ ] Materiali fluidi (acqua sanitaria vs tecnica) e classificazione zone ATEX se pertinente

### Rete

- [ ] Cablaggio Ethernet verso sala server / rack
- [ ] VLAN dedicate (sensori separati da Wi‑Fi ospiti)
- [ ] Connettività Internet di backup (LTE) se la dashboard è anche remota

### Documentazione da richiedere

- [ ] Schemi unifilari aggiornati
- [ ] Manuali sonde / inverter / centraline già installate con protocolli (Modbus, BACnet, ecc.)

---

## C. MVP tecnico (in sede + software)

### Architettura consigliata

1. **Gateway / mini PC** (Linux) nella sala tecnica: lettura sensori, buffering offline se rete assente.
2. **Backend Node** (cartella `server/`): normalizza dati, espone REST + WebSocket, opzionale chiave API.
3. **Dashboard React** (questo progetto): polling REST e/o stream WebSocket, selezione **zona**.

### Comandi rapidi

- Solo frontend simulato: `npm start` (nessun `REACT_APP_GATEWAY_MODE` e nessun `REACT_APP_SENSOR_API_URL`)
- Solo backend di esempio: `npm run server` (dopo `npm install` in `server/`)
- Backend + frontend insieme: `npm install` (root) e `npm install` in `server/`, poi dalla root `npm run stack` (attiva proxy + `REACT_APP_GATEWAY_MODE=proxy`)

### Storico, login e allarmi (MVP tecnico esteso)

- **Storico**: campioni append-only in `server/data/readings.jsonl`; lo snapshot REST include fino a ~120 punti (storico + live).
- **Storico grezzo**: `GET /api/history?zoneId=...&limit=...` per export o grafici futuri.
- **Login**: con `REQUIRE_AUTH=true` sul server, `POST /api/auth/login` + cookie `httpOnly` + token nel body per WebSocket (`?token=`).
- **Allarme acqua**: se definito `NOTIFY_WEBHOOK_URL`, il server invia un POST JSON quando una zona scende sotto il 20% (con cooldown).

---

## D. Privacy, sicurezza, conformità

### Dati trattati

- I campioni tecnici (temperature, livelli) in genere **non** sono dati personali.
- Se in futuro si collegano **accessi nominativi** o telecamere, serve valutazione **GDPR** (titolare, finalità, conservazione, DPIA se necessario).

### Sicurezza applicativa

- In produzione usare **HTTPS** (reverse proxy: Nginx, Caddy, Traefik) davanti al backend.
- La chiave `REACT_APP_SENSOR_API_KEY` è **visibile nel bundle** del browser: adatta solo a MVP o rete interna. Per esposizione pubblica usare **sessione lato server** o **token** con rotazione e dominio same-origin.
- Limitare **CORS** a origini note (`CORS_ORIGIN` nel server).
- Aggiornare periodicamente dipendenze (`npm audit`).

### Continuità operativa

- Backup configurazione e database (se si aggiunge DB persistente).
- Monitoraggio uptime del servizio (anche semplice healthcheck esterno).

---

## E. Scalabilità (struttura grande, più zone)

### Modello dati

- Ogni **zona** ha identificativo stabile (`id`) e nome leggibile.
- Il backend espone `GET /api/zones` e `GET /api/dashboard/snapshot?zoneId=...`.
- Il client mostra un **selettore zona** e aggiorna grafici e log in base alla zona.

### Evoluzioni successive

- Persistenza serie storiche (InfluxDB, TimescaleDB, o tabella dedicata).
- Ruoli utente (solo lettura, amministratore impianto).
- Secondo display in reception: stessa app con `REACT_APP_FACILITY_LINE` dedicata o URL con query `zoneId` (estensione futura).

---

## Riferimenti nel codice

| Elemento | Percorso |
|----------|----------|
| Contratto REST client | `src/services/sensorApi.js` |
| Normalizzazione payload | `src/services/sensorNormalize.js` |
| Simulazione locale / zone mock | `src/services/mockSensors.js` |
| Logica polling + WebSocket | `src/hooks/useDashboardSensors.js` |
| Selettore zona UI | `src/components/ZoneSelector.js` |
| Backend di esempio | `server/index.js` |
| Checklist prossime azioni (ingest Arduino, domande al prof) | `docs/PROSSIMI_PASSI.md` |
