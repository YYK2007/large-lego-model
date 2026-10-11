# General generation acceptance

We want to model unfamiliar subjects across nature, architecture, natural and manmade wonders, and everyday objects. A named subject must never select a hand-authored construction template. Evaluation prompts and frozen regressions aren't production templates.

Complexity follows the subject. A simple object shouldn't gain unnecessary structure. An intricate object needs its identifying sections, proportions, openings, contours, asymmetry and repeated details. Prefer fewer pieces when the checked shape and assessed features are preserved; piece count alone doesn't measure quality. User limits and confirmed owned inventory remain binding.

## Evaluate unfamiliar subjects

Run varied prompts through the same generator, without construction hints:

```sh
node --import tsx scripts/check-generation.ts RUN apple sunflower turtle matterhorn wall opera
```

This command makes paid Gemini calls using the local environment. It runs subjects sequentially with the default Detailed path and visual review enabled, sharing a five-minute budget across research, planning and checks. It calls the generator directly, so it doesn't test the browser queue, Photon transport or the demo's disabled reviewer.

Evidence goes into ignored `output/generation-evaluation/RUN/`: progress, provider plan/patch text, token usage, checked models or failures, reference provenance, AI comparisons and opposite model views. Successful models are also saved for opening in the studio. Request headers and credentials aren't recorded.

`elephant`, `rose` and `taj` reproduce earlier difficult requests. `windmill`, `mushroom`, `lighthouse`, `bridge` and `butterfly` add other forms. Keep these regression cases, and add unfamiliar subjects rather than tuning production rules to this list.

For each result, inspect the actual pixels and the website:

- Is it the right subject? Do the references show distinct views rather than edits of one picture? Check foreground objects and look-alikes.
- Does the model preserve physical height, width and depth, silhouette, and the arrangement and count of defining features?
- Are important spaces open? Do organic parts retain distinct connected surfaces rather than merge into a solid mass?
- Is the detail appropriate to the subject and viewing scale? Inspect front, side, back and above.
- Are the parts real, the connections legal and the placement sequence usable? Do exports reproduce the same placements?

Record failures as well as successes. A connected model can still look wrong, and an AI `matched` verdict still needs human inspection. One run per prompt is a development check, not a reliable success rate. Older measurements and failed experiments belong in [verification history](archive/verification-history.md); [verification](VERIFICATION.md) records the current evidence.

## Current generation flow

New website and iMessage requests use Detailed. Quick is archived behind `QUICK_MODE_ENABLED=false` in `shared/generation-job.ts`; its implementation and tests remain for old jobs and explicit API callers.

Reference research seeks front, side and top or aerial photographs. Detailed requests up to 4, 6 or 12 images according to estimated complexity, with deduplication and bounded network work. Missing views are disclosed. Search labels don't verify a camera angle or subject identity; the model must inspect the selected pixels.

An uploaded photo stays primary. Identifiable real subjects can receive supplemental public references; private or invented subjects can continue from the upload alone. Source excerpts and measurements retain their links, units, qualifiers and hashes. Image estimates remain separate from source-reported facts. Optional external 3D reference renders are labeled separately from photographs.

The reference brief establishes distinguishing features before construction. Those targets stay fixed through repairs and concept selection. For a new Detailed build with visual review enabled, the planner makes one or two coarse concepts and compares their actual renders before choosing a construction approach. These shape studies aren't LEGO assemblies.

Construction uses real admitted parts. Detailed can plan connected local sections and search their declared translation ranges for stud mates. The compiler checks the combined geometry and per-piece placement sequence. This doesn't establish that a whole rigid subassembly can be inserted at once.

With visual review enabled, Gemini compares the compiled model renders against the request and reference pixels. The review covers subject identity and every defining feature as present, incorrect, missing or uncertain. Missing review coverage can't count as a match. Repairs receive the actual model views, the retained plan and specific differences.

