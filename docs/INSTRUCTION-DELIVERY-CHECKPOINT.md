# Instruction delivery checkpoint

Checked against the running project on 2026-10-11. This covers the instruction, phone-model and conversation objective; it does not certify arbitrary subject likeness or physical assembly.

| Requirement | Implemented behavior and evidence |
| --- | --- |
| Fewer pieces without losing the shape | Exact-volume packing compares fully checked tilings; the recorded regression preserves the occupied cells while reducing 18 pieces to 6. No global piece cap. |
| Smaller, practical phone model | Shared binary USD preserves the 1,961-piece Wilson model at 2.62 MB instead of 9.16 MB. The separate phone copy merges by color and reduces 6.71 million triangles to 263,708. Four surface comparisons and USD validation are recorded in `output/imessage-approval/`. |
| Compact LEGO-style PDF | Landscape spreads use pictured quantities and close placement diagrams. Exact repeated placements and alternating A/B cycles share instructions. Bell Tower: 395 original pages to 121, retaining all 448 checked steps, 3,135 pieces, placement paths and exact BOM. The repeated spread and a Wilson middle spread were visually inspected. |
| Primary instructions in iMessage | Photon sends a signed guide card and browser fallback only after approval of the exact previewed revision. Unapproved drafts receive a PNG preview and feedback request. The live public guide works at `guide.llegomodel.site`; the user confirmed opening it, rotation and placement controls on their phone. |
| Normal 3D building, with optional AR | Complete-model inspection, orbit/zoom, exact current part, replay, Back/Next, step jump, parts/stock and saved progress are implemented. AR is a separate action. The user reported that resume and AR seem to work well; no phone frame-rate benchmark is claimed. |
| Polished Frutiger Aero identity | Sky/green lighting, selective glass controls and a lettering-free glass-brick mark. Public guide inspected at 320-pixel and 390-pixel phone widths and landscape, with no horizontal overflow. Latest live check resumed step 178 and showed its exact part and full-model toggle. |
| Optional PDF and exact shopping list | PDF preparation polls short public requests, allowing building to continue. Public cold preparation and an actual PDF download passed. CSV and guide list exact quantities, owned allocations and catalog links. |
| Natural, responsive conversation | Bounded natural-language interpretation uses the existing action handlers. A normal phone conversation was user-confirmed. Validation runs in a worker; measured listener lag was 1.77 ms while a large assembly was checked. Stop cancels pending deliveries and unfinished attempts are kept private. Feedback starts targeted edits from saved placements and each revised preview needs its own approval. |
| Reviewable delivery | Changes are on `feat/brick-studio` in the private GitHub repository and draft PR #1. The final full regression run passed 743 tests and the production build, including approval gating, targeted revisions and manual catalog links. |

The Mac, API and Cloudflare tunnel must remain running for the public guide. The latest Stop cancellation has regression coverage and is active, but its final phone confirmation is still pending. Provider quota remains external; after a 429, an actual subsequent build completed successfully at 10:00:17 UTC. These limits are separate from completed instruction/export functionality.

Demo: describe a build → inspect the checked preview → give feedback → Approve → open the guide. `/instructions` opens the saved guide, `/model` requests the phone model, `/manual` requests the optional PDF, `/parts` requests the exact CSV, and `/stop` cancels pending work.
