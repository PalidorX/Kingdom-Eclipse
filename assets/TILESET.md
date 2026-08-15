# world-tileset.png — atlas spec

256 x 480 px, strict 32px grid (8 cols x 15 rows), PNG with alpha.

Current art: composed from "Tiny Tales Pixel: World Map 2D RPG Tileset"
by Mega Tiles (artist: Rayane Félix), VXA 32px edition.
https://megatiles.itch.io/tiny-tales-worldmap-2d-tileset-asset-pack
License permits use in free/commercial games; redistribution of the
asset files is forbidden — the raw pack is NOT stored in this repo.
Keep the purchased ZIP locally.

## Layout
Row 0: grass fill · water fill · forest fill · road fill · sand fill ·
mountain fill · legacy house (red) · legacy house (blue)

Rows 1-12: five 16-tile corner-blob autotile blocks (4x4 each):
water (cols 0-3, rows 1-4) · forest (4-7, 1-4) · mountain (0-3, 5-8) ·
road (4-7, 5-8) · sand (0-3, 9-12)
Within a block, corner-mask m sits at (m % 4, m / 4).
Mask bits: 1=TL is terrain, 2=TR, 4=BR, 8=BL.

Row 13: house tiles on grass — red · orange · blue · teal.
Buildings render one house per footprint tile, colour chosen per
contiguous building region.

To re-skin: replace this PNG in the same layout, or re-run the
converter against any RPG-Maker A2-format autotiles.
