// POST /ocr/process/:documentId
// Utilise Claude (Anthropic) pour l'extraction de données comptables depuis
// une image ou un PDF. DeepSeek ne supportant pas la vision, ce module
// utilise une clé API Anthropic distincte (ANTHROPIC_API_KEY).

import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const router: Router = Router();

router.post("/ocr/process/:documentId", requireAuth, async (req, res) => {
  const { documentId } = req.params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      503,
      "Service OCR non configuré. Veuillez contacter votre administrateur (ANTHROPIC_API_KEY manquant).",
    );
  }

  // Load document — scoped to the requester's firm for security.
  const doc = await db.query.documentsTable.findFirst({
    where: and(
      eq(documentsTable.id, documentId),
      eq(documentsTable.firmId, req.user!.firmId),
    ),
  });

  if (!doc) {
    throw new HttpError(404, "Document introuvable.");
  }

  const isImage = doc.mimeType.startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";

  if (!isImage && !isPdf) {
    throw new HttpError(
      400,
      "Format non supporté pour l'OCR. Utilisez un PDF, PNG ou JPEG.",
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the vision content block.
  // Claude accepts images directly and PDFs via the "document" block type.
  const mediaBlock: Anthropic.Messages.MessageParam["content"][number] = isImage
    ? {
        type: "image",
        source: {
          type: "base64",
          media_type: doc.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: doc.fileData,
        },
      }
    : {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: doc.fileData,
        },
      };

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          mediaBlock,
          {
            type: "text",
            text: `Tu es un assistant comptable expert en SYSCOHADA. Analyse ce document (facture, reçu ou relevé bancaire) et extrais les informations suivantes. Réponds UNIQUEMENT avec du JSON brut, sans markdown ni explication.

{
  "extracted_vendor_name": "<nom du fournisseur ou émetteur, null si absent>",
  "extracted_date": "<date au format YYYY-MM-DD, null si absente>",
  "extracted_amount": <montant total TTC en nombre, null si absent>,
  "suggested_type": "<'depense' pour charge/achat/facture fournisseur, 'recette' pour revenu/encaissement client, null si indéterminé>",
  "suggested_category": "<catégorie comptable SYSCOHADA courte, ex: 'Achats marchandises', 'Frais de transport', 'Honoraires', 'Loyer', 'Ventes de marchandises', null si indéterminé>",
  "suggested_label": "<libellé court et précis pour la saisie comptable, null si indéterminé>"
}`,
          },
        ],
      },
    ],
  });

  const rawText =
    message.content[0]?.type === "text" ? message.content[0].text.trim() : "{}";

  // Strip accidental markdown fences if the model wraps the JSON.
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: {
    extracted_vendor_name: string | null;
    extracted_date: string | null;
    extracted_amount: number | null;
    suggested_type: "depense" | "recette" | null;
    suggested_category: string | null;
    suggested_label: string | null;
  };

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    req.log.error({ rawText }, "OCR: réponse Claude non parseable");
    throw new HttpError(
      500,
      "Impossible d'interpréter la réponse du service OCR. Veuillez saisir les informations manuellement.",
    );
  }

  res.json(parsed);
});

export default router;
