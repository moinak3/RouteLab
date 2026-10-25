# RouteLab sidecar

The RouteLab sidecar is an OpenAI-compatible routing proxy that runs in the customer's environment. It:

1. Pulls the active signed policy from RouteLab.
2. Verifies its pinned Ed25519 public key and expiration before accepting traffic.
3. Sends the incoming conversation state (messages, tools, tool calls, response format, and session ID) to the policy's OpenRouter Decisions classifier.
4. Maps a confident result to a published RouteLab trace bucket.
5. Applies that bucket's model override, or the general fallback for unknown, low-confidence, failed, timed-out, and unapproved requests.
6. Proxies the original request to OpenRouter with the selected model and optional provider preference.

RouteLab Cloud never receives the model request or the customer's OpenRouter key. The sidecar only fetches the signed policy bundle from RouteLab.

## Run with Docker

From the RouteLab repository root:

```bash
docker build -f sidecar/Dockerfile -t routelab-sidecar .
docker run --rm --env-file routelab-sidecar.env -p 8787:8787 routelab-sidecar
```

The **Export sidecar setup** action in Routing Simulations downloads `routelab-sidecar.env` and `routelab-sidecar.compose.yaml` with the active policy URL, pinned public key, and a generated sidecar client key. Add the customer-owned `OPENROUTER_API_KEY` or `ROUTELAB_OPENROUTER_API_KEY`, then run:

```bash
docker compose -f routelab-sidecar.compose.yaml up --build
```

## Endpoints

- `POST /v1/route`: classify and return the routing decision without generating a completion.
- `POST /v1/chat/completions`: OpenAI-compatible chat endpoint that classifies and proxies the request to the selected OpenRouter model. Streaming is passed through.
- `GET /health`: process liveness.
- `GET /ready`: verified-policy readiness and active version.

Every chat response includes `X-RouteLab-Policy-Version`, `X-RouteLab-Bucket`, `X-RouteLab-Model`, and `X-RouteLab-Route-Source` headers.

Clients authenticate to `/v1/route` and `/v1/chat/completions` with `Authorization: Bearer $ROUTELAB_SIDECAR_API_KEY`. The sidecar uses its separate OpenRouter credential for upstream traffic and never forwards the client credential.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ROUTELAB_POLICY_URL` | Yes | Active bundle endpoint exported by RouteLab. |
| `ROUTELAB_POLICY_PUBLIC_KEY` | Yes | Pinned Ed25519 public key used to verify bundles. |
| `ROUTELAB_SIDECAR_API_KEY` | Yes | Client credential required by routing and chat endpoints. |
| `OPENROUTER_API_KEY` or `ROUTELAB_OPENROUTER_API_KEY` | Yes | Customer-owned key used for classification and completions. |
| `ROUTELAB_DECISION_MODE` | No | `enforce` (default) replaces the requested model; `shadow` preserves a supplied model while still returning routing headers. |
| `ROUTELAB_POLICY_POLL_MS` | No | Active-policy refresh interval; default `30000`. |
| `ROUTELAB_MAX_BODY_BYTES` | No | Maximum request body size; default `2000000`. |
| `PORT` | No | HTTP port; default `8787`. |

The process fails startup if it cannot load and verify a policy. During later polling failures it continues using the last verified, unexpired bundle. Once that bundle expires, readiness and routing fail closed.

The sidecar requires `routelab.policy.v2`, which includes canonical OpenRouter model targets. Republish and deploy older policies from RouteLab before starting the sidecar.

## Hosted Vercel demo

RouteLab also exposes stateless demo equivalents at `/api/sidecar/status`, `/api/sidecar/route`, `/api/sidecar/inspect`, and `/api/sidecar/chat`. The routing and completion endpoints require the same bearer credential as the Docker sidecar. The hosted adapter reloads and verifies the active signed policy on demand, records each decision as a runtime trace, and intentionally does not support streaming. Unknown classifier decisions are tagged for the Review Queue. It is a product demo, not a replacement for the customer-hosted sidecar's privacy boundary.
