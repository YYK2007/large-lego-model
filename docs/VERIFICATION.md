# Large Lego Model: verification record

This document distinguishes tested local behavior from live integrations that need account/device access.

## Automated checks

The current suite has **109 passing tests**. `npm test` covers malformed placements and metadata, exact shape/color preservation through packing, interlocked seams, collision/support/connectivity gates, BOM/step consistency, inventory quantities and provenance, CSV escaping, LDraw units/orientation, PDF placement maps and page overflow, immutable saved revisions, and Photon message parsing/deduplication/session handling. New coverage includes uncapped piece counts, explicit budgets, bulk inventory, V2/legacy normalization, plate heights, four slope orientations and partial stud coverage, repeated-feature plans, exact web/native geometry, streaming progress, provider deadlines/errors, and the detailed castle's openings and placement order.

`npm run build` passes its strict TypeScript check and production build. Vite still reports a bundle-size advisory for the Three.js-containing main chunk (about 970 KB minified, 243 KB gzip). At checkpoint 02, `npm audit` was reduced from 18 moderate transitive findings to zero by pinning `@opentelemetry/core` to 2.12.0; no dependency change or fresh audit was part of checkpoint 03.

## Checkpoint 03: uncapped, more complex builds

- The UI no longer has a piece slider or sends a default budget. Generation, compiler and model validation have no application piece-count ceiling. Exact owned-only stock and explicitly supplied positive-safe-integer budgets still apply. Occupied-cell and shape-primitive caps were removed. Physical extent remains 24 × 24 studs × 72 plate heights; payload/provider/deadline limits are separate.
- The planner can emit boxes, real 3039 slope runs, and compact translated groups for repeated architecture. Instructions ask for actual hollow structures, multiple elevations, openings, floors, roofs and connected details. Geometry checks do not establish semantic faithfulness to every request.
- The curated **Courtyard castle** (`sample-castle`) contains **1,345 pieces**, 19 furnished rooms, four hollow four-storey towers, a three-storey keep, a front gate, courtyard lanes, open windows and five pitched roofs (72 slope pieces). Its frozen placements exactly match recompiling `shared/complex-plan.ts`. Regression checks verify room floors/table pieces, window/gate/courtyard voids, exact BOM quantities, and every elevated placement having an earlier supporting placement. Towers and keep do not have full stairs/circulation; do not claim they do.
- Independent full generation admission of that curated plan took **39 ms**, with geometry validation around **6 ms**, on this Mac. This proves the local pipeline can handle intricate geometry; it is not evidence of AI generation quality. A separate 2,352-piece connected fixture passes the spatial validator and still detects an introduced overlap.
- Inspected the castle from four azimuths and a first-floor cutaway. In the actual browser, reviewed the complete model and step 61, advanced from piece 1 to 2 with matching part/color/coordinate changes, and verified restored step/piece progress. At 390-pixel phone width, fixed the tall model overlapping its title by reserving canvas space below the heading; document and body widths both remain 390 pixels. Each step contains at most 12 pieces; multiple steps can share a height. Progress storage was versioned to avoid interpreting old layer indices as new step indices.
- Web instancing shares geometry and materials. A separate validated **1,038-piece rendering specimen** used **10 draw calls/frame**, averaging **8.30 ms** between rendered frames (p95 **10.3 ms**, 603 frames in five seconds) on an Apple M5 Pro / ANGLE Metal at 1440 × 1000. A stationary five-second sample made no draw calls. These are machine-specific rendering measurements, not generation speed or quality results.
- The castle produces **127 build steps**, a **131-page PDF** (22.8 MB; 19.6 seconds to generate), and a **2.7 MB USDZ** (48 ms). PDF cover, BOM/guide, middle and final-step pages were rendered and inspected; all step headers, placed counts, coordinates and footer numbers were checked from extracted text. USDZ archive integrity passes. Exact BOM total is 1,345. Large PDF generation is still synchronous and is a remaining performance limitation.
- Local review evidence: `output/complex-local/` (four angles, cutaway, browser preview/assembly, benchmark, native export), `output/pdf/courtyard-castle-instructions.pdf`, `output/pdf/castle-pages/`, and `output/checkpoint-03-{tests,build}.txt`. Output files are ignored by Git; teammates can regenerate them from the committed sample.

## Earlier browser / artifact checks

