# world-tileset.png — atlas spec

256 x 736 px, strict 32px grid (8 cols x 23 rows), PNG with alpha.

Art composed from "Tiny Tales Pixel: World Map 2D RPG Tileset" by
Mega Tiles (artist: Rayane Félix), VXA 32px edition.
https://megatiles.itch.io/tiny-tales-worldmap-2d-tileset-asset-pack
License permits use in free/commercial games; redistribution of the
asset files is forbidden — the raw pack is NOT stored in this repo.

## Layout
Row 0: grass · water fill · forest fill · road fill · sand fill · mountain fill
Rows 1-12: corner-blob autotile blocks (4x4, tile m at (m%4, m/4)):
  water(0-3,1-4) forest(4-7,1-4) mountain(0-3,5-8) road(4-7,5-8)
  sand(0-3,9-12) park(4-7,9-12)
Row 13 objects on grass: crate · cave (short) · cavern (medium) ·
  volcano (epic) · tree · gold crate (rare)
Row 14 clean fills: (1)park (2)res (3)com (4)ind (5)civ
Rows 15-22 district autotile blocks:
  res(0-3,15-18) com(4-7,15-18) ind(0-3,19-22) civ(4-7,19-22)

Districts are OSM building zones rendered as overgrown-ruin terrain:
residential=wheat, commercial=orange, industrial=mauve, civic=pale stone.
Mask bits: 1=TL is terrain, 2=TR, 4=BR, 8=BL.
