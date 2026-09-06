"use client";

import { useEffect, useState } from "react";
import UploadForm from "@/components/UploadForm";
import SubscriptionList from "@/components/SubscriptionList";
import ChatBox from "@/components/ChatBox";

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

export default function Home() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [resetting, setResetting] = useState(false);

  async function loadSubscriptions() {
    const res = await fetch("/api/subscriptions");
    if (res.ok) setSubscriptions(await res.json());
  }

  async function handleReset() {
    const confirmed = window.confirm(
      "This deletes ALL transactions and subscriptions. This can't be undone. Continue?"
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      await loadSubscriptions();
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    loadSubscriptions();
  }, []);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Subscription Tracker</h1>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="text-xs text-neutral-500 hover:text-red-400 border border-neutral-800 rounded-lg px-3 py-1.5"
        >
          {resetting ? "Clearing…" : "Clear Database"}
        </button>
      </div>
      <UploadForm onComplete={loadSubscriptions} />
      <SubscriptionList subscriptions={subscriptions} onUpdated={loadSubscriptions} />
      <ChatBox />
    </main>
  );
}