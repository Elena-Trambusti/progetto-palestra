/**
 * =============================================================================
 * NODO AMBIENTE – CO2 / Temperatura / Umidità
 * Hardware : Arduino MKR WAN 1310
 * Sensore  : Sensirion SCD41 (I2C  SDA=A4  SCL=A5)
 * Protocollo: LoRaWAN Classe A · EU868 · OTAA
 * Libreria : MKRWAN.h (ufficiale Arduino)
 * Sleep    : LowPower.sleep() – deep sleep tra le trasmissioni
 * Payload  : 7 byte HEX compresso
 *
 * STRUTTURA PAYLOAD (7 byte):
 *  Byte 0-1  : CO2 ppm            (uint16 BE, es. 0x02D0 = 720 ppm)
 *  Byte 2-3  : Temperatura × 100  (int16  BE, es. 0x0970 = 24.16 °C)
 *  Byte 4-5  : Umidità × 100      (uint16 BE, es. 0x1518 = 54.00 %)
 *  Byte 6    : Batteria %          (uint8,     es. 0x5A   = 90 %)
 *
 * Decoder TTN JavaScript (incollare in Application > Payload Formatters):
 *   function decodeUplink(input) {
 *     var b = input.bytes;
 *     // Temperatura: int16 BE. JS tratta i byte come unsigned,
 *     // occorre ripristinare il segno manualmente.
 *     var tempRaw = (b[2] << 8) | b[3];
 *     if (tempRaw > 32767) tempRaw -= 65536;
 *     return { data: {
 *       co2Ppm:          (b[0] << 8) | b[1],
 *       temperatureC:    tempRaw / 100.0,
 *       humidityPercent: ((b[4] << 8) | b[5]) / 100.0,
 *       battery_level:   b[6]
 *     }};
 *   }
 * =============================================================================
 */

#include <MKRWAN.h>          // Libreria ufficiale LoRaWAN Arduino
#include <ArduinoLowPower.h> // Deep sleep MKR
#include <Wire.h>

// ---- CONFIGURAZIONE OTAA (ricavare da TTN Console) --------------------------
// IMPORTANTE: questi valori devono corrispondere ESATTAMENTE a quanto registrato
// nella TTN Application per questo dispositivo.
const char APP_EUI[]  = "0000000000000000"; // LSB first (come mostrato su TTN)
const char APP_KEY[]  = "00000000000000000000000000000000"; // MSB first

// ---- PARAMETRI OPERATIVI ----------------------------------------------------
const uint32_t SLEEP_MS         = 15UL * 60UL * 1000UL; // 15 minuti
const uint8_t  LORA_PORT        = 1;
const uint8_t  LORA_CONFIRMED   = 0;   // 0=unconfirmed (risparmia airtime)
const uint8_t  MAX_JOIN_RETRIES  = 10;

// ---- PIN -------------------------------------------------------------------
const int PIN_LED_STATUS = LED_BUILTIN; // LED integrato MKR

// ---- VARIABILI GLOBALI -----------------------------------------------------
LoRaModem modem;

// ============================================================================
// FUNZIONI SCD41
// ============================================================================

