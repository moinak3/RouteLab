import { useEffect, useMemo, useState } from "react";
import { modelCatalog } from "../core/catalog";
import {
  activateRoutingPolicy,
  fetchPublishedPolicyHistory,
  fetchSignedRoutingPolicy,
  publishRoutingPolicy,
} from "../core/routingPolicyPersistence";
import type { PublishedPolicyHistory, PublishedTaskSignature, SignedRoutingPolicyEnvelope } from "../core/publishedRoutingPolicy";

const emptyHistory: PublishedPolicyHistory = { activeVersion: null, versions: [] };

function download(name: string, contents: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const modelName = (id: string) => modelCatalog.find((model) => model.id === id)?.display_name ?? id;

export function RoutingPolicyPublisher({ signatures, draftRevision, draftSaved }: {
  signatures: PublishedTaskSignature[];
  draftRevision: number;
  draftSaved: boolean;
}) {
  const [history, setHistory] = useState<PublishedPolicyHistory>(emptyHistory);
  const [state, setState] = useState<"loading" | "idle" | "publishing" | "activating" | "exporting" | "error">("loading");
  const [message, setMessage] = useState("");
  const active = history.versions.find((version) => version.active);
  const latest = history.versions[0];
  const refresh = async () => {
    try {
      setHistory(await fetchPublishedPolicyHistory());
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not load policy versions.");
    }
  };
  useEffect(() => { void refresh(); }, []);
  const publish = async () => {
    setState("publishing");
    setMessage("");
    try {
      const published = await publishRoutingPolicy({ expectedRevision: draftRevision, signatures });
      setMessage(`Policy v${published.bundle.version} is signed and ready to activate.`);
      await refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Policy publishing failed.");
    }
  };
  const activate = async (version: number) => {
    setState("activating");
    setMessage("");
    try {
      await activateRoutingPolicy(version);
      setMessage(`Policy v${version} is now the active sidecar policy.`);
      await refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Policy activation failed.");
    }
  };
  const exportBundle = async (version: number | "active") => {
    setState("exporting");
    setMessage("");
    try {
      const signed = await fetchSignedRoutingPolicy(version);
      download(`routelab-policy-v${signed.bundle.version}.json`, `${JSON.stringify(signed, null, 2)}\n`);
      setMessage(`Policy v${signed.bundle.version} bundle downloaded.`);
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Policy export failed.");
    }
  };
  const exportSidecarEnvironment = async () => {
    setState("exporting");
    setMessage("");
    try {
      const signed = await fetchSignedRoutingPolicy("active");
      const policyUrl = `${window.location.origin}/api/routing-policy/bundle?version=active`;
      const contents = [
        `ROUTELAB_POLICY_URL=${policyUrl}`,
        `ROUTELAB_POLICY_PUBLIC_KEY=${signed.signing.publicKey}`,
        "OPENROUTER_API_KEY=add-customer-owned-key-here",
        "ROUTELAB_DECISION_MODE=shadow",
        "ROUTELAB_POLICY_POLL_MS=30000",
        "PORT=8787",
        "",
      ].join("\n");
      download("routelab-sidecar.env.example", contents, "text/plain");
      setMessage("Sidecar environment template downloaded. Add the customer's OpenRouter key before running it.");
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Sidecar setup export failed.");
    }
  };
  const publishedVersions = useMemo(() => history.versions.slice(0, 6), [history.versions]);
  return <section className="policy-publish-workflow">
    <div className="policy-publish-head">
      <div>
        <p className="eyebrow">Publish and export</p>
        <h3>Turn this draft into a customer-hosted decision policy</h3>
        <p>Publishing freezes and signs an immutable version. Activating changes which verified bundle the local sidecar pulls. Neither action proxies model traffic through RouteLab Cloud.</p>
      </div>
      <button type="button" className="primary" disabled={!draftSaved || state === "publishing"} onClick={publish}>{state === "publishing" ? "Publishing..." : "Publish signed policy"}</button>
    </div>
    {!draftSaved && <p className="policy-lifecycle-message warn">Wait for the cloud draft to finish saving before publishing.</p>}
    {message && <p className={`policy-lifecycle-message ${state === "error" ? "error" : "good"}`}>{message}</p>}
    <div className="policy-lifecycle-state">
      <article><small>Latest published</small><b>{latest ? `Policy v${latest.version}` : "None yet"}</b><span>{latest ? `${latest.overrideCount} overrides · ${latest.signatureCount} signatures` : "Publish the saved draft to create v1."}</span></article>
      <article><small>Active for sidecars</small><b>{active ? `Policy v${active.version}` : "No active policy"}</b><span>{active ? `${modelName(active.fallbackModelId)} fallback` : "Activation is separate from publishing."}</span></article>
      <article><small>Runtime ownership</small><b>Customer hosted</b><span>Customer OpenRouter key · local task classification</span></article>
    </div>
    {publishedVersions.length > 0 && <div className="policy-version-list">
      <div className="policy-version-row policy-version-labels"><span>Version</span><span>Evidence snapshot</span><span>Status</span><span>Actions</span></div>
      {publishedVersions.map((version) => <div className="policy-version-row" key={version.policyId}>
        <span><b>v{version.version}</b><small>{new Date(version.publishedAt).toLocaleString()}</small></span>
        <span>{version.overrideCount} overrides · {version.signatureCount} signatures<small>Expires {new Date(version.expiresAt).toLocaleDateString()}</small></span>
        <span className={version.active ? "active" : "published"}>{version.active ? "Active" : "Published"}</span>
        <span className="policy-version-actions">{!version.active && <button type="button" disabled={state === "activating"} onClick={() => activate(version.version)}>Activate</button>}<button type="button" disabled={state === "exporting"} onClick={() => exportBundle(version.version)}>Export JSON</button></span>
      </div>)}
    </div>}
    <div className="sidecar-export">
      <div><small>RouteLab Local</small><b>Docker-ready customer sidecar</b><span>Verifies the policy, classifies through the customer's OpenRouter account, applies the active rules locally, and returns the selected model.</span></div>
      <button type="button" disabled={!active || state === "exporting"} onClick={exportSidecarEnvironment}>Export sidecar setup</button>
    </div>
  </section>;
}
