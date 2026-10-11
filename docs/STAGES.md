# Large Lego Model: reviewable build stages

Architecture: **Large Lego Model**. Provisional product name: Sprout. Turn an idea and existing bricks into a detailed three-dimensional build, a parts list, and illustrated assembly steps.

## Branch and review process

`main` holds the starting research. Implementation lives on `feat/brick-studio`. Each completed stage receives a commit and a checkpoint entry here. The private collaboration repository is on GitHub; the app currently runs locally.

## 1. Website and canonical brick model

Review: open the local studio; choose a genuinely volumetric sample; orbit/zoom and inspect details from multiple sides; inspect the parts table; step through assembly; download a PDF, CSV, LDraw model, and native USDZ. All outputs must use the same placements. Sample designs are explicitly identified as samples. Flat reliefs do not meet the representative-model acceptance criteria.

Verification: schema validation, no overlapping brick volumes, supported upper layers, one connected final assembly, exact counts, consistent instruction order, browser and PDF visual checks. These are geometric checks, not physical load/stability certification.

Design acceptance: use a calm, playful Frutiger Aero / Y2K workshop with sky/grass colors, selective gloss, and depth. Windows XP is an influence; the literal window-chrome treatment was rejected. Compare the assembly workflow to observed LEGO Builder screens and official walkthroughs, with precise part callouts, orientation, placement, and progress.

## Required catalog expansion

The finished objective includes more than rectangular bricks. After validating the first volumetric generator, add plates, tiles, and upright slopes; then curved pieces and wedges; then verified wheels, hinges, brackets, and connector families. For each increment, review a model that actually uses those parts and verify the same geometry and connections in generation, inventory, viewer, exports, and instructions. Preserve exact part/color IDs and counts. See `docs/complex-builds.md` for the coordinate, connection, and assembly requirements. The current implementation has 36 real part types and 13 colors with verified part/color combinations; it is an increment toward this goal, not the entire required catalog.

## 2. AI, image inspiration, and owned inventory

Review: use an API key to describe an object; revise it; attach an inspiration photo; add exact inventory or import a set. Inventory photos are suggestions requiring confirmation, because occluded parts and counts cannot be measured reliably from a photo.

Verification: invalid generations are repaired or rejected; inventory quantities are enforced in owned-only mode; image and text use the same checked model; no sample fallback is represented as AI output.

## 3. Photon / Spectrum iMessage

Review: connect a Photon project; text the agent; receive a preview; revise the design; request its manual. Use the same generation service as the website. The feedback preview must communicate 3D shape: evaluate a native rotating animation, Apple-native user-controlled 3D model viewing, or an interactive Photon iMessage card. Keep turntable animation distinct from true user-controlled rotation. Verify actual device behavior before claiming native support. Design useful follow-up messages and links around review, refinement, parts, and instructions.

Verification: exercise routing, duplicate handling, media intake, per-conversation state, and outbound construction locally; separately record a real iMessage exchange when credentials are available.

## 4. Hackathon readiness

Review: rehearse prompt → preview → revision → parts → instructions, including an inventory-constrained build. Confirm sponsor requirements with the current organizer guide.

Later: ElevenLabs incoming/outgoing voice notes, physical stability solver and real build testing, AR, multi-person collaborative assembly. Broader part geometry is a required staged expansion described above. Gemini powers text, image understanding, and revisions in the main path. These later features are not included in the initial claim of completion.

## Checkpoints

- iMessage demo approval loop (2026-10-11): revisions retain the selected mode; the user approves an exact checked revision before automatic USDZ/PDF/parts delivery. Post-build Gemini review is preserved behind `PHOTON_VISUAL_REVIEW_ENABLED`, disabled for the demo. Website workflow remains the supporting viewer; the shared review metadata distinguishes skipped review from a match or mismatch.

- Piece economy and automatic finish (2026-10-11): planning justifies added pieces by subject features or construction needs. Exact-volume packing compares checked alternatives by piece count, preserving color, fixed parts, stock and budgets. Website and iMessage jobs stop on a complete match, stalled reviews/construction, a shared time limit or a bounded attempt count; the best checked draft remains available. See `VERIFICATION.md` for tests and limits.

- Reference coverage (2026-10-11): Quick and Detailed explicitly seek front, side and top/above source photographs, prioritize distinct whole-object views, and carry unavailable-angle warnings into planning and review. Public lookup and pixel-forwarding checks are recorded in `VERIFICATION.md`; retrieval alone does not establish generated likeness.

- Catalog expansion (2026-10-11): full-index paginated discovery and resumable import, 80 bundled/96 locally usable part types, real four- and five-petal flowers, explicit simple-piece preference, exact set/loose-inventory support and compact pinned manifests. The unrestricted assembly objective remains incomplete; connector and geometry exclusions stay explicit. See `DYNAMIC-CATALOG.md` and `VERIFICATION.md`.

- Current iMessage/feedback increment: simpler verified parts after repeated construction failures, exact-render Gemini review with automatic finish on a complete match, selectable checked drafts, and Photon conversation jobs with Stop, revisions and byte attachments. Mocked behavior and browser selection are verified; live authentication, message delivery and native phone rotation are separate acceptance gates recorded in `VERIFICATION.md`.

- Checkpoint 08 (`checkpoint-08-feature-refinement`): asymmetric/concave polygon profiles, complete per-feature visual reviews, earlier-draft retention, and a bounded visual correction after structural repair. Rendering two comparison views of a frozen 9,004-piece model fell from 34.31 to 9.06 seconds. 314 tests and the production build pass. Fresh Matterhorn and windmill builds reached review but remain inaccurate; the rose still failed. No new part family was enabled, and broad likeness remains an open acceptance requirement.

