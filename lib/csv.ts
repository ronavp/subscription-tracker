import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(fileContents: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(fileContents, {
    header: true,
    skipEmptyLines: true,
  });

  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
  };
}

// Take the raw rows + the column mapping Claude inferred, and normalize into
// { date, description, amount } shape ready for DB insertion.
export interface ColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  // Some banks split debit/credit into two columns instead of a signed amount
  debitColumn?: string;
  creditColumn?: string;
}

export function normalizeRows(rows: Record<string, string>[], mapping: ColumnMapping) {
  return rows
    .map((row) => {
      const date = row[mapping.dateColumn];
      const description = row[mapping.descriptionColumn];

      let amount: number;
      if (mapping.debitColumn || mapping.creditColumn) {
        const debit = parseFloat(row[mapping.debitColumn ?? ""] || "0") || 0;
        const credit = parseFloat(row[mapping.creditColumn ?? ""] || "0") || 0;
        // Debits (money out) are what we care about for subscriptions — store as positive spend
        amount = debit > 0 ? debit : -credit;
      } else {
        const raw = parseFloat((row[mapping.amountColumn] || "0").replace(/[^0-9.-]/g, ""));
        // Most exports use negative for money out — flip so "spend" is positive
        amount = raw < 0 ? Math.abs(raw) : raw;
      }

      return { date, description, amount };
    })
    .filter((r) => r.date && r.description && !isNaN(r.amount) && r.amount > 0);
}
