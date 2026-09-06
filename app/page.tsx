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
  frequency: string;
  confidence: number;
  nextEstimatedDate: string | null;
}

export default function Home() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  async function loadSubscriptions() {
    const res = await fetch("/api/subscriptions");
    if (res.ok) setSubscriptions(await res.json());
  }

  useEffect(() => {
    loadSubscriptions();
  }, []);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">Subscription Tracker</h1>
      <UploadForm onComplete={loadSubscriptions} />
      <SubscriptionList subscriptions={subscriptions} />
      <ChatBox />
    </main>
  );
}
