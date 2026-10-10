# Large Lego Model: interactive 3D in iMessage

Research verified October 10, 2026. The offline USDZ exporter, download route, web export button, and Photon attachment code are implemented locally. Artifact tests verify the exported geometry. No USDZ, animation, or app-card messages have been sent or verified on a phone.

## Recommendation

The first native option to test on a phone is a **USDZ attachment that opens Apple's Quick Look when tapped**. It carries a real 3D model, rather than a recording of a model. Apple explicitly lists Messages among its built-in USDZ viewers. Retain the HTTPS web viewer as a fallback, and optionally add a short turntable GIF for an immediate visual preview. A user cannot choose a viewpoint in a GIF or MP4. [Apple Quick Look gallery](https://developer.apple.com/quick-look-gallery/)

If the requirement is interaction **inside the conversation's bubble or app panel**, evaluate Photon's live app card after that path works. This requires the recipient to install the Spectrum iMessage App once. It is a different user experience from tapping a file into a system preview. [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app)

## What each option actually provides

| Option | User-controlled rotation? | Where it runs | What remains unverified |
| --- | --- | --- | --- |
| PNG preview | No | Ordinary image message | Actual delivery and appearance through this account |
| Looping GIF turntable | No; pre-rendered viewpoints | Image message | Looping/compression through Photon and recipient settings |
| MP4 turntable | No; playback is a recording | Video message/player | Codec compatibility, compression, autoplay, and looping |
| USDZ attachment | A real interactive model in Quick Look | Native preview opened from Messages | Photon delivery, filename/MIME preservation, taps and rotation on target iPhone |
| HTTPS Three.js viewer | Yes; existing OrbitControls | Web page opened from the link | Touch gestures/performance on the target phone |
| Spectrum `app(url, { live: true })` | Candidate for our interactive web viewer | Installed Spectrum extension in Messages | WebGL, OrbitControls, layout, and any extension restrictions |
| Custom iMessage extension | Can supply a custom interactive 3D view | Own installed iMessage extension | Native app implementation, signing, distribution, device testing |

“Native 3D” here means a 3D file opened by Apple's system viewer. It does not mean the closed file bubble itself becomes a freely rotatable model. “Live app card” means an installed extension supplies interactive content; sending a URL alone does not prove the extension will render our WebGL scene correctly.

## USDZ and the native viewer

