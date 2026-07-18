# Ether Agent Notes

Ether is a Windows-first, local-first desktop creative system. Ether 4.0 is the active product architecture.

Read these normative documents before changing product behavior:

- `docs/product/ether-4.0-design-spec.md`
- `docs/product/ether-4.0-technical-spec.md`
- `docs/product/ether-4.0-acceptance.md`
- `docs/product/visual-system.md`

Follow the active implementation plan:

`docs/superpowers/plans/2026-07-16-ether-4.0-implementation-plan.md`

Non-negotiables:

- Windows desktop first.
- One portable `.ether` file is the document boundary.
- Ether 2.x folder projects are unsupported. Do not add an importer, migration, or compatibility path.
- New 4.0 work must not depend on `@ether/engine` or its `project.json`, `graph.json`, and `ether.db` storage model.
- No paid OpenAI Platform API fallback.
- Use only approved CLI, App Server, or MCP provider integrations.
- Respect the DreamBay and Ether visual system.