- Checkpoint 07 (`checkpoint-07-general-assembly`): generic part overlays, faster exact packing, connection-aware local repair, checked hanging assembly with one bounded ordering retry, matching animation/manual/CAD sequence, distinct-reference selection/cache, and indexed visual repair context. A varied six-prompt live batch yielded four valid drafts; only the apple received an AI likeness match. A later turtle failure was fixed by replaying its unchanged 925-piece geometry through the improved assembly order. Organic reliability and broad likeness remain unresolved; the catalog is still 36 types, not unrestricted. See `VERIFICATION.md` for all failures and the full-catalog acceptance path in `GENERAL-GENERATION.md`.

- Baseline: existing research preserved; staged plan recorded. Implementation not started.
- Repository: private `https://github.com/YYK2007/sprout-hacknc2026`, `main` baseline and `feat/brick-studio` review branch. JSA30 now has write access, confirmed through the GitHub collaborator permission endpoint.
- Checkpoint 01 (`checkpoint-01-studio`): local studio, geometric validation, exact BOM/source allocation, cumulative steps, PDF/CSV/LDraw/PNG exports, and USDZ export implemented. The 97-brick rocket is volumetric. 50 automated checks and the production build pass; PDF and desktop UI inspected. Gemini/image and Photon adapters exist but await live credentials. Broader sample complexity and mobile QA continue on the feature branch.

- Checkpoint 02 (`checkpoint-02-xp-assembly`): XP-inspired workshop and manual; four volumetric samples (flower 118, rocket 97, tree 119, duck 91 pieces); per-piece assembly tray, replay, placement map, and saved viewing progress; corrected SVG occlusion. 57 tests and the production build pass; desktop, 390-pixel mobile, and exported PDF inspected. Live Gemini text generation, exact recolor, and a corrected owned-only four-layer pyramid passed. Two image-inspired attempts failed (geometry rejection and provider failure); reliability work remains. Plates/slopes have a source-checked implementation plan and are not yet enabled.

- Checkpoint 03 (`checkpoint-03-complex-builds`): piece-count/default-small-budget removal, repeated-feature grammar, mixed-height plates and directional slopes, faster large-model validation/rendering, and six curated samples. The 1,345-piece castle has 19 furnished rooms and 127 assembly steps. Its geometry, openings, exports, browser assembly, and representative PDF pages were checked. 109 tests and production build pass. The website uses the calmer Y2K direction. Gemini progress and a shared 60-second deadline are implemented; successful complex AI generation remains blocked by exhausted provider quota. Photon setup remains paused for the user's complexity priority.

- Checkpoint 04 (`checkpoint-04-generation-repairs`): narrow real plates, one alternate shape-preserving packing pass, compact local cutouts, visible checker details, and interrupted-stream handling. PDF generation runs in a worker; a polygon-order fallback fixes accepted designs that previously could not export. 138 tests and production build pass. Fresh Bell Tower requests produced 436 pieces in 24.02 seconds and 346 pieces through the website in 21.65 seconds; resemblance remains insufficient. Reference photographs, visual comparisons, and broader real parts are the next stage.

- Checkpoint 05 preview (`checkpoint-05-reference-preview`), **acceptance still in progress**: 26 real part types and 13 colors, including longer bricks/plates, tiles, a narrow slope, round 1×1 parts and a small cone; a 96×96-stud, 384-plate-height workspace; model-sized camera, lighting and floor framing; reference-photo retrieval, multimodal planning and an AI visual comparison/review flow with source credits and explicit refinement needs. Upright stud connections remain the supported connection system. Local catalog and viewport checks do not establish generation quality. Reference photos entered actual planning. Fresh complete attempts still fail structural checks or time out; a recovered 1,465-piece valid draft was compared separately and marked as needing refinement. Rebrickable authentication, real set lookup and all 26 part-color lists passed; 203 automated tests and the production build pass. Successful reference-backed generation, recognizable Bell Tower likeness, repeat reliability and the complete user flow still require verification before this checkpoint is complete.

- Checkpoint 06 (`checkpoint-06-curved-builds-usdz`): 36 verified part types including 16-stud beams and broad plates; interpolated curved profiles and open ellipse-shell sectors; quick plate/mixed tilings followed by one bounded local repair; exact occupied colors, inventory and explicit budgets preserved. Four initial photo-backed attempts may extend to six only while structural errors decrease and the original time budget permits. Direct page USDZ download captures the clicked revision and reports failures. A fresh 5,910-piece Taj Mahal reached visual review; it and two rose drafts need refinement. Organic generation and hanging appendages remain unresolved. This is a capability and reliability increment, not completion of the likeness acceptance gate. See `VERIFICATION.md` for browser, archive, test and failed-live evidence.

## Quick iMessage delivery checkpoint

- Implemented mode choice, command guide, truthful progress and bounded Quick delivery.
- Repeated component failures switch to a whole-model plan; references prefer different views and can use an optional supported STL.
- 468 regression tests and build pass. A live Quick rose finished in about 34 seconds with its bloom, stem and leaves. A separate phone Quick build finished in 67.3 seconds; the user confirmed that the USDZ opens and rotates. See `VERIFICATION.md` for evidence and remaining likeness/physical limitations.

## Current demo: direct requests and user approval

- Quick mode is archived behind `QUICK_MODE_ENABLED=false`, with code and tests retained. New requests start directly; requested detail does not select a separate speed mode.
- Demo jobs skip the separate concept study and Gemini visual critic, preserve reference analysis and structural checks, and return the first complete checked draft. User feedback drives revisions; explicit approval sends matching USDZ, manual and parts files.
- Delivery, timeout recovery and large-manual verification are tracked in `VERIFICATION.md`.
