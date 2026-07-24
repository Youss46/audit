/**
 * Module AI Copilot — POST /ai/copilot
 *
 * Assistant comptable intelligent SYSCOHADA, accessible à tous les rôles
 * (expert-comptable, collaborateur, stagiaire, client_pme, client_staff,
 * super_admin). Utilise l'API DeepSeek (openai-compatible) en mode streaming
 * SSE pour une expérience conversationnelle fluide.
 *
 * Sécurité :
 *  - Authentification obligatoire (requireAuth)
 *  - Le system prompt injecte uniquement le firmId/clientId de l'utilisateur
 *    connecté — aucune donnée inter-cabinet ne peut fuiter
 *  - Pas de tools/function calls exposés — réponses conversationnelles uniquement
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { z } from "zod";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Validation du body
// ---------------------------------------------------------------------------

const CopilotMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const CopilotBodySchema = z.object({
  messages: z.array(CopilotMessageSchema).min(1).max(50),
  context: z.object({
    route:         z.string().optional(),
    companyName:   z.string().optional(),
    clientName:    z.string().optional(),
    pageTitle:     z.string().optional(),
    additionalCtx: z.string().max(2000).optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// System Prompt dynamique
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  userRole:    string,
  firmName:    string | null | undefined,
  ctx: {
    route?:         string;
    companyName?:   string;
    clientName?:    string;
    pageTitle?:     string;
    additionalCtx?: string;
  } | undefined,
): string {
  const roleLabel: Record<string, string> = {
    expert_comptable: "Expert-Comptable (responsable du cabinet)",
    collaborateur:    "Collaborateur Comptable",
    stagiaire:        "Stagiaire en Comptabilité",
    client_pme:       "Gérant PME (Espace PME)",
    client_staff:     "Personnel PME (Espace PME)",
    super_admin:      "Super Administrateur Système",
  };

  const role = roleLabel[userRole] ?? userRole;
  const isPme = userRole === "client_pme" || userRole === "client_staff";

  const contextLines: string[] = [];
  if (ctx?.pageTitle)   contextLines.push(`- Page active : ${ctx.pageTitle}`);
  if (ctx?.route)       contextLines.push(`- Route : ${ctx.route}`);
  if (ctx?.clientName)  contextLines.push(`- Dossier client actif : ${ctx.clientName}`);
  if (ctx?.additionalCtx) contextLines.push(`- Contexte additionnel : ${ctx.additionalCtx}`);

  return `Tu es **M15 AI Copilot**, l'assistant comptable intelligent intégré à la plateforme **M15 AUDIT** — solution de gestion comptable SYSCOHADA pour cabinets d'expertise comptable et PME en Côte d'Ivoire.

## IDENTITÉ ET MISSION
Tu assistes les professionnels de la comptabilité et les chefs d'entreprise dans leurs tâches quotidiennes : imputations SYSCOHADA, analyse financière, conformité fiscale ivoirienne, et pilotage de l'activité.

## UTILISATEUR ACTUEL
- **Rôle** : ${role}
- **Cabinet / Entreprise** : ${firmName ?? "Non renseigné"}
${contextLines.length ? contextLines.join("\n") : "- Aucun contexte de page spécifique"}

## CADRE SYSCOHADA RÉVISÉ 2018 — RÉFÉRENTIEL OBLIGATOIRE
### Plan Comptable Général OHADA
- Comptes à **6 chiffres** obligatoires pour toute imputation
- **Classe 1** — Ressources durables : 101300 (capital), 162xxx (emprunts)
- **Classe 2** — Actif immobilisé : 231xxx (bâtiments), 245xxx (véhicules)
- **Classe 3** — Stocks : 311xxx (marchandises), 321xxx (matières premières)
- **Classe 4** — Comptes de tiers :
  - 401100 Fournisseurs d'exploitation | 411100 Clients
  - 422100 Personnel rémunérations dues | 431100 CNPS | 447100 ITS/FDFP
  - 445100 TVA récupérable sur achats | 443100/443200 TVA collectée
- **Classe 5** — Trésorerie :
  - 521100 Banques locales | 513100 Chèques
  - 552100 Wave | 552200 Orange Money | 552300 MTN MoMo | 552400 Moov Money
  - 571100 Caisse principale
- **Classe 6** — Charges :
  - 601100 Achats marchandises | 602100 Matières premières/consommables
  - 605100 Eau | 605200 Électricité | 605300 Carburant | 605600 Petit matériel
  - 614100 Transport personnel | 622100 Loyer | 624100 Entretien | 628100 Télécoms
  - 661100 Salaires | 664100 Charges sociales | 631700 Frais Mobile Money
- **Classe 7** — Produits :
  - 701100 Ventes marchandises | 706100 Prestations de services
  - 708100 Revenus immeubles | 758100 Produits divers

### Principes fondamentaux
- **Partie double** : Σ Débits = Σ Crédits pour chaque écriture
- **Journaux** : AC (Achats), VE (Ventes), BQ (Banque), CA (Caisse), OD (Opérations Diverses)
- **États financiers** : Bilan, Compte de Résultat, TAFIRE (Tableau des Flux), Notes annexes

## FISCALITÉ IVOIRIENNE (DGI)
- **TVA** : taux normal 18%, déclaration mensuelle (Réel Normal) ou trimestrielle (Réel Simplifié)
  - TVA collectée (443x00) - TVA déductible (445100) = TVA à décaisser
- **IS** : Impôt sur Sociétés 25%, minimum fiscal = 0,5% du CAHT (min 3M FCFA)
- **Régimes** : Réel Normal (CA > 150M FCFA) | Réel Simplifié (50-150M) | Entreprenant (< 50M)
- **CNPS** : Patronal ~21,75% | Salarial ~5,75% du salaire brut plafonné
- **ITS** : Barème progressif 0-60% sur revenu imposable
- **Patente** : Taxe professionnelle annuelle
- **FDFP** : 0,4% masse salariale (formation professionnelle)
- **Taxe d'apprentissage** : 0,4% masse salariale

## RÈGLES DE COMPORTEMENT
${isPme
  ? `- Tu t'adresses à un chef d'entreprise ou employé PME : vocabulaire accessible, exemples concrets
- Évite le jargon comptable excessif — explique les termes techniques utilisés
- Oriente vers les fonctionnalités de la plateforme (Mes Opérations, Caisse Terrain, Mon Facturier)`
  : `- Tu t'adresses à un professionnel comptable : niveau expert, terminologie SYSCOHADA stricte
- Références précises aux numéros de comptes 6 chiffres, journaux, et normes OHADA
- Peut évoquer les modules : Comptabilité & Travaux, GED, Scoring IA, DSF, Télédéclaration`
}
- **Montants** : toujours en FCFA avec séparateurs (ex : 1 250 000 FCFA)
- **Comptes** : toujours en 6 chiffres (ex : 601100 et non "601")
- **Sécurité** : tu ne fournis d'information que sur le périmètre de l'utilisateur connecté
- **Format** : Markdown structuré (titres ##, listes, **gras**, \`code\`), concis mais complet
- **Langue** : français professionnel exclusivement

Si tu n'as pas les données chiffrées nécessaires à une analyse précise, indique-le et oriente l'utilisateur vers la fonctionnalité appropriée de M15 AUDIT.`;
}

// ---------------------------------------------------------------------------
// POST /ai/copilot
// ---------------------------------------------------------------------------

router.post("/ai/copilot", async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Service IA non configuré (DEEPSEEK_API_KEY manquant)." });
    return;
  }

  let body: z.infer<typeof CopilotBodySchema>;
  try {
    body = CopilotBodySchema.parse(req.body);
  } catch (err: unknown) {
    res.status(400).json({ error: "Corps de requête invalide.", detail: String(err) });
    return;
  }

  const { messages, context } = body;
  const user = req.user!;

  const systemPrompt = buildSystemPrompt(
    user.role,
    user.firmName,
    context,
  );

  // SSE headers for streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Nginx: disable buffering

  // Send a heartbeat immediately so the client knows the connection is live
  res.write(": heartbeat\n\n");

  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
        max_tokens: 2048,
        temperature: 0.5,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[copilot] DeepSeek upstream error:", upstream.status, errText);
      res.write(`data: ${JSON.stringify({ error: "Erreur du service IA. Veuillez réessayer." })}\n\n`);
      res.end();
      return;
    }

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({ error: "Pas de réponse du service IA." })}\n\n`);
      res.end();
      return;
    }

    // Pipe the DeepSeek SSE stream → client SSE stream
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          continue;
        }
        try {
          const chunk = JSON.parse(payload);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {
          // malformed chunk — skip silently
        }
      }
    }

    // Flush any remaining buffer
    if (buffer) {
      const payload = buffer.startsWith("data: ") ? buffer.slice(6).trim() : "";
      if (payload && payload !== "[DONE]") {
        try {
          const chunk = JSON.parse(payload);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch { /* ignore */ }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[copilot] Erreur streaming:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur interne du service IA." });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Connexion interrompue." })}\n\n`);
      res.end();
    }
  }
});

export default router;
