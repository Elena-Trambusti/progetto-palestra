/**
 * Configurazione Swagger/OpenAPI per documentazione API
 * Accessibile all'endpoint /api/docs
 */
const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Misuratore dati LORA Dashboard API",
      version: "1.0.0",
      description: `API per gestione sensori IoT in palestra.
        
## Autenticazione
- **Endpoint pubblici**: /health, /readyz
- **Endpoint protetti**: richiedono sessione auth o API key
- **Endpoint admin**: richiedono ADMIN_KEY o INGEST_SECRET
- **Endpoint ingest**: richiedono INGEST_SECRET in header x-ingest-secret

## Rate Limiting
- /api/ingest: 60 richieste/minuto
- /api/auth/login: 8 tentativi/minuto
- /api/admin/login: 10 tentativi/minuto
- API read: 180 richieste/minuto`,
      contact: {
        name: "Supporto Tecnico",
      },
    },
    servers: [
      {
        url: "https://backend-palestra.onrender.com",
        description: "Server di produzione (Render)",
      },
      {
        url: "http://localhost:4000",
        description: "Server locale sviluppo",
      },
    ],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: "apiKey",
          in: "cookie",
          name: "auth_token",
          description: "Cookie di sessione dopo login",
        },
        ingestSecret: {
          type: "apiKey",
          in: "header",
          name: "x-ingest-secret",
          description: "Secret per endpoint ingest TTN",
        },
        adminKey: {
          type: "apiKey",
          in: "query",
          name: "key",
          description: "Admin key per operazioni admin (oppure header x-admin-key)",
        },
      },
    },
  },
  apis: [
    "./index.js",
    "./lib/*.js",
    "./routes/*.js",
  ],
};

module.exports = swaggerJsdoc(options);