- Desktop studio renders real brick bodies and studs; sample geometry and its piece counts match.
- Build-step navigation shows one placement at a time, with an exact part/color quantity tray, numbered top-down map, current-piece outline, and replay. Reload restored piece 2 of step 1; changing layers reset to its first piece. Reduced-motion preference skips the approach animation. Map labels use the PDF's canonical stud coordinates.
- Adding five gray 2×4 bricks from a named test lot changes the exact source allocation and missing count in Pieces. Test inventory remains isolated in the test browser.
- A PDF downloaded through the actual UI; illustrations, BOM, placement coordinates, source allocations, and numbered pages were inspected.
- The earlier PDF check used continuation pages for dense layers. Checkpoint 03 splits these into at most 12 pieces per actual build step, shared by browser and PDF. Export validation rejects invalid geometry.
- Repeated saves return distinct IDs. Earlier JSON/CSV links retain the original design and inventory after subsequent changes.
- The updated live-rocket PDF, CSV, LDraw, USDZ, and PNG export routes all returned HTTP 200. The PDF text contains the matching 71-piece count, 12 steps, revision ID and coordinates; the USDZ archive passes its integrity check. Actual device opening remains unverified.
- Oversized title metadata is rejected with HTTP 400 before expensive PDF rendering.

Desktop and 390-pixel phone-width screens, export dialogs, part selection, saved progress, and reduced-motion controls were checked. No horizontal overflow was observed. The current website uses the calmer sky/green Y2K direction; the PDF retains the stronger glossy-blue treatment from checkpoint 02. Screenshots and manuals are saved locally under `output/`.

The SVG renderer previously drew false gaps in some solid models. It now orders overlapping body/stud projections and omits enclosed studs. A pixel regression fails on the previous renderer and passes after the fix; corrected flower/rocket images and manual pages were visually inspected.

## Live Gemini results

- Checkpoint 03 latency changes: replaced three sequential 90-second calls with at most two attempts sharing a 60-second provider deadline, explicit SDK single-attempt behavior, and streamed planning/checking/repair progress. `gemini-3.8-flash` uses its supported LOW thinking level; the [official model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) describes MEDIUM as its default. A successful LOW-versus-MEDIUM comparison has **not** been measured.
- First new live request returned provider 504 after **59.209 seconds** (59.226 seconds total), before producing a plan. A subsequent complex observatory request returned **429 RESOURCE_EXHAUSTED** after **184 ms** (198 ms total). Google reported the project's daily free-tier limit of **20 requests** for this model and a retry delay of 16,908 seconds at that moment. The app now reports quota exhaustion separately and does not retry that provider failure. Raw redacted reports are `output/latency/gemini-3.8-flash-low.json` and `output/complex-live/gemini-3.8-flash-low.json`. No billing, model or project settings were changed. Fresh complex generation remains unverified until capacity is available.

Earlier successful and failed runs used the previous catalog/planner:

- Text generation with `gemini-3.8-flash`: **Retro Space Rocket**, ID `58f50dc0-1e55-4ff1-90c8-b95230a1cad5`, 71 pieces and 12 layers. Geometry passed; the main body has depth and details on several faces. One request took about 105 seconds. This is one successful design, not a reliability benchmark or a physical build.
- Recolor revision: ID `e51524b7-636e-4ca7-a021-ac44c5a8482d`, still 71 pieces. Every part ID, position and rotation was unchanged; all 25 red pieces became green. This targeted revision passed exact comparison.
- Owned-only pyramid: ID `c2779e0b-bb77-4eb0-b879-ce949c21c9b9`, 15 green pieces, zero shortages, correct synthetic source labels, HTTP 200 in 75 seconds. **Intent failure:** it added a fifth layer to satisfy an overly strict volume gate despite the four-layer request. A four-layer-pyramid regression exposed that gate error; the checker was corrected and retains its thin-relief rejection test. This run establishes inventory enforcement, not full instruction-following success.

- Owned-only repeat after the checker fix: ID `759fd5ea-7e09-4d28-af99-877c6f3034d1`, 10 pieces in 37 seconds, exactly four layers with footprints 6×6, 4×4, 4×4, 2×2. Geometry passed and shortages were zero against the same synthetic stock. This run passed the requested shape and inventory checks.
- Image inspiration, first run: a synthetic rocket render was supplied through the real API. The request returned HTTP 422 after three rejected plans in 207 seconds; no invalid output was saved. This is a failure to produce the requested design, with safe rejection. It does not establish photo-input quality.

- Image inspiration, identical repeat: HTTP 502 after 152 seconds because a provider call did not complete. No new design was saved. The generic failure response does not establish whether the cause was timeout, quota, or another provider error. Both image runs failed to produce a usable design.

## Live checks still required

- Gemini: successful complex V2 generation with plates/slopes/repeats, request fidelity, repeated-generation consistency, improved successful latency, image inspiration, broader revision fidelity, confirmed physical photo inventory, and reliable image-inspired generation.
- Valid Rebrickable key: real paginated set inventory and comparison to the physical set.
- Photon project and line: inbound text/image, real responses, preview/model files, revision memory, saved inventory continuity, and PDF delivery.
- Target iPhone: native model opening/rotation, actual scale/colors, attachment handling, and web fallback. Documentation of platform support is not evidence of a tested product integration.
- Build a small model physically from the generated manual. Geometry checks alone do not establish mechanical stability.

No credentials have been committed. No real iMessage was sent during offline verification.
