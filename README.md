# Monitoraggio Palestra – Sistema IoT LoRaWAN

Piattaforma di supervisione distribuita: nodi **Arduino MKR WAN 1310** comunicano via **LoRaWAN EU868 Classe A** al gateway **Ebyte E870 (SX1302)**, che inoltra i dati a TTN e poi al backend Node.js su Render.

![Hardware](https://img.shields.io/badge/hardware-Arduino_MKR_WAN_1310-00979D?style=for-the-badge&logo=arduino&logoColor=white)
![Gateway](https://img.shields.io/badge/gateway-Ebyte_E870_SX1302-FF6B35?style=for-the-badge)
![Protocol](https://img.shields.io/badge/LoRaWAN-EU868_ClassA-7B2D8B?style=for-the-badge)

---

## Architettura

```
[MKR WAN 1310 – Vano Idrico]  ─┐
  YF-S201 (Interrupt D4)        │ LoRaWAN EU868
  HC-SR04 (livello)             │ Classe A
  NTC 10k (temperatura)         │
                                │
[MKR WAN 1310 – Palestra]     ─┤──► [Ebyte E870 SX1302 – Piano 1]
  SCD41 (CO2/T/RH, I2C)        │         Ethernet RJ45
                                │              │
                                         [TTN v3 Cloud]
                                               │ HTTPS Webhook
                                    [Backend Node.js su Render]
                                     PostgreSQL · WebSocket · Telegram
```

---

## Schema Connessioni Pin

### Nodo CO2/Ambiente – MKR WAN 1310 + Sensirion SCD41

| Pin MKR | Funzione | Pin SCD41 |
|---|---|---|
| `3.3V` | Alimentazione | VDD |
| `GND` | Massa | GND |
| `A4 (SDA)` | I2C Data | SDA |
| `A5 (SCL)` | I2C Clock | SCL |
| — | Modalità I2C | SEL → GND via 10kΩ |

Pull-up: 4.7 kΩ tra SDA→3.3V e SCL→3.3V (se non sul breakout).

### Nodo Idrico – MKR WAN 1310 + YF-S201 + HC-SR04

| Pin MKR | Funzione | Sensore |
|---|---|---|
| `5V` | Alimentazione flusso | YF-S201 rosso |
| `GND` | Massa comune | YF-S201 nero / HC-SR04 GND |
| `D4` | Interrupt impulsi (INPUT_PULLUP) | YF-S201 giallo (signal) |
| `D5` | HC-SR04 TRIG | TRIG |
| `D6` | HC-SR04 ECHO (**via partitore 10k+22k**) | ECHO (5V→3.3V) |
| `A0` | NTC (partitore con 10kΩ → GND) | Polo+ NTC |

> ⚠️ **ECHO HC-SR04 è a 5V.** Usa partitore resistivo o level-shifter prima di D6.

---

## Payload HEX Compresso

### Nodo CO2 (7 byte) – porta LoRa 1

| Byte | Campo | Tipo | Scala |
|---|---|---|---|
| 0–1 | CO2 ppm | uint16 BE | × 1 |
| 2–3 | Temperatura | int16 BE | × 100 |
| 4–5 | Umidità | uint16 BE | × 100 |
| 6 | Batteria % | uint8 | × 1 |

### Nodo Idrico (8 byte) – porta LoRa 2

| Byte | Campo | Tipo | Scala |
|---|---|---|---|
| 0–1 | Portata L/min | uint16 BE | × 100 |
| 2–3 | Livello % | uint16 BE | × 100 |
| 4–5 | Temperatura | int16 BE | × 100 |
| 6 | Batteria % | uint8 | × 1 |
| 7 | Flags (bit0=wakeInt) | uint8 | — |

**Decoder TTN JavaScript nodo CO2:**
```javascript
function decodeUplink(input) {
  var b = input.bytes;
  return { data: {
    co2Ppm:          (b[0] << 8) | b[1],
    temperatureC:    ((b[2] << 8) | b[3]) / 100.0,
    humidityPercent: ((b[4] << 8) | b[5]) / 100.0,
    battery_level:   b[6]
  }};
}
```

**Decoder TTN JavaScript nodo Idrico:**
```javascript
function decodeUplink(input) {
  var b = input.bytes;
  return { data: {
    flowLmin:      ((b[0] << 8) | b[1]) / 100.0,
    levelPercent:  ((b[2] << 8) | b[3]) / 100.0,
    temperatureC:  ((b[4] << 8) | b[5]) / 100.0,
    battery_level: b[6],
    wakeOnFlow:    (b[7] & 0x01) ? true : false
  }};
}
```

---

## Procedura Pairing Nodo ↔ Gateway (OTAA)

### Step 1 – Registra il Gateway Ebyte E870 su TTN

1. TTN Console → *Gateways* → **+ Register gateway**
2. **Gateway EUI**: recuperalo dal pannello web E870 (`http://192.168.1.10`)
3. **Frequency plan**: `Europe 863-870 MHz (SF9 for RX2 - recommended)`
4. **Gateway Server**: `eu1.cloud.thethings.network`
5. Salva → lo stato diventa `Connected` (LED LoRa verde).

### Step 2 – Crea Application TTN

1. *Applications* → **+ Create application** → ID: `palestra-livorno`
2. **Payload formatters → Uplink → Custom Javascript** → incolla il decoder sopra.

### Step 3 – Registra End Device

1. *End devices* → **+ Register end device** → *Enter manually*
2. Scegli: `LoRaWAN MAC V1.0.3` / `Europe 863-870 MHz`
3. Leggi il **DevEUI** dalla porta seriale Arduino (115200 baud):
   ```
   [LoRa] DevEUI: AABBCCDDEEFF0011
   ```
4. Genera **AppEUI** e **AppKey** → copia nei file `.ino`:
   ```cpp
   const char APP_EUI[] = "0000000000000000";
   const char APP_KEY[] = "A1B2C3D4...";
   ```
5. Flash il firmware. Verifica:
   ```
   [LoRa] Join OTAA tentativo 1
   [LoRa] Join OK
   ```

### Step 4 – Webhook TTN → Backend Render

1. Application → *Integrations* → *Webhooks* → **+ Add webhook**
2. **Base URL**: `https://<backend>.onrender.com`
3. Abilita **Uplink message**
4. Header: `Authorization: Bearer <INGEST_SECRET>`
5. Il backend riceve dati su `POST /api/ttn/webhook`.

---

## Variabili d'Ambiente – `server/.env`

| Variabile | Obbligatoria | Descrizione |
|---|:-:|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `INGEST_SECRET` | ✅ prod | Token Bearer webhook TTN |
| `AUTHORIZED_DEV_EUIS` | ✅ | DevEUI whitelist (virgola-separati) |
| `BACKUP_AUTO_ENABLED` | ❌ | Backup automatico DB su Render (`true`/`false`) |
| `TELEGRAM_BOT_TOKEN` | ⭐ | Token bot allarmi Telegram |
| `TELEGRAM_CHAT_ID` | ⭐ | Chat ID per notifiche allarmi |
| `TELEGRAM_AUTO_MONITOR` | ⭐ | Abilita monitor auto (`true`) |
| `REQUIRE_AUTH` | ✅ prod | Protezione login (`true`) |
| `AUTH_PASSWORD` | ✅ prod | Password dashboard (min 12 car.) |
| `CORS_ORIGIN` | ✅ | URL frontend consentito |
| `DISABLE_AUTO_TICK` | — | Disabilita simulazione (`true` in prod) |
| `AIR_CO2_THRESHOLD` | — | Soglia allarme CO2 [ppm] (default 1000) |
| `WATER_LEAK_THRESHOLD` | — | Soglia flusso notturno [L/min] |

---

## Configurazione Gateway Ebyte E870

| Sezione | Parametro | Valore |
|---|---|---|
| LoRa → General | Frequency Plan | `EU868` |
| LoRa → General | LoRaWAN Version | `1.0.3` |
| Network → Server | Server Address | `eu1.cloud.thethings.network` |
| Network → Server | Server Port | `1700` (UDP) |
| Network → Server | Protocol | `Semtech UDP Packet Forwarder` |
| System → Time | NTP Server | `pool.ntp.org` |

---

## Librerie Arduino

| Libreria | Versione min | Uso |
|---|---|---|
| `MKRWAN` | 1.1.0 | Modem LoRaWAN MKR WAN 1310 |
| `Arduino Low Power` | 1.2.2 | Deep sleep |
| `Wire` | built-in | I2C per SCD41 |

Board package: **Arduino SAMD Boards** ≥ 1.8.13

---

## Quick Start Backend

```bash
npm install && npm --prefix server install
npm run stack        # frontend :3000 + backend :4000
npm run server       # solo backend
```

---

## Struttura Progetto

```
progetto-palestra/
├── arduino/
│   ├── mkr_node_co2_env.ino       ← Firmware nodo Palestra (SCD41)
│   └── mkr_node_water_flow.ino    ← Firmware nodo Idrico (YF-S201)
├── server/
│   ├── index.js
│   ├── lib/
│   │   ├── ttnIngest.js           ← Decoder webhook TTN
│   │   └── zonesData.js           ← Topologia hardware definitiva
│   └── .env
├── src/                           ← Frontend React
├── docs/
│   └── UserGuide.md               ← Manuale operativo titolare
└── render.yaml
```

*Progetto Elena Trambusti – Sistema IoT LoRaWAN Palestra.*
