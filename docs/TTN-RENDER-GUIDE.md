# Guida TTN Webhook → Render Backend

Configurazione passo-passo per collegare The Things Network al backend su Render.

---

## 🎯 Obiettivo

Far arrivare i dati dei sensori LoRaWAN da TTN Console al tuo backend Render.

```
[Sensori Fisici] → [Gateway] → [TTN Cloud] → [Webhook] → [Render Backend] → [Dashboard]
```

---

## 1. Prerequisiti

### Su Render.com
- [ ] Backend deployato e online
- [ ] Variabili `INGEST_SECRET` o `API_KEY` impostate
- [ ] URL backend: `https://backend-palestra.onrender.com`

### Su TTN Console
- [ ] Application creata (es: "palestra-sensori")
- [ ] Almeno un end device registrato
- [ ] Gateway connesso e online

---

## 2. Configurazione Webhook su TTN

### Passaggi

1. **Vai su TTN Console** → Seleziona la tua Application
2. **Menu laterale** → "Integrations" → "Webhooks"
3. Clicca **"Add Webhook"**

### Campi da compilare:

| Campo | Valore | Esempio |
|-------|--------|---------|
| **Webhook ID** | Nome mnemonico | `render-backend` |
| **Base URL** | URL backend + endpoint | `https://backend-palestra.onrender.com/api/ingest` |
| **Enabled events** | Solo quello necessario | `Uplink message` |

### Headers personalizzati:

Clicca "Add Header Entry":

```
Header Name: x-ingest-secret
Header Value: (copia valore da INGEST_SECRET su Render)
```

**Alternativa** se usi `API_KEY`:
```
Header Name: x-api-key
Header Value: (copia valore da API_KEY su Render)
```

4. Clicca **"Create Webhook"**

---

## 3. Verifica Configurazione

### 3.1 Test da TTN Console

1. Vai su "Live Data" della tua Application
2. Attendi che un nodo invii un uplink (o premi pulsante sul nodo)
3. Verifica che compaia un messaggio nella lista

### 3.2 Test con curl (manuale)

Da terminale locale:

```bash
curl -X POST https://backend-palestra.onrender.com/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-ingest-secret: TUO_INGEST_SECRET" \
  -d '{
    "end_device_ids": {
      "device_id": "test-node-01",
      "application_ids": {"application_id": "palestra-sensori"},
      "dev_eui": "AABBCCDDEEFF0011",
      "join_eui": "0000000000000000"
    },
    "uplink_message": {
      "f_port": 1,
      "f_cnt": 42,
      "frm_payload": "AQIDBA==",
      "decoded_payload": {
        "temperatureC": 24.5,
        "humidityPercent": 60,
        "batteryPercent": 85
      },
      "metadata": {
        "time": "2024-01-15T10:30:00Z",
        "gateways": [{
          "gateway_id": "palestra-gateway-01",
          "rssi": -95,
          "snr": 7.5
        }]
      }
    }
  }'
```

**Risposta attesa:**
```json
{
  "ok": true,
  "processed": {
    "devEui": "aabb:ccdd:eeff:0011",
    "timestamp": "2024-01-15T10:30:00Z",
    "type": "unknown"
  }
}
```

### 3.3 Verifica dashboard

1. Apri `https://backend-palestra.onrender.com`
2. Vai alla tab "Rete LoRa"
3. Dovresti vedere il nodo "test-node-01" con stato "online"

---

## 4. Configurazione Mappature Sensori

Se aggiungi nuovi sensori, configura le mappature via env:

### Su Render Dashboard

1. Vai su Environment → Add Environment Variable
2. **Name**: `SENSOR_MAPPINGS_JSON`
3. **Value**: JSON con mappature (esempio):

```json
{
  "palestra-aria-01": {
    "type": "air",
    "fields": ["co2Ppm", "vocIndex", "lux"],
    "sensorType": "air-quality"
  },
  "palestra-acqua-01": {
    "type": "water",
    "fields": ["levelPercent", "temperatureC"],
    "sensorType": "water-level"
  }
}
```

**Note:**
- Chiave deve corrispondere a `device_id` su TTN
- `type`: determina quale analisi applicare (water/air/temperature)
- `fields`: campi dal payload decodificato

---

## 5. Debug Errori Comuni

### Errore 401 Unauthorized

**Sintomo:** TTN mostra "Last error" con codice 401

**Cause e soluzioni:**
- `INGEST_SECRET` non impostato su Render → aggiungilo
- Header `x-ingest-secret` errato → verifica copia-incolla
- Spazi iniziali/finali → rimuovi

### Errore 404 Not Found

**Sintomo:** Risposta 404 dal backend

**Causa:** URL errato

**Verifica:**
```bash
curl https://backend-palestra.onrender.com/api/zones
```

Deve restituire lista zone. Se 404, l'URL base è sbagliato.

### Payload non decodificato

**Sintomo:** Dashboard non mostra dati ma richieste arrivano (200 OK)

**Verifica:**
1. TTN Console → Application → Payload Formatters
2. Formatter deve restituire oggetto con `data: { ... }`
3. Campi devono corrispondere a `fields` in `SENSOR_MAPPINGS_JSON`

### Nodo visto come "unknown"

**Sintomo:** Response type: "unknown"

**Soluzione:**
- Verifica `device_id` in curl = chiave in `SENSOR_MAPPINGS_JSON`
- O usa pattern inferenza automatica:
  - Nome contiene "air" → type: air
  - Nome contiene "water" → type: water
  - Nome contiene "temp" → type: temperature

---

## 6. Test End-to-End

### Flusso completo di verifica

1. **Accendi un nodo fisico** (o simula con `npm run sim:lora`)
2. **Attendi 30-60 secondi**
3. **Verifica su TTN** → Live Data mostra uplink
4. **Verifica su Render Logs** → `render logs --tail` vede richiesta
5. **Verifica su Dashboard** → Nodo appare in tab "Rete"
6. **Verifica grafico** → Dato temperatura visibile

### Comandi utili

```bash
# Simula dati da locale
npm run sim:lora

# Test endpoint diretto
curl -H "x-ingest-secret: $INGEST_SECRET" \
  https://backend-palestra.onrender.com/api/ingest \
  -d @test-payload.json

# Vedi log Render in tempo reale
render logs --tail -s backend-palestra
```

---

## ✅ Checklist Finale

Prima di dichiarare configurazione completata:

- [ ] Webhook creato su TTN senza errori
- [ ] Test curl restituisce `{"ok": true}`
- [ ] Primo dato da nodo reale visibile su dashboard
- [ ] Tab "Rete LoRa" mostra nodo con RSSI/SNR
- [ ] Grafico temperatura aggiornato
- [ ] Notifica Telegram testata (se configurato)

---

*Configurazione completata? Il sistema è pronto per ricevere dati reali dai sensori.*
