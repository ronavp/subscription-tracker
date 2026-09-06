import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askClaude, MODELS } from "@/lib/anthropic";
import { detectRecurringGroups, DetectedGroup } from "@/lib/detection";

const CONFIDENCE_MIN = 0.35;

// Above this coefficient of variation (stddev / mean), the charged amount varies too
// much to be a fixed subscription fee — this is what catches things like a personal
// savings transfer of a DIFFERENT amount each time, before it even reaches the AI.
const MAX_AMOUNT_VARIATION = 0.3;

const SUBSCRIPTION_KEYWORDS = /membership|subscription|premium|recurring|auto.?renew|billing|monthly (fee|charge|plan)|annual (fee|plan)/i;

// Hard, deterministic exclusions — these never reach the AI at all, because getting
// them wrong is either financially dangerous (a personal transfer misread as a huge
// "subscription") or a very common, very confident false-positive pattern (transit
// card top-ups). Relying on the AI to catch these every time isn't safe enough.
const SELF_TRANSFER_KEYWORDS = /\b(plus save|net.?bank saver|save account|savings? account|isaver|esaver|goalsaver|bonus saver|round.?up|sweep)\b/i;
const TRANSIT_KEYWORDS = /\bopal\b|\bmyki\b|\bezlink\b|\btoll\b|public transport|transperth|translink|\bgo ?card\b/i;

