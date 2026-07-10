# world-tileset.png — layout spec (for art replacement)

256 x 416 px. Strict 32px grid: 8 columns x 13 rows. PNG with alpha.
Replace this file with final art using the exact same layout — no code
changes needed.

## Row 0 (base tiles)
| col | tile |
|-----|------|
| 0 | grass (base ground, must self-tile) |
| 1 | water interior (seamless fill) |
| 2 | forest interior (seamless fill) |
| 3 | road/dirt interior (seamless fill) |
| 4 | sand interior (seamless fill) |
| 5 | mountain/rock interior (seamless fill) |
| 6 | town house tile, blue roof (tileable side-by-side) |
| 7 | town house tile, red roof (tileable side-by-side) |

## Rows 1-12 (five 16-tile corner-blob autotile blocks, 4x4 each)
| block | cols | rows |
|-------|------|------|
| water | 0-3 | 1-4 |
| forest | 4-7 | 1-4 |
| mountain | 0-3 | 5-8 |
| road | 4-7 | 5-8 |
| sand | 0-3 | 9-12 |

Within a block, the tile for corner-mask m sits at (m % 4, m / 4).
Mask bits: 1=top-left corner is terrain, 2=top-right, 4=bottom-right,
8=bottom-left. Tile 0 = lone speck on grass; tile 15 = full interior.
Grass shows wherever the terrain doesn't cover.
