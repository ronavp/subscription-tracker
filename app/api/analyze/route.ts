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
  "Other",
];

// Step 2: clean up messy raw descriptions ("SP * SPOTIFY AB STOCKHOLM") into a
// normalized merchant name ("Spotify") + category, in batches to keep prompts small.
async function cleanBatch(descriptions: string[]) {
  const prompt = `Here is a list of raw bank transaction descriptions. For each one, identify the actual
merchant/company name in a clean, normalized form (e.g. "SP * SPOTIFY AB STOCKHOLM" -> "Spotify",
"NETFLIX.COM 866-6374" -> "Netflix", "WOOLWORTHS 1234 SYDNEY" -> "Woolworths"), and assign the best-fitting
category from this list: ${JSON.stringify(CATEGORIES)}.

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

    // Batch in chunks of 25 to keep prompts manageable and avoid token limits
    const BATCH_SIZE = 25;
    let updated = 0;

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const chunk = transactions.slice(i, i + BATCH_SIZE);
      const cleaned = await cleanBatch(chunk.map((t: (typeof chunk)[number]) => t.rawDescription));

      await Promise.all(
        chunk.map((t: { id: string; rawDescription: string }, idx: number) =>
          prisma.transaction.update({
            where: { id: t.id },
            data: {
              cleanMerchant: cleaned[idx]?.merchant ?? t.rawDescription,
              category: cleaned[idx]?.category ?? "Other",
            },
          })
        )
      );
      updated += chunk.length;
    }

    return NextResponse.json({ updated });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Analysis failed" }, { status: 500 });
  }
}