/** Invia il comando CRC-safe al SCD41 via I2C. */
uint8_t scd41Crc(uint16_t word) {
  uint8_t crc = 0xFF;
  for (int i = 1; i >= 0; i--) {
    crc ^= (word >> (8 * i)) & 0xFF;
    for (int b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1;
  }
  return crc;
}

void scd41SendCmd(uint16_t cmd) {
  Wire.beginTransmission(0x62);
  Wire.write(cmd >> 8);
  Wire.write(cmd & 0xFF);
  Wire.endTransmission();
}

/** Legge CO2, temperatura e umidità dal SCD41.
 *  Ritorna true se la lettura è valida.
 */
bool scd41Read(uint16_t &co2, float &tempC, float &rhPct) {
  // Avvia Single-Shot measurement (SCD41 comando 0x219D)
  scd41SendCmd(0x219D);
  delay(5100); // SCD41 single-shot richiede ~5 s

  // Leggi 9 byte (3 word × 3 byte ognuno)
  Wire.beginTransmission(0x62);
  Wire.write(0xEC); Wire.write(0x05);
  Wire.endTransmission();
  delay(1);

  Wire.requestFrom(0x62, 9);
  if (Wire.available() < 9) return false;

  uint8_t raw[9];
  for (int i = 0; i < 9; i++) raw[i] = Wire.read();

  co2   = ((uint16_t)raw[0] << 8) | raw[1];
  tempC = -45.0f + 175.0f * (((uint16_t)raw[3] << 8) | raw[4]) / 65535.0f;
  rhPct = 100.0f  * (((uint16_t)raw[6] << 8) | raw[7]) / 65535.0f;
  return true;
}

// ============================================================================
// FUNZIONE: Legge tensione batteria MKR (ADC interno)
// Il MKR WAN 1310 ha il pin ADC_BATTERY collegato al divisore batteria Li-Ion
// ============================================================================
uint8_t readBatteryPercent() {
  // MKR: ADC_BATTERY (A6) riferito a 3.3 V, divisore 2:1 → range 0–4.2 V
  int raw = analogRead(ADC_BATTERY);
  float vBatt = (raw / 1023.0f) * 3.3f * 2.0f;
  // Mappatura lineare Li-Ion: 3.3V=0% – 4.2V=100%
  int pct = (int)((vBatt - 3.3f) / (4.2f - 3.3f) * 100.0f);
  return (uint8_t)constrain(pct, 0, 100);
}

// ============================================================================
// FUNZIONE: Costruisce e invia il payload LoRaWAN
// ============================================================================
bool sendPayload(uint16_t co2, float tempC, float rhPct, uint8_t batt) {
  // Serializza in 7 byte HEX compresso
  uint8_t payload[7];
  uint16_t co2Raw  = (uint16_t)constrain(co2, 0, 65535);
  int16_t  tempRaw = (int16_t)(tempC * 100.0f);
  uint16_t rhRaw   = (uint16_t)(rhPct * 100.0f);

  payload[0] = co2Raw >> 8;   payload[1] = co2Raw & 0xFF;
  payload[2] = tempRaw >> 8;  payload[3] = tempRaw & 0xFF;
  payload[4] = rhRaw >> 8;    payload[5] = rhRaw & 0xFF;
  payload[6] = batt;

  modem.setPort(LORA_PORT);
  int err = modem.beginPacket();
  if (err <= 0) return false;
  modem.write(payload, 7);
  err = modem.endPacket(LORA_CONFIRMED);
  return err > 0;
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  pinMode(PIN_LED_STATUS, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);

  Serial.begin(115200);
  // Attende monitor seriale max 5 s (opzionale, non blocca in produzione)
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 5000);

  Serial.println(F("[MKR] Nodo CO2/Ambiente – MKRWAN – avvio"));

  // ---- Inizializza I2C + SCD41 -----------------------------------------------
  Wire.begin();
  scd41SendCmd(0x3615); // stop_periodic_measurement (per sicurezza)
  delay(500);

  // ---- Inizializza modem LoRa -------------------------------------------------
  if (!modem.begin(EU868)) {
    Serial.println(F("[LoRa] Errore inizializzazione modem – reset in 1 s"));
    // NON usare while(true): blocco permanente = batteria scaricata, nodo irrecuperabile.
    // Lampeggio veloce × 10 (segnalazione visiva) poi reset hardware completo.
    for (int i = 0; i < 10; i++) {
      digitalWrite(PIN_LED_STATUS, !digitalRead(PIN_LED_STATUS));
      delay(100);
    }
    NVIC_SystemReset();
  }
  Serial.print(F("[LoRa] DevEUI: ")); Serial.println(modem.deviceEUI());

  // ---- Join OTAA (con retry) -------------------------------------------------
  modem.setADR(true);      // Adaptive Data Rate abilitato
  modem.setPort(LORA_PORT);

  bool joined = false;
  for (int attempt = 1; attempt <= MAX_JOIN_RETRIES && !joined; attempt++) {
    Serial.print(F("[LoRa] Join OTAA tentativo ")); Serial.println(attempt);
    joined = modem.joinOTAA(APP_EUI, APP_KEY);
    if (!joined) {
      // Backoff esponenziale cappato: 10s → 20s → 40s … max 300s
      // Deep sleep durante l'attesa: zero consumo radio, zero duty-cycle
      uint32_t backoffMs = min(300000UL, 10000UL * (1UL << (attempt - 1)));
      Serial.print(F("[LoRa] Retry in ")); Serial.print(backoffMs / 1000);
      Serial.println(F(" s..."));
      LowPower.sleep(backoffMs);
    }
  }

  if (!joined) {
    Serial.println(F("[LoRa] Join fallito – deep sleep 5 min e retry"));
    LowPower.sleep(5UL * 60UL * 1000UL);
    NVIC_SystemReset(); // reset hardware e ricomincia da setup()
  }

  Serial.println(F("[LoRa] Join OK"));
  digitalWrite(PIN_LED_STATUS, HIGH); delay(500); digitalWrite(PIN_LED_STATUS, LOW);
}

// ============================================================================
// LOOP – ciclo periodico con deep sleep
// ============================================================================
void loop() {
  // 1. Leggi sensori
  uint16_t co2 = 0;
  float tempC = 0.0f, rhPct = 0.0f;
  bool ok = scd41Read(co2, tempC, rhPct);

  if (!ok) {
    Serial.println(F("[SCD41] Lettura fallita, skip uplink"));
  } else {
    uint8_t batt = readBatteryPercent();
    Serial.print(F("[SCD41] CO2=")); Serial.print(co2);
    Serial.print(F(" ppm  T=")); Serial.print(tempC, 1);
    Serial.print(F(" C  RH=")); Serial.print(rhPct, 0);
    Serial.print(F(" %  Batt=")); Serial.print(batt); Serial.println(F(" %"));

    // 2. Trasmetti
    bool sent = sendPayload(co2, tempC, rhPct, batt);
    Serial.println(sent ? F("[LoRa] Uplink OK") : F("[LoRa] Uplink fallito"));

    // LED lampeggio conferma
    for (int i = 0; i < (sent ? 2 : 5); i++) {
      digitalWrite(PIN_LED_STATUS, HIGH); delay(100);
      digitalWrite(PIN_LED_STATUS, LOW);  delay(100);
    }
  }

  // 3. Deep Sleep fino al prossimo ciclo
  Serial.print(F("[Sleep] Deep sleep ")); Serial.print(SLEEP_MS / 60000); Serial.println(F(" min"));
  Serial.flush();
  LowPower.sleep(SLEEP_MS);
  // Il codice riprende qui dopo il wakeup da timer
}
