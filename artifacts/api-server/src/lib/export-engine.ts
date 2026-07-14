// Module M3 – Financial Statements Export Engine
// Generates professional SYSCOHADA-compliant PDF and Excel documents from
// aggregated ledger data.  All function names and internal identifiers are
// English; all user-facing text (headers, labels, sheet names) is French.
//
// PDF:  pdfmake / PdfPrinter (server-side renderer, no headless browser).
// Excel: exceljs with native number formatting and accounting borders.

import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import type { BalanceRow, BilanResult, CompteResultatResult } from "./reporting-engine";
import type { DsfResult } from "./dsf-engine";
import type { ScoringRatios, ZScoreResult } from "./scoring-engine";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// pdfmake is externalized from the esbuild bundle (CJS that uses @swc/helpers
// internally).  We must load it via createRequire so Node.js resolves the CJS
// exports correctly instead of going through ESM's default-export wrapper.
const _nodeRequire = createRequire(import.meta.url);

const BUILT_IN_FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

// pdfmake@0.3+ changed its Node.js API: the package's main export is now a
// pre-instantiated singleton (`module.exports = new pdfmake()`) configured
// via setFonts/setUrlAccessPolicy/setLocalAccessPolicy, exposing
// createPdf(docDef).getBuffer() rather than the old `new PdfPrinter(fonts)`
// class + `.createPdfKitDocument()` stream API. Lazy-initialise so the
// require happens at call-time (after the module graph is fully loaded).
let _printer: {
  createPdf: (docDef: Record<string, unknown>) => { getBuffer: () => Promise<Buffer> };
  setFonts: (fonts: unknown) => void;
  setUrlAccessPolicy: (cb: (url: string) => boolean) => void;
  setLocalAccessPolicy: (cb: (path: string) => boolean) => void;
} | null = null;

function getPrinter() {
  if (!_printer) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const printer = _nodeRequire("pdfmake");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    printer.setFonts(BUILT_IN_FONTS);
    // Our document definitions are always built internally (never from
    // user-supplied paths/URLs), but pdfmake's local-file resolution is also
    // how it loads the standard 14 PDF fonts (Helvetica, etc.) -- must stay
    // allowed or every render fails. Deny remote URL fetches only, since no
    // document ever references a network image.
    printer.setUrlAccessPolicy(() => false);
    printer.setLocalAccessPolicy(() => true);
    _printer = printer;
  }
  return _printer!;
}

/** Format a number as French accounting notation (space-separated thousands). */
function fmtNum(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Render a pdfmake document definition to a Node.js Buffer. */
function renderPdf(docDef: Record<string, unknown>): Promise<Buffer> {
  return getPrinter().createPdf(docDef).getBuffer();
}

// ---------------------------------------------------------------------------
// Shared PDF layout primitives
// ---------------------------------------------------------------------------

const THEME = {
  primary: "#1e3a5f",    // dark navy – cabinet brand
  accent: "#2e6da4",     // mid-blue
  lightBg: "#f0f4f8",   // column header background
  totalBg: "#dce8f5",   // totals row background
  border: "#b0c4de",    // table border colour
  text: "#1a1a2e",
};

type PdfCell = Record<string, unknown>;

function headerCell(text: string, align = "center"): PdfCell {
  return {
    text,
    style: "tableHeader",
    alignment: align,
    fillColor: THEME.lightBg,
  };
}

function totalCell(text: string, align = "right"): PdfCell {
  return {
    text,
    style: "tableTotal",
    alignment: align,
    fillColor: THEME.totalBg,
  };
}

function buildDocHeader(
  clientName: string,
  year: number,
  title: string,
  subtitle: string,
): unknown[] {
  return [
    {
      columns: [
        {
          stack: [
            { text: clientName, style: "firmName" },
            { text: `Exercice ${year}`, style: "exercice" },
            { text: "Devise : Francs CFA (XOF)", style: "devise" },
          ],
          width: "*",
        },
        {
          stack: [
            { text: title, style: "docTitle" },
            { text: subtitle, style: "docSubtitle" },
          ],
          width: "auto",
          alignment: "right",
        },
      ],
    },
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 4,
          x2: 515,
          y2: 4,
          lineWidth: 2,
          lineColor: THEME.primary,
        },
        {
          type: "line",
          x1: 0,
          y1: 8,
          x2: 515,
          y2: 8,
          lineWidth: 0.5,
          lineColor: THEME.accent,
        },
      ],
      margin: [0, 0, 0, 12],
    },
  ];
}

const BASE_STYLES: Record<string, unknown> = {
  firmName:    { fontSize: 13, bold: true, color: THEME.primary, marginBottom: 2 },
  exercice:    { fontSize: 10, color: THEME.accent },
  devise:      { fontSize: 8, color: "#555", marginBottom: 2 },
  docTitle:    { fontSize: 11, bold: true, color: THEME.primary, alignment: "right" },
  docSubtitle: { fontSize: 8, color: "#555", alignment: "right" },
  tableHeader: { fontSize: 8, bold: true, color: THEME.primary },
  tableTotal:  { fontSize: 8, bold: true, color: THEME.primary },
  cell:        { fontSize: 8, color: THEME.text },
  mono:        { fontSize: 8, font: "Helvetica", color: THEME.text },
  sectionTitle:{ fontSize: 10, bold: true, color: THEME.primary, margin: [0, 10, 0, 4] },
  footer:      { fontSize: 7, color: "#888", alignment: "center" },
};

function tableLayout(): Record<string, unknown> {
  return {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      i === 0 || i === node.table.body.length ? 1 : 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => THEME.border,
    vLineColor: () => THEME.border,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };
}

// ---------------------------------------------------------------------------
// Balance des Comptes – PDF
// ---------------------------------------------------------------------------

