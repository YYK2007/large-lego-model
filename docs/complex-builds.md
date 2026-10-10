# Complex, genuinely three-dimensional builds

Research and proposed next increment, checked 2026-10-10. **Historical proposal with checkpoint 03 progress:** the piece cap is removed; plates/slopes, repeated-feature plans, and a curated 1,345-piece castle are implemented and checked. The live complex Gemini request produced no plan because the project's quota was exhausted. No generated model has been physically built. The original research below records the broader directions that remain to be validated; see `VERIFICATION.md` for current evidence.

## The immediate correction

The current seven-brick engine can represent occupied volume in all three dimensions. Plates, slopes, and a larger budget are not prerequisites for a thick rocket body, a rounded animal torso, or a building with depth. Its current sample sculptures and appearance checks do not establish that quality. Increasing 160 to 1,000 without changing concept planning and evaluation could simply produce a larger flat sculpture.

The next deliverable should be a compact volumetric model that is recognizable from multiple directions, followed by a controlled catalog expansion. Keep the existing website, inventory ledger, immutable export snapshots, and Photon adapter. Replace the generation/validation representation beneath them in stages; do not start a second product.

## Recommended sequence

| Increment | Concrete change | Demonstration required before claiming it works |
| --- | --- | --- |
| A: actual volume | Ask for named three-dimensional features and their thickness; compile their full volume. Add deterministic volume checks and front/side/back/top renders to the repair loop. Existing rectangular bricks are sufficient. | A thick-bodied rocket, animal, and small building, each recognizable from orthogonal views; the display base must not be what passes the depth test. |
| B: plates and upright slopes | Introduce plate-height coordinates, a vetted geometry/connector catalog, real part meshes, and part-specific collision masks. Slopes initially remain mounted upright. | A roof with slope surfaces, mixed plate/brick offsets, exact BOM, and independently reproducible instructions. |
| C: side-mounted and angled features | Add a small selection of brackets or side-stud bricks and one verified hinge family. Placement must solve connector alignment rather than accept an arbitrary rotation. | A side-mounted panel and a hinged feature with valid mating parts, angle/range checks, clearance, and a build sequence. |
| D: repeated subassemblies and larger budgets | Add assembly hierarchy, repeated instances, attachment operations, step dependency planning, and isolated background jobs. | Two repeated modules assembled separately and attached to a main body; all copies counted and every attachment shown. Promote the 500/1,000-piece tiers only after the performance gates below. |

Do A before B. A slope's angled **surface** does not require rotating the whole part. Actual angled **placement** is a later connector/hinge problem. Clips, axles, ball joints, flexible parts, and arbitrary Technic mechanisms are not implied by adding one hinge family.

## What the available tools actually supply

