"use client";

import { useState } from "react";

interface Props {
  onComplete: () => void;
}

type Stage = "idle" | "uploading" | "analyzing" | "detecting" | "done" | "error";

export default function UploadForm({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setSummary(null);
    try {
      setStage("uploading");
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error);

      setStage("analyzing");
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadBatchId: uploadData.uploadBatchId }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error);

      setStage("detecting");
      const detectRes = await fetch("/api/detect", { method: "POST" });
      const detectData = await detectRes.json();
      if (!detectRes.ok) throw new Error(detectData.error);

      setStage("done");
      setSummary(
        `Imported ${uploadData.transactionsImported} transactions, found ${detectData.detected.length} subscriptions.`
      );
      onComplete();
    } catch (err: any) {
      setStage("error");
      setError(err.message ?? "Something went wrong");
    }
  }

  const stageLabels: Record<Stage, string> = {
    idle: "Upload a CSV bank statement",
    uploading: "Uploading & mapping columns…",
    analyzing: "Cleaning up merchant names…",
    detecting: "Detecting recurring subscriptions…",
    done: "Done!",
    error: "Something went wrong",
  };

  return (
    <div className="border border-neutral-800 rounded-xl p-6 bg-neutral-900">
      <label className="block cursor-pointer">
        <span className="text-sm text-neutral-400">{stageLabels[stage]}</span>
        <input
          type="file"
          accept=".csv"
          className="block mt-2 text-sm"
          disabled={stage !== "idle" && stage !== "done" && stage !== "error"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      {summary && <p className="mt-3 text-sm text-green-400">{summary}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
