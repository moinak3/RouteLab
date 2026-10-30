import { useRef, useState } from "react";
import type { Page } from "../types/ui";

type ImportResult = { imported: number; errors: string[] };

export function NewWorkspaceOverview({ onImport, onNavigate, onUseDemo }: {
  onImport: (file: File) => Promise<ImportResult>;
  onNavigate: (page: Page) => void;
  onUseDemo: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const result = await onImport(file);
      if (!result.imported) setError(result.errors[0] ?? "No traces were found in this file.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be imported.");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const steps = [
    ["01", "Add production traces", "Upload CSV or JSONL. RouteLab stores and normalizes the records without classifying or evaluating them."],
    ["02", "Generate task groups", "Start an explicit grouping run to organize requests by the outcome they are trying to achieve."],
    ["03", "Set the quality bar", "Connect eval evidence and review where automated judges disagree with people."],
    ["04", "Replay candidate models", "Compare quality, latency, and cost on the same requests within each task group."],
    ["05", "Approve an allocation policy", "Promote only the task-model combinations that clear your requirements."],
  ];

  return <div className="new-workspace-overview">
    <section className="panel new-workspace-hero">
      <div>
        <p className="eyebrow">Your workspace is ready</p>
        <h2>Build your first model allocation policy.</h2>
        <p>Start with the production traces you already have. RouteLab will organize the work into task groups, show where you have enough evaluation evidence, and only then recommend a model change.</p>
        <div className="new-workspace-actions">
          <input ref={inputRef} type="file" accept=".csv,.json,.jsonl" onChange={(event) => void importFile(event.target.files?.[0])} aria-label="Select a trace file" />
          <button type="button" className="primary" disabled={importing} onClick={() => inputRef.current?.click()}>{importing ? "Importing…" : "Upload traces"}</button>
          <button type="button" onClick={() => onNavigate("Traces")}>See connection options</button>
        </div>
        {error && <p className="new-workspace-error" role="alert">{error}</p>}
      </div>
      <div className="new-workspace-promise" aria-label="What RouteLab produces">
        <span>What you will leave with</span>
        <strong>A model decision for each recurring task</strong>
        <ul><li>Measured against your quality bar</li><li>Compared on cost and latency</li><li>Backed by inspectable traces and evals</li></ul>
      </div>
    </section>

    <section className="new-workspace-grid">
      <article className="panel new-workspace-steps">
        <div className="panelhead"><div><p className="eyebrow">Evidence path</p><h2>Five steps from traces to a policy</h2></div><span>0 of 5</span></div>
        <ol>{steps.map(([number, title, detail], index) => <li className={index === 0 ? "current" : "waiting"} key={number}><b>{number}</b><div><strong>{title}</strong><p>{detail}</p></div><span>{index === 0 ? "Start here" : "Waiting"}</span></li>)}</ol>
      </article>
      <article className="panel new-workspace-demo">
        <p className="eyebrow">Not ready with data?</p>
        <h2>Explore a completed example.</h2>
        <p>The demo workspace contains sample traces, task groups, eval outcomes, and a draft routing policy. It is always labeled and kept separate from your work.</p>
        <button type="button" onClick={onUseDemo}>Open demo workspace</button>
        <small>Your workspace will remain empty and unchanged.</small>
      </article>
    </section>
  </div>;
}
