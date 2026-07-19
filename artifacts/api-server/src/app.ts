import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind Replit's proxy, the real client IP arrives via X-Forwarded-For.
// Trusting the proxy lets req.ip resolve it correctly for the audit trail
// (module M9) instead of always logging the proxy's own address.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS_ORIGIN liste les origines autorisées séparées par des virgules,
// ex : "https://m15-audit.vercel.app,https://m15-audit.ci"
// Si la variable est absente (dev / Replit), toutes les origines sont acceptées.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true; // true = wildcard en développement

app.use(cors({ origin: corsOrigins, credentials: true }));
// Raised limit accommodates base64-encoded document uploads (module M6).
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api", router);

// Global error handler — must come after all routes.
// Handles HttpError (structured) and unexpected errors alike.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status: number =
    typeof err?.statusCode === "number" ? err.statusCode :
    typeof err?.status    === "number" ? err.status    :
    500;
  const message: string =
    typeof err?.message === "string" && err.message
      ? err.message
      : "Erreur interne du serveur.";
  logger.error({ err, status }, "Unhandled route error");
  res.status(status).json({ error: message });
});

export default app;
