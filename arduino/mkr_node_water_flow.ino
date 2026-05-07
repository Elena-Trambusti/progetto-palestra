/**
 * =============================================================================
 * NODO IDRICO – Flusso / Livello / Temperatura
 * Hardware : Arduino MKR WAN 1310
 * Sensori  : YF-S201 (Flussostato Hall, Interrupt su D4)
 *            HC-SR04 (Ultrasuoni livello serbatoio)
 *            NTC 10k (temperatura acqua)
 * Protocollo: LoRaWAN Classe A · EU868 · OTAA
 * Libreria : MKRWAN.h (ufficiale Arduino)
 * Sleep    : LowPower – wakeup su INTERRUPT (flusso) O timer 15 min
 * Payload  : 8 byte HEX compresso
 *
 * STRUTTURA PAYLOAD (8 byte):
 *  Byte 0-1  : Portata × 100  L/min  (uint16 BE, es. 0x01F4 = 5.00 L/min)
 *  Byte 2-3  : Livello %     × 100   (uint16 BE, es. 0x1D4C = 75.00 %)
 *  Byte 4-5  : Temperatura   × 100   (int16  BE, es. 0x0780 = 19.20 °C)
 *  Byte 6    : Batteria %             (uint8,     es. 0x5F   = 95 %)
 *  Byte 7    : Flags (bit0=interrupt) (uint8)
 *
 * Decoder TTN JavaScript:
 *   function decodeUplink(input) {
 *     var b = input.bytes;
 *     // Temperatura: servono 2 byte signed. In JS i byte sono unsigned,
 *     // quindi usiamo lo shift aritmetico per ripristinare il segno.
 *     var tempRaw = (b[4] << 8) | b[5];
 *     if (tempRaw > 32767) tempRaw -= 65536; // converti in signed int16
 *     return { data: {
 *       flowLmin:      ((b[0] << 8) | b[1]) / 100.0,
 *       levelPercent:  ((b[2] << 8) | b[3]) / 100.0,
 *       temperatureC:  tempRaw / 100.0,
 *       battery_level: b[6],
 *       wakeOnFlow:    (b[7] & 0x01) ? true : false
 *     }};
 *   }
 * =============================================================================
 */

#include <MKRWAN.h>
#include <ArduinoLowPower.h>

// ---- CONFIGURAZIONE OTAA ---------------------------------------------------
const char APP_EUI[]  = "0000000000000000";
const char APP_KEY[]  = "00000000000000000000000000000000";

// ---- PARAMETRI OPERATIVI ---------------------------------------------------
const uint32_t SLEEP_MS         = 15UL * 60UL * 1000UL; // 15 min timer
const uint8_t  LORA_PORT        = 2;
const uint8_t  MAX_JOIN_RETRIES  = 10;

// ---- PIN -------------------------------------------------------------------
const int PIN_FLOW_SENSOR  = 4;   // D4 – Interrupt esterno (YF-S201)
const int PIN_TRIG         = 5;   // D5 – HC-SR04 TRIG
const int PIN_ECHO         = 6;   // D6 – HC-SR04 ECHO
const int PIN_NTC          = A0;  // A0 – NTC 10k
const int PIN_LED          = LED_BUILTIN;

// ---- COSTANTI SENSORI ------------------------------------------------------
const float TANK_HEIGHT_CM     = 100.0f; // altezza totale serbatoio [cm]
const float FLOW_PULSE_PER_L   = 450.0f; // impulsi/litro YF-S201
const float NTC_REF_R          = 10000.0f;
const float NTC_B              = 3950.0f;
const float NTC_T0             = 298.15f; // 25 °C in Kelvin
const float NTC_R0             = 10000.0f;

// ---- STATO VOLATIBILE (sopravvive al wake) ---------------------------------
volatile uint32_t pulseCount     = 0;
volatile bool     wakeByInterrupt = false;
unsigned long     lastWakeMs     = 0;
// DEBOUNCE_MS non necessario: YF-S201 usa segnale Hall già filtrato hardware

LoRaModem modem;

// ============================================================================
// ISR – impulso flussostato (SAMD21 / MKR WAN 1310)
// NOTA: IRAM_ATTR è specifico ESP32 e NON va usato su SAMD21 Cortex-M0+.
//       Su SAMD21 le ISR vengono automaticamente allocate in SRAM dal linker.
// ============================================================================
void onFlowPulse() {
  pulseCount++;
  wakeByInterrupt = true;
}


// ============================================================================
// SENSORI
// ============================================================================

/** Distanza HC-SR04 in cm. */
float measureDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long dur = pulseIn(PIN_ECHO, HIGH, 25000); // timeout 25 ms
  return dur * 0.0343f / 2.0f;
}

/** Converte distanza in percentuale livello serbatoio. */
float distanceToLevel(float distCm) {
  float filled = TANK_HEIGHT_CM - distCm;
  return constrain(filled / TANK_HEIGHT_CM * 100.0f, 0.0f, 100.0f);
}

/** Temperatura acqua da NTC (Steinhart-Hart semplificato). */
float readNtcTempC() {
  int raw = analogRead(PIN_NTC);
  if (raw <= 0 || raw >= 1023) return -99.0f;
  float rNtc = NTC_REF_R * ((1023.0f / raw) - 1.0f);
  float tKelvin = 1.0f / ((1.0f / NTC_T0) + (1.0f / NTC_B) * log(rNtc / NTC_R0));
  return tKelvin - 273.15f;
}

uint8_t readBatteryPercent() {
  int raw = analogRead(ADC_BATTERY);
  float vBatt = (raw / 1023.0f) * 3.3f * 2.0f;
  int pct = (int)((vBatt - 3.3f) / 0.9f * 100.0f);
  return (uint8_t)constrain(pct, 0, 100);
}

