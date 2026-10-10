# Large Lego Model: verification record

This document distinguishes tested local behavior from live integrations that need account/device access.

## Automated checks

The current suite has **57 passing tests**. `npm test` covers malformed placements and metadata, exact shape/color preservation through packing, interlocked seams, collision/support/connectivity gates, BOM/step consistency, inventory quantities and provenance, CSV escaping, LDraw units/orientation, PDF placement maps and page overflow, immutable saved revisions, and Photon message parsing/deduplication/session handling.

`npm run build` performs a strict TypeScript check and production build. `npm audit` was reduced from 18 moderate transitive findings to zero by pinning `@opentelemetry/core` to 2.12.0, the patched version already used at the top level. No breaking Spectrum downgrade was applied.

## Browser / artifact checks

- Desktop studio renders real brick bodies and studs; sample geometry and its piece counts match.
- Build-step navigation shows one placement at a time, with an exact part/color quantity tray, numbered top-down map, current-piece outline, and replay. Reload restored piece 2 of step 1; changing layers reset to its first piece. Reduced-motion preference skips the approach animation. Map labels use the PDF's canonical stud coordinates.
- Adding five gray 2×4 bricks from a named test lot changes the exact source allocation and missing count in Pieces. Test inventory remains isolated in the test browser.
- A PDF downloaded through the actual UI; illustrations, BOM, placement coordinates, source allocations, and numbered pages were inspected.
- PDF checks include a dense layer requiring continuation pages. Export validation rejects invalid geometry.
- Repeated saves return distinct IDs. Earlier JSON/CSV links retain the original design and inventory after subsequent changes.
- The updated live-rocket PDF, CSV, LDraw, USDZ, and PNG export routes all returned HTTP 200. The PDF text contains the matching 71-piece count, 12 steps, revision ID and coordinates; the USDZ archive passes its integrity check. Actual device opening remains unverified.
- Oversized title metadata is rejected with HTTP 400 before expensive PDF rendering.

Desktop and 390-pixel phone-width screens, export dialogs, part selection, saved progress, and reduced-motion controls were checked. No horizontal overflow was observed. XP-inspired blue window frames, sky/grass colors, and glossy controls appear in both the app and manual. Screenshots and manuals are saved locally under `output/`.

The SVG renderer previously drew false gaps in some solid models. It now orders overlapping body/stud projections and omits enclosed studs. A pixel regression fails on the previous renderer and passes after the fix; corrected flower/rocket images and manual pages were visually inspected.

## Live Gemini results

- Text generation with `gemini-3.8-flash`: **Retro Space Rocket**, ID `58f50dc0-1e55-4ff1-90c8-b95230a1cad5`, 71 pieces and 12 layers. Geometry passed; the main body has depth and details on several faces. One request took about 105 seconds. This is one successful design, not a reliability benchmark or a physical build.
- Recolor revision: ID `e51524b7-636e-4ca7-a021-ac44c5a8482d`, still 71 pieces. Every part ID, position and rotation was unchanged; all 25 red pieces became green. This targeted revision passed exact comparison.
- Owned-only pyramid: ID `c2779e0b-bb77-4eb0-b879-ce949c21c9b9`, 15 green pieces, zero shortages, correct synthetic source labels, HTTP 200 in 75 seconds. **Intent failure:** it added a fifth layer to satisfy an overly strict volume gate despite the four-layer request. A four-layer-pyramid regression exposed that gate error; the checker was corrected and retains its thin-relief rejection test. This run establishes inventory enforcement, not full instruction-following success.

- Owned-only repeat after the checker fix: ID `759fd5ea-7e09-4d28-af99-877c6f3034d1`, 10 pieces in 37 seconds, exactly four layers with footprints 6×6, 4×4, 4×4, 2×2. Geometry passed and shortages were zero against the same synthetic stock. This run passed the requested shape and inventory checks.
- Image inspiration, first run: a synthetic rocket render was supplied through the real API. The request returned HTTP 422 after three rejected plans in 207 seconds; no invalid output was saved. This is a failure to produce the requested design, with safe rejection. It does not establish photo-input quality.

- Image inspiration, identical repeat: HTTP 502 after 152 seconds because a provider call did not complete. No new design was saved. The generic failure response does not establish whether the cause was timeout, quota, or another provider error. Both image runs failed to produce a usable design.

## Live checks still required

- Gemini: repeated-generation consistency, image inspiration, broader revision fidelity, confirmed physical photo inventory, and reliable image-inspired generation.
- Valid Rebrickable key: real paginated set inventory and comparison to the physical set.
- Photon project and line: inbound text/image, real responses, preview/model files, revision memory, saved inventory continuity, and PDF delivery.
- Target iPhone: native model opening/rotation, actual scale/colors, attachment handling, and web fallback. Documentation of platform support is not evidence of a tested product integration.
- Build a small model physically from the generated manual. Geometry checks alone do not establish mechanical stability.

No credentials have been committed. No real iMessage was sent during offline verification.
