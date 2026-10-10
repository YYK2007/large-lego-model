# Plate and upright-slope increment

Research/design checkpoint, 2026-10-10. **Implemented in checkpoint 03.** The original plan below records the source-grounded migration decision. Production now includes 3022/3020 plates and 3039 slopes, V2 plate-height coordinates, four yaw orientations, accurate high-edge slope studs, matching geometry/exports, and legacy normalization without rewriting old snapshots. See `VERIFICATION.md` for checks and remaining limits. This increment does not finish the broader part catalog.

## Release decision

Add three catalog entries: **3022 plate 2 × 2, 3020 plate 2 × 4, and 3039 upright 45° slope 2 × 2**. Keep the existing seven bricks. The two plates allow small infill and bonds across longer seams; one slope isolates the first directional, partially studded part. This is enough to prove mixed heights, a real inclined surface, accurate connector coverage, four orientations, inventory allocation, and matching exports. It does not finish the broader catalog objective.

Release these entries together with the coordinate migration, geometry, validator, compiler, and instruction changes below. Merely adding entries to `PARTS` is unsafe: the current compiler would consume each as a full brick-height cuboid, the renderer would invent studs across the slope, and LDraw would place its offset origin incorrectly.

This slice supports upright parts on the standard stud grid, joined by downward insertion onto upward studs. No tilting, inversion, half-stud offset, sideways connection, insertion into internal cavities, or arbitrary wedge nesting. These are precise admissible-placement rules, not claims that other real connections are impossible.

## Source-checked parts

