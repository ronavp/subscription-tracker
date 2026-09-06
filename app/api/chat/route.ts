import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askClaude, MODELS } from "@/lib/anthropic";
import { toMonthlyEquivalent } from "@/lib/detection";

// Rather than letting the model write raw SQL against a real DB (risky — sky's the
// limit for a hallucinated DELETE), we fetch all active subscriptions ourselves,
// compute the monthly-equivalent spend server-side, and hand Claude a clean summary
// table to reason over in plain English. This keeps it fast, safe, and cheap.
export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { active: true, dismissed: false },
      orderBy: { amount: "desc" },
    });

    const summary = subscriptions.map((s: (typeof subscriptions)[number]) => ({
      merchant: s.merchantName,
      category: s.category ?? "Other",
      amount: s.amount,
      frequency: s.frequency,
      monthlyEquivalent: Math.round(toMonthlyEquivalent(s.amount, s.frequency as any) * 100) / 100,
      nextEstimatedDate: s.nextEstimatedDate,
    }));

    const totalMonthly = summary.reduce((sum: number, s: (typeof summary)[number]) => sum + s.monthlyEquivalent, 0);

    const prompt = `You are a helpful financial assistant answering questions about the user's
subscriptions, based ONLY on the data below. Be concise and specific — use actual numbers.
If the data doesn't contain what's needed to answer, say so plainly rather than guessing.

Total monthly subscription spend: $${totalMonthly.toFixed(2)}

Subscriptions (amount is per-charge, monthlyEquivalent normalizes to a monthly rate for comparison):
${JSON.stringify(summary, null, 2)}

User's question: "${question}"

Answer in plain English, 2-4 sentences max. Use dollar figures where relevant.`;

    const answer = await askClaude(prompt, { model: MODELS.smart, maxTokens: 400 });

    return NextResponse.json({ answer, subscriptionCount: summary.length });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Chat failed" }, { status: 500 });
  }
}