export async function generateBalancePdf(
  clientName: string,
  year: number,
  rows: BalanceRow[],
): Promise<Buffer> {
  const totals = rows.reduce(
    (acc, r) => ({
      debit: acc.debit + r.totalDebit,
      credit: acc.credit + r.totalCredit,
    }),
    { debit: 0, credit: 0 },
  );

  const tableBody: PdfCell[][] = [
    [
      headerCell("Compte", "left"),
      headerCell("Intitulé", "left"),
      headerCell("Débit Période", "right"),
      headerCell("Crédit Période", "right"),
      headerCell("Solde Débiteur", "right"),
      headerCell("Solde Créditeur", "right"),
    ],
    ...rows.map((r) => [
      { text: r.accountNumber, style: "mono", alignment: "left" },
      { text: r.accountName, style: "cell", alignment: "left" },
      { text: fmtNum(r.totalDebit), style: "mono", alignment: "right" },
      { text: fmtNum(r.totalCredit), style: "mono", alignment: "right" },
      {
        text: r.finalBalanceSide === "debiteur" ? fmtNum(r.finalBalance) : "—",
        style: "mono",
        alignment: "right",
      },
      {
        text: r.finalBalanceSide === "crediteur" ? fmtNum(r.finalBalance) : "—",
        style: "mono",
        alignment: "right",
      },
    ] as PdfCell[]),
    [
      totalCell("TOTAUX", "left"),
      { text: "", fillColor: THEME.totalBg },
      totalCell(fmtNum(totals.debit)),
      totalCell(fmtNum(totals.credit)),
      { text: "", fillColor: THEME.totalBg },
      { text: "", fillColor: THEME.totalBg },
    ],
  ];

  const docDef = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 40, 30, 40],
    defaultStyle: { font: "Helvetica" },
    styles: BASE_STYLES,
    footer: (_currentPage: number, pageCount: number) => ({
      text: `Document généré le ${new Date().toLocaleDateString("fr-FR")} — Page ${_currentPage} / ${pageCount}`,
      style: "footer",
      margin: [30, 10],
    }),
    content: [
      ...buildDocHeader(
        clientName,
        year,
        "BALANCE DES COMPTES",
        "SYSCOHADA RÉVISÉ — Système Normal",
      ),
      {
        table: {
          headerRows: 1,
          widths: [50, "*", 75, 75, 75, 75],
          body: tableBody,
        },
        layout: tableLayout(),
      },
    ],
  };

  return renderPdf(docDef);
}

// ---------------------------------------------------------------------------
// Balance des Comptes – Excel
// ---------------------------------------------------------------------------

export async function generateBalanceExcel(
  clientName: string,
  year: number,
  rows: BalanceRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "M15-AUDIT";
  wb.created = new Date();

  const ws = wb.addWorksheet("Balance des Comptes", {
    pageSetup: { paperSize: 9, orientation: "landscape" },
  });

  // --- Header block ---
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = clientName;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };

  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = `Exercice ${year} — Balance des Comptes — SYSCOHADA RÉVISÉ`;
  ws.getCell("A2").font = { size: 11, color: { argb: "FF2E6DA4" } };

  ws.mergeCells("A3:F3");
  ws.getCell("A3").value = "Devise : Francs CFA (XOF)";
  ws.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF555555" } };

  ws.addRow([]); // spacer

  // --- Column headers ---
  const HEADERS = [
    "Compte",
    "Intitulé",
    "Débit Période",
    "Crédit Période",
    "Solde Débiteur",
    "Solde Créditeur",
  ];
  const headerRow = ws.addRow(HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF2E6DA4" } },
    };
  });
  headerRow.height = 22;

  const COL_WIDTHS = [14, 40, 18, 18, 18, 18];
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const NUM_FMT = "#,##0";
  let debitTotal = 0;
  let creditTotal = 0;

  rows.forEach((r, idx) => {
    const isEven = idx % 2 === 0;
    const row = ws.addRow([
      r.accountNumber,
      r.accountName,
      r.totalDebit,
      r.totalCredit,
      r.finalBalanceSide === "debiteur" ? r.finalBalance : null,
      r.finalBalanceSide === "crediteur" ? r.finalBalance : null,
    ]);

    row.getCell(1).font = { name: "Courier New", size: 9 };
    row.getCell(2).font = { size: 9 };

    [3, 4, 5, 6].forEach((col) => {
      const cell = row.getCell(col);
      cell.numFmt = NUM_FMT;
      cell.font = { name: "Courier New", size: 9 };
      cell.alignment = { horizontal: "right" };
      if (isEven) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
      }
    });

    debitTotal += r.totalDebit;
    creditTotal += r.totalCredit;
  });

  // --- Totals row (double-underline accounting convention) ---
  ws.addRow([]); // spacer before total
  const totalRow = ws.addRow(["TOTAUX", "", debitTotal, creditTotal, null, null]);
  totalRow.getCell(1).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
  [3, 4].forEach((col) => {
    const cell = totalRow.getCell(col);
    cell.numFmt = NUM_FMT;
    cell.font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "right" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    // Double-underline: top border on the totals row + thick bottom
    cell.border = {
      top: { style: "medium", color: { argb: "FF1E3A5F" } },
      bottom: { style: "double", color: { argb: "FF1E3A5F" } },
    };
  });

  ws.addRow([]); // spacer after
  const genRow = ws.addRow([
    `Généré le ${new Date().toLocaleDateString("fr-FR")} par M15-AUDIT`,
  ]);
  genRow.getCell(1).font = { italic: true, size: 8, color: { argb: "FF888888" } };
  ws.mergeCells(`A${genRow.number}:F${genRow.number}`);

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Module M21 — État Annexé (TVA déductible) – Excel
// ---------------------------------------------------------------------------

export interface VatAnnexExcelRow {
  date: Date;
  label: string;
  supplierName: string | null;
  supplierNcc: string | null;
  invoiceNumber: string | null;
  baseHt: number;
  tvaDeductible: number;
  tauxTva: number;
  missingNcc: boolean;
}

