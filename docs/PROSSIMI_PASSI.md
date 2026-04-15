# Prossimi passi — progetto palestra / telecomunicazioni

Guida operativa per **te** e per il **referente in palestra** (prof / CEO), così il lavoro resta ordinato anche senza il vecchio sorgente.

---

## 1. Questa settimana (incontro 15–20 minuti)

Chiedi al prof / chi gestisce l’impianto:

1. **Le sonde temperatura docce sono ancora quelle installate con Arduino?** (modello, cavi, dove sono i quadri.)
2. **I dati oggi come arrivano al PC** (USB-seriale, Ethernet, Wi‑Fi, altro)?
3. **Quante zone “docce”** vuoi sul monitor (una per piano? una per blocco spogliatoi?).
4. **Serve solo temperatura acqua** o anche livello riserva / allarmi?

Annota le risposte: diventano i **requisiti** del progetto.

---

## 2. Cosa hai già nel repository (dimostrabile al prof)

| Pezzo | Ruolo |
|--------|--------|
| Dashboard React | Grafici, zone, tema, login opzionale |
| Server Node | API, WebSocket, storico su file, allarme webhook |
| **`POST /api/ingest/reading`** | Simula ciò che farà **Arduino/ESP** quando invierà una lettura in HTTP |

---

## 3. Prova ingest “come Arduino” (senza hardware)

1. Avvia stack: `npm run stack` (o solo `npm run server`).
2. Invia un campione (PowerShell, da un altro terminale):

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/ingest/reading" -Method POST -ContentType "application/json" -Body '{"zoneId":"docce-p1","temperatureC":31.2,"source":"demo-postman"}'
```

3. Apri la dashboard, seleziona **Docce · Spogliatoi piano -1**: grafico e log devono aggiornarsi (riga `[INGEST]`).

**Sicurezza in laboratorio:** in `server/.env` imposta `INGEST_SECRET=una-chiave-lunga` e invia header:

`x-ingest-secret: una-chiave-lunga`

Se non imposti né `INGEST_SECRET` né `API_KEY`, l’ingest è aperto (solo per demo in rete locale).

**Solo dati “reali” / da ingest**, senza numeri random ogni 2 s:

```env
DISABLE_AUTO_TICK=true
```

Poi i grafici avanzano solo con `POST /api/ingest/reading` (o con script che lo richiama).

---

## 4. Prossima milestone tecnica (Arduino / ESP32)

1. **Firmware** (nuovo, versionato su Git): legge sonde → invia JSON ogni N secondi a  
   `http://<IP-server>:4000/api/ingest/reading` con `x-ingest-secret`.
2. **Rete palestra**: IP fisso o DHCP riservato per il gateway; preferibilmente **cavo** o Wi‑Fi dedicato.
3. **Collaudo**: confronta una lettura con termometro di riferimento (una volta).

---

## 5. Consegna “da corso” (telecomunicazioni)

Documenta in 2–4 pagine:

- Schema a blocchi: **sensore → MCU → HTTP/MQTT → server → dashboard**.
- **Protocollo** (HTTP usato ora; in alternativa MQTT in futuro).
- **Sicurezza**: segreto ingest, HTTPS in produzione.
- **Screenshot** della dashboard + esempio di log `[INGEST]`.

---

Per modifiche al codice chiedi in **Agent mode** con obiettivi precisi (es. “aggiungi MQTT” o “scheda Arduino in `firmware/`”).
