# Guida Operativa - Installazione Sensori in Palestra

Guida essenziale per l'installazione fisica dei sensori LoRaWAN in palestra.

---

## 📋 Checklist Pre-Installazione

### Materiali necessari
- [ ] Nodi sensori (caricati >80% batteria)
- [ ] Gateway LoRaWAN
- [ ] Cavo Ethernet per gateway
- [ ] Alimentazione gateway (PoE o adattatore)
- [ ] Smartphone/tablet per test
- [ ] Accesso TTN Console (account configurato)
- [ ] Accesso backend Render (URL e credenziali admin)

### Verifica preliminare
- [ ] Dashboard online: `https://backend-palestra.onrender.com`
- [ ] Database migration eseguite: `npm run db:setup`
- [ ] TTN Application creata con nome "palestra-sensori"

---

## 🛰️ Configurazione Gateway LoRaWAN

### 1. Registrazione su TTN Console
1. Vai su [console.thethingsnetwork.org](https://console.thethingsnetwork.org)
2. Clicca "Gateways" → "Add Gateway"
3. Inserisci:
   - **Gateway ID**: `palestra-gateway-01`
   - **Gateway EUI**: (leggi sull'etichetta del dispositivo fisico)
   - **Frequency Plan**: Europe 863-870 MHz (SF9 for RX2)
   - **Location**: coordinate palestra

### 2. Configurazione fisica gateway
1. Collega gateway alla rete Ethernet
2. Alimenta il gateway
3. Attendi 2-3 minuti che si registri su TTN
4. Verifica su TTN Console: stato deve essere "Connected"

---

## 📡 Registrazione Sensori (End Devices)

Per ogni nodo da installare:

1. **TTN Console** → Application "palestra-sensori" → "Add end device"
2. **Device ID**: usa nome mnemonico (es: `palestra-aria-01`, `palestra-acqua-01`)
3. **DevEUI**: leggi sull'etichetta del nodo
4. **AppEUI/AppKey**: generati automaticamente, copiali
5. **Frequency Plan**: Europe 863-870 MHz
6. **LoRaWAN Version**: 1.0.2 (o come da datasheet nodo)

### Payload Formatter (JavaScript)

Vai su Application → Payload Formatters → Uplink:

```javascript
function decodeUplink(input) {
  // Esempio: 4 byte temperatura (float), 1 byte umidità, 1 byte batteria
  var temp = (input.bytes[0] | (input.bytes[1] << 8)) / 100;
  var humidity = input.bytes[2];
  var battery = input.bytes[3];
  
  return {
    data: {
      temperatureC: temp,
      humidityPercent: humidity,
      batteryPercent: battery
    }
  };
}
```

*Adatta in base al payload reale del tuo sensore*

---

## 🔗 Collegamento Backend Render

### 1. Configura Webhook su TTN

**TTN Console** → Application → Integrations → Webhooks → "Add Webhook"

- **Webhook ID**: `render-backend`
- **Base URL**: `https://backend-palestra.onrender.com/api/ingest`
- **Enabled events**: Uplink message
- **Headers**:
  - `x-ingest-secret`: (valore da `INGEST_SECRET` su Render)

### 2. Test connessione

```bash
# Da locale, simula un payload
curl -X POST https://backend-palestra.onrender.com/api/ingest \
  -H "x-ingest-secret: TUO_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "end_device_ids": {
      "device_id": "palestra-test-01",
      "dev_eui": "AABBCCDDEEFF0011"
    },
    "uplink_message": {
      "decoded_payload": {
        "temperatureC": 24.5,
        "humidityPercent": 60
      }
    }
  }'
```

Verifica risposta: `{ "ok": true }`

---

## 📍 Posizionamento Ottimale Sensori

### Criteri generali
- **Altezza**: 1.5-2m da terra (evitare calpestio)
- **Distanza gateway**: max 500m in linea d'aria, max 3 pareti
- **Ostacoli**: evitare armadi metallici, specchi, acqua

### Sensori specifici

| Tipo | Posizione ideale | Note |
|------|------------------|------|
| **Aria/CO2** | Parete centrale sala, altezza petto | Lontano da finestre, condizionatori |
| **Acqua/Flusso** | Vicino contatore o tubazione principale | Possibile installazione tecnica |
| **Livello serbatoio** | Sopra serbatoio, protetto da umidità | Considerare altezza massima |
| **Generico** | Punto rappresentativo zona | Evitare angoli isolati |

---

## ✅ Verifica Finale

### Test sequenziale

1. **Accendi un nodo** → attendi 30 secondi
2. **Verifica TTN Console** → "Live Data" deve mostrare uplink
3. **Verifica Dashboard** → nodo appare nella tabella rete
4. **Verifica grafico** → primo dato temperatura visibile

### Checklist finale
- [ ] Gateway online su TTN
- [ ] Almeno un nodo vede segnale (RSSI > -120 dBm)
- [ ] Dashboard mostra nodo nella tabella "Rete LoRa"
- [ ] Primo dato visibile nel grafico temperatura
- [ ] Test notifica Telegram (se configurato)

---

## 🆘 Troubleshooting

### Gateway non connette
- Verifica cavo Ethernet
- Verifica LED gateway (verde = ok, rosso = errore)
- Controlla firewall rete (porte 1700/udp)

### Nodo non visto da gateway
- Verifica nodo acceso (LED lampeggia)
- Verifica DevEUI corretto in TTN
- Aumenta distanza da gateway (test 10m -> 50m -> 100m)
- Controlla antenna nodo (avvitata correttamente)

### Dati non arrivano a dashboard
- Verifica webhook TTN: "Last error" vuoto?
- Verifica INGEST_SECRET su Render = header inviato
- Test con `curl` manuale
- Controlla log Render: `render logs --tail`

### Segnale debole (RSSI < -115)
- Sposta nodo più vicino a gateway
- Cambia orientamento antenna (verticale vs orizzontale)
- Aggiungi gateway repeater intermedio

---

## 📞 Contatti Emergenza

- **Supporto TTN**: [www.thethingsnetwork.org/community](https://www.thethingsnetwork.org/community)
- **Log Render**: Dashboard → Logs su console.render.com
- **Test locale**: `npm run demo` per simulare dati

---

*Ultimo aggiornamento: preparazione software completata*
