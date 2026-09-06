import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Deletes everything — all transactions, all detected subscriptions, and the
// join records linking them. Order matters here regardless of DB-level cascade
// settings: clear the join table first, then subscriptions, then transactions.
export async function POST() {
  try {
    await prisma.subscriptionTransaction.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.transaction.deleteMany({});

    return NextResponse.json({ message: "Database cleared" });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Reset failed" }, { status: 500 });
  }
}