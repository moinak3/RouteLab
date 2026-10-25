import { useEffect, useState, type FormEvent } from "react";

const supportDecisions = [
  { step: "01", title: "Interpret the request", detail: "Identify the customer intent, entities, and constraints.", need: "Fast language understanding and structured extraction" },
  { step: "02", title: "Assess policy eligibility", detail: "Apply retrieved policy evidence to the specific account context.", need: "Grounded reasoning with consistent policy adherence" },
  { step: "03", title: "Draft the response", detail: "Explain the decision clearly in the right customer-facing tone.", need: "Reliable generation with style and latency constraints" },
];

const developerProblems = [
  { number: "01", title: "Know what work appears", text: "Production traces contain recurring tasks, edge cases, and unfamiliar requests. Teams need a reviewable view of that work before they can route it responsibly." },
  { number: "02", title: "Choose against your requirements", text: "A public benchmark can suggest what to test. Application-specific examples and quality requirements are what establish whether a model is suitable for a task." },
  { number: "03", title: "Keep decisions current", text: "Traffic, prompts, models, and prices change. Without policy history and focused review, justified choices turn into another routing table engineers must maintain by hand." },
];

const workflowSteps = [
  { step: "01", title: "Discover task groups", text: "Use deterministic RouteLab rules or run an independent LLM grouping experiment against pre-inference request context." },
  { step: "02", title: "Compare candidate models", text: "Test representative examples against quality, latency, and cost requirements. Shortlists recommend candidates to evaluate, not models to deploy." },
  { step: "03", title: "Approve task-specific choices", text: "Keep successful and unsuccessful attempts comparable within the same task, then approve explicit overrides only when the evidence clears your requirements." },
  { step: "04", title: "Publish an inspected policy", text: "Sign and version the default strategy, task overrides, and the separate emergency model. Earlier versions remain available for reactivation and export." },
  { step: "05", title: "Deploy and review gaps", text: "The customer-hosted OpenRouter runtime classifies requests against the approved catalog, applies the policy, and exposes unknowns for investigation." },
];

const workflowBoundaries = [
  "Task discovery is an offline analysis step. LLM-discovered groups do not automatically become deployed routes.",
  "Runtime classification assigns requests to the approved catalog. Classifier confidence is not measured classification accuracy.",
  "Intent and outcome stay separate, so good and bad attempts at the same task remain comparable.",
  "Unknown requests are review candidates, not automatically accepted as new task groups.",
];

const stackRows = [
  { name: "Braintrust and Arize", role: "Investigation and evaluation", text: "Existing observability and evaluation work can inform RouteLab's decision workflow. RouteLab does not replace those systems or claim native integrations that are not implemented." },
  { name: "RouteLab", role: "Task-to-policy workflow", text: "Connects task groups, representative examples, evaluation evidence, explicit approvals, policy history, and focused review into a maintained routing policy." },
  { name: "OpenRouter", role: "Implemented runtime target", text: "Provides model access and routing. OpenRouter Auto can remain the ordinary default when no approved task override applies. The customer-hosted RouteLab runtime currently proxies to OpenRouter." },
  { name: "Vercel AI Gateway", role: "Model access and fallbacks", text: "Can continue to serve gateway responsibilities in an agent stack. A RouteLab customer-runtime adapter beyond OpenRouter is future work." },
  { name: "DIY", role: "A credible alternative", text: "Build middleware with a classifier, evaluation scripts, and a routing table. RouteLab's proposition is reducing the work to establish, review, deploy, and maintain justified choices." },
];

const fitSignals = [
  "Recurring tasks with meaningfully different capability needs",
  "Usable production traces and representative examples",
  "Measurable quality, latency, or policy requirements",
  "Enough traffic and model variation for routing decisions to matter",
];

