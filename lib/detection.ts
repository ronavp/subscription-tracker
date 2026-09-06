interface TxnForDetection {
  id: string;
  date: Date;
  amount: number;
  cleanMerchant: string;
}

export interface DetectedGroup {
  merchant: string;
  transactionIds: string[];
  amounts: number[];
  avgAmount: number;
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly" | "irregular";
  intervalDays: number;
  confidence: number; // 0-1
  nextEstimatedDate: Date;
}

const FREQUENCY_WINDOWS: { name: DetectedGroup["frequency"]; days: number; tolerance: number }[] = [
  { name: "weekly", days: 7, tolerance: 2 },
  { name: "fortnightly", days: 14, tolerance: 3 },
  { name: "monthly", days: 30, tolerance: 5 },
  { name: "quarterly", days: 91, tolerance: 8 },
  { name: "yearly", days: 365, tolerance: 15 },
];

function daysBetween(a: Date, b: Date) {
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function mean(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]) {
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

/**
 * Groups transactions by cleanMerchant, then checks whether the group's
 * date intervals and amounts look like a recurring subscription.
 * Requires at least 2 occurrences (3+ gives much higher confidence).
 */
export function detectRecurringGroups(transactions: TxnForDetection[]): DetectedGroup[] {
  const byMerchant = new Map<string, TxnForDetection[]>();
  for (const t of transactions) {
    if (!t.cleanMerchant) continue;
    const list = byMerchant.get(t.cleanMerchant) ?? [];
    list.push(t);
    byMerchant.set(t.cleanMerchant, list);
  }

  const results: DetectedGroup[] = [];

  for (const [merchant, txns] of byMerchant.entries()) {
    if (txns.length < 2) continue;

    const sorted = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i].date, sorted[i - 1].date));
    }
    const avgInterval = mean(intervals);
    const intervalConsistency = intervals.length > 1 ? stddev(intervals) : 0;

    // Find the closest matching frequency window
    let bestMatch: (typeof FREQUENCY_WINDOWS)[number] | null = null;
    for (const window of FREQUENCY_WINDOWS) {
      if (Math.abs(avgInterval - window.days) <= window.tolerance + intervalConsistency) {
        if (!bestMatch || Math.abs(avgInterval - window.days) < Math.abs(avgInterval - bestMatch.days)) {
          bestMatch = window;
        }
      }
    }

    const amounts = sorted.map((t) => t.amount);
    const avgAmount = mean(amounts);
    const amountVariance = stddev(amounts) / avgAmount; // coefficient of variation

    // Confidence scoring: more occurrences, tighter interval, tighter amount = higher confidence
    let confidence = 0;
    if (bestMatch) {
      confidence += 0.4;
      confidence += Math.min(0.3, (sorted.length - 2) * 0.1); // more data points = more sure
      confidence += intervalConsistency < bestMatch.tolerance ? 0.15 : 0.05;
      confidence += amountVariance < 0.1 ? 0.15 : amountVariance < 0.25 ? 0.05 : 0;
    }
    confidence = Math.min(1, confidence);

    const lastDate = sorted[sorted.length - 1].date;
    const nextEstimatedDate = new Date(lastDate);
    nextEstimatedDate.setDate(nextEstimatedDate.getDate() + Math.round(bestMatch?.days ?? avgInterval));

    results.push({
      merchant,
      transactionIds: sorted.map((t) => t.id),
      amounts,
      avgAmount,
      frequency: bestMatch?.name ?? "irregular",
      intervalDays: Math.round(avgInterval),
      confidence,
      nextEstimatedDate,
    });
  }

  return results;
}

// Normalize any frequency to a monthly-equivalent spend for easy comparison
export function toMonthlyEquivalent(amount: number, frequency: DetectedGroup["frequency"]) {
  switch (frequency) {
    case "weekly":
      return amount * 4.345; // avg weeks per month
    case "fortnightly":
      return amount * 2.1725;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
    default:
      return amount; // irregular — best guess, flagged low confidence anyway
  }
}