// ============================================================================
// LoRa
// ============================================================================
bool sendPayload(float flowLmin, float levelPct, float tempC, uint8_t batt, bool byInt) {
  uint16_t flowRaw  = (uint16_t)constrain((int)(flowLmin * 100.0f), 0, 65535);
  uint16_t levRaw   = (uint16_t)constrain((int)(levelPct * 100.0f), 0, 10000);
  int16_t  tempRaw  = (int16_t)(tempC * 100.0f);
  uint8_t  flags    = byInt ? 0x01 : 0x00;

  uint8_t payload[8];
  payload[0] = flowRaw >> 8;  payload[1] = flowRaw & 0xFF;
  payload[2] = levRaw  >> 8;  payload[3] = levRaw  & 0xFF;
  payload[4] = tempRaw >> 8;  payload[5] = tempRaw & 0xFF;
  payload[6] = batt;
  payload[7] = flags;

  modem.setPort(LORA_PORT);
  int err = modem.beginPacket();
  if (err <= 0) return false;
  modem.write(payload, 8);
  return modem.endPacket(0) > 0;
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_FLOW_SENSOR, INPUT_PULLUP);

  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 5000);
  Serial.println(F("[MKR] Nodo Idrico – MKRWAN – avvio"));

  // ---- Modem LoRa -----------------------------------------------------------
  if (!modem.begin(EU868)) {
    Serial.println(F("[LoRa] Errore modem – reset in 1 s"));
    // NON usare while(true): il nodo si bloccherebbe permanentemente.
    // 5 lampeggi rapidi come segnalazione visiva, poi reset hardware.
    for (int i = 0; i < 10; i++) {
      digitalWrite(PIN_LED, !digitalRead(PIN_LED));
      delay(100);
    }
    NVIC_SystemReset(); // ritenta boot completo
  }
  Serial.print(F("[LoRa] DevEUI: ")); Serial.println(modem.deviceEUI());

  modem.setADR(true);

  bool joined = false;
  for (int attempt = 1; attempt <= MAX_JOIN_RETRIES && !joined; attempt++) {
    Serial.print(F("[LoRa] Join OTAA tentativo ")); Serial.println(attempt);
    joined = modem.joinOTAA(APP_EUI, APP_KEY);
    if (!joined) {
      // Backoff esponenziale cappato: 10s, 20s, 40s … max 300s
      // Rispetta fair-use LoRaWAN EU868 (duty cycle 1%)
      uint32_t backoffMs = min(300000UL, 10000UL * (1UL << (attempt - 1)));
      Serial.print(F("[LoRa] Retry in ")); Serial.print(backoffMs / 1000);
      Serial.println(F(" s..."));
      LowPower.sleep(backoffMs); // deep sleep durante il backoff
    }
  }

  if (!joined) {
    Serial.println(F("[LoRa] Join fallito – sleep 5 min"));
    LowPower.sleep(5UL * 60UL * 1000UL);
    NVIC_SystemReset();
  }

  // ---- Collega Interrupt su flussostato (RISING = ogni impulso) ------------
  LowPower.attachInterruptWakeup(
    digitalPinToInterrupt(PIN_FLOW_SENSOR),
    onFlowPulse,
    RISING
  );

  Serial.println(F("[LoRa] Join OK – Interrupt flusso attivo"));
  digitalWrite(PIN_LED, HIGH); delay(300); digitalWrite(PIN_LED, LOW);
}

// ============================================================================
// LOOP – sleep con doppio wakeup (interrupt FLUSSO o timer 15 min)
// ============================================================================
void loop() {
  // ---- Calcola portata [L/min] dall'intervallo --------------------------------
  uint32_t pulseSnapshot;
  noInterrupts();
  pulseSnapshot  = pulseCount;
  pulseCount     = 0;
  interrupts();

  // Tempo trascorso dall'ultimo ciclo
  unsigned long nowMs  = millis();
  float elapsedMin     = (float)(nowMs - lastWakeMs) / 60000.0f;
  lastWakeMs = nowMs;
  float flowLmin = (elapsedMin > 0.01f)
                   ? (pulseSnapshot / FLOW_PULSE_PER_L) / elapsedMin
                   : 0.0f;

  // ---- Leggi livello e temperatura ------------------------------------------
  float distCm   = measureDistanceCm();
  float levelPct = distanceToLevel(distCm);
  float tempC    = readNtcTempC();
  uint8_t batt   = readBatteryPercent();
  bool byInt     = wakeByInterrupt;
  wakeByInterrupt = false;

  Serial.print(F("[Sensori] Flusso=")); Serial.print(flowLmin, 2);
  Serial.print(F(" L/min  Livello=")); Serial.print(levelPct, 1);
  Serial.print(F(" %  T=")); Serial.print(tempC, 1);
  Serial.print(F(" C  Batt=")); Serial.print(batt);
  Serial.print(F(" %  WakeInt=")); Serial.println(byInt ? "SI" : "NO");

  bool sent = sendPayload(flowLmin, levelPct, tempC, batt, byInt);
  Serial.println(sent ? F("[LoRa] Uplink OK") : F("[LoRa] Uplink fallito"));

  // LED conferma
  for (int i = 0; i < (sent ? 3 : 6); i++) {
    digitalWrite(PIN_LED, HIGH); delay(80);
    digitalWrite(PIN_LED, LOW);  delay(80);
  }

  // ---- Deep Sleep (timer 15 min OPPURE interrupt flusso) --------------------
  Serial.println(F("[Sleep] Deep sleep...")); Serial.flush();
  LowPower.sleep(SLEEP_MS);
  // Il codice riprende qui dopo il wakeup
}
