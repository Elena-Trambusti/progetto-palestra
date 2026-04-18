#!/usr/bin/env node
/**
 * Prova invio Telegram usando TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
 * (stesse variabili di Render). Carica .env dalla root del progetto e server/.env se presenti.
 *
 * Uso: dalla root del repo → npm run telegram:test
 */
"use strict";

const path = require("path");

const rootDir = path.join(__dirname, "..");
const dotenv = require(path.join(rootDir, "server", "node_modules", "dotenv"));

// Ordine: i file dopo sovrascrivono i precedenti. Su Windows spesso si crea per errore `.env.txt`.
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "server", ".env") });
dotenv.config({ path: path.join(rootDir, ".env.txt") });
dotenv.config({ path: path.join(rootDir, "server", ".env.txt") });

const { sendTelegramMessage } = require(path.join(rootDir, "server", "lib", "telegram"));

async function main() {
  const text =
    "✅ <b>Test Palestra</b>\n\n" +
    "Se leggi questo messaggio, token e chat id sono corretti.\n" +
    `🕐 ${new Date().toISOString()}`;

  const r = await sendTelegramMessage(text);
  if (r.skipped) {
    console.error(
      "Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.\n" +
        "Mettile in server/.env (o progetto/.env). Su Windows, se il file si chiama .env.txt, va bene:\n" +
        "  Esplora file → Visualizza → Estensioni nomi file → rinomina .env.txt in .env\n" +
        "oppure lascia .env.txt: ora lo script lo legge comunque."
    );
    process.exit(1);
  }
  if (!r.ok) {
    console.error("Invio non riuscito (vedi log [telegram] sopra).");
    process.exit(1);
  }
  console.log("Messaggio inviato. Controlla la chat con il bot su Telegram.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
