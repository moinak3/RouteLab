import { useState, type FormEvent } from "react";

const heroStats = [
  { value: "Per task", label: "model decisions backed by calibrated evals" },
  { value: "Fallback first", label: "unknown and low-confidence requests stay protected" },
  { value: "Gateway-ready", label: "versioned policy for local enforcement" },
];

const previewItems = [
  { title: "Trace ingestion", action: "observe" },
  { title: "Task signatures", action: "classify" },
  { title: "Calibrated quality gates", action: "prove" },
  { title: "Routing simulations", action: "compare" },
  { title: "Routing policy", action: "approve" },
  { title: "Local decision layer", action: "enforce" },
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
    text: "Gateways execute calls and observability tools explain history, but no system owns the evidence-backed policy that decides which model should serve each task.",
  },
];

const allocationLayers = [
  {
    title: "Gateways",
    items: ["Call many models", "Fallbacks and budgets", "Do not prove which route is guardrail-approved for you"],
  },
  {
    title: "Eval stacks",
    items: ["Trace and score", "Regression testing", "Need calibration to trust automated judges"],
  },
  {
    title: "RouteLab",
    items: ["Classify task signatures", "Calibrate task-level quality gates", "Publish versioned model-allocation policies"],
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
    text: "Know exactly how often your automated judge disagrees with humans — false passes and false fails, quantified — before you let it approve a routing change.",
    image: "/marketing/evals.jpg",
    alt: "RouteLab Golden Dataset calibration view showing human and judge agreement",
  },
  {
    title: "Run Simulations Across Candidate Models",
    text: "Replay prompts against candidate models and compare direct routing, cascades, thresholds, provider choices, latency, quality, and cost.",
    image: "/marketing/simulations.jpg",
    alt: "RouteLab Simulations tab showing model replay results",
  },
  {
    title: "Build the Routing Policy",
    text: "Start with one general fallback, then promote measured task-model pairs into explicit overrides only after they clear quality, latency, and cost guardrails.",
    image: "/marketing/policy-builder.jpg",
    alt: "RouteLab routing policy builder showing the general fallback and task-specific overrides",
  },
  {
    title: "Publish a Versioned Policy",
    text: "Turn approved overrides into an auditable, signed policy bundle with confidence thresholds, fallback behavior, and rollback history.",
    image: "/marketing/simulations.jpg",
    alt: "RouteLab simulations view showing model comparison results",
  },
  {
    title: "Enforce Locally, Upstream of the Gateway",
    text: "A thin customer-hosted decision layer classifies each request, applies the approved policy, and gives OpenRouter, Vercel AI Gateway, or another gateway the model decision to execute.",
    image: "/marketing/policy-enforcement.jpg",
    alt: "RouteLab latest effective policy showing the fallback and per-task routing state",
  },
];

const assessmentRoutes = [
  { value: "Default", label: "general fallback" },
  { value: "Per task", label: "approved overrides" },
  { value: "Unknown", label: "use fallback" },
  { value: "Versioned", label: "auditable policy" },
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
  "Known task signatures plus unknown",
  "Calibrated task-level quality gates",
  "Cost, latency, and quality simulations",
  "General fallback plus approved overrides",
  "Versioned and auditable policies",
  "Customer-hosted decision layer",
  "Gateway and model agnostic",
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
          <p className="eyebrow">The policy engine for AI inference</p>
          <h1>Decide which model should serve every AI task.</h1>
          <p>
            RouteLab turns production traces and calibrated evals into an auditable model-allocation policy: one conservative fallback,
            measured task-specific overrides, and a local decision layer upstream of your gateway.
          </p>
          <div className="home-cta-row">
            <button type="button" className="primary" onClick={openPasswordPrompt}>Get started</button>
            <span>A time-boxed savings assessment on your own traces. No production traffic, no live router, no risk.</span>
          </div>
          <div className="home-hero-stats" aria-label="RouteLab proof points">
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <b>{stat.value}</b>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
          <a className="home-method-link" href="#how-it-works">See how traces become a versioned routing policy →</a>
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

      <section className="home-assessment home-assessment-condensed">
        <div>
          <p className="eyebrow">48-hour model spend assessment</p>
          <h2>Build the policy before changing production.</h2>
          <p>Import traces, establish task signatures, calibrate quality gates, replay candidate models, and leave with an allocation policy your team can audit.</p>
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
          <b>One fallback plus eval-approved model overrides per task</b>
          <small>inference policy</small>
        </div>
      </section>

      <section className="home-allocation">
        <div className="home-section-head">
          <h2>The policy engine above your gateway.</h2>
          <p>RouteLab decides which model is eligible for each recurring task. OpenRouter, Vercel AI Gateway, or your existing gateway executes the resulting call.</p>
          <p>RouteLab Cloud builds and validates the policy. A thin customer-hosted decision layer applies the latest approved version locally, with conservative fallback for uncertainty or failure.</p>
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
          <h2>Traces become an enforceable inference policy.</h2>
          <p>The loop starts with historical evidence, produces a task-level policy, and keeps that policy current as workloads, models, prices, and prompts change.</p>
          <p>Today RouteLab optimizes per-request workloads — classification, RAG answers, drafting, tool calls. Trajectory-level simulation for multi-step agents is on the roadmap.</p>
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
          <h2>Build an inference policy your team can trust.</h2>
          <p>
            Do not trust a live router on day one. Import traces, define evals, calibrate those evals with golden data,
            replay candidate models, and approve only the task-specific routes that clear your quality, latency, and cost requirements.
            Allocation is not a one-time decision. Every new model release, price drop, and prompt change re-opens the question — RouteLab re-runs the evidence automatically.
          </p>
        </div>
        <div className="home-assessment-card">
          <span>After RouteLab assessment</span>
          <b>Every request gets the general fallback unless a measured task-specific override has earned approval.</b>
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

      <section className="home-allocation">
        <div className="home-section-head">
          <h2>Gateways execute. Observability explains. RouteLab decides.</h2>
          <p>RouteLab connects task classification, calibrated quality evidence, and model simulations into the policy layer that those systems do not own.</p>
        </div>
      </section>

      <section className="home-proof" aria-label="RouteLab trust principles">
        {proof.map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="home-final">
        <h2>Start with traces. Leave with an inference policy.</h2>
        <p>Classify recurring tasks, calibrate the quality bar, simulate candidate models, approve task-level overrides, and publish the policy to a local decision layer.</p>
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
