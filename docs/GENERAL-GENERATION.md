# General generation acceptance

The target is a system that can model unfamiliar subjects across nature, architecture, natural and manmade wonders, and everyday objects. A named subject must never select a hand-authored construction template. Evaluation prompts and frozen regressions are not production templates.

Complexity follows the subject. Preserve the form of a simple object without adding unnecessary structure. An intricate object needs its identifying sections, relative dimensions, negative spaces, contours, asymmetry, and repeated details. Piece count is reported, not optimized as a quality score. User-specified limits and confirmed owned inventory remain binding.

## Review procedure

Run a varied set through the same public generation service, with ordinary prompts and no construction hints:

```sh
node --import tsx scripts/check-generation.ts RUN apple sunflower turtle matterhorn wall opera
```

This makes paid Gemini calls using the local environment. The default detailed path has a five-minute budget per subject; Quick mode uses a 2.5-minute budget, excluding queue wait. It runs sequentially and writes local, ignored evidence under `output/generation-evaluation/RUN/`: progress, successful canonical models or exact failures, geometry checks, reference provenance, AI comparisons, and opposite model views. Successful models are saved for opening in the studio. Provider plan/patch text is retained locally for offline replay; request headers and credentials are never recorded. `elephant`, `rose`, and `taj` reproduce earlier difficult requests; `windmill`, `mushroom`, `lighthouse`, `bridge`, and `butterfly` provide additional evaluation forms; they supplement the unfamiliar cases rather than define the evaluation.

For each result, inspect the actual pixels and the website:

- Is it the right subject? Do the reference images show distinct views rather than edits of one picture? Check foreground objects and look-alikes.
- Does the model preserve physical height/width/depth, silhouette, and the arrangement and count of defining features?
- Are important spaces genuinely open? Do organic parts have distinct connected shapes rather than being absorbed into a block?
- Is detail appropriate to the subject and viewing scale? Inspect front, side, back, and above.
- Are the parts real, the connections legal, and the assembly order usable? Do exports reproduce the same placements?

Record failures as well as successes. A valid model is not automatically a recognizable model. An AI `matched` verdict needs human visual review. One run per prompt is a development check, not a statistically reliable success rate.

## Implemented general changes

- Replace the long, example-heavy planning instructions with one geometry contract and reference-driven feature/scale selection. Visual repair receives the actual compiled renders, not only a text criticism.
- Polygon profiles describe asymmetric and concave contours, with shifting/tapered sections and optional walls. The outline stays fixed in normalized coordinates across its sections; use connected profiles where the contour itself changes. They rasterize to the same real-part pipeline, preserve negative spaces and colors, and retain repair paths. Ellipses and rectangles remain available for simpler forms.
- Review each defining reference feature explicitly as present, incorrect, missing or uncertain. Missing or malformed coverage cannot become a match. Keep the reviewed draft with fewer unresolved features (then fewer issues), and repair its actual plan/renders; ties keep the earlier draft. This is an AI review, not an independently measured likeness score.
- For bounded requests, Quick mode uses a 2.5-minute deadline and four attempts, extending to six only on progress. Detailed mode has a five-minute deadline and up to three construction approaches. After two stalled repairs it changes the construction decomposition; after all approaches stall it stops. Its ten initial attempts may extend to twelve on improvement within the same deadline. A later failed review preserves the earlier reviewed draft with a warning.
- Explicit `partPlacement: 'replace-volume'` lets a real detail piece replace filler within its envelope. This is a declared modeling operation. Fixed pieces still cannot overlap each other; stock, color, collision, and connection checks remain in force. Old plans retain strict behavior.
- Expose exact geometry-edit paths and choose invalid candidate packings by connection count before piece count.
- Reduce repeated work when fitting rectangles and choosing seams, preserving the exact intended cells and colors rather than deleting difficult regions.
- Permit upright parts to attach from below only when the connection graph reaches the table and the planner finds a clear entry and seating path. The website, PDF, and CAD order follow that sequence. One bounded retry prioritizes neighboring hanging pieces before a lower course can seal their entry. This does not introduce sideways parts, hinges, or mechanical load certification.
- Retrieve distinct reference photos, retain source/credit/hash evidence, and handle provider rate limits without treating duplicate edits as extra views.
- Render large builds by splitting only genuinely cyclic occlusion groups. Retain all canonical pieces and exact depth dependencies; avoid sending unrelated shapes into expensive polygon splitting.

## Detailed generation stages

