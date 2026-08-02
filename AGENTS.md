# Ether Agent Notes

Ether is a Windows-first, local-first desktop creative system. Ether 4.0 is the active product architecture.

The 2026-07-31 release candidate was rejected after a product-owner audit. Recovery documents are normative for all new work:

- `docs/product/ether-4.0-recovery-design-spec.md`
- `docs/product/ether-4.0-recovery-acceptance.md`
- `docs/superpowers/plans/2026-08-02-ether-4.0-recovery-implementation-plan.md`

Read these normative documents before changing product behavior:

- `docs/product/ether-4.0-design-spec.md`
- `docs/product/ether-4.0-technical-spec.md`
- `docs/product/ether-4.0-acceptance.md`
- `docs/product/visual-system.md`

The former implementation plan is historical. Follow the active recovery plan:

`docs/superpowers/plans/2026-08-02-ether-4.0-recovery-implementation-plan.md`

Non-negotiables:

- Windows desktop first.
- One portable `.ether` file is the document boundary.
- Ether 2.x folder projects are unsupported. Do not add an importer, migration, or compatibility path.
- New 4.0 work must not depend on `@ether/engine` or its `project.json`, `graph.json`, and `ether.db` storage model.
- No paid OpenAI Platform API fallback.
- Use only approved CLI, App Server, or MCP provider integrations.
- Respect the DreamBay and Ether visual system.
