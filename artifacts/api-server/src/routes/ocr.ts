// Module Phase 3 (OCR IA): Gemini Vision-based receipt/invoice OCR.
// POST /ocr/process/:documentId — fetches the stored document from the DB,
// sends the base64 image/PDF to Gemini Vision, and returns structured
// accounting fields for pre-filling the PME entry form.
//
// Auth: requireAuth. Portal users may only process documents belonging to
// their own client dossier; cabinet roles may process any document in their
// firm.

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, documentsTable, isPortalRole } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import Tesseract from "tesseract.js";

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const router: Router = Router();

// SYSCOHADA categories the AI may suggest (must match CATEGORY_RULES keys in
// lib/accounting-engine.ts to guarantee the frontend Select can use them).
const VALID_CATEGORIES = [
  "achat_marchandises",
  "achat_carburant",
  "loyer",
  "electricite_eau",
  "fournitures_bureau",
  "transport_deplacement",
  "salaires",
  "entretien_reparation",
  "autres_depenses",
  "vente_marchandises",
  "prestation_services",
  "autres_recettes",
] as const;

const GEMINI_PROMPT = `You are an accounting assistant for West African SMEs using SYSCOHADA.
Analyse this receipt, invoice, or financial document and extract the following fields.
Reply ONLY with a valid JSON object, no markdown, no explanation.

Required fields:
{
  "vendor_name": "<supplier or customer name, or null if not found>",
  "date": "<ISO date YYYY-MM-DD, or null if not found>",
  "amount": <total amount as a positive integer in CFA Francs (FCFA), or null if not found>,
  "type": "<'depense' if this is a purchase/expense, 'recette' if this is a sale/income>",
  "category": "<one of: achat_marchandises, achat_carburant, loyer, electricite_eau, fournitures_bureau, transport_deplacement, salaires, entretien_reparation, autres_depenses, vente_marchandises, prestation_services, autres_recettes>",
  "label": "<short French description of the operation (max 80 chars)>"
}`;

const OcrParamsSchema = z.object({
  documentId: z.coerce.number().int().positive(),
});

const GeminiResponseSchema = z.object({
  vendor_name: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  type: z.enum(["depense", "recette"]).optional(),
  category: z.enum(VALID_CATEGORIES).optional(),
  label: z.string().nullable().optional(),
});

// Map MIME types to Gemini-supported inline_data mimeType strings.
function toGeminiMimeType(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "application/pdf";
    case "image/png":
      return "image/png";
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

router.post(
  "/ocr/process/:documentId",
  requireAuth,
  async (req, res) => {
    const parsed = OcrParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new HttpError(400, "documentId invalide.");
    const { documentId } = parsed.data;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new HttpError(503, "Service OCR non configuré.");

    // Fetch document. Portal users may only access their own client's docs.
    const doc = await db.query.documentsTable.findFirst({
      where: eq(documentsTable.id, documentId),
    });

    if (!doc) throw new HttpError(404, "Document introuvable.");
    if (doc.firmId !== req.user!.firmId) throw new HttpError(403, "Accès refusé.");
    if (isPortalRole(req.user!.role)) {
      if (doc.clientId !== req.user!.clientId) {
        throw new HttpError(403, "Accès refusé à ce document.");
      }
    }

    if (!doc.fileData) {
      throw new HttpError(422, "Ce document ne contient pas de données lisibles.");
    }

    // PDF not supported by Tesseract — reject early with a clear message.
    const mimeType = doc.mimeType ?? "image/jpeg";
    if (mimeType === "application/pdf") {
      throw new HttpError(422, "Les PDF ne sont pas pris en charge par le service OCR. Veuillez importer une image (PNG ou JPEG).");
    }

    // Step 1 — local OCR via Tesseract.js (French + English).
    const imageBuffer = Buffer.from(doc.fileData, "base64");
    let ocrText: string;
    try {
      const result = await Tesseract.recognize(imageBuffer, "fra+eng", { logger: () => {} });
      ocrText = result.data.text.trim();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[OCR] Tesseract error:", detail);
      throw new HttpError(502, `Erreur lors de la lecture de l'image : ${detail}`);
    }

    if (!ocrText) {
      throw new HttpError(422, "Aucun texte détecté dans cette image. Vérifiez la qualité du document.");
    }

    // Step 2 — DeepSeek structures the extracted text into accounting fields.
    const structurePrompt = `${GEMINI_PROMPT}\n\nTexte extrait du document :\n"""\n${ocrText}\n"""`;

    let rawText: string;
    try {
      const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model:           "deepseek-v4-pro",
          messages:        [{ role: "user", content: structurePrompt }],
          temperature:     0.1,
          max_tokens:      512,
          response_format: { type: "json_object" },
        }),
      });

      if (!dsRes.ok) {
        const errBody = await dsRes.text();
        console.error("[OCR] DeepSeek error:", errBody);
        throw new HttpError(502, `DeepSeek OCR error (${dsRes.status}): ${errBody}`);
      }

      const dsData = (await dsRes.json()) as {
        choices?: { message?: { content?: string } }[];
      };

      rawText = dsData.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[OCR] DeepSeek fetch error:", detail);
      throw new HttpError(502, `Impossible de joindre le service OCR : ${detail}`);
    }

    // Strip markdown code fences if the model wrapped the JSON.
    const jsonText = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

    let extracted: z.infer<typeof GeminiResponseSchema>;
    try {
      extracted = GeminiResponseSchema.parse(JSON.parse(jsonText));
    } catch {
      console.error("[OCR] Failed to parse Gemini response:", rawText);
      // Return empty extraction rather than hard-failing.
      extracted = {};
    }

    res.json({
      extracted_vendor_name: extracted.vendor_name ?? null,
      extracted_date: extracted.date ?? null,
      extracted_amount: extracted.amount ?? null,
      suggested_type: extracted.type ?? null,
      suggested_category: extracted.category ?? null,
      suggested_label: extracted.label ?? null,
    });
  },
);

export default router;