The retained reviewed draft has fewer unresolved identity/features, then fewer issues. At equal feature and identity statuses, fewer pieces can break a tie; otherwise an exact tie keeps the earlier draft. This is an AI comparison, not an independently measured likeness score.

### The iMessage demo

`PHOTON_VISUAL_REVIEW_ENABLED=false` is the listener's default. Each submitted job snapshots that setting. It skips the separate concept study and post-build visual critic, while retaining reference research, independent requirements, catalog discovery, construction checks and structural repairs.

The first complete geometry-valid draft is saved before preview work and returned with `research.comparison.status='not-reviewed'`. It waits for user feedback or approval. No automatic visual pass is claimed. Setting the listener flag to `true` restores the review path for new jobs; the website and evaluation script use the default enabled reviewer.

For this demo path, the first construction call gets at most 90 seconds and later full plans at most 60 seconds; patches get at most 45 seconds. These calls share the overall deadline and reserve time for repair. A planning timeout can trigger a simpler whole-model attempt if time remains. Failed or partial geometry never becomes a successful draft.

### Targeted revisions

A revision starts from the selected saved placements represented as explicit parts, with their exact part IDs, colors, positions and orientations. Gemini edits that plan through JSON patches. It receives the original request, the new feedback and applicable reference and inventory context.

Replacing or removing the entire parts array is rejected. Individual part changes, removals and additions are allowed, so the user can request a broad recolor or a local shape change. The unchanged snapshot is exact; whether a proposed edit leaves every unrelated feature alone still needs review.

Revisions skip the concept study and don't silently switch to a fresh whole-model plan after failure. Invalid patches are atomic. If the edit fails, the earlier checked revision remains available. Each successful revised preview needs its own approval before Photon delivers final files.

## Deadlines and saved work

Detailed shares one 300-second generation budget across research, planning, compilation and review. It has a hard ceiling of 12 construction attempts; bounded calls start with 10 when references exist and 8 without them, and may extend on progress. Attempts can stop earlier after repeated lack of progress or two unhelpful visual revisions. A bounded new-build call can try up to three construction approaches; continuous jobs and targeted revisions don't use that full-replan mechanism.

The archived Quick path has a 150-second generator budget, or 135 seconds for `stopWhenMatched` delivery requests, and at most six construction attempts. Neither path renews its deadline on each retry. Queue wait is separate. The job manager also enforces a wall-clock worker limit, including CPU work: 310 seconds for Detailed and 150 or 160 seconds for Quick, depending on the delivery policy.

Browser and Photon requests use persisted jobs with up to two active workers. Reloading the page doesn't abandon the job. Stop terminates its worker; a server restart marks unfinished jobs interrupted and requires explicit resumption. It never automatically repeats a paid call after restart.

Checked drafts are saved separately from unfinished attempt evidence. A later failure doesn't erase a saved draft, but a saved draft alone doesn't mean the job succeeded or the visual review passed. At the demo's worker deadline, an already saved checked draft can be returned; without one, the job fails. Unfinished attempts stay private in iMessage.

## Geometry and packing

Boxes, cutouts, repeated features and ellipse, rectangle or polygon profiles describe occupied cells. Polygon profiles can be concave or asymmetric, with shifting and tapered sections and optional walls. Their normalized outline stays fixed across sections; use connected profiles when the contour itself changes.

Explicit `partPlacement: 'replace-volume'` lets an admitted detail part replace filler within its envelope. Fixed parts still can't overlap each other. Stock, colors, collisions and connection checks remain active; plans without that flag retain strict behavior.

Packing compares checked tilings while preserving intended cells and colors. Repairs use exact geometry paths and connection failures, rather than deleting difficult regions. Piece reduction must preserve the shape and final assembly checks.

Upright parts can attach from below when their connection graph reaches the table and the planner finds a clear entry and seating path. Bounded alternate orders can prioritize hanging parts and their anchors before another course seals the entry. The website, PDF and CAD steps follow the checked sequence. These checks don't certify mechanical strength, hinges or arbitrary part orientations.

