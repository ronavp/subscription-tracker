"use client";

import { useState } from "react";

interface Subscription {
  id: string;
  merchantName: string;
  category: string | null;
  amount: number;
  userAmount: number | null;
  frequency: string;
  confidence: number;
  nextEstimatedDate: string | null;
}

interface Props {
  subscriptions: Subscription[];
  onUpdated: () => void;
}

type Period = "weekly" | "monthly" | "yearly";
const PERIODS: Period[] = ["weekly", "monthly", "yearly"];
const PERIOD_LABELS: Record<Period, string> = { weekly: "/wk", monthly: "/mo", yearly: "/yr" };

function toMonthlyEquivalent(amount: number, frequency: string) {
  switch (frequency) {
    case "weekly":
      return amount * 4.345;
    case "fortnightly":
      return amount * 2.1725;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
      return amount / 12;
    default:
      return amount;
  }
}

function fromMonthlyToPeriod(monthlyAmount: number, period: Period) {
  switch (period) {
    case "weekly":
      return monthlyAmount / 4.345;
    case "yearly":
      return monthlyAmount * 12;
    default:
      return monthlyAmount;
  }
}

function effectiveAmount(s: Subscription) {
  return s.userAmount ?? s.amount;
}

// The detection backend names merchants like "Apple ($4.49)" to keep otherwise-identical
// merchant names distinct internally when it isolates a recurring price out of a noisy
// purchase history. That's redundant in the UI since the price is already shown on the
// right — strip it here for display only, without touching the underlying data.
function displayName(name: string) {
  const match = name.match(/^(.+?)\s*\(\$[\d,]+\.\d{2}\)$/);
  return match ? match[1] : name;
}

export default function SubscriptionList({ subscriptions, onUpdated }: Props) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const totalMonthly = subscriptions.reduce(
    (sum, s) => sum + toMonthlyEquivalent(effectiveAmount(s), s.frequency),
    0
  );
  const totalInPeriod = fromMonthlyToPeriod(totalMonthly, period);

  function startEdit(s: Subscription) {
    setEditingId(s.id);
    setEditValue(effectiveAmount(s).toFixed(2));
  }

  async function saveEdit(s: Subscription) {
    setSaving(true);
    try {
      const parsed = parseFloat(editValue);
      const userAmount = isNaN(parsed) ? null : parsed === s.amount ? null : parsed;

      await fetch(`/api/subscriptions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAmount }),
      });
      onUpdated();
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  }

  async function clearOverride(s: Subscription) {
    setSaving(true);
    try {
      await fetch(`/api/subscriptions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAmount: null }),
      });
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-neutral-800 rounded-xl p-6 bg-neutral-900">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-lg font-semibold">Your Subscriptions</h2>
        <div className="text-right">
          <div className="flex justify-end gap-1 mb-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-xs px-2 py-0.5 rounded-md ${
                  period === p ? "bg-blue-600 text-white" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {p === "weekly" ? "Week" : p === "monthly" ? "Month" : "Year"}
              </button>
            ))}
          </div>
          <span className="text-2xl font-bold">
            ${totalInPeriod.toFixed(2)}
            {PERIOD_LABELS[period]}
          </span>
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <p className="text-neutral-500 text-sm">No subscriptions detected yet — upload a statement above.</p>
      ) : (
        <div className="divide-y divide-neutral-800">
          {subscriptions
            .sort(
              (a, b) =>
                toMonthlyEquivalent(effectiveAmount(b), b.frequency) -
                toMonthlyEquivalent(effectiveAmount(a), a.frequency)
            )
            .map((s) => {
              const isShared = s.userAmount !== null && s.userAmount !== s.amount;
              const monthly = toMonthlyEquivalent(effectiveAmount(s), s.frequency);
              const inPeriod = fromMonthlyToPeriod(monthly, period);
              const isEditing = editingId === s.id;

              return (
                <div key={s.id} className="py-3 flex justify-between items-center group">
                  <div>
                    <p className="font-medium">{displayName(s.merchantName)}</p>
                    <p className="text-xs text-neutral-500">
                      {s.category ?? "Other"} · {s.frequency}
                      {s.confidence < 0.65 && <span className="text-yellow-500 ml-1">· low confidence</span>}
                      {isShared && <span className="text-blue-400 ml-1">· split (full bill ${s.amount.toFixed(2)})</span>}
                    </p>
                  </div>

                  <div className="text-right flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <input
                          type="number"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveEdit(s)}
                          autoFocus
                          className="w-20 bg-neutral-800 rounded px-2 py-1 text-sm text-right outline-none"
                        />
                        <button
                          onClick={() => saveEdit(s)}
                          disabled={saving}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-neutral-500 hover:text-neutral-300"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <div>
                          <p className="font-medium">${effectiveAmount(s).toFixed(2)}</p>
                          <p className="text-xs text-neutral-500">
                            ${inPeriod.toFixed(2)}
                            {PERIOD_LABELS[period]}
                          </p>
                        </div>
                        <button
                          onClick={() => startEdit(s)}
                          className="text-sm text-neutral-500 hover:text-blue-400"
                          title="Adjust your share"
                        >
                          ✎
                        </button>
                        {isShared && (
                          <button
                            onClick={() => clearOverride(s)}
                            className="text-sm text-neutral-500 hover:text-red-400"
                            title="Reset to full amount"
                          >
                            ↺
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}