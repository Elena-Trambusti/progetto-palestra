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

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, "server", ".env") });

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
        "Copiali da Render in un file .env nella root del progetto (o in server/.env) e riprova."
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
