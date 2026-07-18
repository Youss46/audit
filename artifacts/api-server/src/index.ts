import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./lib/realtime";
import { startLicenseScheduler } from "./lib/license-scheduler";

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

  // Démarre le scheduler de licences : expire les licences échues, suspend
  // les cabinets sans licence active, envoie les emails d'avertissement.
  startLicenseScheduler();
});
