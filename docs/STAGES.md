# Large Lego Model: reviewable build stages

Architecture: **Large Lego Model**. Provisional product name: Sprout. Turn an idea and existing bricks into a small brick sculpture, a parts list, and illustrated assembly steps.

## Branch and review process

`main` holds the starting research. Implementation lives on `feat/brick-studio`. Each completed stage receives a commit and a checkpoint entry here. No remote repository or public deployment has been created.

## 1. Website and canonical brick model

Review: open the local studio; choose a genuinely volumetric sample; orbit/zoom and inspect details from multiple sides; inspect the parts table; step through assembly; download a PDF, CSV, LDraw model, and native USDZ. All outputs must use the same placements. Sample designs are explicitly identified as samples. Flat reliefs do not meet the representative-model acceptance criteria.

Verification: schema validation, no overlapping brick volumes, supported upper layers, one connected final assembly, exact counts, consistent instruction order, browser and PDF visual checks. These are geometric checks, not physical load/stability certification.

## 2. AI, image inspiration, and owned inventory

Review: use an API key to describe an object; revise it; attach an inspiration photo; add exact inventory or import a set. Inventory photos are suggestions requiring confirmation, because occluded parts and counts cannot be measured reliably from a photo.

Verification: invalid generations are repaired or rejected; inventory quantities are enforced in owned-only mode; image and text use the same checked model; no sample fallback is represented as AI output.

## 3. Photon / Spectrum iMessage

Review: connect a Photon project; text the agent; receive a preview; revise the design; request its manual. Use the same generation service as the website. The feedback preview must communicate 3D shape: evaluate a native rotating animation, Apple-native user-controlled 3D model viewing, or an interactive Photon iMessage card. Keep turntable animation distinct from true user-controlled rotation. Verify actual device behavior before claiming native support. Design useful follow-up messages and links around review, refinement, parts, and instructions.

Verification: exercise routing, duplicate handling, media intake, per-conversation state, and outbound construction locally; separately record a real iMessage exchange when credentials are available.

## 4. Hackathon readiness

Review: rehearse prompt → preview → revision → parts → instructions, including an inventory-constrained build. Confirm sponsor requirements with the current organizer guide.

Later: ElevenLabs incoming/outgoing voice notes, physical stability solver and real build testing, broader part geometry, AR, multi-person collaborative assembly. Gemini powers text, image understanding, and revisions in the main path. These later features are not included in the initial claim of completion.

## Checkpoints

- Baseline: existing research preserved; staged plan recorded. Implementation not started.
- Repository: private `https://github.com/YYK2007/sprout-hacknc2026`, `main` baseline and `feat/brick-studio` review branch. JSA30 invited with write access; acceptance is separate.
- Checkpoint 01 (`checkpoint-01-studio`): local studio, geometric validation, exact BOM/source allocation, cumulative steps, PDF/CSV/LDraw/PNG exports, and USDZ export implemented. The 97-brick rocket is volumetric. 50 automated checks and the production build pass; PDF and desktop UI inspected. Gemini/image and Photon adapters exist but await live credentials. Broader sample complexity and mobile QA continue on the feature branch.
