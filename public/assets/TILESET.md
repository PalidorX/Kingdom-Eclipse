# world-tileset.png — atlas spec

256 x 384 px, strict 32px grid (8 cols x 12 rows), PNG with alpha.

Art from "Tiny Tales Pixel: World Map 2D RPG Tileset" by Mega Tiles
(artist: Rayane Félix), VXA 32px edition.
https://megatiles.itch.io/tiny-tales-worldmap-2d-tileset-asset-pack
License permits use in free/commercial games; redistribution of the
asset files is forbidden — the raw pack is NOT stored in this repo.

## Layout
Row 0: grass fill · clean fills (water forest mountain road paved sand park)
Rows 1-9: RAW RPG-Maker A2 blocks (2x3 tiles each), kept verbatim so the
runtime per-quadrant compositor can use every piece incl. inner corners:
  row 1-3: water(0) forest(2) mountain(4) road/trail(6)
  row 4-6: paved(0) sand(2) park(4) res(6)
  row 7-9: com(0) ind(2) civ(4)
Row 10: clean fills — res com ind civ
Row 11: objects — crate · cave (short) · cavern (medium) · volcano (epic)
  · tree · gold crate (rare) · rubble (transparent-backed)

## Companion atlases (same license terms — raw packs never committed)
- buildings.png (512x256): 15 JRPG-scale building facades composed at
  bake time from "Tiny Tales Overworld 2D Tileset" (Mega Tiles / Rayane
  Félix) A3 roof+wall autotiles, village doors/windows, and the INN sign,
  upscaled 2x to the 32px grid. Frames in src/game/buildingArt.ts.
- smoke.png (96x64): 3-frame chimney smoke from the same pack.
- kingdom-objects.png / crystal.png / clouds.png: kingdom decor, the
  animated Kingdom Crystal, and pixel clouds, same source packs.

Rendering: src/game/terrainRender.ts composes each 32px tile from four
16px quadrants of the A2 block using 8-neighbour logic (dual-grid).
Roads: OSM streets render as 'paved' (stone); footpaths/tracks as the
olive trail. Districts (res/com/ind/civ) are OSM building zones drawn
as ruin terrain with scattered rubble.
