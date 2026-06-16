# Style Ownership

Keep new styles close to the surface they affect:

- `overview.css` for Overview charts, summary cards, and executive summary.
- `traces.css` for trace tables, filtering, and trace drawer.
- `distinct-tasks.css` for Distinct Task tables, drawers, benchmark priors, and eval plans.
- `review-queue.css` for human review queue cards and controls.
- `simulations.css` for scenario controls, range tabs, scope picker, and simulation results.
- `recommendations.css` for recommendation policy cards and projected impact tables.
- `model-catalog.css` for model cards, pricing controls, API-key controls, and provider toggles.

`../styles.css` still carries the existing legacy rules. Move touched rules into these files when editing a surface so parallel branches do not compete for one large stylesheet.
