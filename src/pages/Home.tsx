import { useState, type FormEvent } from "react";

const heroStats = [
  { value: "30-80%", label: "inference savings opportunity" },
  { value: "Human + eval", label: "golden dataset calibration" },
  { value: "Simulate -> recommend -> tune", label: "model optimization loop" },
];

const previewItems = [
  { title: "Trace ingestion", action: "observe" },
  { title: "Distinct tasks", action: "classify" },
  { title: "Import or create evals", action: "define" },
  { title: "Golden calibration", action: "verify" },
  { title: "Prompt simulations", action: "replay" },
  { title: "Recommendations", action: "route" },
  { title: "Fine-tuning prompts", action: "train" },
];

const pains = [
  {
    title: "Overpay",
    text: "Teams use frontier models everywhere because switching feels risky, so software-like margins leak into inference spend.",
  },
  {
    title: "Guess",
    text: "Cheaper models get tested without proof of where quality, latency, or risk will break for a real workflow.",
  },
  {
    title: "Fragment",
    text: "Gateways, evals, golden datasets, logs, model experiments, and fine-tuning workflows live in separate tools, so no system owns model allocation.",
  },
];

const allocationLayers = [
  {
    title: "Gateways",
    items: ["Call many models", "Fallbacks and budgets", "Do not prove which route is safe for you"],
  },
  {
    title: "Eval stacks",
    items: ["Trace and score", "Regression testing", "Need calibration to trust automated judges"],
  },
  {
    title: "RouteLab",
    items: ["Classify tasks", "Calibrate evals with golden data", "Simulate, recommend, and fine-tune"],
  },
];

const steps = [
  {
    title: "Work With Production Traces",
    text: "Start from the traces you already have: prompts, responses, model names, latency, tokens, cost, and workflow context.",
    image: "/marketing/traces.jpg",
    alt: "RouteLab Traces tab showing normalized LLM calls",
  },
  {
    title: "Classify Traces into Distinct Tasks",
    text: "Group traces into repeatable task-level workloads so routing and evaluation decisions are made against stable patterns, not one-off prompts.",
    image: "/marketing/traces.jpg",
    alt: "RouteLab Traces tab showing normalized LLM calls",
  },
  {
    title: "Import or Create Evals",
    text: "Bring existing evals into RouteLab or generate task-specific evaluators for quality, policy, factuality, tool behavior, and failure-mode checks.",
    image: "/marketing/evals.jpg",
    alt: "RouteLab Evals tab showing trace quality judge scores",
  },
  {
    title: "Calibrate Evals With Golden Datasets",
    text: "Upload human-labeled golden datasets and compare human answers against LLM-as-judge results to measure agreement, false passes, false fails, and coverage.",
    image: "/marketing/evals.jpg",
    alt: "RouteLab Evals tab showing trace quality judge scores",
  },
  {
    title: "Run Simulations Across Candidate Models",
    text: "Replay prompts against candidate models and compare direct routing, cascades, thresholds, provider choices, latency, quality, and cost.",
    image: "/marketing/simulations.jpg",
    alt: "RouteLab Simulations tab showing model replay results",
  },
  {
    title: "Generate Recommendations",
    text: "Turn simulation and eval evidence into route recommendations that preserve quality and latency guardrails while reducing spend.",
    image: "/marketing/recommendations.jpg",
    alt: "RouteLab recommendations view",
  },
  {
    title: "Prompt Fine-Tuning When It Is Worth It",
    text: "Detect stable high-context patterns, recommend fine-tuning when it can reduce token overhead, and help users launch an open-weight fine-tuning workflow.",
    image: "/marketing/recommendations.jpg",
    alt: "RouteLab policy export and recommendations view",
  },
];

const assessmentRoutes = [
  { value: "55%", label: "direct cheap" },
  { value: "30%", label: "cascade" },
  { value: "15%", label: "keep premium" },
];

const supportReasons = [
  "High token volume",
  "Customer-facing risk",
  "Clear policies",
  "CSAT and escalation outcomes",
  "Many prompts are over-modeled",
];

const proof = [
  "Trace-native workflow intelligence",
  "Distinct task classification",
  "Eval creation and import",
  "Golden dataset calibration",
  "Provider and model-family agnostic",
  "Simulations, recommendations, and fine-tuning",
];

