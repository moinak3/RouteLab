import { useEffect, useState, type FormEvent } from "react";

const whyNowShifts = [
  { title: "Work is fragmenting", text: "Classification, retrieval, analysis, drafting, and consequential actions now sit behind the same agent experience." },
  { title: "Model choice keeps changing", text: "New capabilities, prices, and latency profiles make one permanent model choice impractical." },
  { title: "Evals stop before allocation", text: "Teams can measure quality, but still have to turn those results into routing decisions themselves." },
];

const trustPrinciples = [
  { title: "Evidence before override", text: "A task-specific route is chosen only after the team reviews its measured quality, latency, and cost tradeoffs." },
  { title: "Conservative unknowns", text: "Unknown and low-confidence requests stay on the general default model and are prioritized for review." },
  { title: "Versioned decisions", text: "Published policies record the default, user-selected overrides, and the measured evidence behind each choice." },
  { title: "Customer-hosted enforcement", text: "The local runtime applies the approved policy per request. RouteLab Cloud is not in the inference path." },
];

const stackStages = [
  { number: "01", name: "Your observability and eval stack", text: "Braintrust, Arize, or your existing tools produce traces, human review, and application-specific quality evidence." },
  { number: "02", name: "RouteLab decision layer", text: "RouteLab organizes task groups, compares candidates, records model choices, and publishes a maintained allocation policy." },
  { number: "03", name: "Your gateway and providers", text: "The customer-hosted runtime applies the policy before sending the selected model to OpenRouter. Other gateway adapters remain future work." },
];

const fitSignals = [
  "Recurring tasks with meaningfully different capability needs",
  "Usable production traces and representative examples",
  "Measurable quality, latency, or policy requirements",
  "Enough traffic and model variation for routing decisions to matter",
];

const allocationComparisonRows = [
  {
    step: "Understand production behavior",
    today: "Traces reveal failures, latency, cost, tool calls, and common workflows.",
    routeLab: "RouteLab organizes that traffic into task groups that can receive different model-allocation decisions.",
    outcome: "We can see the distinct kinds of work our agent is actually doing.",
  },
  {
    step: "Compare models",
    today: "Teams use evals to investigate failures and compare model-level results across datasets.",
    routeLab: "RouteLab connects the relevant evals to each production task group, then compares candidates across quality, reliability, latency, and cost.",
    outcome: "We know what good enough means for this task and which models clear that bar.",
  },
  {
    step: "Make an allocation decision",
    today: "Results inform engineering discussions, spreadsheets, or manually maintained routing rules.",
    routeLab: "Selected results become explicit task-to-model assignments with supporting evidence and approval.",
    outcome: "We know exactly why this task is moving to a different model.",
  },
  {
    step: "Handle uncovered traffic",
    today: "New or unusual traces appear in monitoring and review workflows.",
    routeLab: "Unknown and low-confidence requests remain on the general default model and are prioritized for review.",
    outcome: "If RouteLab is uncertain, it keeps the conservative route.",
  },
];

function FlowArrow({ label }: { label: string }) {
  return <div className="home-flow-arrow" aria-hidden="true">
    <span>{label}</span>
    <svg viewBox="0 0 88 18" role="img">
      <path d="M1 9h78" />
      <path d="m72 2 8 7-8 7" />
    </svg>
  </div>;
}

