import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./lib/realtime";
import { startLicenseScheduler } from "./lib/license-scheduler";
import { warmTesseract } from "./lib/tesseract-worker";
import { runMigrations } from "./lib/ci-migrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Applique les migrations Drizzle avant de démarrer le serveur.
// Utilise drizzle-orm/migrator (pas drizzle-kit push) : aucun TTY requis.
try {
  await runMigrations();
  logger.info("Database migrations applied successfully");
} catch (err) {
  logger.error({ err }, "Failed to apply database migrations");
  process.exit(1);
}

// Module M26: the WebSocket server (real-time comment/notification push)
// shares the same HTTP server/port as Express, upgrading requests on the
// /api/ws path -- no second port to expose through Replit's proxy.
const server = createServer(app);
initRealtime(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Pré-charge les modèles Tesseract en arrière-plan dès le démarrage.
  warmTesseract();

  // Démarre le scheduler de licences : expire les licences échues, suspend
  // les cabinets sans licence active, envoie les emails d'avertissement.
  startLicenseScheduler();
});