export async function generateVatAnnexExcel(
  clientName: string,
  period: string,
  rows: VatAnnexExcelRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "M15-AUDIT";
  wb.created = new Date();

  const ws = wb.addWorksheet("État Annexé TVA", {
    pageSetup: { paperSize: 9, orientation: "landscape" },
  });

  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = clientName;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };

  ws.mergeCells("A2:H2");
  ws.getCell("A2").value = `État Annexé — TVA Déductible — Période ${period} — Formulaire D-201/VA`;
  ws.getCell("A2").font = { size: 11, color: { argb: "FF2E6DA4" } };

  ws.mergeCells("A3:H3");
  ws.getCell("A3").value = "Devise : Francs CFA (XOF)";
  ws.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF555555" } };

  ws.addRow([]);

  const HEADERS = [
    "Date",
    "Libellé",
    "Fournisseur",
    "N° CC Fournisseur",
    "N° Facture",
    "Base HT",
    "Taux",
    "TVA Déductible",
  ];
  const headerRow = ws.addRow(HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: "FF2E6DA4" } } };
  });
  headerRow.height = 22;

  const COL_WIDTHS = [12, 34, 26, 18, 16, 16, 8, 16];
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const NUM_FMT = "#,##0";
  let baseTotal = 0;
  let tvaTotal = 0;

  rows.forEach((r, idx) => {
    const isEven = idx % 2 === 0;
    const row = ws.addRow([
      r.date.toLocaleDateString("fr-FR"),
      r.label,
      r.supplierName ?? "—",
      r.missingNcc ? "MANQUANT" : r.supplierNcc,
      r.invoiceNumber ?? "—",
      r.baseHt,
      `${r.tauxTva}%`,
      r.tvaDeductible,
    ]);

    row.getCell(1).font = { size: 9 };
    row.getCell(2).font = { size: 9 };
    row.getCell(3).font = { size: 9 };
    row.getCell(4).font = r.missingNcc
      ? { size: 9, bold: true, color: { argb: "FFC0392B" } }
      : { size: 9, name: "Courier New" };
    row.getCell(5).font = { size: 9, name: "Courier New" };
    row.getCell(7).alignment = { horizontal: "center" };

    [6, 8].forEach((col) => {
      const cell = row.getCell(col);
      cell.numFmt = NUM_FMT;
      cell.font = { name: "Courier New", size: 9 };
      cell.alignment = { horizontal: "right" };
    });

    if (isEven) {
      row.eachCell((cell) => {
        if (!cell.fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
        }
      });
    }
    if (r.missingNcc) {
      row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEA" } };
    }

    baseTotal += r.baseHt;
    tvaTotal += r.tvaDeductible;
  });

  ws.addRow([]);
  const totalRow = ws.addRow(["TOTAUX", "", "", "", "", baseTotal, "", tvaTotal]);
  totalRow.getCell(1).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
  [6, 8].forEach((col) => {
    const cell = totalRow.getCell(col);
    cell.numFmt = NUM_FMT;
    cell.font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "right" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    cell.border = {
      top: { style: "medium", color: { argb: "FF1E3A5F" } },
      bottom: { style: "double", color: { argb: "FF1E3A5F" } },
    };
  });

  ws.addRow([]);
  const genRow = ws.addRow([`Généré le ${new Date().toLocaleDateString("fr-FR")} par M15-AUDIT`]);
  genRow.getCell(1).font = { italic: true, size: 8, color: { argb: "FF888888" } };
  ws.mergeCells(`A${genRow.number}:H${genRow.number}`);

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// États Financiers (Bilan + Compte de Résultat) – PDF
// ---------------------------------------------------------------------------