1. Identify the target and request 3, 6 or 12 distinct photographs according to its estimated complexity. Retrieve source excerpts and structured measurements with their units, qualifiers, links and hashes. A requested image count is not a claim that every view was found. The planner still must verify subject identity from pixels.
2. Generate one or two coarse geometric alternatives and render both from opposite views. Select the stronger silhouette and record remaining proportion/feature errors. The saved shape study is explicitly not a LEGO assembly.
3. Retrieve relevant real parts from the bulk catalog, then resolve geometry, produced colors and supported connector metadata. Keep verified partial results if discovery time expires. Pass only admitted parts to construction.
4. Build connected local sections and search only their explicitly allowed translation ranges for real stud mates. Preserve their geometry/colors; test collisions and the full per-piece assembly order. This does not certify insertion of a whole rigid subassembly.
5. Compare the actual exported-piece renders against references using the same defining feature list across candidates. Separate mechanical packing fixes from AI visual changes. Retain the best reviewed draft and stop stalled attempts.

The browser submits a persisted background job, so a page reload or disconnected request does not abandon generation. Two workers isolate expensive compilation from the API. Cancellation terminates the worker; a server restart marks unfinished jobs interrupted and requires explicit resumption, which can use the saved best draft. Milestones, shape studies and valid drafts are inspectable during generation. No paid call is automatically restarted after a server restart.

The live harness stores concept geometry/SVG, checkpoint drafts, provider token metadata, stage timing, final geometry and opposite renders. Input, output, thinking and cached token counts are separate; these are usage evidence, not a dollar-cost estimate.

## Full part catalog requirement

The accepted destination is any LEGO piece purchasable individually, including botanical elements, curved shells, wedges, clips, bars, hinges, brackets, wheels, and unusual colors. The dynamically imported upright-stud subset does **not** meet that entire requirement. Adding a search result or a decorative mesh alone would not meet it either.

The catalog implementation and its remaining extensions must connect these records end to end:

1. **Identity and produced colors:** canonical Rebrickable ID, exact mold/print variant, color IDs, and external-system mappings. Use an indexed bulk catalog for discovery; Rebrickable directs high-volume users to its [downloads](https://rebrickable.com/api/). Its [API](https://rebrickable.com/api/v3/docs/) can resolve selected records, but catalog membership is not proof of current seller stock.
2. **Geometry and provenance:** immutable bundles resolving each part and all LDraw subfiles, transforms, printed colors/materials, dimensions, attribution, and dependency hashes. [LDraw's part format](https://www.ldraw.org/article/218.html) supplies geometry; it does not by itself establish legal connections. Preserve each dependency's [header/license](https://www.ldraw.org/article/398.html), rather than assuming one license for every file.
3. **Connections and motion:** connector frames, mating families, insertion direction, permitted orientations, clearance, and any joint degrees of freedom. General placement needs translation and quaternion orientation in LDU, with an adapter for existing upright stud/plate placements. [LDCad snap metadata](https://www.melkert.net/LDCad/tech/meta) and its [official shadow library](https://github.com/RolandMelkert/LDCadShadowLibrary) are candidate inputs. The latter is CC BY-SA 4.0 and covers a subset; unknown connection data must never be guessed from a bounding box. Flexible parts and articulated joints also need configuration rules.
4. **Purchase evidence:** an exact part/color/quantity listing, seller/location constraints where applicable, and a checked-at time. Keep catalog links separate from verified availability and price. Nothing is purchased automatically.
5. **Canonical build snapshot:** retain the resolved geometry/connector version with every selected part so a future catalog update cannot alter an accepted design, instruction sequence, BOM, or USDZ.

The planner must search and select real parts through this data path. Admission must validate the actual chosen geometry and mating connectors; rendering/export must load the same resolved assets. Unsupported connectors should have an explicit status until implemented. Do not relabel searchable records as usable parts. Imported parts currently need verified upright studs/undersides, four-way yaw and mapped opaque colors; sideways/bar/hinge connections and arbitrary orientations remain unsupported.

The first catalog acceptance test is importing a previously unseen purchasable part in an implemented connector family **without a source-code change**, checking its actual mating and insertion path, and matching its preview, instructions, export and exact part/color BOM. Track searchable, geometry-resolved, connector-verified, assembly-supported and currently available status separately. Another hand-picked list does not satisfy this test.

See `VERIFICATION.md` for measured outcomes and remaining acceptance work.

### Part choice across modes

Quick and Detailed both start with the verified built-in and cached specialty catalog. The planner sees exact underside and top connection positions and should choose suitable curved or shaped parts for defining visible surfaces. Quick does not spend its delivery budget on additional catalog discovery; Detailed retains its bounded discovery pass. After repeated construction failures, the basic-parts recovery remains available without dropping likeness requirements. A resolved part can have unusable connector types: those remain excluded from assembly semantics, even when their physical shape is rendered.
