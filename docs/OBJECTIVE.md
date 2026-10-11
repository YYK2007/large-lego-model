# What we're building

Large LEGO Model turns a description, reference photo or confirmed collection of LEGO pieces into a design the user can revise and approve. The approved revision supplies the building guide, exact parts list and downloadable models.

This document records the accepted requirements. See [verification](VERIFICATION.md) for what we've tested and [stages](STAGES.md) for remaining work.

## The conversation

Request → checked preview → feedback → revised preview → approval → guide and files.

Photon Spectrum is the main iMessage interface. Gemini interprets requests, studies references and plans revisions. The website supports model inspection, inventory and downloads.

Start a new request directly. Detail follows the subject and the user's instructions. Quick mode stays archived behind `QUICK_MODE_ENABLED=false`, with its code and tests preserved.

Before approval, send the complete checked preview and ask what the user would change. Keep unfinished attempts private. Feedback starts from the selected saved placements and preserves the original request, photos and confirmed inventory. A failed edit keeps the earlier checked build; it must not silently replace the subject or start again from scratch.

Approval freezes the exact previewed revision. It sends the interactive guide, phone-viewing USDZ and parts CSV. PDF instructions are available on request, or in the final bundle when a public guide isn't configured. Approval never starts another generation. Retain earlier approved revisions and retry only files that weren't acknowledged.

Accept ordinary questions, brainstorming, feedback and file requests. Clarify ambiguous messages before starting work. Status questions, thanks and Stop must not become build requests. Use short progress updates describing actual stages, without invented percentages, JSON or checker coordinates. Keep full diagnostics in local job records.

Stop cancels generation and pending delivery. A message already handed to the transport may still arrive. Provider failures must leave saved builds intact.

## Resemblance and references

A model should look like the requested subject. Check its identity, silhouette, proportions, colors and defining features. A connected model or a large piece count does not establish a good likeness.

For recognizable subjects, seek distinct front, side and top or overhead photographs. Verify the subject, pass actual image pixels into planning and retain source links and credits. Disclose missing angles. Duplicate crops, failed downloads and uninspected captions don't count as independent views.

Use existing 3D references when suitable files are available. Their absence must not block a build. Distinguish inspected geometry and rendered views from links to files we haven't loaded. Reference geometry guides the design; exported LEGO models must still use the checked parts.

Preserve defining features through simplification and repair. A red mass isn't enough to establish a rose: the requested form needs recognizable petal structure. Evaluate varied subjects across nature, architecture, natural and manmade wonders, and everyday objects. Don't add subject-specific templates or treat one successful landmark as broad reliability.

## Generation and recovery

Produce a usable draft before chasing extra detail. Save the first checked result promptly and retain the best one while refinement continues. After repeated construction failures, try simpler supported parts while preserving the subject's proportions, colors and defining features.

New requests share a five-minute generation deadline across retries, with at most twelve construction attempts. Leave time for checking, repairs and saving. These are execution limits, not promises that every request will finish.

For the iMessage demo, `PHOTON_VISUAL_REVIEW_ENABLED=false` skips the separate concept study and post-build Gemini visual critic. Reference analysis, construction checks and structural repairs remain active. Return the first complete checked draft and wait for the user. Label it `not-reviewed`.

Keep the reviewer implementation and tests so the setting can restore it for new jobs. With review enabled, retain the best checked result and stop when the complete review passes, visual revisions stop helping, construction stops progressing or the shared limits are reached. Gemini's review never replaces user approval.

## Real parts and three-dimensional builds

Build meaningful depth and details on several faces. Use flat reliefs only when requested. Openings, interiors, repeated features and subassemblies should follow the subject rather than serve as decoration.

Don't impose a global piece-count ceiling or a default small-piece budget. Preserve explicit user budgets and confirmed owned quantities. Prefer fewer pieces when they preserve the same shape and construction quality.

The bundled seed currently has 80 usable part types and 176 mapped opaque colors, with per-part produced-color constraints. The finished objective is broader: any individually purchasable LEGO part, including specialty shapes and actual produced colors. Discovery alone doesn't establish usable connections or current marketplace stock.

Release each part family only after checking geometry, allowed orientations, mating connections, collisions, quantities and assembly order. Prefer verified curved, shaped and botanical pieces when they fit the request. Standard bricks and plates remain a recovery option.

All previews, native files, parts lists, allocations and instructions must derive from the same checked placements. Preserve the direct website USDZ download and capture the selected revision before exporting. Phone-viewing optimizations must retain the canonical model and its exact part accounting.

Show the exact part, color and quantity required, which confirmed set or loose-brick lot supplies it, and any shortage. Provide useful part and set links. Don't imply ownership, current stock, a checked price or a purchase without evidence.

## Building instructions

The main instruction surface is a normal 3D mini-app inspired by LEGO Builder. Show the whole model, rotation and zoom, close placement views, part callouts, replay, Back/Next, step selection and saved progress. AR is an optional “View in your room” action. Ordinary building must work without camera permission.

Keep a compact PDF companion with close diagrams, pictured quantities and clear orientation. Explain repeated placements once with counts and final locations. Distinguish stacked layer cycles from separate copies, and preserve the checked assembly order.

Study actual LEGO Builder screens and official demonstrations before changing assembly UX. Record sources and observations about camera behavior, added pieces, subassemblies and progress. Distinguish observing a demonstration from operating the app.

## Appearance and writing

Use the name Large LEGO Model throughout the product and technical documentation. Keep a calm, playful Frutiger Aero / Y2K identity: sky colors, greenery, selective gloss and dimensional model lighting. Windows XP is an influence; the literal desktop-window treatment was rejected. Preserve actual part colors and readable diagrams.

Write short, concrete explanations. Report what was made and tested without generic marketing claims. Keep geometric checks, visual review, phone tests and physical hand-building distinct.

## Working on the project

Work from `main` with focused commits and reviewable changes. Keep setup instructions and verification records current. Use research and delegated work where useful, then review the result. When the user needs to act, give numbered steps, direct links, exact fields and a completion check. Keep credentials and private runtime data out of Git and reports.

Cooperative building, ElevenLabs voice notes, broader connector families and physical load simulation remain future work. Reliable likeness across varied subjects remains an open requirement, even when a build passes structural checks.