Apple's AR Quick Look documentation supports USDZ or Reality files and touch manipulation of the displayed model. Its WWDC discussion explicitly describes rotation gestures. These establish the platform capability; they do not establish that our generated model or Photon delivery works on a particular device. [Previewing a model](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look), [Apple's rotation discussion](https://developer.apple.com/videos/play/wwdc2019/612/)

Spectrum accepts file attachments from a path, URL, or buffer with explicit filename and MIME type. The prepared transport code uses a `.usdz` filename and `model/vnd.usdz+zip`. The installed `@spectrum-ts/imessage` 12.10.1 attachment path uploads generic file content; no USDZ-specific success guarantee is documented. This is a supported API shape plus an integration hypothesis that requires a real-device test. [Photon attachment API](https://photon.codes/docs/spectrum-ts/content/attachments)

The web app serves `/api/designs/:id/model.usdz` with that MIME type. **Let's build → Native 3D model** saves a design/inventory snapshot and downloads the USDZ. The current button is a download action; opening Quick Look directly from Safari is a separate optional improvement. WebKit documents an anchor with `rel="ar"` and a single image/picture child for that flow. An ordinary direct file link can require an additional thumbnail tap. [WebKit's USDZ guide](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/)

```html
<!-- Optional direct-launch UI pattern. Both file endpoints exist locally;
     the current export button downloads the USDZ instead. -->
<a rel="ar" href="/api/designs/DESIGN_ID/model.usdz">
  <img src="/api/designs/DESIGN_ID/preview.png" alt="Open this build in 3D" />
</a>
```

Quick Look viewing should not be treated as approval. No reviewed Photon contract provides a “user rotated the model” or “approved in Quick Look” event for a generic attachment. Keep approval and changes explicit in the conversation.

## GIFs and video

Apple documents sending and receiving GIFs in Messages. It also exposes an accessibility setting that disables automatic animated-image playback in Messages. Therefore a GIF can be a convenient looping preview, but autoplay is a recipient preference, not something our agent can guarantee. Include a useful first frame. [Apple GIF support](https://support.apple.com/en-ie/118278), [Motion settings](https://support.apple.com/en-ae/guide/iphone/iph0b691d3ed/ios)

Apple supports video sharing through Messages, but the reviewed sources do not promise that an arbitrary MP4 attachment will loop or autoplay in the transcript. Treat it as a short video requiring playback, and verify its presentation. Size limits may depend on the service. A six-second, modest-resolution turntable is a proposed starting point, not a platform guarantee. [Apple photo/video sharing](https://support.apple.com/guide/iphone/share-photos-and-videos-iphf28f17237/ios)

A turntable should be rendered from the **same validated brick geometry** as the manual. Do not use a generative image/video model to invent a prettier build that differs from the actual parts and coordinates.

## Photon app cards and true interaction inside Messages

The current Spectrum API exposes `app(url, { live: true })`; `live` is a rendering hint, with static/URL fallback when a live surface is unavailable. Photon says its app cards open in the Spectrum iMessage App, installed once by the recipient. The [official App Store listing](https://apps.apple.com/ca/app/spectrum-apps-in-messages/id6777616651) describes interactive cards and web content, and currently requires iOS 17 or later. [Photon API](https://photon.codes/docs/spectrum-ts/content/app)

Reusing our existing public Three.js viewer in that extension is the smallest experiment. However, the reviewed documentation does **not explicitly promise WebGL support or successful OrbitControls gestures**. Test that before describing it as interactive native 3D. The listing's general support for web content is evidence for an experiment, not proof for our scene.

Photon also exposes `customizedMiniApp` with an extension bundle ID, team ID, URL, visual layout, and optional `live`. A matching extension must be installed. Merely inventing those identifiers will not create a working native app. [Customized cards](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/apps)

Apple's `MSMessageLiveLayout` allows custom interactive transcript views and requires an alternative layout for recipients without the app. A dedicated extension could host a 3D view, but building and distributing one is a separate native-app project. It is unnecessary for the first Quick Look path. [Apple live layout](https://developer.apple.com/documentation/messages/msmessagelivelayout), [Messages framework](https://developer.apple.com/documentation/messages)

## Implementation and remaining work

1. **Shared geometry is implemented.** `shared/brick-geometry.ts` builds the exact bodies, studs, and catalog colors used by `src/BrickScene.tsx` and the native exporter. The USDZ excludes the display pedestal, UI, grid, lights, and decorative outlines.
2. **Offline USDZ export is implemented and tested.** `server/native-model.ts` validates the design before calling Three.js `USDZExporter.parseAsync` with `quickLookCompatible: true`. Untextured `MeshStandardMaterial` keeps this path independent of browser canvas APIs. Tests export every catalog part at both rotations and all four sample designs; every geometry reference resolves. [Official Three.js exporter documentation](https://threejs.org/docs/pages/USDZExporter.html)
3. **Scale and orientation are tested in the exported archive.** The model is Y-up, with 8 mm stud spacing and 9.6 mm layer spacing. Tests check the actual USDA transforms and vertices, rotated footprints, all bodies/studs, and uncompressed ZIP entries aligned to 64 bytes. The cosmetic body gap leaves the bottom 0.04 mm above the ground, matching the web geometry. Apple's Quick Look respects USDZ unit metadata. [Apple's asset guidance](https://developer.apple.com/videos/play/wwdc2023/10274/)
4. **Web download and attachment code are implemented; phone delivery remains untested.** The web export button and `/api/designs/:id/model.usdz` route call the same exporter. After the PNG and optional web link, the adapter prepares a USDZ attachment with the correct MIME type and a caption explaining the feedback loop. Native export/delivery errors leave the earlier preview and manual available. A new revision has a new design ID.
5. **The feedback loop remains explicit in iMessage.** A text revision passes the current design and saved inventory to `generateDesign`, then sends the updated preview. The existing `manual` command produces instructions without inventing a viewing/approval event.
6. **Turntable and app cards remain future work.** A turntable is optional preview media. A live card is a separate device test with the Spectrum extension installed, retaining a regular link fallback.

This work should not change inventory constraints, the validated model, or manual generation. Voice memo input/output with ElevenLabs remains a later feature and is not part of this transport plan.

## Required real-device checks before claiming completion

- Deliver a small known-good USDZ through the configured Photon line; open it from Messages and manipulate it with touch.
- Deliver one exported Large Lego Model design; inspect color, orientation, studs, centering, scale, and native object/AR behavior.
- Test the HTTPS viewer and downloaded USDZ separately on the actual recipient phone. If a direct Safari Quick Look action is later added, test that separately too.
- Send a revision from iMessage and confirm the new model, preserved owned inventory, and resulting PDF all correspond to the new design ID.
- If adding GIF/video, test recipient motion settings and first-frame usefulness; do not require autoplay for comprehension.
- If adding a live app card, test the install/fallback experience and then the existing WebGL viewer's gestures inside Spectrum. Document the tested iOS and Spectrum versions.

Research, offline USDZ generation, local artifact tests, and the web download integration are complete. Turntable generation, a direct Safari Quick Look launch action, and live app-card integration remain unimplemented. Photon delivery and all on-device checks above remain unverified. Follow [the live test guide](live-testing.md) when credentials and a phone are available.
