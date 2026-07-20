// POST /ocr/process/:documentId
// Temporairement indisponible : DeepSeek ne supporte pas les images.
// Un modèle vision (GPT-4o, Gemini, Claude) est requis.

import { Router } from "express";
import { requireAuth } from "../middlewares/auth";

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const router: Router = Router();

router.post("/ocr/process/:documentId", requireAuth, (_req, _res) => {
  throw new HttpError(
    503,
    "Le scanner IA nécessite un modèle avec support vision. " +
    "DeepSeek ne supporte pas l'analyse d'images. " +
    "Veuillez saisir les informations manuellement.",
  );
});

export default router;
