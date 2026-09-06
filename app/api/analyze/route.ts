import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askClaude, MODELS } from "@/lib/anthropic";

const CATEGORIES = [
  "Streaming",
  "Music",
  "Software/SaaS",
  "Fitness",
  "News/Media",
  "Gaming",
  "Food Delivery",
  "Cloud Storage",
  "Utilities",
  "Insurance",
  "Membership",
  "Other",
];

async function cleanBatch(descriptions: string[]) {
  const prompt = `Here is a list of raw bank transaction descriptions. For each one, identify the actual
merchant/company name in a clean, normalized form, and assign the best-fitting category from this list:
${JSON.stringify(CATEGORIES)}.

General normalization examples:
"SP * SPOTIFY AB STOCKHOLM" -> "Spotify"
"NETFLIX.COM 866-6374" -> "Netflix"
"WOOLWORTHS 1234 SYDNEY" -> "Woolworths"

IMPORTANT — keep membership/subscription add-ons SEPARATE from the base pay-per-use service they
belong to, even though they share a parent brand. Do not collapse these into the generic brand name:
"UBER ONE MEMBERSHIP" or "UBER * ONE" -> "Uber One" (category: Membership) — NOT "Uber"
"UBER TRIP" or "UBER *TRIP HELP.UBER.COM" -> "Uber" (category: Other) — this is a regular ride, not a subscription
"UBER EATS" (an actual food order) -> "Uber Eats" (category: Food Delivery)
"AMAZON PRIME" -> "Amazon Prime" (category: Membership) — NOT "Amazon"
"DOORDASH DASHPASS" -> "DashPass" (category: Membership) — NOT "DoorDash"
The distinction matters: a membership fee is a fixed recurring charge (same amount every time),
while regular per-use charges from the same company vary in amount. Use the description text to tell
them apart — look for words like "MEMBERSHIP", "ONE", "PRIME", "PASS", "PLUS" that indicate a
subscription tier rather than a one-off transaction.

Descriptions (respond in the same order):
${descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Respond with ONLY a JSON array, no other text, in this exact shape:
[{ "merchant": "...", "category": "..." }, ...]`;

  const result = await askClaude(prompt, { model: MODELS.fast, jsonMode: true, maxTokens: 2000 });
  return result as { merchant: string; category: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const { uploadBatchId } = await req.json();
    if (!uploadBatchId) {
      return NextResponse.json({ error: "uploadBatchId required" }, { status: 400 });
    }

    const transactions = await prisma.transaction.findMany({
      where: { uploadBatchId, cleanMerchant: null },
    });

    if (transactions.length === 0) {
      return NextResponse.json({ message: "Nothing to analyze", updated: 0 });
    }

    const BATCH_SIZE = 25;
    let updated = 0;

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const chunk = transactions.slice(i, i + BATCH_SIZE);
      const cleaned = await cleanBatch(chunk.map((t: (typeof chunk)[number]) => t.rawDescription));

      for (let idx = 0; idx < chunk.length; idx++) {
        const t = chunk[idx];
        await prisma.transaction.update({
          where: { id: t.id },
          data: {
            cleanMerchant: cleaned[idx]?.merchant ?? t.rawDescription,
            category: cleaned[idx]?.category ?? "Other",
          },
        });
      }

      updated += chunk.length;
    }

    return NextResponse.json({ updated });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Analysis failed" }, { status: 500 });
  }
}