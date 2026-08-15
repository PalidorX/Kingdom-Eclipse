# world-tileset.png — atlas spec

256 x 416 px, strict 32px grid (8 cols x 13 rows), PNG with alpha.

Current art: composed from the PIPOYA FREE RPG Tileset 32x32
(https://pipoya.itch.io/pipoya-rpg-tileset-32x32) via tools/ pipeline.
Credit: PIPOYA. The raw asset pack is NOT stored in this repository —
Pipoya's license permits use in games but not redistribution of the
material itself. Keep the original ZIP locally.

## Layout
Row 0: grass fill · water fill · forest fill · road fill · sand fill ·
mountain fill · town roof (blue) · town roof (red)

Rows 1-12: five 16-tile corner-blob autotile blocks (4x4 each):
water (cols 0-3, rows 1-4) · forest (4-7, 1-4) · mountain (0-3, 5-8) ·
road (4-7, 5-8) · sand (0-3, 9-12)

Within a block, the tile for corner-mask m is at (m % 4, m / 4).
Mask bits: 1=TL corner is terrain, 2=TR, 4=BR, 8=BL.

To re-skin: replace this PNG with any art in the same layout, or re-run
the converter against different RPG-Maker-format (A2) autotiles.
