# Large Lego Model: accepted objective

Build a hackathon product that turns text, inspiration images, or the user's existing LEGO collection into a design the user can review, an exact list of pieces (including which owned set supplies them), and illustrated assembly instructions.

The initial surface is a website. The primary later surface is an AI agent in iMessage using **Photon Spectrum**, the framework required by the HackNC sponsor track. Use **Gemini** for multimodal interpretation and revisions. Evaluate **ElevenLabs** for incoming/outgoing voice memos after the main flow is working.

## User experience

Models must support meaningful complexity and genuine three-dimensional structure, including depth, details on several faces, and ultimately internal structure and subassemblies. Flat pixel-art reliefs are not a sufficient demonstration. Use them only when a user explicitly requests a flat design. Validate representative models from several viewing angles and with actual assembly checks. Avoid inflated claims, generic marketing copy, and unnecessary implementation work.

1. User describes an object or shares an image. They may instead identify existing sets/loose bricks and ask for a new design using them.
2. The system interprets the idea and builds a structured brick model. The user reviews the actual design and can request changes in a loop.
3. In iMessage, the feedback preview must convey 3D shape. Prefer native user-controlled model viewing if supported; otherwise a rotating animation, with a clear distinction between interactive rotation and prerecorded motion. Evaluate what useful previews, model files, links, and follow-up actions the agent should send.
4. Freeze the accepted revision, allocate real parts/colors/quantities to the user's source sets where available, and disclose any missing pieces.
5. Generate a LEGO-style illustrated manual with a Frutiger Aero treatment. All models, diagrams, instructions, and piece counts must remain consistent.

## Engineering process

- Research alternatives before adopting the supplied LegoGPT fork or proposed workflow.
- Use delegated research/implementation where helpful; maintain shared contracts and independently review the result.
- Work in a Git repository with a clean baseline and reviewable feature branch. Keep stage checklists, verification evidence, and commits that teammates can inspect.
- Publish the collaboration repository to GitHub and invite teammates when their usernames are supplied.
- Be precise about implemented, locally verified, configured, live-tested, physically tested, and future behavior.

## Later stages retained

Native/interactive iMessage model viewing, augmented reality, a richer step-by-step 3D assembly experience, cooperative multi-person building, and ElevenLabs voice notes. Native viewing is being investigated during the Photon work; actual device testing remains required.

## Names

**Large Lego Model** is the user-chosen architecture name and must be used in technical documentation. **Sprout** was an assistant-chosen temporary product/repository name; product branding remains provisional.
