import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askClaude, MODELS } from "@/lib/anthropic";
import { detectRecurringGroups, DetectedGroup } from "@/lib/detection";

// Step 3: for groups where the interval math is ambiguous (confidence in the
// "maybe" zone), ask Claude to make the judgment call — e.g. distinguish a real
// subscription from a coincidentally regular one-off purchase (weekly coffee run).
async function aiJudgeAmbiguousGroup(group: DetectedGroup) {
  const prompt = `A user's bank transactions show a merchant charging them repeatedly:

Merchant: ${group.merchant}
Number of charges: ${group.transactionIds.length}
Average amount: $${group.avgAmount.toFixed(2)}
Average days between charges: ${group.intervalDays}
Detected frequency pattern: ${group.frequency}

Is this most likely a genuine recurring subscription/membership (like streaming, software,
gym, insurance) rather than a coincidentally regular one-off purchase (like buying coffee or
groceries at the same place on a regular schedule, which isn't really a "subscription")?

Respond with ONLY a JSON object: { "isSubscription": true/false, "reasoning": "one short sentence" }`;

  return (await askClaude(prompt, { model: MODELS.smart, jsonMode: true, maxTokens: 200 })) as {
    isSubscription: boolean;
    reasoning: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { cleanMerchant: { not: null } },
    });

    const groups = detectRecurringGroups(
      transactions.map((t: (typeof transactions)[number]) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        cleanMerchant: t.cleanMerchant!,
      }))
    );

    const created: string[] = [];
    const dismissedByAi: string[] = [];

    for (const group of groups) {
      // High confidence: save automatically.
      // Low confidence (<0.35): skip, not worth bothering the user or the AI about.
      // Middle zone: let Claude make the judgment call.
      if (group.confidence < 0.35) continue;

      let shouldSave = group.confidence >= 0.65;
      let reasoning: string | undefined;

      if (!shouldSave) {
        const judgment = await aiJudgeAmbiguousGroup(group);
        shouldSave = judgment.isSubscription;
        reasoning = judgment.reasoning;
        if (!shouldSave) dismissedByAi.push(`${group.merchant}: ${reasoning}`);
      }

      if (!shouldSave) continue;

      const category = transactions.find(
        (t: (typeof transactions)[number]) => t.cleanMerchant === group.merchant
      )?.category;

      // Find existing subscription for this merchant, or create a new one
      let sub = await prisma.subscription.findFirst({ where: { merchantName: group.merchant } });
      if (sub) {
        sub = await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            amount: group.avgAmount,
            frequency: group.frequency,
            confidence: group.confidence,
            nextEstimatedDate: group.nextEstimatedDate,
            category,
          },
        });
      } else {
        sub = await prisma.subscription.create({
          data: {
            merchantName: group.merchant,
            amount: group.avgAmount,
            frequency: group.frequency,
            confidence: group.confidence,
            nextEstimatedDate: group.nextEstimatedDate,
            category,
          },
        });
      }

      // Link transactions (ignore duplicates)
      for (const txnId of group.transactionIds) {
        await prisma.subscriptionTransaction.upsert({
          where: { subscriptionId_transactionId: { subscriptionId: sub.id, transactionId: txnId } },
          create: { subscriptionId: sub.id, transactionId: txnId },
          update: {},
        });
      }

      created.push(group.merchant);
    }

    return NextResponse.json({ detected: created, dismissedByAi });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Detection failed" }, { status: 500 });
  }
}
