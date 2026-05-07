# Manuale Operativo – Sistema IoT Palestra
**Per il Titolare della Palestra**

---

## Introduzione

Questo manuale descrive la manutenzione ordinaria del sistema di monitoraggio IoT installato nella palestra. Il sistema è composto da:

- **2 schede Arduino MKR WAN 1310** (i "nodi sensore")
- **1 gateway Ebyte E870** (la "scatola di rete" al Piano 1)
- **Una dashboard web** accessibile da PC o smartphone

---

## Guida ai LED del Gateway Ebyte E870

Il gateway è installato nel locale tecnico al Piano 1. Ha tre LED sul pannello frontale.

### LED `SYS` (Sistema)

| Stato LED | Significato | Cosa fare |
|---|---|---|
| 🟢 **Verde fisso** | Sistema operativo. Tutto OK. | Nessuna azione. |
| 🟢 **Verde lampeggio lento** (ogni 2 s) | Gateway in avvio. Attendere 60 s. | Aspettare. |
| 🔴 **Rosso fisso** | Errore critico firmware. | Spegnere e riaccendere il gateway. Se persiste, chiamare il tecnico. |
| ⚫ **Spento** | Nessuna alimentazione. | Verificare il cavo di alimentazione (12V DC). |

### LED `ETH` (Connessione Internet)

| Stato LED | Significato | Cosa fare |
|---|---|---|
| 🟢 **Verde fisso** | Connesso a Internet tramite cavo Ethernet. | Nessuna azione. |
| 🟡 **Giallo lampeggio** | Traffico dati in corso. Normale. | Nessuna azione. |
| ⚫ **Spento** | Nessuna connessione di rete. | Verificare il cavo Ethernet tra gateway e router. Riavviare il router se necessario. |

### LED `LoRa` (Ricezione dati dai sensori)

| Stato LED | Significato | Cosa fare |
|---|---|---|
| 🟢 **Verde lampeggio breve** | Pacchetto ricevuto da un sensore. Normale. | Nessuna azione. |
| 🔵 **Blu lampeggio breve** | Gateway ha risposto a un sensore (downlink). | Nessuna azione. |
| ⚫ **Completamente spento** per oltre 30 min | Nessun sensore in ricezione. | Verificare che i nodi Arduino siano alimentati (vedi sotto). |

---

## Manutenzione delle Antenne

### Antenna del Gateway Ebyte E870

Il gateway ha un'antenna esterna collegata con connettore **SMA**. Si trova sopra il dispositivo.

**Controllo mensile (5 minuti):**
1. Verifica visiva che l'antenna sia verticale e non inclinata.
2. Assicurati che il connettore SMA sia avvitato a mano fino in fondo (non serve attrezzo).
3. Controlla che nessun oggetto metallico o parete non era prima sia stato spostato vicino all'antenna — i metalli bloccano il segnale radio.

**⚠️ Non fare mai:**
- Non torcere il cavo coassiale ad angolo acuto (rischio di rottura interna).
- Non spostare l'antenna a meno di 50 cm da grosse strutture in acciaio (attrezzature palestra, pilastri metallici).
- Non usare un cacciavite per stringere il connettore SMA — si rovina il filetto.

