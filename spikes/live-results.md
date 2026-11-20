# Live spike results (2026-11-20)

| Catalog | Step | Result | Requests | ms |
|---|---|---|---|---|
| Earth Search | connect | search ✓ · CQL2 ✗ · query ✓ · sort ✓ · collection search ✗ | 1 | 986 |
| Earth Search | all collections | 9 | 1 | 901 |
| Earth Search | collections in area, regional | 0 | 0 | 4 |
| Earth Search | describe sentinel-2-c1-l2a | bands 17 · queryables 7 · 2015-06-27T10:25:31.456000Z.. | 0 | 1 |
| Earth Search | select best item | 65 found, 1 picked (S2A_T23KPT_20240902T131357_L2A) · query · datetime-normalised,filter-via-query | 2 | 1650 |
| Earth Search | search first 50 | 50 items | 1 | 628 |
| Planetary Computer | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✗ | 1 | 935 |
| Planetary Computer | all collections | 141 | 1 | 1979 |
| Planetary Computer | collections in area, regional | 5 | 0 | 4 |
| Planetary Computer | describe sentinel-2-l2a | bands 18 · queryables 36 · 2015-06-27T10:25:31Z.. | 1 | 275 |
| Planetary Computer | select best item | 60 found, 1 picked (S2A_MSIL2A_20240902T131241_R138_T23KPT_20240902T194346) · cql2-json · datetime-normalised | 1 | 815 |
| Planetary Computer | search first 50 | 50 items | 1 | 1258 |
| Copernicus Data Space | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✓ | 1 | 1175 |
| Copernicus Data Space | all collections | 428 | 1 | 1341 |
| Copernicus Data Space | collections in area, regional | 12 | 1 | 1276 |
| Copernicus Data Space | describe sentinel-2-l2a | bands 0 · queryables 12 · 2015-06-27T10:25:31Z.. | 1 | 273 |
| Copernicus Data Space | select best item | ✗ No sentinel-2-l2a item meets the selection (0 found by the search; 65 more had no COG or GeoTIFF asset (zipped or vector downloads) and were skipped) (3 failed: 400) | 4 | 2695 |
| Copernicus Data Space | search first 50 | 50 items | 1 | 1834 |
| INPE BDC | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✗ | 1 | 1666 |
| INPE BDC | all collections | 80 | 1 | 1177 |
| INPE BDC | collections in area, regional | 60 | 0 | 1 |
| INPE BDC | describe S2-16D-2 | bands 19 · queryables 5 · 2017-01-01T00:00:00.000000Z..2026-11-16T00:00:00.000000Z (1 failed: 404) | 2 | 555 |
| INPE BDC | select best item | 9 found, 1 picked (S2-16D_V2_032027_20240711) · query · datetime-normalised,filter-via-query | 1 | 582 |
| INPE BDC | search first 50 | 9 items | 1 | 305 |
| swisstopo | connect | search ✓ · CQL2 ✗ · query ✗ · sort ✓ · collection search ✗ | 1 | 1587 |
| swisstopo | all collections | 515 | 6 | 6551 |
| swisstopo | collections in area, regional | 513 | 0 | 7 |
| swisstopo | describe ch.swisstopo.swissalti3d | bands 0 · queryables 2 · 2019-01-01T00:00:00Z..2026-01-01T00:00:00Z | 1 | 544 |
| swisstopo | select best item | 60 found, 29 picked (swissalti3d_2025_2598-1197) · none | 1 | 1268 |
| swisstopo | search first 50 | 50 items | 1 | 1104 |
| eoAPI demo | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✓ | 1 | 990 |
| eoAPI demo | all collections | 41 | 1 | 1187 |
| eoAPI demo | describe copernicus-dem | bands 1 · queryables 3 · 2022-05-09T00:00:00.000000Z..2022-05-10T00:00:00.000000Z | 1 | 248 |
| eoAPI demo | select best item | 200 found, 1 picked (10_S90_00_W180_00) · none | 1 | 2122 |
| eoAPI demo | search first 50 | 50 items | 1 | 350 |
| GEM-15 (static) | connect | static catalog | 1 | 680 |
| GEM-15 (static) | all collections | 1 | 1 | 793 |
| GEM-15 (static) | collections in area, regional | 0 | 0 | 0 |
| GEM-15 (static) | describe gem-15 | bands 6 · queryables 2 · 2026-09-29T14:17:40Z..2026-09-29T14:17:40Z | 0 | 0 |
| GEM-15 (static) | select best item | 1 found, 1 picked (gem-15_wm113s36) · client · static-catalog | 6 | 1249 |
| GEM-15 (static) | search first 50 | 1 items | 6 | 591 |

## After the fixes of the review (same day)

The run before the fixes, with its findings, is in `live-results-before.md`.

| Catalog | Before | After |
|---|---|---|
| GEM-15: list collections | 298 requests, 15.4 s | 1 request, 0.8 s (listing stops at the collection) |
| swisstopo swissALTI3D: select | 60 found, none picked | 60 found, 29 tiles picked as a mosaic (`coverage: "auto"`) |
| Planetary Computer: select | 3 requests | 1 request |
| Earth Search: describe | queryables 1 | queryables 7 (from the queryables link) |
| Copernicus: select | 4 failed (400, 400, 429, 400) | 3 failed (400, 400, 400), no 429 this time |

Copernicus still refuses large pages: the page-size policy (start at 100, read the stated maximum, Fields
extension) is the redesign that waits for its spike.
