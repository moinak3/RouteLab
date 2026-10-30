import { workspaceOnboardingState, type WorkspaceOnboardingInput } from "../core/workspaceOnboarding";
import type { Page } from "../types/ui";

export function WorkspaceOnboarding({ onNavigate, ...input }: WorkspaceOnboardingInput & { onNavigate: (page: Page) => void }) {
  const state = workspaceOnboardingState(input);
  const activeStep = state.currentStep ?? state.steps[state.steps.length - 1];
  const progress = state.completedCount / state.steps.length * 100;
  const finished = !state.currentStep;

  return <section className="panel workspace-onboarding" aria-labelledby="workspace-onboarding-title">
    <div className="workspace-onboarding-head">
      <div>
        <p className="eyebrow">Your evidence path</p>
        <h2 id="workspace-onboarding-title">{finished ? "Your first allocation policy is active." : `${activeStep.title} next.`}</h2>
        <p>{finished
          ? "The evidence path is complete. Revisit any step as traffic, evals, prices, or models change."
          : activeStep.detail}</p>
      </div>
      <div className="workspace-onboarding-progress" aria-label={`${state.completedCount} of ${state.steps.length} onboarding steps complete`}>
        <div><span style={{ width: `${progress}%` }} /></div>
        <strong>{state.completedCount} of {state.steps.length} complete</strong>
      </div>
    </div>

    <div className="workspace-onboarding-body">
      <ol className="workspace-onboarding-steps">
        {state.steps.map((step, index) => {
          const status = step.complete ? "complete" : step.current ? "current" : "waiting";
          const canOpen = step.complete || step.current || finished;
          return <li className={status} key={step.id}>
            <button type="button" disabled={!canOpen} onClick={() => onNavigate(step.page)} aria-current={step.current ? "step" : undefined}>
              <span className="workspace-onboarding-number" aria-hidden="true">{step.complete ? "✓" : step.number}</span>
              <span><strong>{step.title}</strong><small>{step.detail}</small></span>
              <b>{step.complete ? "Complete" : step.current ? "Up next" : `Step ${index + 1}`}</b>
            </button>
          </li>;
        })}
      </ol>

      <div className="workspace-onboarding-action">
        <span>{finished ? "Evidence path complete" : `Step ${activeStep.number}`}</span>
        <h3>{finished ? "Keep the policy current" : activeStep.title}</h3>
        <p>{finished
          ? "Re-run the evidence path when your traffic, prompts, evals, models, or prices change."
          : activeStep.detail}</p>
        <button type="button" className="primary" onClick={() => onNavigate(activeStep.page)}>{activeStep.action}</button>
        {input.traceCount > 0 && activeStep.id !== "traces" && <button type="button" className="workspace-onboarding-secondary" onClick={() => onNavigate("Traces")}>Inspect imported traces</button>}
      </div>
    </div>
  </section>;
}