export async function generateFinancialStatementsPdf(
  clientName: string,
  year: number,
  bilan: BilanResult,
  compteResultat: CompteResultatResult,
): Promise<Buffer> {
  // --- Bilan tables ---
  const bilanActifRows: PdfCell[][] = [
    [headerCell("Poste", "left"), headerCell("Montant (XOF)", "right")],
    ...bilan.actif.map((l) => [
      { text: l.label, style: "cell" },
      { text: fmtNum(l.amount), style: "mono", alignment: "right" },
    ] as PdfCell[]),
    [totalCell("Total Actif", "left"), totalCell(fmtNum(bilan.totalActif))],
  ];

  const bilanPassifRows: PdfCell[][] = [
    [headerCell("Poste", "left"), headerCell("Montant (XOF)", "right")],
    ...bilan.passif.map((l) => [
      { text: l.label, style: "cell" },
      { text: fmtNum(l.amount), style: "mono", alignment: "right" },
    ] as PdfCell[]),
    [totalCell("Total Passif", "left"), totalCell(fmtNum(bilan.totalPassif))],
  ];

  // --- Compte de Résultat tables ---
  const chargesRows: PdfCell[][] = [
    [headerCell("Compte", "left"), headerCell("Libellé", "left"), headerCell("Montant (XOF)", "right")],
    ...compteResultat.charges.map((l) => [
      { text: l.accountNumber, style: "mono" },
      { text: l.label, style: "cell" },
      { text: fmtNum(l.amount), style: "mono", alignment: "right" },
    ] as PdfCell[]),
    [totalCell("Total Charges", "left"), { text: "", fillColor: THEME.totalBg }, totalCell(fmtNum(compteResultat.totalCharges))],
  ];

  const produitsRows: PdfCell[][] = [
    [headerCell("Compte", "left"), headerCell("Libellé", "left"), headerCell("Montant (XOF)", "right")],
    ...compteResultat.produits.map((l) => [
      { text: l.accountNumber, style: "mono" },
      { text: l.label, style: "cell" },
      { text: fmtNum(l.amount), style: "mono", alignment: "right" },
    ] as PdfCell[]),
    [totalCell("Total Produits", "left"), { text: "", fillColor: THEME.totalBg }, totalCell(fmtNum(compteResultat.totalProduits))],
  ];

  const resultatColor = compteResultat.resultatNet >= 0 ? "#1a7a4a" : "#c0392b";
  const resultatLabel = compteResultat.resultatNet >= 0 ? "BÉNÉFICE NET" : "PERTE NETTE";

  const docDef = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [35, 40, 35, 40],
    defaultStyle: { font: "Helvetica" },
    styles: BASE_STYLES,
    footer: (_currentPage: number, pageCount: number) => ({
      text: `Document généré le ${new Date().toLocaleDateString("fr-FR")} — Page ${_currentPage} / ${pageCount}`,
      style: "footer",
      margin: [35, 10],
    }),
    content: [
      // ---- Document header ----
      ...buildDocHeader(
        clientName,
        year,
        "ÉTATS FINANCIERS",
        "BILAN SYSTÈME NORMAL — SYSCOHADA RÉVISÉ",
      ),

      // ---- BILAN ----
      { text: "BILAN", style: "sectionTitle" },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "ACTIF", style: { bold: true, fontSize: 9, color: THEME.accent }, margin: [0, 0, 0, 4] },
              {
                table: { headerRows: 1, widths: ["*", 80], body: bilanActifRows },
                layout: tableLayout(),
              },
            ],
            margin: [0, 0, 8, 0],
          },
          {
            width: "50%",
            stack: [
              { text: "PASSIF", style: { bold: true, fontSize: 9, color: THEME.accent }, margin: [0, 0, 0, 4] },
              {
                table: { headerRows: 1, widths: ["*", 80], body: bilanPassifRows },
                layout: tableLayout(),
              },
            ],
          },
        ],
      },

      // Equilibre check
      bilan.totalActif !== bilan.totalPassif
        ? {
            text: `⚠ Écart : Actif ${fmtNum(bilan.totalActif)} ≠ Passif ${fmtNum(bilan.totalPassif)}`,
            color: "#c0392b",
            fontSize: 8,
            margin: [0, 4, 0, 0],
          }
        : {
            text: `✓ Bilan équilibré : ${fmtNum(bilan.totalActif)} XOF`,
            color: "#1a7a4a",
            fontSize: 8,
            margin: [0, 4, 0, 0],
          },

      // ---- COMPTE DE RÉSULTAT ----
      { text: "COMPTE DE RÉSULTAT SIMPLIFIÉ", style: "sectionTitle", pageBreak: "before" },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "CHARGES (Classe 6)", style: { bold: true, fontSize: 9, color: THEME.accent }, margin: [0, 0, 0, 4] },
              {
                table: { headerRows: 1, widths: [40, "*", 80], body: chargesRows },
                layout: tableLayout(),
              },
            ],
            margin: [0, 0, 8, 0],
          },
          {
            width: "50%",
            stack: [
              { text: "PRODUITS (Classe 7)", style: { bold: true, fontSize: 9, color: THEME.accent }, margin: [0, 0, 0, 4] },
              {
                table: { headerRows: 1, widths: [40, "*", 80], body: produitsRows },
                layout: tableLayout(),
              },
            ],
          },
        ],
      },

      // Résultat net highlight box
      {
        table: {
          widths: ["*", 120],
          body: [
            [
              {
                text: `${resultatLabel} DE L'EXERCICE ${year}`,
                bold: true,
                fontSize: 11,
                color: resultatColor,
              },
              {
                text: fmtNum(Math.abs(compteResultat.resultatNet)) + " XOF",
                bold: true,
                fontSize: 12,
                alignment: "right",
                color: resultatColor,
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 2,
          vLineWidth: () => 0,
          hLineColor: () => resultatColor,
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        margin: [0, 12, 0, 0],
      },
    ],
  };

  return renderPdf(docDef);
}

// ---------------------------------------------------------------------------
// États Financiers – Excel
// ---------------------------------------------------------------------------

export async function generateFinancialStatementsExcel(
  clientName: string,
  year: number,
  bilan: BilanResult,
  compteResultat: CompteResultatResult,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "M15-AUDIT";
  wb.created = new Date();

  const NUM_FMT = "#,##0";

  // ---- Helper: write a two-column section (label | amount) ----
  function writeSection(
    ws: ExcelJS.Worksheet,
    title: string,
    rows: { label: string; amount: number }[],
    totalLabel: string,
    totalAmount: number,
    startRow: number,
    colA: number,
    colB: number,
  ): number {
    // Section title
    let r = ws.getRow(startRow);
    r.getCell(colA).value = title;
    r.getCell(colA).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
    r.getCell(colA).border = { bottom: { style: "thin", color: { argb: "FF2E6DA4" } } };
    r.getCell(colB).border = { bottom: { style: "thin", color: { argb: "FF2E6DA4" } } };

    // Column headers
    r = ws.getRow(startRow + 1);
    r.getCell(colA).value = "Poste";
    r.getCell(colB).value = "Montant (XOF)";
    [colA, colB].forEach((c) => {
      r.getCell(c).font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      r.getCell(c).alignment = { horizontal: c === colA ? "left" : "right", vertical: "middle" };
    });

    let currentRow = startRow + 2;
    rows.forEach((row, idx) => {
      const wsRow = ws.getRow(currentRow);
      wsRow.getCell(colA).value = row.label;
      wsRow.getCell(colA).font = { size: 9 };
      wsRow.getCell(colB).value = row.amount;
      wsRow.getCell(colB).numFmt = NUM_FMT;
      wsRow.getCell(colB).font = { name: "Courier New", size: 9 };
      wsRow.getCell(colB).alignment = { horizontal: "right" };
      if (idx % 2 === 0) {
        wsRow.getCell(colA).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
        wsRow.getCell(colB).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
      }
      currentRow++;
    });

    // Total row
    const totRow = ws.getRow(currentRow);
    totRow.getCell(colA).value = totalLabel;
    totRow.getCell(colA).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    totRow.getCell(colA).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    totRow.getCell(colB).value = totalAmount;
    totRow.getCell(colB).numFmt = NUM_FMT;
    totRow.getCell(colB).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    totRow.getCell(colB).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    totRow.getCell(colB).alignment = { horizontal: "right" };
    [colA, colB].forEach((c) => {
      totRow.getCell(c).border = {
        top: { style: "medium", color: { argb: "FF1E3A5F" } },
        bottom: { style: "double", color: { argb: "FF1E3A5F" } },
      };
    });

    return currentRow + 1;
  }

  // ---- Sheet 1: Bilan ----
  const wsBilan = wb.addWorksheet("Bilan");
  wsBilan.getColumn(1).width = 35;
  wsBilan.getColumn(2).width = 20;
  wsBilan.getColumn(3).width = 4; // spacer
  wsBilan.getColumn(4).width = 35;
  wsBilan.getColumn(5).width = 20;

  // Document header
  wsBilan.getCell("A1").value = clientName;
  wsBilan.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  wsBilan.getCell("A2").value = `Bilan — Exercice ${year} — SYSCOHADA RÉVISÉ`;
  wsBilan.getCell("A2").font = { size: 11, color: { argb: "FF2E6DA4" } };
  wsBilan.getCell("A3").value = "Devise : Francs CFA (XOF)";
  wsBilan.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF555555" } };

  let nextActifRow = writeSection(wsBilan, "ACTIF", bilan.actif, "Total Actif", bilan.totalActif, 5, 1, 2);
  writeSection(wsBilan, "PASSIF", bilan.passif, "Total Passif", bilan.totalPassif, 5, 4, 5);

  const bilanEquil = nextActifRow + 1;
  wsBilan.getCell(`A${bilanEquil}`).value =
    bilan.totalActif === bilan.totalPassif
      ? `✓ Bilan équilibré : ${fmtNum(bilan.totalActif)} XOF`
      : `⚠ Écart Actif/Passif : ${fmtNum(bilan.totalActif)} vs ${fmtNum(bilan.totalPassif)}`;
  wsBilan.getCell(`A${bilanEquil}`).font = {
    italic: true, size: 9,
    color: { argb: bilan.totalActif === bilan.totalPassif ? "FF1a7a4a" : "FFc0392b" },
  };

  // ---- Sheet 2: Compte de Résultat ----
  const wsCDR = wb.addWorksheet("Compte de Résultat");
  wsCDR.getColumn(1).width = 12;
  wsCDR.getColumn(2).width = 35;
  wsCDR.getColumn(3).width = 20;
  wsCDR.getColumn(4).width = 4;
  wsCDR.getColumn(5).width = 12;
  wsCDR.getColumn(6).width = 35;
  wsCDR.getColumn(7).width = 20;

  wsCDR.getCell("A1").value = clientName;
  wsCDR.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  wsCDR.getCell("A2").value = `Compte de Résultat — Exercice ${year} — SYSCOHADA RÉVISÉ`;
  wsCDR.getCell("A2").font = { size: 11, color: { argb: "FF2E6DA4" } };
  wsCDR.getCell("A3").value = "Devise : Francs CFA (XOF)";
  wsCDR.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF555555" } };

  // Charges section (cols 1-3)
  let cdrRow = 5;
  wsCDR.getRow(cdrRow).getCell(1).value = "CHARGES (Classe 6)";
  wsCDR.getRow(cdrRow).getCell(1).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
  cdrRow++;
  const cdrHead = wsCDR.getRow(cdrRow);
  ["Compte", "Libellé", "Montant (XOF)"].forEach((h, i) => {
    cdrHead.getCell(i + 1).value = h;
    cdrHead.getCell(i + 1).font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cdrHead.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cdrHead.getCell(i + 1).alignment = { horizontal: i === 2 ? "right" : "left" };
  });
  cdrRow++;
  compteResultat.charges.forEach((l, idx) => {
    const row = wsCDR.getRow(cdrRow);
    row.getCell(1).value = l.accountNumber;
    row.getCell(1).font = { name: "Courier New", size: 9 };
    row.getCell(2).value = l.label;
    row.getCell(2).font = { size: 9 };
    row.getCell(3).value = l.amount;
    row.getCell(3).numFmt = NUM_FMT;
    row.getCell(3).font = { name: "Courier New", size: 9 };
    row.getCell(3).alignment = { horizontal: "right" };
    if (idx % 2 === 0) {
      [1, 2, 3].forEach((c) => {
        wsCDR.getRow(cdrRow).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
      });
    }
    cdrRow++;
  });
  [1, 2, 3].forEach((c) => {
    wsCDR.getRow(cdrRow).getCell(c).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    wsCDR.getRow(cdrRow).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    wsCDR.getRow(cdrRow).getCell(c).border = { top: { style: "medium" }, bottom: { style: "double" } };
  });
  wsCDR.getRow(cdrRow).getCell(1).value = "Total Charges";
  wsCDR.getRow(cdrRow).getCell(3).value = compteResultat.totalCharges;
  wsCDR.getRow(cdrRow).getCell(3).numFmt = NUM_FMT;
  wsCDR.getRow(cdrRow).getCell(3).alignment = { horizontal: "right" };

  // Produits section (cols 5-7)
  let pRow = 5;
  wsCDR.getRow(pRow).getCell(5).value = "PRODUITS (Classe 7)";
  wsCDR.getRow(pRow).getCell(5).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
  pRow++;
  ["Compte", "Libellé", "Montant (XOF)"].forEach((h, i) => {
    wsCDR.getRow(pRow).getCell(i + 5).value = h;
    wsCDR.getRow(pRow).getCell(i + 5).font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    wsCDR.getRow(pRow).getCell(i + 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    wsCDR.getRow(pRow).getCell(i + 5).alignment = { horizontal: i === 2 ? "right" : "left" };
  });
  pRow++;
  compteResultat.produits.forEach((l, idx) => {
    const row = wsCDR.getRow(pRow);
    row.getCell(5).value = l.accountNumber;
    row.getCell(5).font = { name: "Courier New", size: 9 };
    row.getCell(6).value = l.label;
    row.getCell(6).font = { size: 9 };
    row.getCell(7).value = l.amount;
    row.getCell(7).numFmt = NUM_FMT;
    row.getCell(7).font = { name: "Courier New", size: 9 };
    row.getCell(7).alignment = { horizontal: "right" };
    if (idx % 2 === 0) {
      [5, 6, 7].forEach((c) => {
        wsCDR.getRow(pRow).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FB" } };
      });
    }
    pRow++;
  });
  [5, 6, 7].forEach((c) => {
    wsCDR.getRow(pRow).getCell(c).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    wsCDR.getRow(pRow).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
    wsCDR.getRow(pRow).getCell(c).border = { top: { style: "medium" }, bottom: { style: "double" } };
  });
  wsCDR.getRow(pRow).getCell(5).value = "Total Produits";
  wsCDR.getRow(pRow).getCell(7).value = compteResultat.totalProduits;
  wsCDR.getRow(pRow).getCell(7).numFmt = NUM_FMT;
  wsCDR.getRow(pRow).getCell(7).alignment = { horizontal: "right" };

  // Résultat net row
  const rnRow = Math.max(cdrRow, pRow) + 2;
  const isProfit = compteResultat.resultatNet >= 0;
  const rnLabel = isProfit ? "BÉNÉFICE NET DE L'EXERCICE" : "PERTE NETTE DE L'EXERCICE";
  const rnColor = isProfit ? "FF1a7a4a" : "FFc0392b";

  wsCDR.getCell(`A${rnRow}`).value = rnLabel;
  wsCDR.getCell(`A${rnRow}`).font = { bold: true, size: 12, color: { argb: rnColor } };
  wsCDR.getCell(`C${rnRow}`).value = Math.abs(compteResultat.resultatNet);
  wsCDR.getCell(`C${rnRow}`).numFmt = NUM_FMT;
  wsCDR.getCell(`C${rnRow}`).font = { bold: true, size: 12, color: { argb: rnColor } };
  wsCDR.getCell(`C${rnRow}`).alignment = { horizontal: "right" };
  ["A", "B", "C"].forEach((col) => {
    wsCDR.getCell(`${col}${rnRow}`).border = {
      top: { style: "medium", color: { argb: rnColor } },
      bottom: { style: "double", color: { argb: rnColor } },
    };
    wsCDR.getCell(`${col}${rnRow}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isProfit ? "FFE8F5E9" : "FFFDECEA" },
    };
  });

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Module M24 — DSF / Liasse Fiscale SYSCOHADA Révisé (multi-sheet export)
// ---------------------------------------------------------------------------

function styleHeaderRow(ws: ExcelJS.Worksheet, row: number, cols: number[], titles: string[]): void {
  const r = ws.getRow(row);
  cols.forEach((c, i) => {
    r.getCell(c).value = titles[i];
    r.getCell(c).font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    r.getCell(c).alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
  });
}

function docHeader(ws: ExcelJS.Worksheet, clientName: string, subtitle: string): void {
  ws.getCell("A1").value = clientName;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { size: 11, color: { argb: "FF2E6DA4" } };
  ws.getCell("A3").value = "Devise : Francs CFA (XOF)";
  ws.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF555555" } };
}

/**
 * Generates the DSF (Déclaration Statistique et Fiscale / Liasse Fiscale
 * SYSCOHADA Révisé) as a 3-sheet Excel workbook — Bilan (Actif/Passif),
 * Compte de Résultat, and Tableau des Flux de Trésorerie — following the
 * DGI's official line codes and column layout (Brut/Amortissements/Net for
 * the Bilan Actif).
 */
export async function generateDsfExcel(
  clientName: string,
  year: number,
  dsf: DsfResult,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "M15-AUDIT";
  wb.created = new Date();
  const NUM_FMT = "#,##0";

  // ---- Sheet 1: Bilan (Actif left, Passif right) ----
  const wsBilan = wb.addWorksheet("Bilan");
  wsBilan.getColumn(1).width = 6;
  wsBilan.getColumn(2).width = 38;
  wsBilan.getColumn(3).width = 16;
  wsBilan.getColumn(4).width = 16;
  wsBilan.getColumn(5).width = 16;
  wsBilan.getColumn(6).width = 4;
  wsBilan.getColumn(7).width = 6;
  wsBilan.getColumn(8).width = 38;
  wsBilan.getColumn(9).width = 18;

  docHeader(wsBilan, clientName, `Bilan — Liasse Fiscale — Exercice ${year} — SYSCOHADA RÉVISÉ`);

  styleHeaderRow(wsBilan, 5, [1, 2, 3, 4, 5], ["Réf.", "ACTIF", "Brut", "Amort.", "Net"]);
  let actifRow = 6;
  for (const l of dsf.bilanActif) {
    const r = wsBilan.getRow(actifRow);
    if (l.isSectionHeader) {
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
    } else {
      r.getCell(1).value = l.lineCode;
      r.getCell(1).font = { name: "Courier New", size: 8 };
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: l.isSubtotal, size: 9 };
      r.getCell(3).value = l.brut;
      r.getCell(4).value = l.amortissements;
      r.getCell(5).value = l.netN;
      [3, 4, 5].forEach((c) => {
        r.getCell(c).numFmt = NUM_FMT;
        r.getCell(c).font = { bold: l.isSubtotal, name: "Courier New", size: 9 };
        r.getCell(c).alignment = { horizontal: "right" };
      });
      if (l.isSubtotal) {
        [1, 2, 3, 4, 5].forEach((c) => {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
          r.getCell(c).border = { top: { style: "thin" } };
        });
      }
    }
    actifRow++;
  }
  wsBilan.getCell(`B${actifRow + 1}`).value = "TOTAL ACTIF";
  wsBilan.getCell(`B${actifRow + 1}`).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
  wsBilan.getCell(`E${actifRow + 1}`).value = dsf.totalBilanActif;
  wsBilan.getCell(`E${actifRow + 1}`).numFmt = NUM_FMT;
  wsBilan.getCell(`E${actifRow + 1}`).font = { bold: true, size: 10 };
  wsBilan.getCell(`E${actifRow + 1}`).alignment = { horizontal: "right" };

  styleHeaderRow(wsBilan, 5, [7, 8, 9], ["Réf.", "PASSIF", "Net"]);
  let passifRow = 6;
  for (const l of dsf.bilanPassif) {
    const r = wsBilan.getRow(passifRow);
    if (l.isSectionHeader) {
      r.getCell(8).value = l.label;
      r.getCell(8).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
    } else {
      r.getCell(7).value = l.lineCode;
      r.getCell(7).font = { name: "Courier New", size: 8 };
      r.getCell(8).value = l.label;
      r.getCell(8).font = { bold: l.isSubtotal, size: 9 };
      r.getCell(9).value = l.montantN;
      r.getCell(9).numFmt = NUM_FMT;
      r.getCell(9).font = { bold: l.isSubtotal, name: "Courier New", size: 9 };
      r.getCell(9).alignment = { horizontal: "right" };
      if (l.isSubtotal) {
        [7, 8, 9].forEach((c) => {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
          r.getCell(c).border = { top: { style: "thin" } };
        });
      }
    }
    passifRow++;
  }
  wsBilan.getCell(`H${passifRow + 1}`).value = "TOTAL PASSIF";
  wsBilan.getCell(`H${passifRow + 1}`).font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
  wsBilan.getCell(`I${passifRow + 1}`).value = dsf.totalBilanPassif;
  wsBilan.getCell(`I${passifRow + 1}`).numFmt = NUM_FMT;
  wsBilan.getCell(`I${passifRow + 1}`).font = { bold: true, size: 10 };
  wsBilan.getCell(`I${passifRow + 1}`).alignment = { horizontal: "right" };

  const equilRow = Math.max(actifRow, passifRow) + 3;
  wsBilan.getCell(`B${equilRow}`).value = dsf.bilanEquilibre
    ? `✓ Bilan équilibré : ${fmtNum(dsf.totalBilanActif)} XOF`
    : `⚠ Écart Actif/Passif : ${fmtNum(dsf.totalBilanActif)} vs ${fmtNum(dsf.totalBilanPassif)}`;
  wsBilan.getCell(`B${equilRow}`).font = {
    italic: true, size: 9,
    color: { argb: dsf.bilanEquilibre ? "FF1a7a4a" : "FFc0392b" },
  };

  // ---- Sheet 2: Compte de Résultat (SIG cascade) ----
  const wsCR = wb.addWorksheet("Compte de Résultat");
  wsCR.getColumn(1).width = 6;
  wsCR.getColumn(2).width = 45;
  wsCR.getColumn(3).width = 18;
  wsCR.getColumn(4).width = 18;
  wsCR.getColumn(5).width = 18;

  docHeader(wsCR, clientName, `Compte de Résultat — Exercice ${year} — SYSCOHADA RÉVISÉ (SIG)`);
  styleHeaderRow(wsCR, 5, [1, 2, 3, 4, 5], ["Réf.", "Libellé", "Produits", "Charges", "Solde"]);
  let crRow = 6;
  for (const l of dsf.compteResultat) {
    const r = wsCR.getRow(crRow);
    if (l.isSectionHeader) {
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
    } else {
      r.getCell(1).value = l.lineCode;
      r.getCell(1).font = { name: "Courier New", size: 8 };
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: l.isIntermediate, size: 9 };
      r.getCell(3).value = l.produits || null;
      r.getCell(4).value = l.charges || null;
      r.getCell(5).value = l.solde;
      [3, 4, 5].forEach((c) => {
        r.getCell(c).numFmt = NUM_FMT;
        r.getCell(c).font = { bold: l.isIntermediate, name: "Courier New", size: 9 };
        r.getCell(c).alignment = { horizontal: "right" };
      });
      if (l.isIntermediate) {
        [1, 2, 3, 4, 5].forEach((c) => {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
          r.getCell(c).border = { top: { style: "thin" } };
        });
      }
    }
    crRow++;
  }

  // ---- Sheet 3: Tableau des Flux de Trésorerie (TFT) ----
  const wsTft = wb.addWorksheet("TFT");
  wsTft.getColumn(1).width = 8;
  wsTft.getColumn(2).width = 55;
  wsTft.getColumn(3).width = 20;

  docHeader(wsTft, clientName, `Tableau des Flux de Trésorerie — Exercice ${year} — Méthode indirecte`);
  styleHeaderRow(wsTft, 5, [1, 2, 3], ["Réf.", "Libellé", "Montant N"]);
  let tftRow = 6;
  for (const l of dsf.tft) {
    const r = wsTft.getRow(tftRow);
    if (l.isSectionHeader) {
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: true, size: 10, color: { argb: "FF2E6DA4" } };
    } else {
      r.getCell(1).value = l.lineCode;
      r.getCell(1).font = { name: "Courier New", size: 8 };
      r.getCell(2).value = l.label;
      r.getCell(2).font = { bold: l.isSubtotal, size: 9 };
      r.getCell(3).value = l.montantN;
      r.getCell(3).numFmt = NUM_FMT;
      r.getCell(3).font = { bold: l.isSubtotal, name: "Courier New", size: 9 };
      r.getCell(3).alignment = { horizontal: "right" };
      if (l.isSubtotal) {
        [1, 2, 3].forEach((c) => {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8F5" } };
          r.getCell(c).border = { top: { style: "thin" } };
        });
      }
    }
    tftRow++;
  }

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Module M25 (Générateur de Synthèses & Documents Juridiques) — HTML → PDF
// ---------------------------------------------------------------------------
//
// The in-app WYSIWYG editor (TipTap) produces clean, shallow semantic HTML
// (h1-h3, p, strong/em, ul/ol/li, table, br). There is no headless browser
// in this stack (see the module header comment above), so rather than pull
// in a heavyweight HTML-to-PDF renderer, this is a small, purpose-built
// converter from that specific HTML subset to a pdfmake content tree.
// Any tag outside this subset has its markup stripped and its text content
// kept, so a document never silently loses content -- worst case it loses
// formatting, never text.

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Parses inline HTML (text possibly containing <strong>/<b>, <em>/<i>, <br>)
// into a pdfmake "text" run array, tracking bold/italics via a small stack.
function parseInlineRuns(html: string): Record<string, unknown>[] {
  const runs: Record<string, unknown>[] = [];
  const stack: { bold: boolean; italics: boolean }[] = [{ bold: false, italics: false }];
  const tokenRe = /<br\s*\/?>|<(\/?)(strong|b|em|i)>|([^<]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    const [full, closing, tag, plainText] = match;
    if (full.startsWith("<br")) {
      runs.push({ text: "\n" });
      continue;
    }
    if (tag) {
      const top = stack[stack.length - 1];
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else {
        const isBold = tag === "strong" || tag === "b";
        const isItalics = tag === "em" || tag === "i";
        stack.push({ bold: isBold || top.bold, italics: isItalics || top.italics });
      }
      continue;
    }
    if (plainText) {
      const top = stack[stack.length - 1];
      const text = decodeHtmlEntities(plainText);
      if (text.length === 0) continue;
      runs.push({ text, bold: top.bold, italics: top.italics });
    }
  }
  return runs.length > 0 ? runs : [{ text: "" }];
}

/** Converts a TipTap-produced HTML document into a pdfmake `content` array. */
function htmlToPdfContent(html: string): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  const blockRe = /<(h1|h2|h3|p|ul|ol|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = blockRe.exec(html)) !== null) {
    matchedAny = true;
    const [, tag, inner] = match;
    if (tag === "h1") {
      content.push({ text: parseInlineRuns(inner), style: "docTitle", margin: [0, 0, 0, 10] });
    } else if (tag === "h2") {
      content.push({ text: parseInlineRuns(inner), style: "sectionHeading", margin: [0, 14, 0, 6] });
    } else if (tag === "h3") {
      content.push({ text: parseInlineRuns(inner), style: "subHeading", margin: [0, 10, 0, 4] });
    } else if (tag === "blockquote") {
      content.push({ text: parseInlineRuns(inner), italics: true, margin: [10, 4, 0, 4], color: THEME.accent });
    } else if (tag === "ul" || tag === "ol") {
      const items = Array.from(inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((m) => ({
        text: parseInlineRuns(m[1]),
      }));
      content.push(tag === "ul" ? { ul: items, margin: [0, 2, 0, 6] } : { ol: items, margin: [0, 2, 0, 6] });
    } else {
      // <p> (and anything else falling through)
      content.push({ text: parseInlineRuns(inner), margin: [0, 0, 0, 8], lineHeight: 1.25 });
    }
  }

  if (!matchedAny) {
    // No recognized block tags at all — fall back to rendering the whole
    // string as plain text rather than producing an empty PDF.
    const plain = decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).trim();
    content.push({ text: plain, margin: [0, 0, 0, 8] });
  }

  return content;
}

/**
 * Renders a compiled/edited Module M25 document (rapport de gestion, lettre
 * de commentaires, lettre de mission, synthèse de performance) to PDF from
 * its current HTML.
 */
export function generateReportDocumentPdf(
  title: string,
  clientName: string,
  year: number,
  contentHtml: string,
): Promise<Buffer> {
  const docDef = {
    pageSize: "A4",
    pageMargins: [50, 60, 50, 60],
    content: [
      {
        columns: [
          { text: clientName, style: "docMeta" },
          { text: `Exercice ${year}`, style: "docMeta", alignment: "right" },
        ],
        margin: [0, 0, 0, 20],
      },
      ...htmlToPdfContent(contentHtml),
    ],
    styles: {
      docMeta: { fontSize: 9, color: "#666666" },
      docTitle: { fontSize: 18, bold: true, color: THEME.primary },
      sectionHeading: { fontSize: 13, bold: true, color: THEME.primary },
      subHeading: { fontSize: 11, bold: true, color: THEME.accent },
    },
    defaultStyle: { font: "Helvetica", fontSize: 10, color: THEME.text },
    info: { title },
  };
  return renderPdf(docDef);
}

// ---------------------------------------------------------------------------
// Module M27 (Scoring Financier & Évaluation d'Entreprise) — Synthèse
// Exécutive PDF, meant to be handed to a bank or partner.
// ---------------------------------------------------------------------------

function fmtPct(n: number | null | undefined): string {
  return n == null ? "n/a" : `${(n * 100).toFixed(1)} %`;
}
function fmtRatio(n: number | null | undefined): string {
  return n == null ? "n/a" : n.toFixed(2);
}

const RISK_BADGE_COLOR: Record<string, string> = {
  FAIBLE_RISQUE: "#1a7a4a",
  RISQUE_MODERE: "#d97706",
  RISQUE_ELEVE: "#c0392b",
};
const RISK_LABEL_FR: Record<string, string> = {
  FAIBLE_RISQUE: "RISQUE FAIBLE",
  RISQUE_MODERE: "RISQUE MODÉRÉ",
  RISQUE_ELEVE: "RISQUE ÉLEVÉ",
};

export interface ScoringExecutiveSummaryInput {
  ratios: ScoringRatios;
  zScoreResult: ZScoreResult;
  valuation: {
    ebitdaMultiplierUsed: number;
    ebitdaMultiplierValue: number;
    capitalizationRateUsed: number;
    capitalizedEarningsValue: number;
    equityValue: number;
    customComments: string | null;
  };
}

export async function generateScoringExecutiveSummaryPdf(
  clientName: string,
  year: number,
  input: ScoringExecutiveSummaryInput,
): Promise<Buffer> {
  const { ratios, zScoreResult, valuation } = input;
  const badgeColor = RISK_BADGE_COLOR[zScoreResult.riskCategory] ?? THEME.primary;
  const badgeLabel = RISK_LABEL_FR[zScoreResult.riskCategory] ?? zScoreResult.riskCategory;

  const ratioRows: PdfCell[][] = [
    [headerCell("Indicateur", "left"), headerCell("Valeur", "right")],
    [{ text: "Rentabilité — Return on Equity (ROE)", style: "cell" }, { text: fmtPct(ratios.returnOnEquity), style: "mono", alignment: "right" }],
    [{ text: "Liquidité — Ratio de liquidité générale", style: "cell" }, { text: fmtRatio(ratios.currentRatio), style: "mono", alignment: "right" }],
    [{ text: "Solvabilité — Ratio d'endettement (Dettes/Fonds propres)", style: "cell" }, { text: fmtRatio(ratios.debtToEquity), style: "mono", alignment: "right" }],
    [{ text: "Solvabilité — Ratio d'autonomie financière", style: "cell" }, { text: fmtPct(ratios.solvencyRatio), style: "mono", alignment: "right" }],
    [{ text: "Besoin en Fonds de Roulement (BFR / FRNG)", style: "cell" }, { text: fmtNum(ratios.netWorkingCapital) + " XOF", style: "mono", alignment: "right" }],
  ];

  const valuationRows: PdfCell[][] = [
    [headerCell("Approche", "left"), headerCell("Détail", "left"), headerCell("Valeur estimée", "right")],
    [
      { text: "Approche Patrimoniale", style: "cell" },
      { text: "Actif Net Réévalué (Capitaux propres)", style: "cell" },
      { text: fmtNum(valuation.equityValue) + " XOF", style: "mono", alignment: "right" },
    ],
    [
      { text: "Approche Comparative", style: "cell" },
      { text: `Multiple de l'EBE — ${valuation.ebitdaMultiplierUsed}x`, style: "cell" },
      { text: fmtNum(valuation.ebitdaMultiplierValue) + " XOF", style: "mono", alignment: "right" },
    ],
    [
      { text: "Capitalisation du résultat", style: "cell" },
      { text: `Taux de capitalisation — ${fmtPct(valuation.capitalizationRateUsed)}`, style: "cell" },
      { text: fmtNum(valuation.capitalizedEarningsValue) + " XOF", style: "mono", alignment: "right" },
    ],
  ];

  const docDef = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [35, 40, 35, 40],
    defaultStyle: { font: "Helvetica" },
    styles: BASE_STYLES,
    footer: (currentPage: number, pageCount: number) => ({
      text: `Document confidentiel — généré le ${new Date().toLocaleDateString("fr-FR")} — Page ${currentPage} / ${pageCount}`,
      style: "footer",
      margin: [35, 10],
    }),
    content: [
      ...buildDocHeader(
        clientName,
        year,
        "SYNTHÈSE EXÉCUTIVE",
        "SCORING FINANCIER & ÉVALUATION D'ENTREPRISE",
      ),

      { text: "DIAGNOSTIC DE RISQUE FINANCIER", style: "sectionTitle" },
      {
        table: {
          widths: ["*", 140],
          body: [
            [
              { text: "Score de solidité financière (Z-Score)", bold: true, fontSize: 10, color: THEME.text },
              { text: zScoreResult.zScore.toFixed(2), bold: true, fontSize: 14, alignment: "right", color: badgeColor },
            ],
            [
              { text: "Catégorie de risque", fontSize: 9, color: "#555" },
              { text: badgeLabel, bold: true, fontSize: 10, alignment: "right", color: badgeColor },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 1.5,
          vLineWidth: () => 0,
          hLineColor: () => badgeColor,
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 8],
      },
      {
        text: zScoreResult.riskExplanationFr,
        fontSize: 9,
        color: THEME.text,
        italics: true,
        margin: [0, 0, 0, 12],
      },

      { text: "RATIOS FINANCIERS CLÉS", style: "sectionTitle" },
      {
        table: { headerRows: 1, widths: ["*", 120], body: ratioRows },
        layout: tableLayout(),
      },

      { text: "ÉVALUATION D'ENTREPRISE", style: "sectionTitle" },
      {
        table: { headerRows: 1, widths: ["*", "*", 120], body: valuationRows },
        layout: tableLayout(),
      },

      valuation.customComments
        ? {
            text: [
              { text: "Commentaire de l'expert-comptable : ", bold: true, fontSize: 9 },
              { text: valuation.customComments, fontSize: 9 },
            ],
            margin: [0, 10, 0, 0],
          }
        : {
            text: "Ce document est établi à des fins d'information et de présentation (partenaires, établissements bancaires). Il ne se substitue pas à un rapport d'évaluation contractuel ou à un audit indépendant.",
            fontSize: 8,
            italics: true,
            color: "#777",
            margin: [0, 10, 0, 0],
          },
    ],
  };

  return renderPdf(docDef);
}