export function Home({ onGetStarted }: { onGetStarted: (password: string) => boolean }) {
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function openPasswordPrompt() {
    setPassword("");
    setPasswordError(null);
    setIsPasswordOpen(true);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (onGetStarted(password)) return;
    setPasswordError("Incorrect password.");
  }

  return (
    <main className="home-page">
      <nav className="home-nav" aria-label="Marketing navigation">
        <div className="home-brand"><img src="/routelab-icon.svg" alt="" /><b>RouteLab</b></div>
        <div>
          <a href="#problem">Problem</a>
          <a href="#why-now">Why now</a>
          <a href="#how-it-works">How it works</a>
          <button type="button" onClick={openPasswordPrompt}>Get started</button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>Find the cheapest safe model for every AI workflow.</h1>
          <p>
            RouteLab works from production traces, classifies distinct tasks, helps teams create and calibrate evals,
            simulates candidate models, recommends safe routes, and prompts fine-tuning when stable workloads can be made cheaper.
          </p>
          <div className="home-cta-row">
            <button type="button" className="primary" onClick={openPasswordPrompt}>Get started</button>
            <span>Start with traces. Leave with calibrated evals, model recommendations, and fine-tuning candidates.</span>
          </div>
          <div className="home-hero-stats" aria-label="RouteLab proof points">
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <b>{stat.value}</b>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="home-product-preview" aria-label="RouteLab workflow preview">
          {previewItems.map((item, index) => (
            <div key={item.title}>
              <small>0{index + 1}</small>
              <b>{item.title}</b>
              <span>{item.action}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-problem" id="problem">
        <div>
          <h2>AI inference is becoming cloud spend 2.0.</h2>
          <p>
            Teams are scaling AI features faster than they can govern model spend, quality, risk, and evaluation trust.
            The result is avoidable spend with no auditable answer for why a model served a workflow or whether the eval is good enough to approve it.
          </p>
        </div>
        <div className="home-pain-grid" aria-label="AI inference spend problems">
          {pains.map((pain) => (
            <article key={pain.title}>
              <span>{pain.title}</span>
              <p>{pain.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-why" id="why-now">
        <div>
          <p className="eyebrow">Why now</p>
          <h2>Capability is compressing faster than price.</h2>
          <p>
            Open and managed-open models are good enough for many workflows, while premium frontier models still cost
            dramatically more. The decision is no longer which model is best. It is which model is good enough for this
            distinct task, under this eval, with this golden dataset evidence.
          </p>
        </div>
        <div className="home-why-panel">
          <span>The old default breaks</span>
          <b>One frontier model for every request</b>
          <small>margin leak</small>
          <i />
          <span>The new control plane</span>
          <b>Portfolio of models, evals, and fine-tunes per task</b>
          <small>proved allocation</small>
        </div>
      </section>

      <section className="home-allocation">
        <div className="home-section-head">
          <h2>Not routing. Model allocation.</h2>
          <p>RouteLab is the allocation layer above gateways, eval tools, and fine-tuning workflows: prove what should move, what should stay, and what should be trained.</p>
        </div>
        <div className="home-allocation-grid">
          {allocationLayers.map((layer) => (
            <article className={layer.title === "RouteLab" ? "featured" : ""} key={layer.title}>
              <h3>{layer.title}</h3>
              {layer.items.map((item) => <p key={item}>{item}</p>)}
            </article>
          ))}
        </div>
      </section>

      <section className="home-steps" id="how-it-works">
        <div className="home-section-head">
          <h2>Traces become model allocation decisions.</h2>
          <p>The loop starts with uploaded traces and becomes a calibrated operating system for routing, evaluation, and fine-tuning.</p>
        </div>
        <div className="home-step-grid">
          {steps.map((step, index) => (
            <article className="home-step-card" key={step.title}>
              <div>
                <small>0{index + 1}</small>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <img src={step.image} alt={step.alt} loading="lazy" />
            </article>
          ))}
        </div>
      </section>

      <section className="home-assessment">
        <div>
          <p className="eyebrow">48-hour model spend assessment</p>
          <h2>A savings assessment that pays for itself.</h2>
          <p>
            Do not trust a live router on day one. Import traces, define evals, calibrate those evals with golden data,
            replay candidate models, identify safe savings, and decide where fine-tuning can reduce repeated context cost.
          </p>
        </div>
        <div className="home-assessment-card">
          <span>After RouteLab assessment</span>
          <b>Each distinct task gets the cheapest safe route or a fine-tuning path.</b>
          <div>
            {assessmentRoutes.map((route) => (
              <p key={route.label}><strong>{route.value}</strong>{route.label}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="home-icp">
        <div>
          <p className="eyebrow">Initial focus</p>
          <h2>Built first for high-volume AI support teams.</h2>
          <p>
            Support has high token volume, measurable outcomes, customer-facing risk, and many prompts that are
            over-modeled.
          </p>
        </div>
        <div className="home-icp-list">
          {supportReasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
        <strong>Cut AI support inference cost by 50%+ while preserving CSAT, resolution, and escalation guardrails.</strong>
      </section>

      <section className="home-proof" aria-label="RouteLab trust principles">
        {proof.map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="home-final">
        <h2>Start with traces. Leave with a calibrated model strategy.</h2>
        <p>Classify tasks, create evals, verify them with golden data, simulate candidates, generate recommendations, and fine-tune when the evidence says it is worth it.</p>
        <button type="button" className="primary" onClick={openPasswordPrompt}>Get started</button>
      </section>

      {isPasswordOpen && (
        <div className="home-password-layer" role="presentation">
          <form className="home-password-dialog" onSubmit={submitPassword} role="dialog" aria-modal="true" aria-labelledby="home-password-title">
            <button className="home-password-close" type="button" onClick={() => setIsPasswordOpen(false)} aria-label="Close password prompt">×</button>
            <p className="eyebrow">Private preview</p>
            <h2 id="home-password-title">Enter the RouteLab password</h2>
            <label>
              Password
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError(null);
                }}
              />
            </label>
            {passwordError && <p className="home-password-error">{passwordError}</p>}
            <button type="submit" className="primary">Unlock RouteLab</button>
          </form>
        </div>
      )}
    </main>
  );
}
