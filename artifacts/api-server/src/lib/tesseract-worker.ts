// Singleton Tesseract worker — initialised once at server startup so the
// language-data files (~80 MB for fra+eng) are downloaded before the first
// HTTP request arrives. Subsequent calls reuse the warm worker.

import Tesseract from "tesseract.js";
import { logger } from "./logger";

let workerPromise: Promise<Tesseract.Worker> | null = null;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      logger.info("Tesseract OCR — initialisation du worker (téléchargement des modèles de langue)…");
      const worker = await Tesseract.createWorker("fra+eng", 1, {
        logger: () => {}, // silence verbose progress events
      });
      logger.info("Tesseract OCR — worker prêt.");
      return worker;
    })();

    // On failure, clear the promise so the next call retries.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Warm the worker at startup — call once from index.ts. */
export function warmTesseract(): void {
  getWorker().catch((err) =>
    logger.warn({ err }, "Tesseract OCR — pré-initialisation échouée, nouvelle tentative au premier appel.")
  );
}

/** Run OCR on a Buffer and return the extracted text. */
export async function recognizeImage(imageBuffer: Buffer): Promise<string> {
  const worker = await getWorker();
  const result = await worker.recognize(imageBuffer);
  return result.data.text.trim();
}
