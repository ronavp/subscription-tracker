"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How much am I spending on streaming services?",
  "What's my most expensive subscription?",
  "What am I paying yearly vs monthly?",
];

function renderContent(content: string) {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const isBulletList = lines.length > 1 && lines.every((l) => /^[-•]\s/.test(l.trim()));

  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  if (isBulletList) {
    return (
      <ul className="list-disc list-inside space-y-1">
        {lines.map((line, i) => (
          <li key={i}>{renderInline(line.replace(/^[-•]\s/, ""))}</li>
        ))}
      </ul>
    );
  }

  return lines.map((line, i) => (
    <p key={i} className={i > 0 ? "mt-2" : ""}>
      {renderInline(line)}
    </p>
  ));
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

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
    <div className="border border-neutral-800 rounded-xl bg-neutral-900 flex flex-col h-[440px] overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-300">Ask about your spending</h2>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="block w-full text-left text-sm text-neutral-400 border border-neutral-800 rounded-lg px-3.5 py-2.5 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`text-sm leading-relaxed rounded-2xl px-4 py-2.5 max-w-[85%] ${
                m.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-neutral-800 text-neutral-100 rounded-bl-sm"
              }`}
            >
              {renderContent(m.content)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-neutral-800 rounded-2xl rounded-bl-sm px-4 py-2.5 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce" />
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 p-3 border-t border-neutral-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 bg-neutral-800 rounded-lg px-3.5 py-2 text-sm outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          Ask
        </button>
      </form>
    </div>
  );
}