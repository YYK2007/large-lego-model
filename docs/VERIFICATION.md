# Large Lego Model: verification record

This document distinguishes tested local behavior from live integrations that need account/device access.

## Automated checks

`npm test` covers malformed placements and metadata, exact shape/color preservation through packing, interlocked seams, collision/support/connectivity gates, BOM/step consistency, inventory quantities and provenance, CSV escaping, LDraw units/orientation, PDF placement maps and page overflow, immutable saved revisions, and Photon message parsing/deduplication/session handling.

`npm run build` performs a strict TypeScript check and production build. `npm audit` was reduced from 18 moderate transitive findings to zero by pinning `@opentelemetry/core` to 2.12.0, the patched version already used at the top level. No breaking Spectrum downgrade was applied.

## Browser / artifact checks

- Desktop studio renders real brick bodies and studs; sample geometry and its piece counts match.
- Build-step navigation shows cumulative layers and highlights the newly added bricks.
- Adding five gray 2×4 bricks from a named test lot changes the exact source allocation and missing count in Pieces. Test inventory remains isolated in the test browser.
- A PDF downloaded through the actual UI; illustrations, BOM, placement coordinates, source allocations, and numbered pages were inspected.
- PDF checks include a dense layer requiring continuation pages. Export validation rejects invalid geometry.
- Repeated saves return distinct IDs. Earlier JSON/CSV links retain the original design and inventory after subsequent changes.
- Oversized title metadata is rejected with HTTP 400 before expensive PDF rendering.

Desktop screenshots and generated manuals are saved locally under `output/`. Additional mobile, image-input, export, and connection checks will be recorded after their execution.

## Live checks still required

- Valid Gemini key: text generation, successful repair/rejection, vision inspiration, revision fidelity, and confirmed photo inventory.
- Valid Rebrickable key: real paginated set inventory and comparison to the physical set.
- Photon project and line: inbound text/image, real responses, preview/model files, revision memory, saved inventory continuity, and PDF delivery.
- Target iPhone: native model opening/rotation, actual scale/colors, attachment handling, and web fallback. Documentation of platform support is not evidence of a tested product integration.
- Build a small model physically from the generated manual. Geometry checks alone do not establish mechanical stability.

No credentials have been committed. No real iMessage was sent during offline verification.