const FREQUENCY_DAYS: Record<string, number> = {
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

type WithMerchant = { cleanMerchant: string | null; rawDescription: string; amount: number };

function splitByKeyword<T extends WithMerchant>(transactions: T[]): (T & { effectiveMerchant: string })[] {
  const byMerchant = new Map<string, T[]>();
  for (const t of transactions) {
    if (!t.cleanMerchant) continue;
    const list = byMerchant.get(t.cleanMerchant) ?? [];
    list.push(t);
    byMerchant.set(t.cleanMerchant, list);
  }

  const result: (T & { effectiveMerchant: string })[] = [];

  for (const [merchant, txns] of byMerchant.entries()) {
    const hasMatch = txns.some((t) => SUBSCRIPTION_KEYWORDS.test(t.rawDescription));
    const hasNonMatch = txns.some((t) => !SUBSCRIPTION_KEYWORDS.test(t.rawDescription));
    const isMixedGroup = hasMatch && hasNonMatch;

    for (const t of txns) {
      const isMatch = SUBSCRIPTION_KEYWORDS.test(t.rawDescription);
      const effectiveMerchant = isMixedGroup && isMatch ? `${merchant} Membership` : merchant;
      result.push({ ...t, effectiveMerchant });
    }
  }

  return result;
}

function splitByRecurringAmount<T extends { effectiveMerchant: string; amount: number }>(
  transactions: T[]
): T[] {
  const byMerchant = new Map<string, T[]>();
  for (const t of transactions) {
    const list = byMerchant.get(t.effectiveMerchant) ?? [];
    list.push(t);
    byMerchant.set(t.effectiveMerchant, list);
  }

  const result: T[] = [];

  for (const [merchant, txns] of byMerchant.entries()) {
    const amountCounts = new Map<number, number>();
    for (const t of txns) {
      const key = Math.round(t.amount * 100);
      amountCounts.set(key, (amountCounts.get(key) ?? 0) + 1);
    }

    const hasRepeatingSubset = [...amountCounts.values()].some((c) => c >= 2 && c < txns.length);

    if (!hasRepeatingSubset) {
      result.push(...txns);
      continue;
    }

    for (const t of txns) {
      const key = Math.round(t.amount * 100);
      const count = amountCounts.get(key)!;
      if (count >= 2 && count < txns.length) {
        result.push({ ...t, effectiveMerchant: `${merchant} ($${t.amount.toFixed(2)})` });
      } else {
        result.push(t);
      }
    }
  }

  return result;
}

function coefficientOfVariation(amounts: number[]): number {
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (mean === 0) return 0;
  const variance = amounts.reduce((a, n) => a + (n - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

async function aiJudgeGroup(group: DetectedGroup, category: string | undefined) {
  const prompt = `A user's bank transactions show a merchant charging them repeatedly:

Merchant: ${group.merchant}
Category (auto-assigned, may be wrong): ${category ?? "Unknown"}
Number of charges: ${group.transactionIds.length}
Average amount: $${group.avgAmount.toFixed(2)}
Average days between charges: ${group.intervalDays}
Detected frequency pattern: ${group.frequency}

Decide if this is a genuine recurring SUBSCRIPTION or MEMBERSHIP — something the user
specifically signed up for that bills automatically (e.g. Netflix, Spotify, a gym membership,
software like Adobe/Claude, insurance, phone/internet plan, a subscription box, PlayStation Plus).

It IS a subscription if it's a membership/premium tier add-on billed at a fixed recurring
amount, even when the parent brand also sells one-off items or pay-per-use services —
e.g. "Uber One", "Amazon Prime", "PlayStation Plus". If the merchant name includes a specific
dollar amount in parentheses (a naming convention this system uses when it isolates one
recurring price out of a merchant's otherwise varied purchase history), treat that as a strong
signal it recurs — the surrounding math already confirmed the interval is consistent.

It is NOT a subscription if it's any of these, even though they recur regularly:
- Food delivery or takeout ORDERS — habitual purchases, not a subscription billing arrangement
- Rideshare TRIPS — pay-per-use, not a subscription
- Public transport, transit card top-ups, or toll road charges — pay-per-use, even when the
  fare amount is often identical (e.g. the same daily commute costing the same each time)
- Retail or grocery shopping, or one-off purchases (games, DLC, items) at the same store
- A payment to or from another PERSON's name rather than a company
- A transfer to the user's own savings/investment account, or between their own accounts
- One-off large purchases that happen to repeat by coincidence

A strong signal for a real subscription: the exact same amount charged at a fixed interval.
A strong signal against: the amount varies noticeably between charges (typical of pay-per-use).

Respond with ONLY a JSON object: {"is_subscription": true/false, "reasoning": "one short sentence"}`;

  return (await askClaude(prompt, { model: MODELS.smart, jsonMode: true, maxTokens: 200 })) as {
    is_subscription: boolean;
    reasoning: string;
  };
}

async function aiJudgeSingleOccurrence(
  merchant: string,
  rawDescription: string,
  amount: number,
  category: string | undefined
) {
  const prompt = `A user's bank transaction appears only ONCE in the statement period provided
(too recent, or the statement doesn't span long enough to show a repeat yet):

Merchant: ${merchant}
Raw transaction description: "${rawDescription}"
Amount: $${amount.toFixed(2)}
Category (auto-assigned, may be wrong): ${category ?? "Unknown"}

Based purely on the wording of the description (it contains a word like "membership",
"subscription", "premium", "billing", etc.), does this look like a genuine subscription or
membership fee that bills on a recurring basis — even though we can't yet confirm the interval
because it's only appeared once?

Respond with ONLY a JSON object: {"is_subscription": true/false, "reasoning": "one short sentence"}`;

  return (await askClaude(prompt, { model: MODELS.smart, jsonMode: true, maxTokens: 200 })) as {
    is_subscription: boolean;
    reasoning: string;
  };
}

async function upsertSubscription(
  merchant: string,
  amount: number,
  frequency: string,
  confidence: number,
  nextEstimatedDate: Date | null,
  category: string | undefined
) {
  let sub = await prisma.subscription.findFirst({ where: { merchantName: merchant } });
  if (sub) {
    sub = await prisma.subscription.update({
      where: { id: sub.id },
      // Explicitly reactivate — if this merchant was previously marked inactive
      // (stopped renewing) but a fresh matching charge just showed up, it's active again.
      data: { amount, frequency, confidence, nextEstimatedDate, category, active: true },
    });
  } else {
    sub = await prisma.subscription.create({
      data: { merchantName: merchant, amount, frequency, confidence, nextEstimatedDate, category },
    });
  }
  return sub;
}

/**
 * Sweeps every currently-active subscription and checks whether it's overdue for its
 * next expected charge by a generous margin. If a subscription hasn't billed again
 * within ~1.5x its normal interval (plus a week of slack for statement/processing lag),
 * it's marked inactive — most likely cancelled, or the free trial/service simply ended.
 */
async function deactivateStaleSubscriptions() {
  const activeSubs = await prisma.subscription.findMany({ where: { active: true } });
  const now = new Date();

  for (const sub of activeSubs) {
    const links = await prisma.subscriptionTransaction.findMany({
      where: { subscriptionId: sub.id },
      include: { transaction: true },
    });
    if (links.length === 0) continue;

    const lastDate = links.reduce(
      (max: Date, l: (typeof links)[number]) => (l.transaction.date > max ? l.transaction.date : max),
      links[0].transaction.date
    );

    const intervalDays = FREQUENCY_DAYS[sub.frequency] ?? 30;
    const graceDays = intervalDays * 1.5 + 7;
    const daysSinceLast = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceLast > graceDays) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { active: false } });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawTransactions = await prisma.transaction.findMany({
      where: { cleanMerchant: { not: null } },
    });

    const afterKeywordSplit = splitByKeyword(rawTransactions);
    const transactions = splitByRecurringAmount(afterKeywordSplit);

    const groups = detectRecurringGroups(
      transactions.map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        cleanMerchant: t.effectiveMerchant,
      }))
    );

    const created: string[] = [];
    const dismissedByAi: string[] = [];
    const handledMerchants = new Set<string>();

    // Pass 1: interval-based recurring groups (2+ occurrences)
    for (const group of groups) {
      handledMerchants.add(group.merchant);
      if (group.confidence < CONFIDENCE_MIN) continue;

      // Hard exclusions — never even ask the AI about these.
      if (SELF_TRANSFER_KEYWORDS.test(group.merchant)) {
        dismissedByAi.push(`${group.merchant}: matches a personal savings/transfer pattern`);
        continue;
      }
      if (TRANSIT_KEYWORDS.test(group.merchant)) {
        dismissedByAi.push(`${group.merchant}: transit/toll fare, pay-per-use`);
        continue;
      }

      // Amount varies too much to be a fixed subscription fee (e.g. a savings
      // transfer of a different amount each time averaging out to something
      // that looks deceptively regular).
      const variation = coefficientOfVariation(group.amounts);
      if (variation > MAX_AMOUNT_VARIATION) {
        dismissedByAi.push(
          `${group.merchant}: amount varies ${(variation * 100).toFixed(0)}% — too inconsistent for a fixed subscription`
        );
        continue;
      }

      const category = transactions.find((t) => t.effectiveMerchant === group.merchant)?.category;

      const judgment = await aiJudgeGroup(group, category);

      if (!judgment.is_subscription) {
        dismissedByAi.push(`${group.merchant}: ${judgment.reasoning}`);
        continue;
      }

      const sub = await upsertSubscription(
        group.merchant,
        group.avgAmount,
        group.frequency,
        group.confidence,
        group.nextEstimatedDate,
        category
      );

      for (const txnId of group.transactionIds) {
        const exists = await prisma.subscriptionTransaction.findFirst({
          where: { subscriptionId: sub.id, transactionId: txnId },
        });
        if (!exists) {
          await prisma.subscriptionTransaction.create({
            data: { subscriptionId: sub.id, transactionId: txnId },
          });
        }
      }

      created.push(group.merchant);
    }

    // Pass 2: single-occurrence transactions whose wording suggests a subscription
    const byEffectiveMerchant = new Map<string, typeof transactions>();
    for (const t of transactions) {
      if (handledMerchants.has(t.effectiveMerchant)) continue;
      const list = byEffectiveMerchant.get(t.effectiveMerchant) ?? [];
      list.push(t);
      byEffectiveMerchant.set(t.effectiveMerchant, list);
    }

    for (const [merchant, txns] of byEffectiveMerchant.entries()) {
      if (txns.length !== 1) continue;
      const txn = txns[0];
      if (!SUBSCRIPTION_KEYWORDS.test(txn.rawDescription)) continue;
      if (SELF_TRANSFER_KEYWORDS.test(merchant) || TRANSIT_KEYWORDS.test(merchant)) continue;

      const judgment = await aiJudgeSingleOccurrence(merchant, txn.rawDescription, txn.amount, txn.category ?? undefined);

      if (!judgment.is_subscription) {
        dismissedByAi.push(`${merchant}: ${judgment.reasoning}`);
        continue;
      }

      const nextEstimated = new Date(txn.date);
      nextEstimated.setDate(nextEstimated.getDate() + 30);

      const sub = await upsertSubscription(merchant, txn.amount, "monthly", 0.4, nextEstimated, txn.category ?? undefined);

      const exists = await prisma.subscriptionTransaction.findFirst({
        where: { subscriptionId: sub.id, transactionId: txn.id },
      });
      if (!exists) {
        await prisma.subscriptionTransaction.create({
          data: { subscriptionId: sub.id, transactionId: txn.id },
        });
      }

      created.push(merchant);
    }

    // Pass 3: check every active subscription (not just ones touched this run) for staleness
    await deactivateStaleSubscriptions();

    return NextResponse.json({ detected: created, dismissedByAi });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Detection failed" }, { status: 500 });
  }
}