const comingNext = [
  "Review-driven proposals for group names, splits, and merges with an approval path into the deployed catalog",
  "Runtime adapters beyond the current OpenRouter target",
  "A more complete Cloud telemetry loop and versioned catalog lifecycle for customer-hosted runtimes",
];

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
        <div className="home-document-meta" aria-label="Document status"><span>Model allocation brief</span><span>Private preview</span><span>Rev. 01</span></div>
        <div className="home-nav-links">
          <a href="#why-now">Why now</a><a href="#how-it-works">How it works</a><a href="#product">Product</a><a href="#stack">Stack</a><a href="#for-teams">Who it is for</a>
          <a className="home-nav-waitlist" href="#waitlist">Join waitlist</a>
          <button type="button" onClick={openPasswordPrompt}>Get Started</button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Model routing for AI agents</p>
          <h1>Choose the right model for each task your agent takes on.</h1>
          <p>Understand the work in your production traffic, compare models against your quality requirements, and deploy routing policies your team can inspect and improve.</p>
          <div className="home-cta-row"><button type="button" className="primary" onClick={openPasswordPrompt}>Get Started</button><a className="home-button-secondary" href="#how-it-works">See how it works</a></div>
          <p className="home-hero-boundary">Built today for task grouping, model evaluation, and model-routing policies. The broader vision spans more intelligence primitives over time.</p>
        </div>
        <aside className="home-review-docket" aria-label="RouteLab evidence standard">
          <div className="home-docket-head"><span>Decision standard</span><b>Evidence before allocation</b></div>
          <dl>
            <div><dt>Task group</dt><dd>Defined</dd></div>
            <div><dt>Evaluation</dt><dd>Calibrated</dd></div>
            <div><dt>Quality bar</dt><dd>Explicit</dd></div>
            <div><dt>Fallback</dt><dd>Required</dd></div>
          </dl>
          <div className="home-docket-signoff"><span>Prepared for</span><b>Platform review</b><small>Decision remains inspectable</small></div>
        </aside>
        <div className="home-allocation-ledger" aria-label="RouteLab routing policy behavior">
          <div className="home-ledger-head"><b>Routing policy behavior</b><span>What the runtime does with each request</span><small>Conservative by default</small></div>
          <div className="home-ledger-row home-ledger-columns"><span>Request state</span><span>Evidence required</span><span>Decision</span><span>Runtime behavior</span></div>
          <div className="home-ledger-row"><b>Known task group</b><span>Candidate clears quality, latency, and cost requirements</span><strong>Approved override</strong><em>Route to selected model</em></div>
          <div className="home-ledger-row"><b>Unknown or low confidence</b><span>No task-specific evidence available</span><strong>General default</strong><em>Keep the conservative route</em></div>
          <div className="home-ledger-row"><b>Applicable provider failure</b><span>Emergency behavior configured and verified</span><strong>Emergency model</strong><em>Use the separate failure route</em></div>
        </div>
      </section>

      <section className="home-section home-why" id="why-now">
        <div className="home-section-head"><div><p className="eyebrow">Why now</p><h2>One agent interface now contains many kinds of work.</h2></div><p>At the same time, developers can choose among frontier models, open-weight models, specialized multimodal models, and fast system-one decision models. The suitable capability depends on the task, not only the product surface.</p></div>
        <div className="home-driver-row">
          <article><span>Driver 01</span><h3>More varied work per agent</h3><p>Classification, document interpretation, policy assessment, and difficult analysis can sit behind one conversation.</p></article>
          <article><span>Driver 02</span><h3>More capability choices</h3><p>Success, consistency, latency, retries, and cost all change with the model and the job it is asked to perform.</p></article>
        </div>
        <div className="home-conversation-example">
          <div className="home-example-intro"><small>Illustrative support experience</small><h3>One customer conversation. Several routing decisions.</h3><p>No model winner is assumed. Each call has a different capability profile to validate.</p></div>
          <div className="home-example-calls">{supportDecisions.map((decision) => <article key={decision.step}><span>{decision.step}</span><div><h4>{decision.title}</h4><p>{decision.detail}</p><small>{decision.need}</small></div></article>)}</div>
        </div>
      </section>

      <section className="home-section home-problem" id="problem">
        <div className="home-section-head"><div><p className="eyebrow">The developer problem</p><h2>Model choice becomes an operating discipline.</h2></div><p>The hard part is not writing a conditional. It is knowing what to route, establishing why a choice is acceptable, and keeping that decision current without creating an open-ended review burden.</p></div>
        <div className="home-problem-list">{developerProblems.map((problem) => <article key={problem.number}><span>{problem.number}</span><h3>{problem.title}</h3><p>{problem.text}</p></article>)}</div>
        <p className="home-problem-note">Unfamiliar requests deserve explicit uncertainty and review. RouteLab does not assume every application starts with one expensive model or that every small chatbot benefits from task-specific routing.</p>
      </section>

      <section className="home-section home-workflow" id="how-it-works">
        <div className="home-section-head"><div><p className="eyebrow">How RouteLab works</p><h2>From production evidence to a maintained routing policy.</h2></div><p>A compact workflow for discovering work, evaluating candidates, approving choices, and reviewing what the current policy does not cover.</p></div>
        <ol className="home-workflow-steps">{workflowSteps.map((step) => <li key={step.step}><span>{step.step}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
        <aside className="home-boundaries" aria-label="Workflow boundaries"><h3>Important boundaries</h3><ul>{workflowBoundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul></aside>
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
          <div className="home-feature-copy"><span>03 · Deploy and review</span><h3>Version the policy, then inspect its gaps.</h3><p>Policies support explicit task overrides, a fixed model or OpenRouter Auto as the ordinary default, and a separate emergency model for applicable runtime failures. Signed versions can be deployed, reactivated, and exported.</p><p>The review queue surfaces unknowns and evidence gaps. Policy verification failures can make the runtime unavailable, so RouteLab does not promise that every failure returns a fallback completion.</p></div>
          <div className="home-preview-pair"><figure><img src="/marketing/policy-history.jpg" alt="RouteLab policy version history with deployed and published versions" /><figcaption>Current policy lifecycle · signed versions</figcaption></figure><figure><img src="/marketing/review-queue.jpg" alt="RouteLab Review Queue showing stratified review lanes and a trace selected for review" /><figcaption>Bundled demo data · focused human review</figcaption></figure></div>
        </article>
      </section>

      <section className="home-section home-stack" id="stack">
        <div className="home-section-head"><div><p className="eyebrow">How it fits</p><h2>Build on your eval and gateway stack.</h2></div><p>RouteLab focuses on the operational workflow between understanding application tasks and maintaining approved model-routing choices.</p></div>
        <div className="home-stack-table" role="list">{stackRows.map((row) => <article role="listitem" key={row.name}><div><b>{row.name}</b><span>{row.role}</span></div><p>{row.text}</p></article>)}</div>
        <p className="home-stack-note">Dynamic routers such as OpenRouter Auto Router and JevRouter already select models. RouteLab adds application-specific evaluation evidence, explicit overrides, policy history, and the maintenance workflow around those choices.</p>
      </section>

      <section className="home-section home-for-teams" id="for-teams">
        <div className="home-section-head"><div><p className="eyebrow">Who it is for</p><h2>Agent engineers accountable for experience and economics.</h2></div><p>RouteLab starts with production support and knowledge-work agents where recurring tasks, evidence, and meaningful model differences already exist.</p></div>
        <div className="home-fit-layout"><div><h3>A strong starting point has</h3><ul>{fitSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div><aside><small>Not a universal default</small><p>A small chatbot with one narrow task, little traffic, or no measurable quality requirement may be better served by a fixed model and simple gateway configuration.</p></aside></div>
      </section>

      <section className="home-coming-next" aria-labelledby="coming-next-title"><div><p className="eyebrow">Coming next</p><h2 id="coming-next-title">Close more of the maintenance loop.</h2></div><ul>{comingNext.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="home-section home-waitlist" id="waitlist" aria-labelledby="waitlist-title">
        <div className="home-waitlist-copy">
          <p className="eyebrow">Early access</p>
          <h2 id="waitlist-title">Join the RouteLab waitlist.</h2>
          <p>Tell us what you are building and where model choice matters. We will contact you as additional private-preview capacity opens.</p>
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
      <section className="home-final"><div><p className="eyebrow">Private preview</p><h2>Evaluate RouteLab on your own traffic.</h2><p>Start with a scoped pilot using representative traces and your quality requirements. Inspect the task groups, candidate evidence, and proposed policy before changing production routing.</p></div><button type="button" className="primary" onClick={openPasswordPrompt}>Get Started</button></section>
      <footer className="home-footer"><a className="home-brand" href="/" aria-label="RouteLab home"><img src="/routelab-icon.svg" alt="" /><b>RouteLab</b></a><span>Task-specific model choices, backed by application evidence.</span></footer>

      {isPasswordOpen && <div className="home-password-layer" role="presentation"><form className="home-password-dialog" onSubmit={submitPassword} role="dialog" aria-modal="true" aria-labelledby="home-password-title"><button className="home-password-close" type="button" onClick={() => setIsPasswordOpen(false)} aria-label="Close password prompt">×</button><p className="eyebrow">Private preview</p><h2 id="home-password-title">Enter the RouteLab password</h2><label>Password<input autoFocus type="password" value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); }} /></label>{passwordError && <p className="home-password-error">{passwordError}</p>}<button type="submit" className="primary">Unlock RouteLab</button></form></div>}
    </main>
  );
}
