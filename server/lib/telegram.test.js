"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

function loadTelegram() {
  const resolved = require.resolve("./telegram");
  delete require.cache[resolved];
  return require("./telegram");
}

describe("telegram", () => {
  test("sendTelegramMessage restituisce skipped senza variabili d'ambiente", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const { sendTelegramMessage } = loadTelegram();
    const r = await sendTelegramMessage("ciao");
    assert.deepEqual(r, { ok: false, skipped: true });
  });

  test("maybeNotifyThresholdAlarm non chiama fetch se il valore è in soglia", async () => {
    const { maybeNotifyThresholdAlarm } = loadTelegram();
    let calls = 0;
    const orig = global.fetch;
    global.fetch = async () => {
      calls += 1;
      return {};
    };
    try {
      await maybeNotifyThresholdAlarm(
        { id: 1, name: "T", min_threshold: 0, max_threshold: 100 },
        50
      );
      assert.equal(calls, 0);
    } finally {
      global.fetch = orig;
    }
  });

  test("maybeNotifyThresholdAlarm invia POST quando fuori soglia e Telegram è configurato", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123";
    const { maybeNotifyThresholdAlarm } = loadTelegram();
    const payloads = [];
    const orig = global.fetch;
    global.fetch = async (url, opts) => {
      payloads.push({ url, opts });
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, result: { message_id: 1 } };
        },
      };
    };
    try {
      await maybeNotifyThresholdAlarm(
        {
          id: 7,
          name: "Temp",
          min_threshold: 10,
          max_threshold: 20,
          location: "Z1",
          type: "temp",
          dev_eui: "AABBCCDD",
        },
        25
      );
      assert.equal(payloads.length, 1);
      assert.match(String(payloads[0].url), /api\.telegram\.org\/bottest-token\/sendMessage/);
      const body = JSON.parse(payloads[0].opts.body);
      assert.equal(body.chat_id, "123");
      assert.match(body.text, /ALLARME/);
    } finally {
      global.fetch = orig;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });

  test("sendTelegramMessage non propaga errori di rete (try/catch)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.TELEGRAM_CHAT_ID = "1";
    const { sendTelegramMessage } = loadTelegram();
    const orig = global.fetch;
    global.fetch = async () => {
      throw new Error("network down");
    };
    try {
      const r = await sendTelegramMessage("x");
      assert.equal(r.ok, false);
    } finally {
      global.fetch = orig;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });
});
