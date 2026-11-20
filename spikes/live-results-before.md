# Live spike results (2026-11-20)

| Catalog | Step | Result | Requests | ms |
|---|---|---|---|---|
| Earth Search | connect | search ✓ · CQL2 ✗ · query ✓ · sort ✓ · collection search ✗ | 1 | 681 |
| Earth Search | all collections | 9 | 1 | 939 |
| Earth Search | collections in area, regional | 0 | 0 | 2 |
| Earth Search | describe sentinel-2-c1-l2a | bands 17 · queryables 1 · 2015-06-27T10:25:31.456000Z.. | 1 | 339 |
| Earth Search | select best item | 65 found, 1 picked (S2A_T23KPT_20240902T131357_L2A) · query · datetime-normalised,filter-via-query | 3 | 2007 |
| Earth Search | search first 50 | 50 items | 1 | 766 |
| Planetary Computer | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✗ | 1 | 962 |
| Planetary Computer | all collections | 140 | 1 | 1830 |
| Planetary Computer | collections in area, regional | 5 | 0 | 2 |
| Planetary Computer | describe sentinel-2-l2a | bands 18 · queryables 36 · 2015-06-27T10:25:31Z.. | 1 | 286 |
| Planetary Computer | select best item | 60 found, 1 picked (S2A_MSIL2A_20240902T131241_R138_T23KPT_20240902T194346) · cql2-json · datetime-normalised | 3 | 1427 |
| Planetary Computer | search first 50 | 50 items | 1 | 1239 |
| Copernicus Data Space | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✓ | 1 | 1670 |
| Copernicus Data Space | all collections | 428 (1 failed: The operation was aborted due to timeout) | 2 | 32918 |
| Copernicus Data Space | collections in area, regional | 12 | 1 | 1498 |
| Copernicus Data Space | describe sentinel-2-l2a | bands 0 · queryables 12 · 2015-06-27T10:25:31Z.. | 1 | 282 |
| Copernicus Data Space | select best item | ✗ No sentinel-2-l2a item meets the selection (0 found by the search; 65 more had no COG or GeoTIFF asset (zipped or vector downloads) and were skipped) (4 failed: 400, The operation was aborted due to timeout) | 7 | 34893 |
| Copernicus Data Space | search first 50 | 50 items | 1 | 1709 |
| INPE BDC | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✗ | 1 | 2324 |
| INPE BDC | all collections | 80 | 1 | 1173 |
| INPE BDC | collections in area, regional | 60 | 0 | 3 |
| INPE BDC | describe S2-16D-2 | bands 19 · queryables 5 · 2017-01-01T00:00:00.000000Z..2026-11-16T00:00:00.000000Z (1 failed: 404) | 1 | 270 |
| INPE BDC | select best item | 9 found, 1 picked (S2-16D_V2_032027_20240711) · query · datetime-normalised,filter-via-query (2 failed: 404) | 3 | 1135 |
| INPE BDC | search first 50 | 9 items | 1 | 310 |
| swisstopo | connect | search ✓ · CQL2 ✗ · query ✗ · sort ✓ · collection search ✗ | 1 | 2964 |
| swisstopo | all collections | 515 | 6 | 6724 |
| swisstopo | collections in area, regional | 513 | 0 | 1 |
| swisstopo | describe ch.swisstopo.swissalti3d | bands 0 · queryables 2 · 2019-01-01T00:00:00Z..2026-01-01T00:00:00Z (1 failed: 404) | 3 | 1146 |
| swisstopo | select best item | ✗ No ch.swisstopo.swissalti3d item meets the selection (60 found by the search) (1 failed: 404) | 4 | 1587 |
| swisstopo | search first 50 | 50 items | 1 | 1233 |
| eoAPI demo | connect | search ✓ · CQL2 ✓ · query ✓ · sort ✓ · collection search ✓ | 1 | 1159 |
| eoAPI demo | all collections | 41 | 1 | 1071 |
| eoAPI demo | describe copernicus-dem | bands 1 · queryables 3 · 2022-05-09T00:00:00.000000Z..2022-05-10T00:00:00.000000Z | 1 | 237 |
| eoAPI demo | select best item | 200 found, 1 picked (10_S90_00_W180_00) · none | 2 | 4630 |
| eoAPI demo | search first 50 | 50 items | 1 | 482 |
| GEM-15 (static) | connect | static catalog | 1 | 1015 |
| GEM-15 (static) | all collections | 1 | 298 | 15366 |
| GEM-15 (static) | collections in area, regional | 0 | 0 | 0 |
| GEM-15 (static) | describe gem-15 | bands 6 · queryables 2 · 2026-09-29T14:17:40Z..2026-09-29T14:17:40Z | 0 | 0 |
| GEM-15 (static) | select best item | 1 found, 1 picked (gem-15_wm113s36) · client · static-catalog | 6 | 1057 |
| GEM-15 (static) | search first 50 | 1 items | 6 | 616 |

## Findings from the run

1. **Copernicus rejects large pages instead of clamping them** (against the Item Search rule that `limit` is a
   suggestion). `POST /search` with `limit` 1000 answers 400 `LimitValidationError`: "Limit of 1000 exceeds
   maximum of 200 for sentinel-2-l2a ... To use limit > 100, you must use the 'fields' extension". Our retry halves
   the limit (1000 → 500 → 250) and the third quick request hits the WAF: 429 "Rate limit exceeded". The search
   succeeds only after four failed requests. Fixes to weigh: remember the working page size per server and
   collection; read the stated maximum from the error; start at a safer size; use the Fields extension (the
   server asks for it) to request only id, bbox, geometry, datetime, cloud cover, assets and links.
2. **Copernicus `GET /collections?limit=1000` once took 33 s and timed out** in the first run; the second run took
   1.5 s. Transient, but one slow page should not stall the whole list: it needs a time budget and a fallback to
   the server's default page size.
3. **Copernicus Sentinel-2 L2A items have no COG or GeoTIFF asset** (JPEG 2000 in SAFE products): 65 items found and
   all skipped, as designed. The message says so.
4. **swisstopo: 60 swissALTI3D tiles found, none picked**: the default pick for an area wants one item that
   contains the whole area (`coverage: "full"`), and 1 km tiles never do. Picking "best" (a mosaic) works. For
   tiled products the default pick is the wrong one.
5. **Per-collection queryables return 404** on INPE and swisstopo; handled (falls back to summaries).
6. **GEM-15**: listing collections reads all 298 documents (15 s, the known caveat); the area search reads 6 and
   finds the right cell (wm113s36 for the Grand Canyon west of 112° W).
7. Earth Search, Planetary Computer, INPE and the eoAPI demo behave as in the studio; CQL2 runs on the server where
   declared (PC, CDSE), the Query extension otherwise (Earth Search, INPE).