function RouteLabWorkflowIllustration() {
  return <figure className="home-workflow-illustration" id="how-it-works" aria-labelledby="workflow-illustration-title">
    <div className="home-flow-heading">
      <div>
        <span>RouteLab control loop</span>
        <b id="workflow-illustration-title">Evidence in. An inspected policy out.</b>
      </div>
      <small>Offline control plane + customer-hosted runtime</small>
    </div>

    <div className="home-flow-canvas">
      <section className="home-flow-node home-flow-evidence">
        <span className="home-flow-stage">Observe</span>
        <div className="home-flow-traces" aria-hidden="true"><i /><i /><i /><i /></div>
        <h3>Production evidence</h3>
        <ul><li>Traces</li><li>Evaluations</li><li>Traffic and cost</li></ul>
      </section>

      <FlowArrow label="Analyze offline" />

      <section className="home-flow-node home-flow-cloud">
        <header><img src="/routelab-icon.svg" alt="" /><div><span>RouteLab Cloud</span><small>Control plane</small></div></header>
        <ol>
          <li><span>01</span><div><b>Group recurring tasks</b><small>Define comparable work and unknowns</small></div></li>
          <li><span>02</span><div><b>Test candidate models</b><small>Compare measured quality, cost, and latency</small></div></li>
          <li><span>03</span><div><b>Approve model choices</b><small>Keep a default and add proven overrides</small></div></li>
        </ol>
        <div className="home-flow-policy"><span>Approved policy</span><b>Signed and versioned</b></div>
      </section>

      <FlowArrow label="Publish policy" />

      <section className="home-flow-node home-flow-runtime">
        <span className="home-flow-stage">Apply</span>
        <h3>Customer-hosted runtime</h3>
        <div className="home-runtime-request"><span>Current request</span><b>Prompt + tools + metadata</b></div>
        <ol>
          <li><span>1</span>Classify the task group</li>
          <li><span>2</span>Apply the local policy</li>
          <li><span>3</span>Send the model decision to OpenRouter</li>
        </ol>
        <div className="home-runtime-decision"><span>Model decision</span><b>Approved route or general default</b></div>
      </section>
    </div>

    <div className="home-flow-review">
      <div><span>Weekly review loop</span><b>Review what the policy does not yet know.</b></div>
      <ul><li>Representative</li><li>Unusual</li><li>Uncovered</li></ul>
      <p>Human decisions update the next task-group catalog, eval version, and routing policy.</p>
    </div>
    <figcaption>RouteLab learns and validates policy offline. The local runtime applies the approved policy per request without putting RouteLab Cloud in the inference path.</figcaption>
  </figure>;
}

