# Sprout: reviewable build stages

Working name: Sprout. Turn an idea and existing bricks into a small brick sculpture, a parts list, and illustrated assembly steps.

## Branch and review process

`main` holds the starting research. Implementation lives on `feat/brick-studio`. Each completed stage receives a commit and a checkpoint entry here. No remote repository or public deployment has been created.

## 1. Website and canonical brick model

Review: open the local studio; choose a sample; orbit/zoom; inspect the parts table; step through assembly; download a PDF, CSV, and LDraw model. All outputs must use the same placements. Sample designs are explicitly identified as samples.

Verification: schema validation, no overlapping brick volumes, supported upper layers, one connected final assembly, exact counts, consistent instruction order, browser and PDF visual checks. These are geometric checks, not physical load/stability certification.

## 2. AI, image inspiration, and owned inventory

Review: use an API key to describe an object; revise it; attach an inspiration photo; add exact inventory or import a set. Inventory photos are suggestions requiring confirmation, because occluded parts and counts cannot be measured reliably from a photo.

Verification: invalid generations are repaired or rejected; inventory quantities are enforced in owned-only mode; image and text use the same checked model; no sample fallback is represented as AI output.

## 3. Photon / Spectrum iMessage

Review: connect a Photon project; text the agent; receive a preview; revise the design; request its manual. Use the same generation service as the website.

Verification: exercise routing, duplicate handling, media intake, per-conversation state, and outbound construction locally; separately record a real iMessage exchange when credentials are available.

## 4. Hackathon readiness

Review: rehearse prompt → preview → revision → parts → instructions, including an inventory-constrained build. Confirm sponsor requirements with the current organizer guide.

Later: physical stability solver and real build testing, broader part geometry, AR, multi-person collaborative assembly. These are not included in the initial claim of completion.

## Checkpoints

- Baseline: existing research preserved; staged plan recorded. Implementation not started.
