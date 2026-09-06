"use client";

import { useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How much am I spending on streaming services?",
  "What's my most expensive subscription?",
  "What am I paying yearly vs monthly?",
];

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.ok ? data.answer : `Error: ${data.error}` },
      ]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-neutral-800 rounded-xl p-6 bg-neutral-900 flex flex-col h-[420px]">
      <h2 className="text-lg font-semibold mb-3">Ask about your spending</h2>

      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="block w-full text-left text-sm text-neutral-400 border border-neutral-800 rounded-lg px-3 py-2 hover:bg-neutral-800"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
              m.role === "user" ? "bg-blue-600 ml-auto" : "bg-neutral-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && <div className="text-sm text-neutral-500">Thinking…</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm outline-none"
        />
        <button type="submit" className="bg-blue-600 rounded-lg px-4 py-2 text-sm font-medium">
          Ask
        </button>
      </form>
    </div>
  );
}
