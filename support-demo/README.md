# RouteLab Support Console

Standalone customer-support chat that sends complete conversations to the RouteLab sidecar and renders the resulting routing trace beside the answer.

## Run locally

Start a deployed policy sidecar first, then start the console with the same sidecar API key:

```bash
ROUTELAB_SIDECAR_URL=http://127.0.0.1:8787 \
ROUTELAB_SIDECAR_API_KEY=replace-with-exported-key \
npm run support-demo
```

Open `http://127.0.0.1:8790`.

The browser calls only the console server. The console server forwards requests to the sidecar, keeping both the sidecar credential and the OpenRouter key out of browser code.

Each user turn is classified once. If the selected model calls a tool, the console returns the sidecar's signed continuation token with the tool result so the follow-up completion reuses the same task group, confidence, and route.

Publishing from RouteLab Cloud signs and deploys the new version in one action. A running sidecar polls the active bundle, verifies it against its pinned public key, and adopts the new mapping without a restart.

## Hosted Vercel demo

The main RouteLab deployment publishes the same console at `/support-console/`. Its `/api/support/*` handlers run the sidecar routing logic in a stateless Vercel function, verify the active signed policy on every warm-cache refresh, and keep the OpenRouter credential server-side. Each completed support turn is normalized into a RouteLab trace and stored in the configured workspace database. RouteLab loads these records into Traces, while unknown classifier decisions appear in the Review Queue's dedicated filter. This hosted path is for demonstration; customer traffic should use the Docker sidecar so prompts and credentials stay in the customer's environment.
