# Bundled catalog attribution

`server/catalog-seed.json` contains 44 pinned imported part definitions, 176 mapped opaque colors and produced-color evidence. Together with the 36 built-in definitions, a fresh checkout has 80 usable part types. It is a reproducible starting snapshot, not the complete catalog or a stock/price feed.

Every part's `geometry.assets` lists the exact source URL, SHA-256, original author where supplied, and license. Original part authors retain copyright. The imported meshes were flattened, deduplicated, triangulated for rendering, transformed from LDraw units to the project's coordinates, and separated into body/stud geometry. Unsupported connector metadata does not authorize an attachment.

- LDraw geometry: [official library](https://library.ldraw.org/), authors and source files listed per part. Use the CC BY 4.0 option for dual-licensed files. The original library's `CAreadme.txt`, `CAlicense.txt` (CC BY 2.0) and `CAlicense4.txt` (CC BY 4.0) are included here.
- LDCad Shadow Library connector metadata: [Roland Melkert and contributors](https://github.com/RolandMelkert/LDCadShadowLibrary), pinned revision `9b1131fb1991f8c0bfc072325e4e12f6271aba35`, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The transformed connector metadata retains that license; its legal text is included as `CC-BY-SA-4.0.txt`.
- Identity, produced colors and color mappings: [Rebrickable API](https://rebrickable.com/api/). These are catalog facts with source attribution; no product photographs, credentials or account inventory are bundled. Catalog data does not verify current availability or price.

Retain this notice and each manifest's source records when redistributing the bundled assets. This is an independent project, not affiliated with or endorsed by the LEGO Group, LDraw, LDCad or Rebrickable.
