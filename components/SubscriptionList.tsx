interface Subscription {
  id: string;
  merchantName: string;
  category: string | null;
  amount: number;
  frequency: string;
  confidence: number;
  nextEstimatedDate: string | null;
}

interface Props {
  subscriptions: Subscription[];
}

// Mirrors lib/detection.ts toMonthlyEquivalent — duplicated here since this
// runs client-side; keep the two in sync if you change the multipliers.
function monthlyEquivalent(amount: number, frequency: string) {
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

export default function SubscriptionList({ subscriptions }: Props) {
  const totalMonthly = subscriptions.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.frequency), 0);

  return (
    <div className="border border-neutral-800 rounded-xl p-6 bg-neutral-900">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Your Subscriptions</h2>
        <span className="text-2xl font-bold">${totalMonthly.toFixed(2)}/mo</span>
      </div>

      {subscriptions.length === 0 ? (
        <p className="text-neutral-500 text-sm">No subscriptions detected yet — upload a statement above.</p>
      ) : (
        <div className="divide-y divide-neutral-800">
          {subscriptions
            .sort((a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency))
            .map((s) => (
              <div key={s.id} className="py-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{s.merchantName}</p>
                  <p className="text-xs text-neutral-500">
                    {s.category ?? "Other"} · {s.frequency}
                    {s.confidence < 0.65 && <span className="text-yellow-500 ml-1">· low confidence</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">${s.amount.toFixed(2)}</p>
                  <p className="text-xs text-neutral-500">${monthlyEquivalent(s.amount, s.frequency).toFixed(2)}/mo</p>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
