# Personal-agent trajectory golden dataset

`personal-agent-trajectory-golden-20.csv` is a 20-row calibration fixture for the personal-agent workspace. It is intentionally small enough for a live demo and includes a mix of passing and failing trajectories across ten task groups.

The machine-readable row contract is in `golden-trajectory-schema.json`.

## Evidence contract

Every row snapshots the same evidence packet that RouteLab sends to the LLM judge:

- user request and system instructions
- prior conversation messages
- available tools and retrieved context
- execution spans, tool calls, and tool results
- final agent response and trajectory status
- workflow and operational metadata

The human reference answer, verdict, score, severity, and rationale are labels. They are stored beside the evidence but are never included in the judge's evidence packet.

`evidence_fingerprint` identifies the exact trajectory snapshot. RouteLab excludes a row from calibration if that fingerprint no longer matches the imported trace, preventing a human label for one trajectory from being compared with a judge result for another.

## Human review

The included labels are curated synthetic fixture labels and are marked `prefilled_needs_human_confirmation`. For a real calibration decision, a reviewer should inspect the full trajectory fields, confirm or edit the human labels, and then upload the revised CSV.

Regenerate both the dataset and its portal download copy with:

```bash
npm run dataset:golden-trajectory
```
