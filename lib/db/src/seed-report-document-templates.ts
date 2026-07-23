import { db, documentTemplatesTable } from "./index";
import { sql } from "drizzle-orm";

// Seeds the Module M25 (Générateur de Synthèses & Documents Juridiques)
// starter templates. Global, not firm-scoped -- every cabinet starts from
// the same standard administrative-French boilerplate and edits the
// generated instance, not the template. Safe to re-run: upserts on `title`.
//
// Supported placeholders (see artifacts/api-server/src/lib/document-hydrator.ts
// for the authoritative computation): {{COMPANY_NAME}}, {{LEGAL_FORM}},
// {{FISCAL_YEAR}}, {{PREVIOUS_FISCAL_YEAR}}, {{TURNOVER}}, {{NET_INCOME}},
// {{EQUITY}}, {{CASH_BALANCE}}, {{CHARGES_TOTAL}}, {{GENERATION_DATE}}.
const TEMPLATES: {
  templateType: "RAPPORT_GESTION" | "LETTRE_COMMENTAIRES" | "LETTRE_MISSION" | "SYNTHESE_PERFORMANCE";
  title: string;
  contentHtml: string;
}[] = [
  {
    templateType: "RAPPORT_GESTION",
    title: "Rapport de Gestion Annuel - Standard",
    contentHtml: `
<h1>RAPPORT DE GESTION</h1>
<p><em>Exercice clos le 31 décembre {{FISCAL_YEAR}}</em></p>
<p>Mesdames, Messieurs les Associés,</p>
<p>Nous vous présentons notre rapport sur la gestion de la société <strong>{{COMPANY_NAME}}</strong> ({{LEGAL_FORM}}), relatif à l'exercice clos le 31 décembre {{FISCAL_YEAR}}, ainsi que sur les comptes annuels dudit exercice, tels qu'ils sont annexés au présent rapport.</p>

<h2>1. Situation de la société durant l'exercice écoulé</h2>
<p>Au cours de l'exercice {{FISCAL_YEAR}}, la société a poursuivi son activité dans des conditions que nous nous proposons de commenter ci-après.</p>
<p><em>[Insérez ici votre commentaire sur le contexte économique ivoirien et sectoriel de l'exercice…]</em></p>

<h2>2. Analyse de l'activité et des résultats</h2>
<p>Le chiffre d'affaires de l'exercice s'élève à <strong>{{TURNOVER}}</strong>, contre l'exercice {{PREVIOUS_FISCAL_YEAR}}.</p>
<p>Le résultat net de l'exercice ressort à <strong>{{NET_INCOME}}</strong>, pour un total de charges de {{CHARGES_TOTAL}}.</p>
<p><em>[Insérez ici votre analyse de l'évolution de l'activité et des marges…]</em></p>

<h2>3. Situation financière</h2>
<p>Les capitaux propres de la société s'établissent à <strong>{{EQUITY}}</strong> à la clôture de l'exercice.</p>
<p>La trésorerie disponible au 31 décembre {{FISCAL_YEAR}} s'élève à <strong>{{CASH_BALANCE}}</strong>.</p>

<h2>4. Perspectives et recommandations du cabinet</h2>
<p><em>[Insérez ici les perspectives pour l'exercice suivant et les recommandations du cabinet…]</em></p>

<h2>5. Conclusion</h2>
<p>Nous vous proposons d'approuver les comptes annuels tels qu'ils vous sont présentés ainsi que les opérations traduites dans ces comptes ou résumées dans ce rapport.</p>
<p>Fait à Abidjan, le {{GENERATION_DATE}}.</p>
<p>Le Cabinet</p>
`.trim(),
  },
  {
    templateType: "LETTRE_COMMENTAIRES",
    title: "Lettre de Synthèse Financière (Commentaires du Cabinet)",
    contentHtml: `
<h1>LETTRE DE COMMENTAIRES</h1>
<p><em>Exercice {{FISCAL_YEAR}}</em></p>
<p>Monsieur le Gérant,</p>
<p>À l'issue de nos travaux de révision comptable portant sur l'exercice clos le 31 décembre {{FISCAL_YEAR}} de la société <strong>{{COMPANY_NAME}}</strong>, nous avons l'honneur de porter à votre connaissance les commentaires et recommandations ci-après.</p>

<h2>Synthèse des indicateurs clés</h2>
<ul>
  <li>Chiffre d'affaires de l'exercice : <strong>{{TURNOVER}}</strong></li>
  <li>Résultat net de l'exercice : <strong>{{NET_INCOME}}</strong></li>
  <li>Capitaux propres au 31 décembre {{FISCAL_YEAR}} : <strong>{{EQUITY}}</strong></li>
  <li>Trésorerie disponible en fin d'exercice : <strong>{{CASH_BALANCE}}</strong></li>
</ul>

<h2>Notre avis sur l'évolution du marché ivoirien et de votre activité</h2>
<p><em>[Insérez ici votre avis sur l'évolution du marché et son incidence sur l'activité de la société…]</em></p>

<h2>Points d'attention relevés au cours de nos travaux</h2>
<p><em>[Insérez ici les anomalies, points de vigilance ou zones de risque identifiés…]</em></p>

<h2>Recommandations du cabinet</h2>
<p><em>[Insérez ici vos recommandations pour l'exercice à venir…]</em></p>

<p>Nous restons à votre disposition pour tout complément d'information.</p>
<p>Veuillez agréer, Monsieur le Gérant, l'expression de nos salutations distinguées.</p>
<p>Fait à Abidjan, le {{GENERATION_DATE}}.</p>
`.trim(),
  },
  {
    templateType: "LETTRE_MISSION",
    title: "Lettre de Mission - Renouvellement Annuel",
    contentHtml: `
<h1>LETTRE DE MISSION</h1>
<p><em>Exercice {{FISCAL_YEAR}}</em></p>
<p>Monsieur l'Associé Unique,</p>
<p>La présente lettre a pour objet de définir les termes et conditions de notre mission d'assistance comptable et fiscale auprès de la société <strong>{{COMPANY_NAME}}</strong> ({{LEGAL_FORM}}), pour l'exercice {{FISCAL_YEAR}}.</p>

<h2>1. Objet de la mission</h2>
<p>Notre mission consiste en la tenue, la révision et la présentation des comptes annuels de votre société, ainsi que l'accomplissement de vos obligations fiscales et sociales déclaratives, conformément aux normes de la profession et au référentiel comptable SYSCOHADA Révisé.</p>

<h2>2. Nature et étendue de nos diligences</h2>
<p><em>[Insérez ici le détail des diligences prévues : saisie, révision, déclarations, conseil…]</em></p>

<h2>3. Responsabilités respectives</h2>
<p>La direction de la société demeure responsable de l'établissement des comptes annuels et de la conservation des pièces justificatives. Le cabinet met en œuvre les diligences professionnelles requises pour l'exécution de la présente mission.</p>

<h2>4. Honoraires</h2>
<p><em>[Insérez ici les conditions d'honoraires convenues pour l'exercice {{FISCAL_YEAR}}…]</em></p>

<p>Nous vous prions de bien vouloir nous retourner un exemplaire de la présente lettre, revêtu de la mention « bon pour accord », accompagné de votre signature.</p>
<p>Veuillez agréer, Monsieur l'Associé Unique, l'expression de nos salutations distinguées.</p>
<p>Fait à Abidjan, le {{GENERATION_DATE}}.</p>
`.trim(),
  },
  {
    templateType: "SYNTHESE_PERFORMANCE",
    title: "Synthèse de Performance Financière",
    contentHtml: `
<h1>SYNTHÈSE DE PERFORMANCE FINANCIÈRE</h1>
<p><em>{{COMPANY_NAME}} — Exercice {{FISCAL_YEAR}}</em></p>

<h2>Chiffres clés de l'exercice</h2>
<table>
  <tbody>
    <tr><td><strong>Chiffre d'affaires</strong></td><td>{{TURNOVER}}</td></tr>
    <tr><td><strong>Charges totales</strong></td><td>{{CHARGES_TOTAL}}</td></tr>
    <tr><td><strong>Résultat net</strong></td><td>{{NET_INCOME}}</td></tr>
    <tr><td><strong>Capitaux propres</strong></td><td>{{EQUITY}}</td></tr>
    <tr><td><strong>Trésorerie disponible</strong></td><td>{{CASH_BALANCE}}</td></tr>
  </tbody>
</table>

<h2>Lecture du cabinet</h2>
<p><em>[Insérez ici votre commentaire de synthèse : tendance par rapport à {{PREVIOUS_FISCAL_YEAR}}, points forts, points de vigilance…]</em></p>

<h2>Recommandations</h2>
<p><em>[Insérez ici les recommandations prioritaires pour le dirigeant…]</em></p>

<p>Document établi par le cabinet le {{GENERATION_DATE}}, à partir des écritures validées de l'exercice.</p>
`.trim(),
  },
];

async function main() {
  for (const t of TEMPLATES) {
    await db
      .insert(documentTemplatesTable)
      .values(t)
      .onConflictDoUpdate({
        target: documentTemplatesTable.title,
        set: {
          templateType: sql`excluded.template_type`,
          contentHtml: sql`excluded.content_html`,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`Seeded ${TEMPLATES.length} document templates (M25).`);
  // NB: pas de process.exit(0) ici — ce fichier est importé par seed-all.ts
}

export { main as seed };

// Auto-run uniquement en exécution standalone
if (process.argv[1]?.endsWith("seed-report-document-templates.ts") || process.argv[1]?.endsWith("seed-report-document-templates.js")) {
  main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