**Posizione ottimale antenna gateway:**
- Verticale (90°)
- Distanza minima da pareti in cemento armato: **≥ 50 cm**
- Altezza dal pavimento: **≥ 2 m** (già garantita dall'installazione)

### Antenne dei Nodi Arduino MKR WAN 1310

Ogni scheda Arduino ha una piccola antenna a filo (dipolo flessibile) collegata con connettore **u.FL** sul lato corto della scheda.

**Controllo trimestrale (2 minuti per nodo):**
1. Verifica che il cavo antenna (filo sottile) non sia piegato o schiacciato sotto il guscio.
2. Controlla che il connettore u.FL sia inserito nella scheda (si sente un leggero clic).
3. Non tirare mai il cavo antenna — il connettore u.FL è molto delicato.

**Se il segnale è debole (RSSI < -115 dBm sulla dashboard):**
- Prova a ruotare il nodo di 90° o spostarlo di qualche centimetro.
- Evita che il nodo sia dentro un armadio metallico chiuso.

---

## Cosa fare se un Sensore è "Offline"

La dashboard mostra un nodo come **OFFLINE** o **STALE** (in ritardo) quando non riceve dati da più di 4 minuti.

### Procedura di verifica (in ordine)

**1. Controlla il LED del gateway Ebyte E870**
- Il LED LoRa lampeggia? Se sì, il gateway funziona. Il problema è nel nodo specifico.
- Il LED ETH è spento? Risolvere prima la connessione Internet del gateway.

**2. Verifica l'alimentazione del nodo Arduino**
- I nodi sono alimentati tramite **batteria LiPo 3.7V** + micro-USB come backup.
- Controlla che la batteria non sia scarica: la dashboard mostra la percentuale.
- Quando la batteria scende sotto il **20%**, arriva automaticamente un avviso Telegram.

**3. Riavvio del nodo (solo se necessario)**
- Premi il pulsante **RST** (Reset) sulla scheda Arduino per 1 secondo.
- Il nodo si riavvia, tenta il join LoRaWAN e torna online entro 2-3 minuti.

**4. Se il problema persiste**
- Invia un messaggio WhatsApp al tecnico di riferimento con lo screenshot della dashboard.

---

## Interpretare la Dashboard Web

### Indicatori principali

| Indicatore | Significato | Valore normale |
|---|---|---|
| **CO₂ (ppm)** | Qualità dell'aria in palestra | 400–800 ppm (ottimo) · <1000 ppm (accettabile) |
| **Temperatura** | Temperatura ambiente o acqua | 18–26 °C (palestra) |
| **Umidità** | Umidità relativa aria | 40–65 % |
| **Flusso (L/min)** | Portata acqua in ingresso | 0 (notte) · 2–15 (orario apertura) |
| **Livello (%)** | Livello serbatoio idrico | > 20% (normale) |
| **Batteria (%)** | Carica batteria nodo | > 30% (normale) |
| **RSSI (dBm)** | Forza segnale radio | -60 / -100 dBm (buono) |

### Allarmi automatici Telegram

Il sistema invia messaggi Telegram in questi casi:

| Allarme | Causa | Azione consigliata |
|---|---|---|
| 🚨 **CO₂ alta** | CO₂ > 1000 ppm | Aprire finestre, aumentare ventilazione |
| 💧 **Livello acqua basso** | Serbatoio < 20% | Verificare erogazione idrica comunale |
| 🔴 **Perdita d'acqua notturna** | Flusso rilevato di notte | Controllare impianto idraulico |
| 🔋 **Batteria bassa** | Nodo < 20% | Ricaricare/sostituire batteria nodo |
| 📡 **Nodo offline** | Nessun uplink > 5 min | Vedi procedura "nodo offline" sopra |

---

## Manutenzione Programmata

| Frequenza | Attività |
|---|---|
| **Ogni settimana** | Controlla dashboard: tutti i nodi "online"? Batterie > 30%? |
| **Ogni mese** | Verifica visiva antenna gateway (verticale, connettore stretto) |
| **Ogni 3 mesi** | Controlla connettori u.FL antenne nodi Arduino |
| **Ogni 6 mesi** | Verifica cavo Ethernet gateway → router (sostituire se danneggiato) |
| **Ogni anno** | Sostituzione batterie LiPo nodi se < 80% capacità residua |

---

## Contatti Tecnici

| Ruolo | Contatto |
|---|---|
| **Sviluppo e manutenzione sistema** | Elena Trambusti |
| **Assistenza gateway Ebyte E870** | Documentazione: [ebyte.com](https://www.ebyte.com) |
| **Supporto TTN / LoRaWAN** | [thethingsnetwork.org/forum](https://www.thethingsnetwork.org/forum) |

---

*Documento generato automaticamente il 07/05/2026 – Versione 1.0*
