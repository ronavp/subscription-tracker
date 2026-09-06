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

export interface ColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  debitColumn?: string;
  creditColumn?: string;
  dateFormat?: string;
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
        // Debits (money out) are what we care about for subscriptions — store as positive spend.
        // Credits (money in) get a negative value here so they're filtered out below.
        amount = debit > 0 ? debit : -credit;
      } else {
        const raw = parseFloat((row[mapping.amountColumn] || "0").replace(/[^0-9.-]/g, ""));
        // Most single-column exports use negative for money OUT and positive for money IN.
        // We only want money out (spend) — flip negatives to positive, and explicitly
        // discard positives (incoming payments like "PAYMENT FROM ...") by marking them
        // negative so the final filter drops them.
        amount = raw < 0 ? Math.abs(raw) : -raw;
      }

      return { date, description, amount };
    })
    .filter((r) => r.date && r.description && !isNaN(r.amount) && r.amount > 0);
}

/**
 * Parses a date string using an explicit format (e.g. "DD/MM/YYYY") identified by the AI
 * from sample rows, rather than guessing per-row. Falls back to JS's native Date parsing
 * if no format is given or the format doesn't match.
 */
export function parseDateWithFormat(str: string, format?: string): Date | null {
  if (!str) return null;
  str = str.trim();

  if (format) {
    const sepMatch = format.match(/[^A-Za-z]/);
    const sep = sepMatch ? sepMatch[0] : "/";
    const formatParts = format.split(sep);
    const strParts = str.split(/[\/\-.]/).map((p) => p.trim());

    if (formatParts.length === strParts.length) {
      let day: number | undefined;
      let month: number | undefined;
      let year: number | undefined;

      formatParts.forEach((part, i) => {
        const val = Number(strParts[i]);
        if (isNaN(val)) return;
        if (part.startsWith("D")) day = val;
        else if (part.startsWith("M")) month = val;
        else if (part.startsWith("Y")) year = val;
      });

      if (day !== undefined && month !== undefined && year !== undefined) {
        if (year < 100) year += 2000;
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}