LDraw is a community CAD library, not a mechanical tolerance specification or LEGO certification. Its format defines 20 LDU stud pitch, 24 LDU brick body height, 8 LDU plate body height, and 4 LDU stud height. Negative native Y is up. Keep placement coordinates integral in **plate units**, but retain LDU precision for meshes and collision shapes; a slope surface and a stud are not quantized to 8 LDU. [LDraw specification](https://www.ldraw.org/article/218.html)

| Catalog part | LDraw asset | Body height | Top connections | Bottom connections |
| --- | --- | --- | --- | --- |
| 3022, plate 2 × 2 | `3022.dat` | 8 LDU / 1 plate | Four ordinary studs | Four grid-aligned stud-receiving sites |
| 3020, plate 2 × 4 | `3020.dat` | 8 LDU / 1 plate | Eight ordinary studs | Eight grid-aligned stud-receiving sites |
| 3039, slope 45° 2 × 2 | `3039.dat` | 24 LDU / 3 plates | **Two studs on the high, rear row only** | Four grid-aligned stud-receiving sites |

The official [3022 geometry](https://library.ldraw.org/library/official/parts/3022.dat) and [3020 geometry](https://library.ldraw.org/library/official/parts/3020.dat) contain the plate thickness and stud placements. Their undersides are independently described in the maintainer's [3022 snap data](https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/parts/3022.dat) and [3020 snap data](https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/parts/3020.dat). For this release, accept only the ordinary stud-to-underside pairs, even where a file describes another possible connection.

The [3039 part](https://library.ldraw.org/library/official/parts/3039.dat), its [body subpart](https://library.ldraw.org/library/official/parts/s/3039s01.dat), and the [two-stud primitive](https://library.ldraw.org/library/official/p/stug-1x2.dat) establish a noncentral native origin:

- Native body bounds: X = −20…20, Y = 0…24, Z = −30…10 LDU.
- Native top stud centers: (−10, 0, 0) and (10, 0, 0).
- Native front face rises from Y = 20 at Z = −30 to Y = 0 at Z = −10. The low nose is 4 LDU thick; it is **not** a triangular prism with a zero-height tip.

The maintainer's [3039 underside snap data](https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/parts/s/3039s01.dat) places two bottom receivers at each of native Z = 0 and Z = −20, all on Y = 24. The rear recess is 20 LDU deep; the front recess is 4 LDU deep. Ordinary 4-LDU studs can seat in either row. A longer rod or other connector must not be accepted by pretending both rows have the same clearance. The [normal stud snap declaration](https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/p/stud.dat) supplies its radius and length. These snap annotations describe mating geometry, not clutch strength.

Use exact canonical catalog IDs in inventory and an independent `ldrawId`. For example, 3023 is **not** part of this release, but the investigation found that [3023.dat](https://library.ldraw.org/library/official/parts/3023.dat) now redirects to [3023b.dat](https://library.ldraw.org/library/official/parts/3023b.dat), whose header identifies Rebrickable 3023. Assuming every external namespace and filename always match would create another avoidable migration bug. Do not collapse printed or mechanically different variants into these IDs.

Part/color validity also needs an explicit catalog field. Existing code accepts any of nine colors with any part; geometry files cannot establish that every combination was manufactured. Confirm release combinations against the inventory provider's part/color records, retain that evidence with the catalog, and reject unlisted pairs. An owned-set import is evidence for the specific returned pair, not a blanket alias rule. The demonstrator below specifies ordinary white/red/gray combinations, whose availability must be checked before a purchase-ready BOM is claimed.

## Coordinates, rotations, and migration

Use `schemaVersion: 2`, `catalogVersion: 'upright-plates-slopes-1'`, and `coordinateSystem: 'stud-xy-plate-z'` on new designs. Preserve `x` and `y` as the minimum footprint corner in integer studs. `z` is now an integer count of 8-LDU plate heights from the table to the **body bottom**, excluding studs. Each catalog entry gets `heightPlates` (1 or 3).

For old JSON without a schema version, validate with the legacy seven-brick rules, clone it, set each `z` to `3 * oldZ`, and stamp V2 metadata. Do not mutate files in `data/designs`: saved revisions are immutable. Migrate on the read boundary, use the migrated object in memory, and save user edits under a new revision ID. Reject unknown versions. A V2 design must never be multiplied again.

Apply this normalizer to server saved-design loads, API posted/exported designs and `previous` inputs, browser localStorage, initial samples, and Photon saved-model imports. Keep a legacy validation path only inside the migration module, not in every geometric helper. Inventory quantities/IDs and source provenance do not change. Existing full-brick scenes keep their physical positions, colors, IDs, BOMs, and step ordering after migration.

Preserve the physical workspace: X/Y extents ≤24 studs and `z + heightPlates ≤72`. The old highest permitted body reaches 24 brick heights. Testing only `z < 24` after conversion would wrongly shrink the vertical workspace; testing only the bottom would let tall parts cross its ceiling. Retain the 160-part cap until the separate complexity/performance work measures a larger tier.

Allow yaw `0 | 90 | 180 | 270`. Keep the legacy short-X/long-Y convention for rectangular catalog entries. Define slope rotation 0 as its low nose toward −Y and its high studded row toward +Y. Around a local width W, depth D rectangle, normalized point rotations are:

| Yaw | Local point `(u,v)` becomes | New footprint |
| --- | --- | --- |
| 0 | `(u,v)` | W × D |
| 90 | `(D-v,u)` | D × W |
| 180 | `(W-u,D-v)` | W × D |
| 270 | `(v,W-u)` | D × W |

These formulas use continuous local coordinates (stud centers are half-integers). Rotate body faces, connector sites, collision shapes, and the LDraw transform identically, then translate by `(x,y)`. A square slope still has **four different orientations**. Current `part.width !== part.depth` rotation deduplication must use actual part symmetry, not square dimensions. No reflection or non-unit scale is permitted.

## One part definition, distinct geometry and connections

Extend the small catalog with explicit fields, not a general mechanism engine:

```ts
type UprightPart = {
  id: string;
  name: string;
  width: number;
  depth: number;
  heightPlates: 1 | 3;
  yawSymmetry: 90 | 180 | 360; // smallest rotation that leaves geometry AND connectors unchanged
  ldrawId: string;
  ldrawToCanonical: number[]; // fixed rigid transform, including the source origin offset
  body: { kind: 'box' } | { kind: 'slope3039' };
  topStuds: { x: number; y: number; z: number }[]; // local studs and plate heights
  bottomSockets: { x: number; y: number; recessLdu: number }[];
  colorIds: number[];
};
```

Do not treat this type sketch as implemented API. Existing bricks and the two plates have grid-wide top and bottom sites. Define those sites once from the catalog, never independently inside a renderer. The sphere/axle/hinge abstractions required later are deliberately absent.

For 3039 in canonical LDU coordinates `(u,v,w)`, the native conversion is `(X+20, Z+30, 24-Y)`. Its body envelope is `0≤u≤40`, `0≤v≤40`, `0≤w≤min(24,4+v)`. Its top sites, expressed in stud/plate coordinates, are `(0.5,1.5,3)` and `(1.5,1.5,3)`; bottom sites are all four `(0.5 or 1.5, 0.5 or 1.5, 0)`. This is an authored derivation from the cited geometry, to be fixture-tested against the asset before release.

Keep three representations with different jobs:

1. **Display geometry:** the resolved, pinned LDraw mesh with its actual slope, rear ledge, studs, and underside. Bake or load it once per catalog entry and share it between the web viewer and USDZ. A simplified instruction drawing may omit underside details, but must preserve the exterior and connector coverage. Never stretch a box or add decorative triangles that disagree with the real part.
2. **Collision body:** a closed outer envelope excluding studs and hollow internals. Boxes use boxes; 3039 uses the convex envelope above. At this upright-only scope, AABB broad phase followed by convex intersection/SAT is small and sufficient. Strict positive-volume penetration is collision; coincident faces are contact. Define an LDU tolerance and test boundary cases. Treat hollow interiors as occupied, since insertion into them is outside this release.
3. **Connection sites:** explicit stud/receiver positions, axes, and seating planes. Coincident compatible sites create a graph edge only when the lower stud's seat plane equals the upper body bottom, its axis is correct, and the receiver can accommodate it. The absence of material above a sloping face is not a connector. Do not derive support by intersecting footprint rectangles.

Studs require their own collision rule. A lower stud may enter the matched upper receiver by 4 LDU; that is intentional mating, not body penetration. Unmatched studs must not be ignored when they intersect another body. With this restricted grid, enumerate nearby stud cylinders and test them against body envelopes, exempting **only matched** sockets. Reject use of interior clearances other than these sockets. The visual micro-gap between displayed bricks must not affect canonical collision/support decisions.

A bitmask of 20 × 20 × 8 LDU cells may accelerate broad phase, but is not exact slope geometry: the nose reaches 4 LDU, and the ramp cuts through cells. Never use a partially occupied cell as a full connector, and never conclude that two parts cannot collide solely because their sampled cell centers differ. A conservative occupied mask can reject safe placements; it cannot certify the slice's final result on its own.

Update the support graph to use matching connector sites at `lower.z + site.z == upper.z`, independent of whether the height difference is 1 or 3 plates. Every non-ground part needs a seated lower connection and the final graph must be connected. Table contact and side contact still do not connect parts. Mechanical strength, tipping, and intermediate hand support remain separate assessments.

## Small compiler change that can actually choose slopes

The existing `ShapeBox` grammar describes solid cuboids in full-brick voxels. It cannot express a real 3039 surface while also promising exact cell preservation. Do not silently swap a rectangular brick for a slope after packing: that removes requested material and studs on which a later piece may depend.

Introduce a versioned V2 shape plan with boxes in stud/stud/**plate** units and one additional primitive:

```ts
type SlopeRun = {
  kind: 'upright45';
  x: number; y: number; z: number;
  width: number; // even stud count, measured along the slope's unrotated X axis
  rotation: 0 | 90 | 180 | 270;
  colorId: number;
};
```

Depth is fixed at 2 studs and body height at 3 plates for this primitive. Each two-stud span maps to one catalog 3039; no arbitrary angle, resized part, inferred part ID, or fabricated triangular filler. The planner requests this surface only where it is meaningful (roof, nose, fairing). If it requests an unsupported slope width/angle or the necessary inventory is missing, return a constraint error for repair. An ordinary brick must not count as an owned slope.

For the first release, reserve each slope run's complete bounding envelope and require box regions not to overlap it. Validate reservations before packing. This deliberate grammar restriction avoids ambiguous box-overwrite semantics and avoids packing into the empty wedge above a slope. The final geometric validator still uses the real envelope, not the reservation. Slopes must have supported bottoms; any cap above them must match their actual rear studs.

For box regions, extend the candidate placements to height 1 and 3: a candidate must match all requested color cells throughout its complete body volume. Consume all of those cells and register its connectors at its actual top height. Walk the lowest remaining cell first. Retain interlocking benefit before size preference; use volume and actual legal yaw as tie breakers. Give a bounded search/repair path to mixed-height gaps rather than claiming greedy packing is complete. A `2×4×1` region chooses a plate; a `2×4×3` region can choose a brick or three available plates, subject to connection and inventory checks.

The old limit of 1,600 occupied brick cells becomes 4,800 occupied plate cells for the same box volume. Keep explicit memory/work limits. A slope reservation is not an instruction to fill its empty volume and should be budgeted separately. Existing brick-only conservation tests still compare their original geometric volume after unit conversion; new slope tests compare the declared analytic envelope and connector sites, not six invented solid voxels per part.

Count inventory globally across slope reservations and box packing before publishing a result. Candidate search should reserve/release exact part-color units without changing source allocations; final `allocateInventory` retains source provenance. Failed repairs do not persist a half-result or debit user inventory. A deterministic compiler must own all accepted part IDs and transforms; Gemini supplies only this bounded plan and user intent.

The planner prompt, JSON schema, repair feedback, and `previous` representation must all name the new units and grammar. Carry unchanged existing instances through simple color-only edits rather than reinterpreting their heights. The photo inventory prompt currently explicitly ignores plates/slopes: update it only once the catalog is released, and retain mandatory user review of its estimates.

## Concrete code assumptions to change

These references describe the inspected working tree; neighboring assembly and illustration work is in progress.

| File/function | Current assumption | Required behavior |
| --- | --- | --- |
| `shared/model.ts` types/catalog/`footprint` | No schema version, no height, yaw only 0/90 | Versioned units; part height, transform, connector masks, all legal yaws |
| `validateDesign` | Same-z overlap; `abs(z difference)===1` means connection | Three-dimensional body/stud collision and exact connector planes; bounds include part height |
| `buildSteps` | Every distinct bottom z is a numbered brick layer; connects to previous layer | Steps from support dependencies, labeled in plate-height units; distinguish step number from physical height |
| `exportLDraw` | All origins at top-center; global long-axis matrix; `-(z+1)*24` | Compose per-part native transform and yaw with V2 placement; preserve physical legacy placement |
| `server/compiler.ts` | `Object.values(PARTS)` all one-height rectangles; 24 passes; square parts skip yaw90 | Family-aware candidates, multi-height coverage, actual symmetry, slope reservations, connector ledger |
| `server/generation.ts` | Shape schema/prompt full-brick boxes; volume check counts only `brick.z===layer` | V2 grammar; test occupied cross-sections through actual heights, excluding false plinth-only depth |
| `shared/brick-geometry.ts` | Box body height 1.17, z×1.2, studs on every footprint cell | One catalog mesh/transform; 8 LDU = 0.4 viewer units, exact top-stud sites, real slope surface |
| `src/BrickScene.tsx` | Camera height `(max(z)+1)*1.2`; vertical animation assumed clear | Bounds from transformed part geometry; checked insertion animation and actual assembly steps |
| `shared/illustration.ts` | Full boxes, 1.2 vertical projection, rectangular silhouettes and box occlusion | Project actual slope faces and true heights; shared top sites; polygon occlusion must handle ramps |
| `server/manual.ts` | One layer equals one full brick; rectangle footprint conveys orientation | Plate-height legend, per-part height, slope front/high-row cue, matching support studs and insertion arrows |
| `src/AssemblyView.tsx` | Footprint swap explains yaw; layer z+1 | A square slope needs a direction arrow/part thumbnail; piece-level dependency order and explicit physical height |
| `server/native-model.ts` | Delegates to all-cuboid geometry | Export the identical catalog meshes; preserve metric size and attribution/asset provenance |
| `server/store.ts`, `server/index.ts`, `src/App.tsx`, Photon load paths | Raw JSON casts/readback and current validator | Normalize legacy objects at boundaries; retain immutable raw revision and schema/catalog metadata |
| `server/inventory.ts`, loose/photo inventory, `PARTS` dropdowns | Global part/color allowlists; copy says standard bricks only | Exact released part-color mappings and explicit exclusions; no silent variant conversion |
| `tests/native-model.test.ts` | Every part exports `1 + width*depth` meshes | Check actual instance geometry and expected connector count, not a renderer implementation count |

A rising bottom-height sort is a useful initial dependency order for these upright parts, but is not by itself an assembly proof. For this release, reject placements whose conservative footprint-column vertical insertion sweep crosses an already placed nonmating part. This can decline clever nested arrangements; it must not show a collision-free animation merely because the final poses are disjoint. No need to implement arbitrary-direction disassembly for this increment.

For illustration/manuals, a numbered top-down footprint is still useful for location, but insufficient for a slope's direction. Show its high studded edge and downhill arrow both in the callout and placement map. A 180° rotation has the same rectangle and a different legal attachment. If the current SVG painter cannot order partial slope faces robustly, render the exact shared mesh with an orthographic camera for the manual instead of weakening geometric consistency.

For LDraw, slope rotation 0 at `(x,y,z)` must produce native translation `(20*x+20, -(8*z+24), 20*y+30)` with identity rotation under the canonical slope convention above. The extra 10 LDU offset from footprint center in native Z is intentional. Derive other yaws by transform composition; do not manually tweak each export formula. The old brick-specific matrix can remain a catalog transform for those parts. Inspect output in an independent LDraw viewer.

## Demonstrator and acceptance

First use a small **gable-roof connection specimen**, not a claim of complex generation. It is 4 × 4 studs, has two opposing inclined faces, mixes 1-plate and 3-plate parts, bonds its base across seams, and connects its central cap only to real slope studs. All coordinates below use V2 units and existing rectangular-part orientation conventions.

| Step | Placements | Purpose |
| --- | --- | --- |
| 1 | Two gray 3001 bricks at `(0,0,0)` and `(2,0,0)`, yaw0 | 4×4 base; loose on table initially |
| 2 | Two white 3020 plates at `(0,0,3)` and `(0,2,3)`, yaw90 | Cross the seam and join both base bricks |
| 3 | Four white 3022 plates at `(0,0,4)`, `(2,0,4)`, `(0,2,4)`, `(2,2,4)`, yaw0 | Second plate-height eave course, supports roof |
| 4 | Four red 3039 slopes: `(0,0,5)`, `(2,0,5)` yaw0; `(0,2,5)`, `(2,2,5)` yaw180 | Two opposite roof faces, high rows toward ridge |
| 5 | One white 3020 plate at `(0,1,8)`, yaw90 | Ridge cap seats on all eight real rear-row studs |

Expected BOM: 2 gray 3001; 3 white 3020; 4 white 3022; 4 red 3039. **13 pieces**, 32×32 mm nominal footprint, 28.8 mm body height plus exposed studs. This is a proposed fixture with analytically aligned connectors, not a model that the current production validator supports or a physically assembled result. Hand-build it from the exported manual before calling the new family physically reviewed.

An independent arithmetic check of these coordinates returned 13 connected instances, support for every upper part, eight seated ridge-cap studs, a 72-LDU body height, and no positive-volume overlap between body bounding envelopes. That checks the table and connector arithmetic only; the new asset loader, collision implementation, exporter, and physical assembly do not yet exist.

Then use the same verified roof construction on a genuinely volumetric small lookout/birdhouse: a hollow wall enclosure, front opening, visible side/back detail, and plate eaves. The compiler must select the released parts from a V2 plan. Review front, back, both sides, top, and cutaway. The tiny specimen alone does not meet the user's request for complex final models.

Required tests before enabling the catalog:

| Test | Required result |
| --- | --- |
| Legacy migration | Every sample and a saved AI revision retains its physical LDU bounds, instance IDs, BOM, colors, and old steps; V2 round trip is idempotent; unknown version rejected; original saved bytes unchanged |
| Vertical lattice | Three identical plates stack to exactly one brick body's 24 LDU; a brick can start at z1 and a plate at z3; nonintegral z and `z+height>72` rejected |
| Mixed-height collision | Brick at z0 and plate at z1 on the same footprint collide even though their bottoms differ; plate at z3 seats legally; side face contact alone gives no edge |
| Slope mesh | Native bounds and offset match pinned DAT; nonzero 4-LDU front lip, exactly two rear studs; all four yaws preserve shape and rotate stud positions |
| Slope connection | A 1×1 test brick above its high row at z3 seats; above the low row at z3 fails support; a part intersecting the ramp fails collision; matched bottom receivers work on either underside row |
| Stud clearance | Legitimate seated stud intrusion is accepted; unmatched stud-body penetration rejected; surface-touching/no-volume cases are deterministic within the declared tolerance |
| Graph/instructions | Specimen is one connected final assembly; base warning persists until joined; all 13 IDs occur once; each insertion has a valid predecessor/support and unobstructed allowed sweep |
| Packing | V2 box volume/color preserved; height1 chooses a plate; height3 can use the available three plates when no brick exists; odd-width slope or overlap with a reserved slope envelope rejected |
| Strict inventory | Exact specimen inventory succeeds with zero missing; remove one red3039 and generation fails/repairs without saving or overspending; a red3003 cannot satisfy it; duplicate-source allocation remains exact |
| Revision fidelity | Red→green changes exactly the four slopes in the specimen with identical IDs, transforms, heights, and other colors; unavailable green in owned-only mode rejects |
| LDraw | Four slope yaws export the correct origin and determinant+1 transforms; plate heights preserved; import in an independent viewer matches assembly and has no missing subparts |
| USDZ/web | Archived actual vertices have correct metric body heights and slope direction; no invented front studs; show identical frozen instance IDs/colors/counts; legacy native model scale remains unchanged |
| SVG/PDF | Side and top views show real incline/stud coverage; ridge cap is on rear rows; four-yaw callouts differ; no painter holes; dense step/continuation pages remain legible |
| API/storage/Photon | Every boundary accepts migrated legacy and V2 objects consistently; catalog mismatch/invalid part-color rejected; saved exports and messaging preview use the same revision |
| Live Gemini | Fresh plate/sloped-roof brief produces a V2 plan and accepted real instances; image brief and geometry-preserving color revision recorded separately; no sample fallback |

Do not rewrite legacy geometry tests to merely accept changed render dimensions. Compare against canonical metric/LDraw expectations, then update implementation-specific mesh-count assertions deliberately. Keep all current model/compiler/inventory/manual/Photon tests and the production build passing.

## Assets, dependencies, and attribution

The three official LDraw files examined declare **CC BY 4.0**. Resolve and pin their complete transitive DAT/primitive dependency sets, record checksums and authors, preserve headers, and provide asset attribution plus the license link with distributed source/model assets. State conversions/simplification. Inspect licenses per dependency instead of assuming the top-level file covers everything. The current [LDraw contributor agreement](https://www.ldraw.org/article/349.html) supports CC BY 4.0 or CC0 contributions; the actual file header determines the asset's declaration. [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/)

The LDCad shadow library has a **different license, CC BY-SA 4.0**. Its [maintainer repository license](https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/LICENSE.md) and per-file headers must remain associated with reused/adapted connector data. Keep that data as a small separately attributed asset package under its applicable license; do not relabel it MIT or assume the entire LDCad editor is a dependency. The [shadow mechanism](https://www.melkert.net/LDCad/tech/shadowLib) and [snap format](https://www.melkert.net/LDCad/tech/meta) explain how geometry and connection annotations are combined. Rendering an LDraw mesh does not automatically import those connections.

A production catalog package should contain its manifest, source URLs/hashes, asset licenses/attribution, canonical transforms, geometry, and authored connector test fixtures. Freeze its version into accepted revisions so an upstream origin/geometry correction cannot silently change a saved build. This research read live upstream files; it has **not** vendored, pinned, or shipped them.

## Current evidence and immediate sequence

The parent run reports live Gemini rocket generation succeeded with **71 bricks**, followed by an exact red→green revision retaining all 71 placements with **25 green pieces**. Those establish live behavior of the current rectangular-brick path, not plate/slope support. A later owned-only pyramid run used only confirmed stock but added an unwanted fifth layer; a checker fix and repeat then produced the requested four layers with zero shortages. See `VERIFICATION.md` for both IDs and outcomes. Neither run establishes plate/slope support.

Implement this increment in four reviewable changes: coordinate/catalog migration and connector fixtures; matching collision and shared rendering/export geometry; V2 plan/compiler plus strict inventory; then assembly/manual and live/physical acceptance. Each change needs its targeted checks before the next, and the family is enabled for normal generation only when the end-to-end specimen passes. More complex real-part models remain ongoing product work after this first complete slice.