export function Home({ onGetStarted, promptForPassword = false }: { onGetStarted: (password: string) => boolean; promptForPassword?: boolean }) {
  const [isPasswordOpen, setIsPasswordOpen] = useState(promptForPassword);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [waitlistMessage, setWaitlistMessage] = useState("");

  useEffect(() => {
    if (promptForPassword) setIsPasswordOpen(true);
  }, [promptForPassword]);

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

  async function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setWaitlistStatus("submitting");
    setWaitlistMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          company: formData.get("company"),
          useCase: formData.get("useCase"),
          website: formData.get("website"),
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We could not add you to the waitlist.");

      form.reset();
      setWaitlistStatus("success");
      setWaitlistMessage("You're on the RouteLab waitlist. We'll be in touch when access opens.");
    } catch (error) {
      setWaitlistStatus("error");
      setWaitlistMessage(error instanceof Error ? error.message : "We could not add you to the waitlist.");
    }
  }

  return (
    <main className="home-page">
      <nav className="home-nav" aria-label="Marketing navigation">
        <a className="home-brand" href="/" aria-label="RouteLab home"><img src="/routelab-icon.svg" alt="" /><b>RouteLab</b></a>
        <div className="home-nav-links">
          <a href="#how-it-works">How it works</a><a href="#product">Product</a><a href="#stack">How it fits</a>
          <a className="home-nav-waitlist" href="#waitlist">Join waitlist</a>
          <button type="button" onClick={openPasswordPrompt}>Get Started</button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Model routing for AI agents</p>
          <h1>Choose the right model for each task your agent takes on.</h1>
          <p>RouteLab uses your production traces and human-calibrated evals to choose the right model for each recurring task.</p>
          <div className="home-cta-row"><button type="button" className="primary" onClick={openPasswordPrompt}>Get Started</button><a className="home-button-secondary" href="#how-it-works">See how it works</a></div>
        </div>
        <aside className="home-why-now-card" id="why-now" aria-label="Why model allocation matters now">
          <div className="home-why-now-head"><span>Why now</span><b>One agent now performs many kinds of work.</b></div>
          <ol>
            {whyNowShifts.map((shift, index) => <li key={shift.title}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{shift.title}</b><p>{shift.text}</p></div></li>)}
          </ol>
        </aside>
        <RouteLabWorkflowIllustration />
        <div className="home-hero-positioning">
          <b>RouteLab does not replace your eval platform or gateway.</b>
          <span>It translates your existing traces and eval results into a model allocation policy your team can inspect, deploy, and maintain.</span>
        </div>
      </section>

      <section className="home-section home-allocation-comparison" id="before-after" aria-labelledby="before-after-title">
        <div className="home-comparison-intro">
          <div>
            <p className="eyebrow">From measurement to allocation</p>
            <h2 id="before-after-title">From measuring model performance to acting on it.</h2>
          </div>
          <p>Keep the observability, evaluation, and gateway systems you already use. RouteLab adds the workflow for making, deploying, and maintaining task-specific model decisions.</p>
        </div>
        <div className="home-comparison-frame">
          <div className="home-comparison-caption">
            <b>Where RouteLab adds the decision layer</b>
            <span>Illustrative team outcomes</span>
          </div>
          <div className="home-comparison-scroll">
            <table className="home-comparison-table">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">With observability and evals today</th>
                  <th scope="col">With RouteLab added</th>
                  <th scope="col">What the team can now say</th>
                </tr>
              </thead>
              <tbody>
                {allocationComparisonRows.map((row) => (
                  <tr key={row.step}>
                    <th scope="row">{row.step}</th>
                    <td data-label="With observability and evals today">{row.today}</td>
                    <td data-label="With RouteLab added">{row.routeLab}</td>
                    <td data-label="What the team can now say"><blockquote>“{row.outcome}”</blockquote></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="home-section home-product" id="product">
        <div className="home-section-head"><div><p className="eyebrow">Product evidence</p><h2>Inspect the work, the evidence, and the resulting policy.</h2></div><p>These previews use current RouteLab demo surfaces. Counts, replay results, and classifier values shown in the images are workflow examples, not customer outcome claims.</p></div>
        <article className="home-product-feature">
          <div className="home-feature-copy"><span>01 · Discover</span><h3>Define task groups and compare methods.</h3><p>RouteLab rules produce deterministic groups. The independent LLM experiment adds inclusion and exclusion criteria, representative traces, confusing counterexamples, neighboring groups, and a method comparison.</p><p>LLM grouping remains analysis-only. It does not replace the approved catalog or publish routes.</p></div>
          <div className="home-preview-pair"><figure><img src="/marketing/task-groups.jpg" alt="RouteLab Task Groups showing deterministic rules and grouped production traces" /><figcaption>Deterministic demo data · RouteLab rules</figcaption></figure><figure><img src="/marketing/compare-methods.jpg" alt="RouteLab Compare Methods showing deterministic and independent LLM group distributions" /><figcaption>Saved analysis experiment · Compare Methods</figcaption></figure></div>
        </article>
        <article className="home-product-feature reverse">
          <div className="home-feature-copy"><span>02 · Evaluate</span><h3>Measure candidates against application requirements.</h3><p>Routing Simulations compares observed traffic with candidate replay across quality, latency, and cost. Real live replays and deterministic demo estimates are presented as different evidence types.</p><p>Each task group can show three models to evaluate. Public benchmark priors are estimated, available customer evaluations carry more weight, and the adoption interface is not proof of quality or an established customer network.</p></div>
          <figure className="home-preview-wide"><img src="/marketing/routing-simulations-current.jpg" alt="RouteLab Routing Simulations comparing current traffic and candidate replay" /><figcaption>Deterministic demo replay · illustrative results</figcaption></figure>
        </article>
        <article className="home-product-feature">
          <div className="home-feature-copy"><span>03 · Deploy and review</span><h3>Version the policy, then inspect its gaps.</h3><p>Policies support explicit task overrides plus one default strategy: either a fixed model or OpenRouter Auto. Signed versions can be deployed, reactivated, and exported.</p><p>The review queue surfaces unknowns and evidence gaps. Requests without a confident matched override use the selected default strategy.</p></div>
          <div className="home-preview-pair"><figure><img src="/marketing/policy-history.jpg" alt="RouteLab policy version history with deployed and published versions" /><figcaption>Current policy lifecycle · signed versions</figcaption></figure><figure><img src="/marketing/review-queue.jpg" alt="RouteLab Review Queue showing stratified review lanes and a trace selected for review" /><figcaption>Bundled demo data · focused human review</figcaption></figure></div>
        </article>
      </section>

      <section className="home-section home-trust" id="stack">
        <div className="home-section-head"><div><p className="eyebrow">Trust and deployment</p><h2>Evidence is reviewed in the cloud. Decisions run in your environment.</h2></div><p>RouteLab adds a controlled decision layer between the evaluation evidence you already collect and the gateway that executes each model call.</p></div>
        <div className="home-trust-grid" role="list">{trustPrinciples.map((principle, index) => <article role="listitem" key={principle.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{principle.title}</h3><p>{principle.text}</p></article>)}</div>
        <div className="home-stack-flow" aria-label="How RouteLab fits into an existing AI stack">
          {stackStages.map((stage, index) => <div className="home-stack-stage" key={stage.name}><article><span>{stage.number}</span><h3>{stage.name}</h3><p>{stage.text}</p></article>{index < stackStages.length - 1 && <b aria-hidden="true">→</b>}</div>)}
        </div>
        <p className="home-stack-note">OpenRouter is the implemented runtime target today. Dynamic routers can remain the general default; RouteLab adds application-specific evidence, explicit task overrides, policy history, and conservative handling for uncovered traffic.</p>
        <p className="home-stack-note">RouteLab validates both Task Group classification and response quality against human judgments before they influence routing.</p>
      </section>

      <section className="home-section home-for-teams" id="for-teams">
        <div className="home-section-head"><div><p className="eyebrow">Who it is for</p><h2>Agent engineers accountable for experience and economics.</h2></div><p>RouteLab starts with production support and knowledge-work agents where recurring tasks, evidence, and meaningful model differences already exist.</p></div>
        <div className="home-fit-layout"><div><h3>A strong starting point has</h3><ul>{fitSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div><aside><small>Not a universal default</small><p>A small chatbot with one narrow task, little traffic, or no measurable quality requirement may be better served by a fixed model and simple gateway configuration.</p></aside></div>
      </section>

      <section className="home-section home-waitlist" id="waitlist" aria-labelledby="waitlist-title">
        <div className="home-waitlist-copy">
          <p className="eyebrow">Private preview</p>
          <h2 id="waitlist-title">Evaluate RouteLab on your own traffic.</h2>
          <p>Join the waitlist for a scoped pilot using representative traces and your quality requirements. Inspect the task groups, candidate evidence, and proposed policy before changing production routing.</p>
          <ul aria-label="Waitlist details">
            <li>Bring representative traces from your application</li>
            <li>Evaluate candidate models before changing production routing</li>
            <li>Keep provider credentials and runtime traffic in your environment</li>
          </ul>
        </div>
        <form className="home-waitlist-form" onSubmit={submitWaitlist} aria-busy={waitlistStatus === "submitting"}>
          <label>Name<input name="name" type="text" autoComplete="name" maxLength={120} placeholder="Your name" /></label>
          <label>Work email<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@company.com" required /></label>
          <label>Company<input name="company" type="text" autoComplete="organization" maxLength={160} placeholder="Company name" /></label>
          <label className="home-waitlist-use-case">How would you use RouteLab?<textarea name="useCase" maxLength={1200} placeholder="Describe the agent tasks, model choices, or outcomes you want to evaluate." rows={4} required /></label>
          <label className="home-waitlist-honeypot" aria-hidden="true">Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
          <button type="submit" className="primary" disabled={waitlistStatus === "submitting"}>{waitlistStatus === "submitting" ? "Joining..." : "Join waitlist"}</button>
          <small>By joining, you agree that RouteLab may email you about product access. You can unsubscribe at any time.</small>
          {waitlistMessage && <p className={`home-waitlist-status ${waitlistStatus}`} role="status" aria-live="polite">{waitlistMessage}</p>}
        </form>
      </section>
      <footer className="home-footer"><a className="home-brand" href="/" aria-label="RouteLab home"><img src="/routelab-icon.svg" alt="" /><b>RouteLab</b></a><span>Task-specific model choices, backed by application evidence.</span></footer>

      {isPasswordOpen && <div className="home-password-layer" role="presentation"><form className="home-password-dialog" onSubmit={submitPassword} role="dialog" aria-modal="true" aria-labelledby="home-password-title"><button className="home-password-close" type="button" onClick={() => setIsPasswordOpen(false)} aria-label="Close password prompt">×</button><p className="eyebrow">Private preview</p><h2 id="home-password-title">Enter the RouteLab password</h2><label>Password<input autoFocus type="password" value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); }} /></label>{passwordError && <p className="home-password-error">{passwordError}</p>}<button type="submit" className="primary">Unlock RouteLab</button></form></div>}
    </main>
  );
}
