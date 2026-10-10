# Large Lego Model: accepted objective

Build a hackathon product that turns text, inspiration images, or the user's existing LEGO collection into a design the user can review, an exact list of pieces (including which owned set supplies them), and illustrated assembly instructions.

The initial surface is a website. The primary later surface is an AI agent in iMessage using **Photon Spectrum**, the framework required by the HackNC sponsor track. Use **Gemini** for multimodal interpretation and revisions. Evaluate **ElevenLabs** for incoming/outgoing voice memos after the main flow is working.

## User experience

**Current priority: resemblance to the real subject.** For named or recognizable real-world objects, retrieve existing reference photographs, verify the subject, feed actual image pixels into planning, and retain source/credit links. Compare the generated geometry with those references for silhouette, proportions, materials/colors, and distinctive features before calling it a successful match. Geometry validity alone is insufficient. Expand the usable scale and real-part catalog where they force crude approximations; preserve exact parts, connections, inventory, and matching exports. More pieces alone are not evidence of likeness. Use the Morehead-Patterson Bell Tower as the first visible before/after acceptance case.

**Current priority:** remove the application piece-count limit and default small-piece budget, then substantially improve build complexity before resuming Photon setup. Designs should include meaningful structure, details on several faces, openings, interiors, and connected sections when the prompt calls for them. Verify an intricate larger build through geometry, multi-angle viewing, performance, and complete instructions. Preserve only budgets the user explicitly requests and exact owned-inventory constraints.

Models must support meaningful complexity and genuine three-dimensional structure, including depth, details on several faces, and ultimately internal structure and subassemblies. Flat pixel-art reliefs are not a sufficient demonstration. Use them only when a user explicitly requests a flat design. Validate representative models from several viewing angles and with actual assembly checks. Avoid inflated claims, generic marketing copy, and unnecessary implementation work.

**Required part variety:** designs must go beyond rectangular bricks. Expand to real plates, tiles, slopes, curved pieces, wedges, hinges, wheels, brackets, and connectors in verified increments. Part geometry and legal connections must drive generation, owned inventory, the 3D viewer, native exports, BOMs, and assembly instructions consistently. A seven-brick rectangular-only catalog is an initial prototype, not completion of this objective. Release each family only after its dimensions, connections, collisions, quantities, and instruction sequence are checked.

The current implementation contains 26 real part types and 13 colors, restricted to verified part/color combinations. Its 96×96-stud, 384-plate-height workspace supports larger models without introducing a piece-count ceiling. Tiles, upright slopes, round 1×1 parts and a small cone extend the brick/plate palette; they do not fulfill the entire catalog objective. Checkpoint 05 remains in progress: reference photos now enter planning, and the comparison/review flow is being verified. Fresh end-to-end attempts still fail structural checks or time out. A recovered 1,465-piece valid draft was compared separately and marked as needing refinement; successful reference-backed likeness is not yet established.

1. User describes an object or shares an image. They may instead identify existing sets/loose bricks and ask for a new design using them.
2. The system interprets the idea and builds a structured brick model. The user reviews the actual design and can request changes in a loop.
3. In iMessage, the feedback preview must convey 3D shape. Prefer native user-controlled model viewing if supported; otherwise a rotating animation, with a clear distinction between interactive rotation and prerecorded motion. Evaluate what useful previews, model files, links, and follow-up actions the agent should send.
4. Freeze the accepted revision, allocate real parts/colors/quantities to the user's source sets where available, and disclose any missing pieces.
5. Generate a LEGO-style illustrated manual with a Frutiger Aero treatment. All models, diagrams, instructions, and piece counts must remain consistent.
6. Give the user direct part and set references: which confirmed owned set or loose-brick lot supplies each required part/color/quantity, remaining shortages, and catalog links for finding those missing pieces. Carry this through iMessage responses and linked/downloadable instructions; do not confuse catalog references with checked stock, prices, or completed purchases.

## Engineering process

**Design direction:** calm, playful Frutiger Aero / Y2K with sky, greenery, selective gloss, and dimensional model lighting. Windows XP remains an influence, but the literal desktop-window treatment was rejected. Keep a coherent identity across the website, iMessage previews, and manual, with readable diagrams and faithful brick colors.

**Explicit LEGO Builder research requirement:** inspect actual app screens and official walkthroughs before finalizing step-by-step UX. Record how it handles added pieces, orientation, part counts, camera movement, subassemblies, and progress. Distinguish operating the app from observing its official demo. Continue researching beyond the first functional prototype.

- Research alternatives before adopting the supplied LegoGPT fork or proposed workflow.
- Use delegated research/implementation where helpful; maintain shared contracts and independently review the result.
- Work in a Git repository with a clean baseline and reviewable feature branch. Keep stage checklists, verification evidence, and commits that teammates can inspect.
- Publish the collaboration repository to GitHub and invite teammates when their usernames are supplied.
- Be precise about implemented, locally verified, configured, live-tested, physically tested, and future behavior.
- Whenever account setup, credentials, inventory details, or device checks require the user, provide numbered steps, direct links, exact fields, and an observable completion check. Avoid vague requests for API codes; keep secret values in local configuration.

## Later stages retained

Native/interactive iMessage model viewing, augmented reality, a richer step-by-step 3D assembly experience, cooperative multi-person building, and ElevenLabs voice notes. Native viewing is being investigated during the Photon work; actual device testing remains required.

## Names

**Large Lego Model** is the user-chosen architecture name and must be used in technical documentation. **Sprout** was an assistant-chosen temporary product/repository name; product branding remains provisional.
