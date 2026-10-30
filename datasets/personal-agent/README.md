# Synthetic personal-agent traces

This dataset contains 300 fictional, production-shaped conversations for a personal agent similar to Muse or Instinct. No record contains real customer data.

## Files

- `personal-agent-traces-300.jsonl`: richest version, including structured messages, tool spans, and metadata.
- `personal-agent-traces-300.csv`: RouteLab-compatible flat export. The `messages` and `metadata` columns contain JSON.
- `manifest.json`: counts by case type, pass/fail result, feedback signal, and task group.

## Coverage

The dataset contains 15 task groups with 20 conversations each. Each group contains 12 happy paths, five unhappy paths, and three edge cases. Edge cases intentionally mix correct and incorrect handling.

Each trace includes:

- full request history and final agent response
- model, provider, tokens, latency, cost, and status
- task group, domain, risk, complexity, and case type
- eval score, pass/fail result, and evaluator rationale
- thumbs-up, thumbs-down, or no user feedback
- a corrected output for every failed response
- available tools, observed tool use, authorization requirements, and safety signals

The data is deterministic. Regenerate it with:

```bash
node scripts/generate-personal-agent-traces.mjs
```
