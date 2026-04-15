const test = require("node:test");
const assert = require("node:assert/strict");

const {
  gateMiddleware,
  extractToken,
  isValid,
  sessions,
  revoke,
} = require("./sessions");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("extractToken prefers bearer header", () => {
  const req = {
    get(name) {
      if (name === "authorization") return "Bearer abc123";
      return "";
    },
    cookies: { palestra_sess: "cookie-token" },
  };
  assert.equal(extractToken(req), "abc123");
});

test("gateMiddleware rejects invalid api key when auth disabled", () => {
  const mw = gateMiddleware({ requireAuth: false, apiKey: "secret" });
  const req = {
    get(name) {
      if (name === "x-api-key") return "wrong";
      return "";
    },
    cookies: {},
  };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("isValid returns false for revoked token", () => {
  const token = "manual-token";
  sessions.set(token, { expires: Date.now() + 60_000 });
  assert.equal(isValid(token), true);
  revoke(token);
  assert.equal(isValid(token), false);
});
