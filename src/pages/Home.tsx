import { useState, type FormEvent } from "react";

export const ASSESSMENT_URL = "mailto:TODO@routelab.dev"; // TODO(moinak): replace with assessment intake URL.
export const SAMPLE_REPORT_URL = "#sample-report"; // TODO(moinak): replace with final sample assessment report.

const pains = [
  { title: "Overpay.", text: "Frontier models everywhere, because switching feels risky." },
  { title: "Guess.", text: "Cheaper models get tried on vibes, not your workload." },
  { title: "Fragment.", text: "Gateways route. Dashboards log. Nobody decides." },
];
const layers = [
  { title: "Gateways", items: ["Execute model calls", "Handle provider fallback", "Apply budgets and limits"] },
  { title: "Observability", items: ["Capture traces", "Explain failures", "Track production behavior"] },
  { title: "RouteLab", items: ["Groups requests into tasks", "Proves eligible model choices", "Publishes the approved policy"] },
];
const steps = [
  { verb: "Observe", title: "Ingest production traces", text: "Normalize prompts, responses, tokens, cost, latency and workflow context.", image: "observe" },
  { verb: "Classify", title: "Group traces into tasks", text: "Build a stable task map while preserving an explicit Unknown path.", image: "classify" },
  { verb: "Prove", title: "Calibrate evals against a golden dataset", text: "Measure judge agreement, false passes and false fails before an eval can approve a route.", image: "prove" },
  { verb: "Compare", title: "Replay candidate models", text: "Compare cost, latency and quality on identical production inputs.", image: "compare" },
  { verb: "Approve", title: "Promote eligible overrides", text: "Approve only candidates whose quality interval, cost and latency clear the task's bars, then publish a signed version.", image: "approve" },
  { verb: "Enforce", title: "Apply policy locally", text: "A customer-hosted decision layer chooses the model upstream of your gateway and falls back on any doubt.", image: "enforce" },
];
const supportReasons = ["High token volume", "Customer-facing risk", "Clear policies", "CSAT and escalation outcomes", "Many prompts are over-modeled"];

