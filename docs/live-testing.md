# Large Lego Model: live integration test guide

Use this guide to reproduce live checks. Gemini text generation and one exact recolor revision have passed. Rebrickable and Photon have not been live-tested. A configured key, a sample, or a geometry badge is not evidence of a successful integration. See `docs/VERIFICATION.md` for actual results and failures.

The current generator asks Gemini for colored boxes, packs those occupied cells into seven supported rectangular brick types, and checks overlap, support, connectedness, budget, and owned quantities. It is not a general mesh generator or a mechanical stability solver. The curated flower, rocket, tree, and duck now have substantial volume and details on multiple sides. They remain offline fixtures; they do not establish live-generation reliability. Test that separately below.

## 1. Connect Gemini and start the app

1. Get your own key from [Google AI Studio](https://aistudio.google.com/apikey). Open the local `.env` file in your editor and set `GEMINI_API_KEY`. Do not put the key in the browser, screenshots, a terminal command, or Git.
2. Keep `GEMINI_MODEL` set to a model available to your account. The checked-in default is `gemini-3.8-flash`; live text generation and recoloring were verified with that model on October 10, 2026. If Google reports that it is unavailable, choose an available Gemini model that accepts images and structured JSON, then update the field.
3. In a terminal opened in this repository, run the following. Run `npm ci` only if dependencies are not installed. Copy the template only if `.env` does not already exist; preserve any existing values.

```sh
npm ci
cp -n .env.example .env
npm run dev
```

4. Open [the local studio](http://127.0.0.1:5173). Open **Connect your tools** and select **Refresh connections**. The configured label only confirms the field exists; the next generation is the actual API test. For a status check without exposing a key, open [the API status endpoint](http://127.0.0.1:3001/api/status).
5. Keep the terminal running. Restart `npm run dev` after server/shared-code changes. Gemini settings are re-read from `.env` when used. Use the Photon worker only in section 6.

## 2. Generate and inspect a real 3D object

Select **Any bricks**, set **Brick budget** to **120**, and paste this prompt into **Describe your build**:

> Build a small three-dimensional cottage about 8 studs wide, 8 studs deep, and 8 brick layers tall. Give it a substantial box-shaped building, four walls, a stepped red roof, one supported chimney, a blue window on the front, a blue window on a side, and a yellow front door. Use ordinary upright rectangular bricks. Keep it within 120 pieces and keep the upper features supported. Make its shape interesting from the front, both sides, the back, and above. Explain any simplified detail.

Choose Quick or Detailed, then click **Generate design** once. Quick aims for a draft in about 2.5 minutes per attempt cycle, excluding queue wait; a usable result is not guaranteed. The website keeps refining until **Stop generation**. Record its displayed attempts, elapsed time and outcome. Keep failures and unfinished previews separate from checked builds; use **Use this build** only for a checked result.

Check every item before recording a pass:

- The heading says **YOUR GEMINI DESIGN**. The result is a new cottage, not one of the curated samples. The total is at most 120 bricks.
- Drag to inspect the front, sides, and back; use **View from above** too. The main building has substantial width **and** depth above any base. Aim for at least 6 studs along both horizontal axes in the building's lower body. A large flat plinth under a thin façade does not meet this test.
- There are recognizable walls, a roof whose horizontal footprint changes by layer, and a supported chimney. Front and side details appear on their intended faces. Three-dimensional depth must belong to the object itself.
- Open **Build steps**. Step through every layer, checking that upper features actually have supporting bricks below. Open **Pieces** and check that the listed quantities total the preview's count.
- Open **Let's build** and download the **Build manual**, **Parts & collection list**, **Native 3D model**, and **Design preview**. Check that all describe the same cottage, colors, count, and layers. The PNG and PDF illustrations are fixed views of the brick coordinates; they are not independent generated images.
- Open the USDZ in an available viewer. On an Apple device, verify that touch changes the viewpoint. A downloaded file alone is not proof that Quick Look opened it correctly. Final iMessage testing is in section 6.

Record visual/intent failure separately from geometry failure. A connected, collision-free model can still look wrong. Keep the rejected result as evidence; do not count it as a pass because it has a green badge. Try the identical prompt three times to measure consistency, recording all three outcomes rather than selecting only the best one.

## 3. Revise the accepted design

On an accepted cottage, select **Refine**, then submit:

> Keep the building's width, depth, window positions, and yellow door. Change the roof from red to green, lower the chimney by one brick layer, and leave the rest recognizable as the same cottage.

Confirm that the UI identifies the current design as the one being refined before clicking **Refine my build**. Inspect the result from the same viewpoints and compare with the earlier PNG/manual. Confirm the requested changes and look for unintended changes to the footprint or colors. Gemini receives the full previous brick model, but exact unchanged geometry is not guaranteed by the current implementation; record unintended redesign as a revision-fidelity failure.

Download the revised artifacts. They must match the revised geometry, and previously downloaded files must still describe the original. **Undo design change** should return to the prior build in the current browser session. If generation returns an error, the previous model should remain visible.

## 4. Test owned inventory

Use a separate browser profile for test inventory if you already have a real collection saved. Open **Manage your brick collection** and add these fixture rows using **Part**, **Color**, **Count**, and **Brick source**. These are test quantities, not a claim about bricks you own.

| Part | Color | Count | Source |
| --- | --- | ---: | --- |
| Brick 2 × 4 · 3001 | Green | 60 | Live test fixture |
| Brick 2 × 2 · 3003 | Green | 40 | Live test fixture |
| Brick 1 × 2 · 3004 | Green | 40 | Live test fixture |
| Brick 1 × 1 · 3005 | Green | 40 | Live test fixture |

1. Select **Save collection**, then **Only my bricks**, set the budget to **100**, and generate: “A small green stepped pyramid with a 6 by 6 stud base and four brick layers, using only my collection. Keep every layer supported and the final assembly connected.”
2. In **Pieces**, every row must be green and use only the four entered part IDs. No required quantity may exceed the available quantity, **Missing** must be zero, and the source allocation must say **Live test fixture**. Confirm the same counts and source in the PDF and CSV.
3. Refine it with: “Use red bricks for the top layer.” Since this inventory contains no red bricks, a red result is a failure. Accept an explicit error, or a clearly explained green alternative; record whether the requested color was unavailable. Never treat an unexplained ignored request as full intent success.
4. Set all fixture quantities to zero, keep **Only my bricks** selected, and try another generation. Expect the “Add your bricks” error and preservation of the current model. Restore the fixture quantities afterward if continuing into iMessage.

For a real collection, replace fixture quantities with counted physical bricks before claiming reuse. If a Rebrickable key is available, add it to `.env`, use **Add set** with a set you own, and compare supported part/color/count rows with that set. The importer excludes spare and unsupported parts; the app's count should not be mistaken for the set's total piece count. Do not add the same physical set twice unless you own two copies.

## 5. Exercise both image paths

**Inspiration:** Choose **Any bricks**, add a JPEG, PNG, or WebP under 5 MiB showing a simple object, and leave **Use as inspiration** selected. Add a text description requesting a small volumetric interpretation, then generate. Inspect from several angles. Check that the result preserves recognizable features and states necessary simplifications. It cannot recover unseen geometry or certify the source object's internal parts from one photo.

**Inventory estimate:** Photograph a small, manually counted group of separated supported bricks. Use **Add a photo → Identify my loose bricks → Review the bricks in my photo**. Compare every estimated part, color, and quantity against the physical group; edit or remove mistakes. Confirm that the collection does not change until **Confirm these quantities** is clicked. Only then use **Only my bricks**. Keep the original counted list and the corrected estimate as evidence; a plausible-looking estimate is not a verified inventory.

## 6. Verify Photon and native rotation on your phone

1. Complete [Photon setup](photon-setup.md): project, managed line, `SPECTRUM_PROJECT_ID`, and `SPECTRUM_PROJECT_SECRET`. Gemini must already pass the web test. If using web links, configure `PUBLIC_BASE_URL` to the actual HTTPS deployment connected to the same saved-design data. Localhost does not work as the phone's remote viewer address.
2. From a saved web design with the desired inventory, select **Let's build → Copy command to continue in iMessage**. This saves a snapshot and copies `/open <id>`. A nonempty inventory snapshot puts the Photon conversation into owned mode, even if the web generation had used **Any bricks**; choose the intended snapshot.
3. Run `npm run photon` in a second terminal. This starts real replies to incoming messages on the configured line. Keep only one worker running. Send the copied `/open` command from your test phone to that line and verify the title and inventory acknowledgement.
4. Send a change that can be built from that inventory, such as “Keep the same base and make the top one layer shorter.” Confirm a caption, PNG, USDZ, and the configured web link arrive. Tap the USDZ, open Apple's viewer, and rotate it yourself. Verify the updated form, colors, upright orientation, and sensible physical scale. Record the phone/iOS version and whether the file opens from Messages. A spinning recording does not count as user-controlled rotation.
5. Return to Messages and send another change. Verify it applies to the latest model. Send `manual`; check that the PDF belongs to that revision and preserves the saved owned quantities and source labels.
6. Restart the worker, then send another revision. Verify that the latest design and inventory persist. Send `/new a different small idea` and verify a new design is created within the same saved inventory. `/new` preserves imported inventory; opening a design with no inventory switches back to unlimited mode.
7. Test one captioned photo and one photo sent alone. A photo alone should ask what to build; the following text should be combined with that pending image. Confirm that a photo is not silently treated as counted owned inventory.

The current web **Native 3D model** action downloads USDZ. It does not implement a direct `rel="ar"` Safari launch. Spectrum live app cards, animated turntables, and ElevenLabs voice memos are not part of this test. See [the native-preview research](imessage-3d-preview.md) for those boundaries.

## Record the results

For each case, save the prompt, selected model from `/api/status`, elapsed time, pass/fail, returned error if any, saved design ID, and screenshots from the required viewpoints. Use **Copy command to continue in iMessage** to obtain a snapshot ID; remove the `/open ` prefix to open `/api/designs/ID` in the local API if JSON inspection is needed. Do not include API keys or project secrets. Record geometry, appearance, revision fidelity, inventory, exports, and phone delivery separately.

| Case | Status before live execution | Required evidence |
| --- | --- | --- |
| Live rocket text generation / exact recolor | Passed once each; broader consistency unverified | IDs and checks in `docs/VERIFICATION.md` |
| Three repeated cottage generations | Not run | All three outcomes, front/side/back/top views, counts |
| Targeted cottage revision | Not run | Before/after views and matching exports |
| Owned generation and unavailable color | Four-layer pyramid passed after checker fix; unavailable-color case not run | Zero shortages, correct sources, safe handling of red request |
| Inspiration and reviewed inventory photo | Two synthetic-image runs failed (geometry rejection, then provider failure); physical inventory photo not run | Source photo, observed interpretation, corrected counts |
| Photon continuation and restart | Not run | Same revision/inventory before and after restart |
| Native 3D on the target phone | Not run | Actual Messages attachment opened and rotated, device version |
| Physical assembly | Not run | One small generated design built from its PDF, recorded weak points |

Local tests establish checks on data and exported files. Only the runs above establish live model behavior and delivery; only a hands-on build provides evidence about the physical result.
