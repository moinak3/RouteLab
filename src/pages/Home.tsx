import { useEffect, useState, type FormEvent } from "react";

const whyNowShifts = [
  { title: "Work is fragmenting", text: "Classification, retrieval, analysis, drafting, and consequential actions now sit behind the same agent experience." },
  { title: "Model options are multiplying", text: "Frontier, open-weight, domain-specific, and decision models keep expanding. At the same time, applications demand different capabilities, modalities, latency, and cost profiles, making one permanent model choice impractical." },
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

function RouteLabWorkflowIllustration() {
  return <figure className="home-workflow-illustration home-architecture" id="how-it-works" aria-labelledby="workflow-illustration-title">
    <div className="home-architecture-heading">
      <div>
        <span>How RouteLab works</span>
        <h2 id="workflow-illustration-title">How RouteLab routes and improves model decisions.</h2>
      </div>
      <p>Offline evidence and simulations inform a signed policy. Live requests stay in the customer-hosted runtime.</p>
    </div>

    <div className="home-architecture-board">
      <section className="home-architecture-zone home-architecture-offline" aria-labelledby="offline-control-plane-title">
        <header>
          <span>01</span>
          <div><b id="offline-control-plane-title">Offline control plane</b><small>Analyze evidence before changing production routing</small></div>
        </header>
        <div className="home-architecture-flow">
          <article className="home-architecture-node">
            <small>Existing stack</small>
            <b>Observability + evals</b>
            <p>Imported traces and evaluation evidence</p>
          </article>
          <div className="home-architecture-connector evidence" aria-label="Imported evidence enters RouteLab Cloud"><i /><span>Imported evidence</span></div>
          <article className="home-architecture-node routelab">
            <div className="home-architecture-brand"><img src="/routelab-icon.svg" alt="" /><span>RouteLab Cloud</span></div>
            <p>Discover task groups<br />Compare candidate models</p>
          </article>
          <div className="home-architecture-connector simulation" aria-label="RouteLab Cloud exchanges offline simulation requests and measured results with OpenRouter"><i /><span>Offline simulations</span><small>Replay requests + measured results</small></div>
          <article className="home-architecture-node">
            <small>Model access</small>
            <b>OpenRouter</b>
            <p>Candidate model requests</p>
          </article>
          <div className="home-architecture-connector simulation" aria-label="OpenRouter sends simulation requests to candidate models"><i /><span>Candidates</span></div>
          <div className="home-architecture-models" aria-label="Candidate models"><span>Model A</span><span>Model B</span><span>Model C</span></div>
        </div>
      </section>

      <div className="home-architecture-policy-sync" aria-label="RouteLab Cloud deploys a signed policy to the RouteLab sidecar">
        <i />
        <div><b>Signed policy deployment</b><span>Versioned routing logic</span></div>
      </div>

      <section className="home-architecture-zone home-architecture-runtime" aria-labelledby="customer-environment-title">
        <header>
          <span>02</span>
          <div><b id="customer-environment-title">Customer environment</b><small>Live request and response path</small></div>
        </header>
        <div className="home-architecture-flow">
          <article className="home-architecture-node">
            <small>Request origin</small>
            <b>Agent application</b>
            <p>Prompt + tools + context</p>
          </article>
          <div className="home-architecture-connector live" aria-label="The agent application sends the live request to the RouteLab sidecar"><i /><span>Live request</span></div>
          <article className="home-architecture-node routelab sidecar">
            <div className="home-architecture-brand"><img src="/routelab-icon.svg" alt="" /><span>RouteLab sidecar</span></div>
            <p>Classify task + apply policy</p>
            <em>Approved override or configured default</em>
          </article>
          <div className="home-architecture-connector live" aria-label="The RouteLab sidecar sends the request with the selected model to OpenRouter"><i /><span>Selected route</span></div>
          <article className="home-architecture-node">
            <small>Customer-configured access</small>
            <b>OpenRouter</b>
            <p>Send request to selected model</p>
          </article>
          <div className="home-architecture-connector live" aria-label="OpenRouter sends the live request to the selected model"><i /><span>Provider call</span></div>
          <article className="home-architecture-node selected-model">
            <small>Provider</small>
            <b>Selected model</b>
            <p>Generate the response</p>
          </article>
          <div className="home-architecture-response"><span>Response returns through the same customer-owned path</span></div>
        </div>
      </section>
    </div>

    <div className="home-architecture-footer">
      <strong>RouteLab Cloud is not in the live inference path.</strong>
      <ul aria-label="Architecture diagram legend">
        <li className="live"><i />Live request + response</li>
        <li className="simulation"><i />Offline simulation traffic</li>
        <li className="policy"><i />Signed policy deployment</li>
      </ul>
    </div>
    <figcaption>RouteLab Cloud groups imported evidence and runs candidate replays through OpenRouter. The customer-hosted sidecar independently applies the deployed policy to each live request.</figcaption>
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
          <div className="home-cta-row"><button type="button" className="primary" onClick={openPasswordPrompt}>Get Started</button><a className="home-button-secondary" href="#how-it-works">See how it works</a><a className="home-button-secondary" href="#video">Watch the 90-sec overview</a><a className="home-button-secondary" href="#ask-routelab-video">See RouteLab Copilot in action</a></div>
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

      <section className="home-section home-video" id="video" aria-labelledby="video-title">
        <div className="home-video-copy">
          <p className="eyebrow">90-second overview</p>
          <h2 id="video-title">See RouteLab turn production evidence into a routing policy.</h2>
          <p>Follow the workflow from traces and Task Groups through model simulations, deployment, calibration, and ongoing review.</p>
          <dl>
            <div><dt>Runtime</dt><dd>1:30</dd></div>
            <div><dt>Format</dt><dd>Product explainer</dd></div>
          </dl>
        </div>
        <div className="home-video-player" data-label="ROUTELAB / PRODUCT OVERVIEW">
          <video
            controls
            playsInline
            preload="metadata"
            poster="https://cl13cqagrtjkhygq.public.blob.vercel-storage.com/marketing/routelab-explainer-v2-poster-piALIymeRdMEcVUp72CDGC74UuY4pn.png"
            src="https://cl13cqagrtjkhygq.public.blob.vercel-storage.com/marketing/routelab-explainer-90s-v2-h7EUdGpH1RIeT7PX0OufXjp3ztkzyq.mp4"
            aria-label="RouteLab 90-second product explainer"
          />
          <p>Includes narration, music, product screenshots, and on-screen captions.</p>
        </div>
      </section>

      <section className="home-section home-video" id="ask-routelab-video" aria-labelledby="ask-routelab-video-title">
        <div className="home-video-copy">
          <p className="eyebrow">77-second agent tour</p>
          <h2 id="ask-routelab-video-title">Meet the agent that turns routing questions into action.</h2>
          <p>Ask RouteLab answers specific workspace questions with custom metrics and charts you can pin to Overview, then helps you launch simulations and publish measured Task Group overrides.</p>
          <dl>
            <div><dt>Runtime</dt><dd>1:17</dd></div>
            <div><dt>Format</dt><dd>Agent workflow</dd></div>
          </dl>
          <a className="home-button-secondary home-video-direct-link" href="/marketing/ask-routelab-77s-v6.mp4" target="_blank" rel="noreferrer">Watch the Ask RouteLab video</a>
        </div>
        <div className="home-video-player" data-label="ASK ROUTELAB / AGENT WORKFLOW">
          <video
            controls
            playsInline
            preload="metadata"
            poster="/marketing/ask-routelab-77s-v6-poster.jpg"
            src="/marketing/ask-routelab-77s-v6.mp4"
            aria-label="Ask RouteLab 77-second agent workflow"
          />
          <p>See custom charts pinned to Overview, a targeted model simulation, and a measured routing-policy update.</p>
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