export function Home({ onGetStarted }: { onGetStarted: (password: string) => boolean }) {
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const openPasswordPrompt = () => { setPassword(""); setPasswordError(null); setIsPasswordOpen(true); };
  const submitPassword = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!onGetStarted(password)) setPasswordError("Incorrect password."); };

  return <main className="home-page">
    <nav className="home-nav" aria-label="Marketing navigation"><div className="home-brand"><img src="/routelab-icon.svg" alt="" /><b>RouteLab</b></div><button className="home-menu" type="button" aria-expanded={menuOpen} onClick={()=>setMenuOpen((open)=>!open)}>Menu</button><div className={menuOpen ? "open" : ""}><a href="#why-now">Why now</a><a href="#how-it-works">How it works</a><a className="home-primary" href={ASSESSMENT_URL}>Request an assessment</a></div></nav>

    <section className="home-hero"><div className="home-hero-copy"><p className="eyebrow">Model routing policy</p><h1>Every AI task on the cheapest model that passes.</h1><p>RouteLab replays your traces on cheaper models, grades them with evals your reviewers trust, and ships a routing policy your gateway enforces. Anything uncertain stays on your current model.</p><div className="home-cta-row"><a className="home-primary" href={ASSESSMENT_URL}>Request an assessment</a><button className="home-preview-link" type="button" onClick={openPasswordPrompt}>Have a preview password?</button></div><small className="home-cta-note">48 hours. Your traces. No production changes.</small></div><picture className="home-hero-shot"><source srcSet="/marketing/hero-policy.webp" type="image/webp"/><img src="/marketing/policy-enforcement.jpg" alt="RouteLab policy overview showing the fallback model and approved task overrides" /></picture></section>

    <section className="home-problem" id="problem"><div><h2>AI inference is becoming cloud spend 2.0.</h2><p>AI features ship faster than anyone can govern them. The bill grows, and nobody can say why a given model serves a given task.</p></div><div className="home-pain-grid">{pains.map((pain)=><article key={pain.title}><h3>{pain.title}</h3><p>{pain.text}</p></article>)}</div></section>

    <section className="home-why" id="why-now"><div><p className="eyebrow">Why now</p><h2>Capability is compressing faster than price.</h2><p>Open models now handle most routine work. Frontier models still cost an order of magnitude more. The question is no longer which model is best, but which is good enough for this task, proven on your data.</p></div><div className="home-why-panel"><span>The old default</span><b>One frontier model for every request</b><small>Unmeasured margin leak</small><i/><span>The control plane</span><b>One fallback plus approved overrides</b><small>Auditable policy</small></div></section>

    <section className="home-steps" id="how-it-works"><div className="home-section-head"><h2>From traces to an enforced policy.</h2><p>Works today on single requests: classification, RAG, drafting and tool calls. Multi-step agents are next.</p></div><div className="home-step-grid">{steps.map((step,index)=><article className="home-step-card" key={step.verb}><div><small>0{index+1} · {step.verb}</small><h3>{step.title}</h3><p>{step.text}</p></div><picture><source srcSet={`/marketing/${step.image}.webp`} type="image/webp"/><img src={`/marketing/${step.image}.jpg`} alt={`RouteLab ${step.verb.toLowerCase()} view: ${step.title.toLowerCase()}`} loading="lazy"/></picture></article>)}</div></section>

    <section className="home-allocation"><div className="home-section-head"><h2>Gateways execute. Observability explains. RouteLab decides.</h2><p>RouteLab decides which model each recurring task may use. OpenRouter, Vercel AI Gateway or your existing gateway makes the call. A thin decision layer in your environment applies the latest approved policy and falls back to your current model on any doubt.</p></div><div className="home-allocation-grid">{layers.map((layer)=><article className={layer.title==="RouteLab"?"featured":""} key={layer.title}><h3>{layer.title}</h3>{layer.items.map((item)=><p key={item}>{item}</p>)}</article>)}</div></section>

    <section className="home-icp"><div><p className="eyebrow">Initial focus</p><h2>Built first for AI support teams.</h2><p>Support has measurable outcomes, customer-facing risk and enough volume for model allocation to matter.</p></div><div className="home-icp-list">{supportReasons.map((reason)=><span key={reason}>{reason}</span>)}</div><strong>Target: half the inference bill, same CSAT.</strong>{/* TODO(moinak): replace with a measured replay result. */}</section>

    <section className="home-final"><div><p className="eyebrow">48-hour assessment</p><h2>Don't hand production to a router on day one.</h2><p>Import traces, calibrate evals against your reviewers, replay candidate models, and approve only the routes that clear your quality, latency and cost bars. Every model launch, price cut and prompt change reopens the question. RouteLab reruns the evidence.</p></div><div><h2>Start with traces. Leave with an inference policy.</h2><p>Classify tasks, calibrate the bar, simulate candidates, publish the policy.</p><a className="home-primary" href={ASSESSMENT_URL}>Request an assessment</a></div></section>

    <footer className="home-footer"><div><b>RouteLab</b><a href={ASSESSMENT_URL}>Contact</a><a href="#privacy">Privacy</a><a href="#trace-handling">How we handle your traces</a><a href={SAMPLE_REPORT_URL}>Download a sample assessment report</a></div><section id="trace-handling"><h2>How we handle your traces</h2>{["Storage","Isolation","Retention and deletion","Subprocessors"].map((heading)=><article key={heading}><h3>{heading}</h3><p>TODO(moinak)</p></article>)}</section></footer>

    {isPasswordOpen && <div className="home-password-layer" role="presentation"><form className="home-password-dialog" onSubmit={submitPassword} role="dialog" aria-modal="true" aria-labelledby="home-password-title"><button className="home-password-close" type="button" onClick={()=>setIsPasswordOpen(false)} aria-label="Close password prompt">×</button><p className="eyebrow">Private preview</p><h2 id="home-password-title">Enter the RouteLab password</h2><label>Password<input autoFocus type="password" value={password} onChange={(event)=>{setPassword(event.target.value);setPasswordError(null)}}/></label>{passwordError&&<p className="home-password-error">{passwordError}</p>}<button type="submit" className="primary">Unlock RouteLab</button></form></div>}
  </main>;
}