The renderer keeps canonical geometry and depth ordering. Large-build rendering splits cyclic occlusion groups where needed; it doesn't substitute a separately generated beauty image. Export and visual comparisons must use the same saved placements.

## Full part catalog requirement

The accepted destination is any LEGO piece purchasable individually, including botanical elements, curved shells, wedges, clips, bars, hinges, brackets, wheels, and unusual colors. The current upright-stud subset doesn't meet that entire requirement. Search results and decorative meshes still need geometry, connection and assembly checks before they can become usable parts.

The catalog implementation and its remaining extensions must connect these records end to end:

1. Record the canonical Rebrickable ID, exact mold/print variant, produced color IDs and external-system mappings. Use an indexed bulk catalog for discovery; Rebrickable directs high-volume users to its [downloads](https://rebrickable.com/api/). Its [API](https://rebrickable.com/api/v3/docs/) can resolve selected records, but catalog membership is not proof of current seller stock.
2. Pin geometry bundles containing each part and all LDraw subfiles, transforms, printed colors/materials, dimensions, attribution and dependency hashes. [LDraw's part format](https://www.ldraw.org/article/218.html) supplies geometry; it does not by itself establish legal connections. Preserve each dependency's [header/license](https://www.ldraw.org/article/398.html), rather than assuming one license for every file.
3. Record connector frames, mating families, insertion direction, permitted orientations, clearance and any joint degrees of freedom. General placement needs translation and quaternion orientation in LDU, with an adapter for existing upright stud/plate placements. [LDCad snap metadata](https://www.melkert.net/LDCad/tech/meta) and its [official shadow library](https://github.com/RolandMelkert/LDCadShadowLibrary) already supply metadata for the admitted upright subset. The shadow library is CC BY-SA 4.0 and covers a subset; unknown connection data must never be guessed from a bounding box. Flexible parts and articulated joints also need configuration rules.
4. Keep purchase evidence for the exact part, color and quantity, with seller/location constraints where applicable and a checked-at time. Keep catalog links separate from verified availability and price. Nothing is purchased automatically.
5. Retain the resolved geometry/connector version with every selected part in the canonical build snapshot so a future catalog update cannot alter an accepted design, instruction sequence, BOM, or USDZ.

The planner must search and select real parts through this data path. Admission must validate the actual chosen geometry and mating connectors; rendering/export must load the same resolved assets. Unsupported connectors should have an explicit status until implemented. Do not relabel searchable records as usable parts. Imported parts currently need verified upright studs/undersides, four-way yaw and mapped opaque colors; sideways/bar/hinge connections and arbitrary orientations remain unsupported.

The first catalog acceptance test is importing a previously unseen purchasable part in an implemented connector family **without a source-code change**, checking its actual mating and insertion path, and matching its preview, instructions, export and exact part/color BOM. Track searchable, geometry-resolved, connector-verified, assembly-supported and currently available status separately. Another hand-picked list does not satisfy this test.

See [verification](VERIFICATION.md) for measured outcomes and remaining acceptance work.

### Part choice and recovery

Detailed and the archived Quick path both start with the verified built-in and cached specialty catalog. The planner receives each part's actual underside and top connection positions. It can choose curved, shaped or botanical pieces for visible surfaces, subject to produced colors and supported connections.

Detailed can discover more parts when Rebrickable is configured. Quick only reuses the trusted cache. For a new build, two construction failures can trigger a simpler rectangular brick, plate and tile palette; a failed component plan can then become one connected whole-model plan. This recovery keeps the reference requirements and inventory limits. Targeted revisions keep the saved placements and don't take that rebuild path.

A resolved part can contain connector types the assembly engine doesn't support. Those connectors remain unavailable even when their physical shape is rendered. See [catalog admission](DYNAMIC-CATALOG.md) for the implemented boundary.