| Source | Verified capability | Appropriate role and limitation |
| --- | --- | --- |
| [LDraw format](https://www.ldraw.org/article/218.html) and [MPD specification](https://www.ldraw.org/article/47.html) | Part references carry a translation and 3x3 transformation; MPD embeds named subfiles that can reference one another. Scale is 20 LDU per stud, 24 per brick, and 8 per plate. LDraw uses negative Y upward. | Canonical geometry interchange and hierarchy export. Geometry alone does not prove a legal connection, structural strength, or assembly order. |
| [LDCad snapping metadata](https://www.melkert.net/LDCad/tech/meta) | Metadata describes connector frames and families including cylinder profiles, clips, fingers/hinges, and generic mating groups. | A concrete reference for our connector schema. Its [editing guide](https://www.melkert.net/LDCad/docs/basicEdit) explicitly notes that some parts lack snapping data. Unknown coverage must fail closed for automated assembly. |
| [LTRON v1](https://github.com/aaronwalsman/ltron/tree/v1.0.0) | A research assembly environment built on LDraw, OMR, and LDCad data. Its README identifies v1 as the stable research branch and describes Ubuntu/OpenGL requirements and a roughly 3 GB asset install; master is described as unstable with non-public dependencies. | Useful offline reference and experiment, not a drop-in browser backend. [Its license manifest](https://github.com/aaronwalsman/ltron/blob/v1.0.0/LICENSE) separates MIT code from third-party assets and older LDCad terms. Verify the exact current shadow-data license before reuse; do not infer all assets are MIT. |
| [BrickGPT](https://github.com/AvaLovelace1/BrickGPT) | Text-to-brick research code with a physics analysis path requiring Gurobi; the documented alternative without it is a weaker connectivity method. Gated base-model access is required. | A comparative generator/physics experiment for its supported brick family, not automatic support for every LDraw part. Preserve explicit success/failure and validate outputs independently. |
| [BrickGPT mesh2brick](https://github.com/AvaLovelace1/BrickGPT/blob/main/src/mesh2brick/README.md) | Converts meshes such as OBJ/GLB into brick JSON, text, or LDraw. Its documented JSON uses brick type, XYZ, and a two-state orientation. | A candidate volume-to-rectangular-brick baseline if our shape planner fails. A mesh pipeline still needs inventory constraints, connector checks, support, and instruction planning; it does not by itself solve plates, hinges, or arbitrary orientation. |
| BrickLink Studio [connectivity](https://studiohelp.bricklink.com/hc/en-us/articles/6501624386071-Connectivity-check), [stability](https://studiohelp.bricklink.com/hc/en-us/articles/6501498505111-Stability-check), and [export](https://studiohelp.bricklink.com/hc/en-us/articles/6502197862679-Exporting-to-other-formats) tools | Desktop checks expose disconnected groups and stability cautions; Studio says its stability test is conservative. LDraw/MPD export preserves submodels. | Independent desktop review and editable interchange. No supported headless Studio generation/validation API was established in this research. Do not make an undocumented Studio service or GUI automation the production dependency. |

For the first catalog expansion, author and test connector records for a small supported palette rather than importing a giant partially understood database. Add ordinary plates and simple slopes first, then the exact bracket/hinge pair needed for a demonstrator. Every added part needs its exact part/color mapping, licensed asset dependencies, collision representation, connector frames, and positive/negative connection fixtures before the generator may choose it. A placeholder box is not acceptable geometry for a slope in the final preview or manual.

A concrete candidate palette for B is the [1x2 plate (`3023b.dat`)](https://library.ldraw.org/library/official/parts/3023b.dat), [2x2 plate (`3022.dat`)](https://library.ldraw.org/library/official/parts/3022.dat), [2x4 plate (`3020.dat`)](https://library.ldraw.org/library/official/parts/3020.dat), and [45-degree 2x2 slope (`3039.dat`)](https://library.ldraw.org/library/official/parts/3039.dat). For C, evaluate the [1x1 side-stud brick (`87087.dat`)](https://library.ldraw.org/library/official/parts/87087.dat) and the hinge [base (`3937.dat`)](https://library.ldraw.org/library/official/parts/3937.dat)/[top (`3938.dat`)](https://library.ldraw.org/library/official/parts/3938.dat) pair. These verified geometry headers establish candidate identities, not tested mating frames, clearance, strength, or stocked colors. The 1x2 plate header explicitly maps Rebrickable `3023` to LDraw `3023b`; this is why filenames must come from an explicit versioned mapping rather than appending `.dat` to inventory IDs.

## A model contract that can support this

Version the existing format instead of silently changing the meaning of `z`. V1's Z is a full-brick bottom layer; V2 must accommodate 8-LDU plates, half-stud offsets, and later hinge transforms.

- **Part definition:** exact inventory ID, LDraw filename and asset hash, geometry-origin adapter, local collision shapes, connector records, available colors, and measured or unknown mass/strength data. Part definition and geometry asset versions are frozen with the design.
- **Part instance:** stable ID, part/color IDs, parent assembly ID, local rigid transform, and allocated inventory source. Store translations in LDU and an orthonormal rotation matrix or quaternion. Reject scaling, shear, and reflections of physical parts. Convert axis conventions exactly once at the renderer/export boundary.
- **Connector:** local frame, compatible family/profile, mating direction, allowed rotation/translation degrees of freedom, and engagement depth. A stud/underside match differs from a hinge, clip/bar, or axle/hole match. Matching connector types is necessary but insufficient without pose and interference checks.
- **Connection:** two specific instance/connector IDs, their verified relative pose, engagement state, and constraint kind. A physics result also records the parameter set and solver version; unknown strength remains unknown.
- **Assembly definition and instance:** immutable local part instances, child assembly references, and a parent transform. Reusing a definition twice creates two physical instances with distinct expanded IDs and twice the material consumption.
- **Instruction operation:** `addPart`, `buildSubassembly`, `attachSubassembly`, or `rotateAssembly`; consumed instance IDs, prerequisites, attachment connector IDs, insertion path, and camera/callout data. Store presentation transforms separately from true model transforms.

The V1 adapter can convert existing bricks into V2 rigid transforms without changing their BOM. Start V2 with the 24 orthogonal rigid orientations and known connector-aligned offsets. General hinge angles are permitted only when a supported joint supplies the angle and allowed range. Numerical tolerances must come from a curated mating-fixture test set, not a global "shrink everything until it fits" rule.

## Planning and validation remain separate

Have the model propose a **feature tree**: body, nose, cockpit, wings, roof, wheel housings, and so on, with dimensions and intended attachment regions. Require real thickness for the primary body. A small set of deterministic solid primitives can express an ellipsoid, cylinder, taper, or box combination more naturally than asking an LLM for 1,000 individual transforms. Expose simplifications and incomplete source-image information in the preview.

The compiler should optimize discrete candidate placements for shape fit, inventory, seams, connections, and assembly access. Keep a bounded greedy/repair path for simple cases. If that demonstrably fails useful shapes, [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver) is a credible offline/worker option for integer candidate-selection constraints; solver `UNKNOWN` or timeout is not a successful design. It is a packing/constraint tool, not a LEGO force solver.

Validate four distinct properties and return separate evidence:

1. **Geometric validity:** no illegal material intersections, valid rigid transforms, exact part availability, and legal connector engagement. Use broad-phase spatial hashing/AABBs followed by part-specific narrow-phase checks. Raw bounding-box overlap cannot distinguish a valid inserted stud from an actual collision or handle a slope's empty space. [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) supplies accelerated spatial queries; connector-aware collision tolerances and verified collision solids still belong to us.
2. **Connection graph:** the intended final model is connected through legal mates. Evaluate joint degrees of freedom, not just whether nodes are reachable. A hinged arm can belong to the graph and still swing freely or collapse under load.
3. **Structural plausibility:** check support contacts and center of mass, then force/torque limits for connection families with measured parameters. The [BrickGPT paper](https://arxiv.org/html/2505.05469v1) explicitly models static force/torque equilibrium and measured friction capacity, under a baseplate assumption. Its assembly planning also checks intermediate states. Our freestanding models cannot inherit a fixed-base result without modeling the actual base included in the BOM. Extending that solver to plates, slopes, brackets, or hinges requires new geometry, mass, and connection-force assumptions plus validation.
4. **Assemblability:** there is a collision-free insertion path and a usable order for parts/subassemblies. A completed connection graph can still contain a captive part that could never be inserted after the enclosing shell was built. A valid final model is not proof that every partial assembly can stand by itself.

[Rapier's JavaScript joint system](https://rapier.rs/docs/user_guides/javascript/joints/) can represent fixed and revolute constraints and other degrees of freedom. It is useful for mechanism previews or an explicitly approximate physical experiment. Welding every stud connection into an unbreakable fixed joint would manufacture apparent stability; Rapier does not supply calibrated LEGO clutch parameters. Do not label either generic rigid-body simulation or a connected graph as physically certified.

## Instructions for multiple subassemblies

Replace `buildSteps = group by Z` for V2. That function remains valid only for the current upright palette.

Build an assembly dependency DAG. Generate candidate operations by reversing removable parts/subassemblies, testing the reverse insertion sweep and the support of intermediate states. At first, restrict extraction to verified connector directions and known joint motions. If there is no acceptable order, repair the design or decline the build; do not export a plausible-looking but impossible instruction sequence.

Each subassembly has a local frame, its own build sequence, and a join step in the parent. A repeated module can have one instruction callout with a precise `build 2` quantity, but the inventory ledger must reserve both copies. The joining page needs the finished subassembly, oriented matching connector faces, an insertion arrow, relevant existing assembly context, and a flip/rotation cue when needed. Never count a temporary exploded-view transform as a physical placement.

Studio's [Instruction Maker documentation](https://studiohelp.bricklink.com/hc/en-us/categories/360002182253) establishes useful output conventions: linked submodels, callouts, orientation/camera setup, new-part highlighting, offsets, flip indicators, and BOMs. Preserve hierarchy and `0 STEP` boundaries in MPD, while retaining our richer operation DAG in JSON. Review an exported MPD in an independent editor. Render the PDF from the exact frozen revision and verify that replaying all operations reconstructs the same part instances, transforms, and BOM. Unknown or hand-supported intermediate stability must be explicit, never silently passed.

## Acceptance: genuine depth, not a base that passes a bounding-box check

The following are proposed project tests, not external standards or already-passing results. Calibrate numeric appearance thresholds against a labeled set of good models and deliberately flat negatives before making them automatic rejection rules.

- Separate the intended subject from any display plinth or temporary support. Keep every physical support in the BOM, but exclude it from subject-shape metrics. Cross-check the proposed base/subject tags against geometry and the brief; do not trust an LLM to mark a broad base as the subject to pass the test.
- For briefs requesting a volumetric body, require the **subject itself** to span at least 4 studs in both horizontal axes. A 4x4 footprint alone is insufficient: a diagonal wall, crossed thin walls, or an otherwise flat sign on a broad platform must be negative fixtures.
- Inspect depth distribution through the subject's height and principal-axis thickness. A provisional diagnostic is the ratio of the smallest to middle covariance eigenvalues of occupied subject cells; values near zero expose thin sheets even when rotated diagonally. Do not make one ratio the entire decision: hollow cabins, wings, and intentional thin details require semantic and view-based checks.
- Generate eight evenly spaced azimuth renders, plus top and orthogonal side views, from the accepted part geometry at fixed scale and lighting. For the initial rocket/animal/building evaluation set, two independent human reviewers should identify the intended object category without reading its title in front, side, and rear views. A model judge can critique and request repairs, but is not sole acceptance evidence.
- Specify category-specific features before generation: e.g. a rocket has a thick central body and fin arrangement around it; a house has actual front/side/back walls and an enclosing roof; an animal has a torso with depth and anatomically placed appendages. A large empty box can pass thickness checks but fail the brief.
- Run at least three fresh generations per selected brief and record all failures, not just the best render. Include negatives for a 1-stud-thick flower on a broad base, a rotated diagonal sheet, unsupported wings, an inaccessible trapped part, and a disconnected but visually touching module.
- Hand-build at least one accepted model per new connector family from its exported instructions. Record where the instructions or joints failed and rerun the same frozen revision after repair. This is evidence about those builds, not universal certification.

If a prompt intentionally requests a sign, mosaic, or thin decorative panel, represent that honestly as a different build mode. Do not use that legitimate exception to satisfy a request for a complex three-dimensional object.

## Piece budgets are measured operating tiers

The current 160-brick limit is an implementation bound, not a physical limit or evidence that 160 bricks are necessary for volume. Keep three explicit target tiers:

| Tier | Intended role | Admission gate |
| --- | --- | --- |
| Up to 160 | Fast concept validation and the current live generator test | Multi-view quality and accurate exports first; do not lower the user's requested complexity silently. |
| Up to 500 | Detailed single assemblies or several repeated modules | Spatially indexed checking, geometry instancing, asynchronous manual rendering, and the full 500-piece test suite must pass on the declared demo machine. |
| Up to 1,000 | Larger hierarchical models | Separate worker/resource budgets, incremental validation, cached step renders, reliable cancellation, and 1,000-piece tests including deep hierarchy and repeated modules. Experimental until measured. |

Do not simply change a validator constant. Current pairwise validation examines 12,720 pairs at 160 pieces, 124,750 at 500, and 499,500 at 1,000. Real meshes, connector matching, and many intermediate instruction states make each pair more expensive. The current renderer also creates per-piece/per-stud objects, and cumulative PDF pages repeatedly draw prior pieces. Profile these costs before expanding the default.

Use shared immutable part geometry and batched/instanced transforms; maintain instance IDs for highlighting and selection. Recompute only affected collision neighborhoods, connector edges, and assembly dependencies on edits. Run generation/packing/physics/PDF jobs outside the request event loop with bounded queues and cancellation. Cache a rendered step by revision hash, completed-instance set, view, and style. Freeze catalog and inventory versions with that revision.

Proposed release targets, **not current measurements**: warmed interactive orbit at p95 frame time below 33 ms on the named demo laptop; geometric/connector validation below 1 second for 500 pieces and 2 seconds for 1,000; an asynchronous manual within 60/120 seconds respectively without blocking unrelated API requests. Measure peak memory, cold asset load, and output size as well. If a tier misses a target, report its measured limitation or keep it experimental. A force solver gets its own timeout and may return inconclusive; it must not borrow the geometric check's pass label.

Performance fixtures should include dense solid bodies, hollow shells, many small parts, many distinct part/color combinations, repeated subassemblies, and rejection cases. The same fixtures must prove exact inventory accounting, no missing/duplicate instruction instances, stable snapshot exports, and independently loadable MPDs. A tier is released only when both correctness and measured usability pass.

## Next action

Use the real Gemini key to evaluate the current pipeline on an explicitly volumetric brief and preserve the full result and ten-view contact sheet. Repair the representation/evaluation if it generates a planar object. Then implement the smallest complete V2 slice: plate units, a small plate/slope catalog with authored connector fixtures, actual meshes, and one physically reviewed model with a repeated subassembly. Run larger budget experiments after that slice is correct. Neither research availability nor this document demonstrates that those stages are already implemented.

## Next assembly requirement: hanging pieces on ordinary upright studs

**Proposed, not implemented, October 10 checkpoint.** Keep the current strict admission rule until ordering, clearance checks, viewer guidance, and manual instructions change together. Adding longer parts or accepting a connected final graph does not complete this work. The current 36-part palette can geometrically connect an upright piece to an underside above it using its top studs; no hinge, sideways stud, inverted part, or invented connector is needed. Whether that connection can carry a hanging load remains physically unverified.

The recorded `output/complex-reliability/elephant-2/plan.json` exposes the limitation. Its trunk begins above the base at z24, tusk tips at z45, and tail tuft at z51. An offline compilation at this checkpoint produced 3,518 pieces: 131 had no stud below, while 130 of those had a matching connection above. The final graph still had 64 disconnected components, so this **is not** a valid model waiting for one rule to be removed. It combines a real restriction of our assembly subset with disconnected plan geometry and packing failures. These counts describe that recorded plan and compiler checkpoint; later packing changes can change them without changing the intended occupied volume.

`validateDesign` already builds an undirected graph from actual matching stud/underside sites. Its separate requirement for a lower connection on every elevated piece implies eventual ground support. If that requirement is replaced, explicitly require both at least one z0 piece and a single connected graph containing every piece and the grounded pieces. Otherwise a completely floating but internally connected cluster could pass. Side contact and table contact must still create no stud-connection edges.

The smallest useful assembly extension is a deterministic sequence of individually placed upright pieces:

1. Seed the sequence with the existing ground pieces in stable z/y/x/ID order. They can remain loose on the table until later pieces join them, as current instructions explain.
2. Consider only pieces with a real connector to an already placed piece. Allow attachment from above to a lower stud, or from below to an upper receiver. Prefer the existing order where it remains valid, then consider newly reachable hanging pieces before closing access around them.
3. Check a conservative insertion path against the **already placed** assembly, including the part body envelope and exposed stud volumes. An approach from above must have a clear downward path. An approach from below can use a straight lateral entry from one of ±X/±Y at a disengaged height, followed by an upward seating stroke. Derive the disengagement distance from verified connector geometry; one plate is a candidate clearance, not a substitute for that check. Reject approaches through the table plane.
4. Exempt only a matching stud/receiver during terminal seating. No exemption permits an unrelated stud or body to pass through material. An infinite upward ray would unnecessarily reject a hanging appendage over a wide base; checking only the short upward stroke would incorrectly allow teleporting into a sealed cavity. The lateral approach and seating stroke both need a check.
5. Record the actual direction and waypoints with each placement. If no supported sequence is found, decline it with “No assembly path was found in the supported placement directions.” Do not call every such rejection physically impossible. A greedy sequence can miss a valid alternative order or a solution using separate subassemblies, rotations, or hand manipulation; those remain outside this narrow increment.

The check proves only this conservative geometric path under the catalog assumptions. It does not simulate hand access, friction, clutch strength, bending, tipping, or whether intermediate states stay upright without being held. Retain those physical limitations in the output.

| File or surface | Required coordinated change |
| --- | --- |
| New `shared/assembly.ts` | Pure connector-frontier ordering and swept-path result, with deterministic placement IDs, direction, and waypoints; spatial indexing for large builds |
| `shared/model.ts` | Keep schema/catalog/collision checks; replace the lower-only rule only after grounded connectivity and assembly-path checks exist; make `buildSteps` use that same order |
| `buildSteps` contract | Retain `index`, `z`, `bricks`, and `instruction`; add per-piece placement metadata. Batch only compatible consecutive placements, preserving exact sequence and coordinates |
| `src/AssemblyView.tsx` | Show the active piece's approach and attachment direction; invalidate old saved step indices by changing the progress-storage version |
| `src/BrickScene.tsx` | Stop showing every piece dropping from above; animate or clearly indicate the checked path, including upward attachment |
| `shared/brick-geometry.ts` | Generalize the existing vertical offset only if the viewer displays lateral waypoints; final transforms remain unchanged |
| `server/manual-render.ts` | Print the same sequence and attachment direction, including below-attachment callouts; diagrams and numbered placements must not independently sort by height |
| LDraw export | Continue consuming `buildSteps` so `0 STEP` follows the same assembly sequence; preserve all part IDs, colors, final poses, and BOM |
| Compiler diagnostics and planner prompt | Distinguish a connected hanging piece from a disconnected component. Do not claim every missing lower stud is impossible, or silently fill the appendage's empty space |

Acceptance cases before enabling the new rule:

- A grounded overhang with a connected hanging chain passes; the anchor is placed first and hanging pieces attach upward in a checked order.
- A connected cluster with no ground path fails. Side-only contact and a supposed connection onto a studless tile fail.
- A sealed-cavity fixture fails even though its final connector graph is connected; a piece cannot appear inside it without a permitted insertion path.
- An overhead obstruction blocks downward insertion. A counterpart with a clear lateral approach and upward seating path succeeds; closing that corridor causes rejection.
- A nonmatching stud intersecting a swept body rejects. Matched terminal seating succeeds without a blanket collision exemption.
- The existing frozen samples retain exact instance IDs, final poses, BOMs, and their current order wherever that order passes the new checks. No fixture is silently rewritten to hide a path failure.
- The web active placement, PDF callout, and LDraw step reconstruct the same frozen model in the same order. An upward placement must not retain a downward animation or lower-stud instruction.
- A large connected fixture is timed with the new ordering/path checks; failures remain responsive and no path decision silently skips geometry because of model size.

No part of this proposed extension establishes the current rose, elephant, or Taj Mahal generation acceptance. Reference resemblance, complete valid geometry, and usable instructions still need separate recorded evidence.
