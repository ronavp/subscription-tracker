// Thin wrapper around the Anthropic Messages API.
// Runs server-side only (API routes) — never expose ANTHROPIC_API_KEY to the client.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Use haiku for cheap, high-volume classification tasks (column mapping, merchant cleanup).
// Use sonnet for anything that needs real judgment (ambiguous subscription calls, chat answers).
export const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-5",
} as const;

interface AskClaudeOptions {
  system?: string;
  model?: string;
  maxTokens?: number;
  jsonMode?: boolean; // if true, strips markdown fences and JSON.parses the response
}

export async function askClaude(prompt: string, options: AskClaudeOptions = {}) {
  const { system, model = MODELS.fast, maxTokens = 1500, jsonMode = false } = options;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((c: any) => c.type === "text");
  const text = textBlock?.text ?? "";

  if (jsonMode) {
    const cleaned = text.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`Failed to parse JSON from model response: ${cleaned}`);
    }
  }

  return text;
}
