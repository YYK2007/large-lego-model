# Test the full build flow

Use this guide for a deliberate live check. Gemini requests can spend credits and the Photon listener sends real replies. The automated suite uses mocks and doesn't replace these checks. See [verification](VERIFICATION.md) for results already recorded.

Keep private evidence in ignored `output/`. Record failures as well as successes. Don't commit credentials, phone numbers, prompts, photos or signed guide links.

## 1. Start locally

1. Follow the [README setup](../README.md#run-locally) on Node.js 24. Preserve an existing `.env` rather than overwriting it.
2. Put your own key from [Google AI Studio](https://aistudio.google.com/apikey) in `GEMINI_API_KEY`. Use a multimodal model available to that account in `GEMINI_MODEL`.
3. Run `npm run dev` and open [the studio](http://127.0.0.1:5173). Check [API status](http://127.0.0.1:3001/api/status). A configured field doesn't prove the provider has quota or accepts requests.
4. Open a sample first. Rotate it, follow a few build steps, inspect the parts list and download an export. This checks local viewing without spending generation credits.

## 2. Generate and inspect

Select Any bricks and enter:

> Build a small three-dimensional cottage with a red roof, yellow front door, one front window and one side window. Keep the interior hollow where practical and explain any simplified details.

Click Generate design once. There is no Quick/Detailed selection. Watch for an acknowledgement, stage updates and a terminal result. Use the job progress display or Stop generation if needed; don't submit the same request repeatedly because it's quiet.

For a checked result:

- Inspect the front, sides, back and top. The cottage needs depth above its base, a recognizable roof and details on the requested faces.
- Compare the model with any retrieved references. Record missing angles and differences rather than treating a geometry badge as a likeness pass.
- Follow Build steps and inspect the part callouts. Compare the parts list with the model's count.
- Download PDF, CSV, LDraw and USDZ from the same selected revision. Check colors, quantities and geometry. Open the USDZ in a viewer and rotate it.

A valid but inaccurate model is a resemblance failure. An unfinished plan isn't a checked result. For a consistency study, repeat the same prompt deliberately and retain every outcome; don't report only the best run.

## 3. Revise the selected model

Select Refine and ask:

> Keep the cottage's shape, windows and door. Change only the roof from red to green.

Compare the saved placements and before/after views. Unrequested changes are a revision failure. A failed edit should retain the earlier checked model. Repeat with a geometry change, such as lowering the chimney, if the draft includes one.

Download the revision's files and confirm they describe that revision. Earlier exports must still describe the earlier model. Tests cover targeted patch mechanics; this live check evaluates whether Gemini chose the right edits.

## 4. Check inventory and images

Use a separate browser profile if you already have a collection saved. In Manage your brick collection, enter these test quantities. They don't claim ownership of physical parts.

| Part | Color | Count | Source |
| --- | --- | ---: | --- |
| 3001, brick 2 × 4 | Green | 60 | Test collection |
| 3003, brick 2 × 2 | Green | 40 | Test collection |
| 3004, brick 1 × 2 | Green | 40 | Test collection |
| 3005, brick 1 × 1 | Green | 40 | Test collection |

1. Save the collection and choose Only my bricks. Ask for a small green stepped pyramid. Required quantities must stay within stock, with zero shortages and the correct source in the guide and CSV.
2. Ask for a red top layer. Since this collection has no red pieces, an unexplained red result is a failure. The agent should explain the constraint or propose an available alternative.
3. Try an inspiration photo with a description. Inspect recognizable features and unseen-side assumptions from several views.
4. Photograph a small, manually counted group of separated pieces. Choose Identify my loose bricks, review the estimate and correct it before confirming. Verify that unconfirmed suggestions don't change the collection.
5. With a Rebrickable key configured, import a set you actually own and compare the supported part/color/count rows with its inventory. Unsupported pieces and spares may be excluded, so the imported count needn't equal the advertised set count.

## 5. Test iMessage approval and delivery

Follow [Photon setup](photon-setup.md), including its test-user configuration. Keep only one listener running. A public guide needs built web assets and an HTTPS origin forwarding to the signed gateway on port 3002.

1. Send `/status`. Confirm a reply about the existing conversation without starting generation.
2. Send a build request or open a saved website snapshot using its copied `/open` command. Confirm the subject and imported inventory.
3. During generation, ask “what's happening?” Confirm it reports the same job. The first completed response should contain a checked preview and feedback request.
4. Ask for one clear edit. Confirm the new preview changes that feature and retains the rest of the subject. Before approval, requests for `/instructions`, `/model`, `/manual` or `/parts` should ask you to approve the selected preview.
5. Reply Approve. Verify that the guide, phone-viewing USDZ and parts CSV belong to that exact revision. Without a public guide, expect the PDF bundle fallback.
6. Open the model and rotate it. Open the guide, start building, advance a step, close it and check Resume. Try the browser fallback and optional AR separately. Record the phone and OS version.
7. Send `/manual`. Confirm the PDF arrives, opens and matches the approved model. Check repeated steps and part quantities.
8. Restart an idle listener and use `/retry` after an actual failed delivery. It should retry the same approved revision without another build or unnecessary duplicate files.
9. Test Stop during a separate generation and during pending export delivery. Confirm an acknowledgement and no new work for that request. An attachment already handed to Photon may still arrive.

A new edit needs fresh approval. The earlier approved revision must remain saved. Test a captioned photo and a photo followed by text separately; neither should silently become confirmed owned inventory.

## Record the result

For each case, keep the request, model/configuration, elapsed time, saved revision, screenshots and any error in private local evidence. Record geometry, resemblance, revision fidelity, inventory, exports and delivery separately.

For a physical check, build one small generated model from its actual instructions. Record unclear placements, weak connections and balance problems. Software checks alone can't establish that result.
