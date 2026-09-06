"use client";

import { useState, useRef } from "react";

interface Props {
  onComplete: () => void;
}

type Stage = "idle" | "uploading" | "analyzing" | "detecting" | "done" | "error";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "Drop a CSV bank statement here, or click to browse",
  uploading: "Uploading & mapping columns…",
  analyzing: "Cleaning up merchant names…",
  detecting: "Detecting recurring subscriptions…",
  done: "Done!",
  error: "Something went wrong",
};

export default function UploadForm({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBusy = stage === "uploading" || stage === "analyzing" || stage === "detecting";

  async function handleFile(file: File) {
    setError(null);
    setSummary(null);
    setFileName(file.name);
    try {
      setStage("uploading");
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");

      setStage("analyzing");
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadBatchId: uploadData.uploadBatchId }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error ?? "Analysis failed");

      setStage("detecting");
      const detectRes = await fetch("/api/detect", { method: "POST" });
      const detectData = await detectRes.json();
      if (!detectRes.ok) throw new Error(detectData.error ?? "Detection failed");

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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isBusy) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !isBusy && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${isBusy ? "cursor-default" : "hover:border-blue-500 hover:bg-neutral-900/60"}
        ${isDragging ? "border-blue-500 bg-neutral-900/60" : "border-neutral-800 bg-neutral-900"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        disabled={isBusy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div className="flex flex-col items-center gap-3">
        {isBusy ? (
          <div className="w-8 h-8 rounded-full border-2 border-neutral-700 border-t-blue-500 animate-spin" />
        ) : stage === "done" ? (
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
            ✓
          </div>
        ) : stage === "error" ? (
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400">✕</div>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-neutral-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
        )}

        <p className="text-sm text-neutral-400">{STAGE_LABELS[stage]}</p>

        {fileName && stage !== "idle" && <p className="text-xs text-neutral-600">{fileName}</p>}
        {summary && <p className="text-sm text-green-400">{summary}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}