const { createProxyMiddleware } = require("http-proxy-middleware");

const target = process.env.REACT_APP_PROXY_TARGET || "http://localhost:4000";

module.exports = function proxy(app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: false,
    })
  );
  app.use(
    "/ws",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
};
