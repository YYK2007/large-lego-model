# Large Lego Model: project instructions

Read `docs/OBJECTIVE.md`, `docs/STAGES.md`, and `docs/VERIFICATION.md` before changing product behavior. Keep the supplied Karpathy-style principles: explicit assumptions, minimum necessary implementation, surgical changes, and verifiable outcomes.

## Product requirements

- Call the architecture **Large Lego Model**. The product name is provisional.
- **Use Windows XP as the main visual reference within the Frutiger Aero / Y2K brief.** Apply bright blue rounded window frames, sky and grassy greens, friendly icons, glossy controls, dimensional lighting, and nature imagery throughout the website, model presentation, feedback surfaces, and manuals. Keep the LEGO workshop identity; use original assets. Glass and translucency can support this direction. Keep actual brick colors accurate and instructions legible.
- Study actual **LEGO Builder** screens and official demonstrations before deciding assembly UX. Record sources and what was observed. Prioritize part callouts, precise placement, orientation, camera behavior, subassemblies, and clear progress. Do not claim to have operated the mobile app when only a video or screenshot was inspected.
- Generate genuinely three-dimensional and increasingly complex builds. A wide plinth underneath a thin relief is not sufficient. Inspect multiple sides, depth, internal structure when relevant, and subassembly needs. Flat designs are appropriate only when requested.
- **Support more than rectangular bricks.** Expand the real-part catalog in verified stages: plates, tiles, slopes, curves and wedges, then suitable hinges, wheels, brackets and connectors. Each released family needs accurate geometry, legal connections/orientations, collision checks, exact inventory/BOM accounting, and understandable assembly steps. The current seven-brick palette is a prototype limitation, not the finished goal. Do not substitute decorative meshes for usable parts or claim unimplemented families work.
- All previews, animations, native 3D files, BOMs, allocations, and instructions come from the same validated brick model. Never generate illustrative media that invents a different set.
- Distinguish geometric checks, physical simulation, real hand-building, and live account/device tests. Do not equate connected bricks with mechanically proven stability.
- For iMessage, prefer native user-controlled viewing with a verified fallback. A looping animation is not interactive rotation. Test actual phone behavior before claiming it works.
- Use Gemini in the main multimodal flow and Photon Spectrum for iMessage. ElevenLabs voice notes remain a later stage unless explicitly promoted.
- Make progress reviewable through local checkpoints, tests, documentation, feature-branch commits, and a draft PR. Avoid inflated claims, generic marketing copy, and unnecessary features.
- Keep credentials and user runtime data out of Git. Never print secret values in logs or reports.

## Validation

Run relevant tests and `npm run build` after meaningful changes. Inspect the running desktop/mobile UI and generated manual pages; code passing a test does not establish visual quality. Keep `docs/VERIFICATION.md` current and preserve remaining live-test requirements.
