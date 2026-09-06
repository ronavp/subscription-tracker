import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PATCH { userAmount: number | null } — set your actual share of a shared subscription,
// or pass null to clear the override and go back to the full detected amount.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userAmount } = await req.json();

    if (userAmount !== null && (typeof userAmount !== "number" || isNaN(userAmount) || userAmount < 0)) {
      return NextResponse.json({ error: "userAmount must be a non-negative number or null" }, { status: 400 });
    }

    const sub = await prisma.subscription.update({
      where: { id },
      data: { userAmount },
    });

    return NextResponse.json(sub);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Update failed" }, { status: 500 });
  }
}