import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askClaude, MODELS } from "@/lib/anthropic";
import { parseCsv, normalizeRows, ColumnMapping, parseDateWithFormat } from "@/lib/csv";

async function inferColumnMapping(headers: string[], sampleRows: Record<string, string>[]): Promise<ColumnMapping> {
  const prompt = `You are looking at a bank statement CSV export. Here are the column headers and a few sample rows.

Headers: ${JSON.stringify(headers)}

Sample rows:
${JSON.stringify(sampleRows.slice(0, 5), null, 2)}

Identify which column contains the transaction date, which contains the description/merchant text,
and which contains the amount. Some banks use a single signed "amount" column; others split into
separate "debit"/"withdrawal" and "credit"/"deposit" columns — if so, return debitColumn and creditColumn
instead of amountColumn.

Also identify the exact date format used, as a pattern using DD, MM, YYYY, and the separator character
exactly as it appears (e.g. "DD/MM/YYYY", "MM-DD-YYYY", "YYYY-MM-DD"). Look carefully — Australian and UK
banks typically use day-first (DD/MM/YYYY), US banks typically use month-first (MM/DD/YYYY). If any sample
date has a first number greater than 12, that confirms day-first.

Respond with ONLY a JSON object, no other text, in this exact shape:
{
  "dateColumn": "...",
  "descriptionColumn": "...",
  "amountColumn": "...",
  "debitColumn": null,
  "creditColumn": null,
  "dateFormat": "DD/MM/YYYY"
}`;

  const mapping = await askClaude(prompt, { model: MODELS.fast, jsonMode: true, maxTokens: 300 });
  return mapping as ColumnMapping;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV appears to be empty" }, { status: 400 });
    }

    const mapping = await inferColumnMapping(headers, rows);
    const normalized = normalizeRows(rows, mapping);

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "Couldn't extract transactions — check the CSV format", mapping },
        { status: 422 }
      );
    }

    const withParsedDates = normalized
      .map((r) => ({ ...r, parsedDate: parseDateWithFormat(r.date, mapping.dateFormat) }))
      .filter((r) => r.parsedDate !== null);

    if (withParsedDates.length === 0) {
      return NextResponse.json(
        { error: "Couldn't parse any dates in this file", mapping },
        { status: 422 }
      );
    }

    const uploadBatchId = crypto.randomUUID();

    await prisma.transaction.createMany({
      data: withParsedDates.map((r) => ({
        date: r.parsedDate as Date,
        rawDescription: r.description,
        amount: r.amount,
        uploadBatchId,
      })),
    });

    return NextResponse.json({
      uploadBatchId,
      mapping,
      transactionsImported: withParsedDates.length,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }
}