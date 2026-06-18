import { useState, type FormEvent } from "react";

const heroStats = [
  { value: "30-80%", label: "inference savings opportunity" },
  { value: "0", label: "unproven route changes" },
  { value: "Replay -> evaluate -> route", label: "offline proof loop" },
];

const previewItems = [
  { title: "Distinct tasks", action: "classify" },
  { title: "Import or generate evals", action: "define" },
  { title: "Prompt simulations", action: "replay" },
  { title: "Route readiness", action: "decide" },
  { title: "Policy deployment", action: "monitor" },
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
    text: "Gateways, evals, logs, and model experiments live in separate tools, so no system owns model allocation.",
  },
];

const allocationLayers = [
  {
    title: "Gateways",
    items: ["Call many models", "Fallbacks and budgets", "Do not prove which route is safe for you"],
  },
  {
    title: "Eval stacks",
    items: ["Trace and score", "Regression testing", "Do not optimize model allocation"],
  },
  {
    title: "RouteLab",
    items: ["Classify workloads", "Replay and prove routes", "Own cost-quality decisions"],
  },
];

const steps = [
  {
    title: "Classify Traces into Distinct Tasks",
    text: "Group production traces into task-level workloads so routing decisions are made against repeatable work, not one-off prompts.",
    image: "/marketing/traces.jpg",
    alt: "RouteLab Traces tab showing normalized LLM calls",
  },
  {
    title: "Import/Generate an eval",
    text: "Bring existing evals into RouteLab or generate task-specific evaluators for quality, policy, and failure-mode checks.",
    image: "/marketing/evals.jpg",
    alt: "RouteLab Evals tab showing trace quality judge scores",
  },
  {
    title: "Run Simulations Across Routing Strategies",
    text: "Run prompts against candidate models and compare direct routing, cascades, thresholds, and fallback strategies.",
    image: "/marketing/simulations.jpg",
    alt: "RouteLab Simulations tab showing model replay results",
  },
  {
    title: "Route Readiness",
    text: "Score cost, quality, latency, failure severity, and evidence grade before production changes.",
    image: "/marketing/simulations.jpg",
    alt: "RouteLab Simulations tab showing route readiness results",
  },
  {
    title: "Policy Deployment and Continuous Monitoring",
    text: "Export gateway-ready policies, then monitor drift detection, shadow traffic, and benchmark refreshes over time.",
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
  "Local-first trace ingestion",
  "Eval-backed decisions",
  "Provider and model-family agnostic",
  "Cost, quality, latency guardrails",
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
            RouteLab connects to production traces, scores model quality, replays traffic across candidate models, and
            generates eval-backed allocation policies that reduce inference spend without unproven route changes.
          </p>
          <div className="home-cta-row">
            <button type="button" className="primary" onClick={openPasswordPrompt}>Get started</button>
            <span>Start offline with traces. Leave with a safe routing policy.</span>
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
            Teams are scaling AI features faster than they can govern model spend, quality, and risk. The result is
            avoidable spend with no auditable answer for why a model served a workflow.
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
            workflow.
          </p>
        </div>
        <div className="home-why-panel">
          <span>The old default breaks</span>
          <b>One frontier model for every request</b>
          <small>margin leak</small>
          <i />
          <span>The new control plane</span>
          <b>Portfolio of models per workflow</b>
          <small>proved allocation</small>
        </div>
      </section>

      <section className="home-allocation">
        <div className="home-section-head">
          <h2>Not routing. Model allocation.</h2>
          <p>RouteLab is the allocation layer above gateways and eval tools: prove what should move, then export the policy.</p>
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
          <p>The same loop starts offline, then evolves into a continuously optimizing runtime.</p>
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
            Do not trust a live router on day one. Import traces, replay candidate models, identify safe savings, and
            export a policy before touching production traffic.
          </p>
        </div>
        <div className="home-assessment-card">
          <span>After RouteLab assessment</span>
          <b>Each workflow gets the cheapest safe route.</b>
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
        <h2>Start with traces. Leave with a safe routing policy.</h2>
        <p>Replay candidate models, prove quality, and export the cheapest safe execution path for every workflow.</p>
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
