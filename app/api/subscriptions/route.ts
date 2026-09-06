import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const subscriptions = await prisma.subscription.findMany({
    where: { active: true, dismissed: false },
    orderBy: { amount: "desc" },
  });
  return NextResponse.json(subscriptions);
}
