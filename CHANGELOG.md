# Changelog

## 0.1.0 (unreleased)

### Media types instead of formats (2026-11-21)

Breaking, before the first release: the library names assets by their media type (STAC asset `type`), as the
standard does, and leaves names for people ("COG", "GeoTIFF") to applications.

- Renamed: `assetFormat` → `assetMediaType` (`{mediaType, inferred}`), `itemFormats` → `itemMediaTypes`,
  `formatsFilter` → `mediaTypesFilter`, the client-side CQL2 property `asset_formats` → `asset_media_types`
  (`ASSET_MEDIA_TYPES`), `collectionFormats` → `collectionMediaTypes` (`CollectionMediaTypes`, with `untyped`
  keys and an `inferred` flag per media type), `StacSelection.formats` → `mediaTypes`, and
  `CollectionDescription.assets[].format` → `mediaType`. `AssetFormat` and the format names are gone.
- `normaliseMediaType`: one spelling per media type (case, spaces, quotes and parameter order do not matter, as in
  RFC 6838). Media types are compared in that spelling and otherwise exactly: `image/tiff; application=geotiff`
  does not match a COG.
- An asset without `type` gets the media type of its file extension (`.tif` → `image/tiff`), marked `inferred`.
- `CollectionSummary.mediaTypes` and `mediaTypeSource`: the media types of `item_assets`, with no request.
- `mediaTypeMatch(known, wanted)`: `"match"`, `"no-match"` (only when `item_assets` say so), `"not-in-sample"`
  (the items read have none, others may) or `"unknown"`.
- `CollectionFilter.mediaTypes` (with `mediaTypesUnsure: "keep" | "drop"`, default keep): drops only the
  collections known not to match. Tested in the client; no server filters collections on asset media types.

### Excluded periods and time extents (2026-11-21)

- `exceptDatetime` on search requests, selections and collection filters: periods to leave out, in the forms of
  `datetime` (open ends allowed). STAC's `datetime` takes one interval only, so they go as a CQL2 filter:
  - The server gets `datetime < a OR end_datetime < a OR datetime > b` per period, ANDed with the other
    predicates: basic CQL2 on `datetime` and `end_datetime` only, because Planetary Computer (pgstac) answers HTTP
    500 to `start_datetime` and `IS NULL`. It is exact for items with an instant.
  - The client then tests the exact rule on every item (an item is left out when its span overlaps a period;
    `exceptFilter` gives it as CQL2), which covers items with a span, servers without CQL2, the Query extension
    and static catalogs. Verification of the server's filter does not count these items as violations.
  - Collections are left out when their whole declared period lies inside an excluded one.
  - `check` reports a period open at both ends, and one that covers the whole of `datetime`.
- `timeExtent(collections?, {exact, area})`: the time span to offer in a period picker. Declared periods (their
  union), widened by the items read, and with `exact` the first and last items of a sorted search; each end says
  where it comes from and whether the data goes on (`openEnd`).
- `seenTimeExtent(collections?)`: the earliest and latest times of every item the client has read (searches,
  crawls, `dateRange`), with no request.
- `dateRange` ignores `exceptDatetime` as it ignores `datetime`.

### No format preference (2026-11-20)

- ria-stac prefers no format; which formats matter is the application's or the user's choice:
  - `select()` keeps every item by default. `formats` takes any names `assetFormat` gives (`"COG"`, `"JPEG 2000"`,
    `"Zarr"`, `"XYZ (zipped)"`, ...).
  - `isDataAsset` is any asset that holds data (not thumbnails, overviews, previews or metadata), whatever its
    format.
  - `CollectionDescription.assets` lists them all, each with its `format`.
  - `AssetFormat` loses `openable`, which belonged to ria-geotiff, and gains `zipped`.

### Band naming (2026-11-20)

- Band naming (evidence: `spikes/BAND-NAMING.md` of ria-stac, nine real collections): names stay roles first (EO
  common name when unique, else the asset key), which keeps styles portable across catalogs. New:
  - Keys lose the item's id before naming (`stableAssetKey`): swisstopo's per-tile keys
    (`swissalti3d_2019_2598-1198_0.5_2056_5728.tif`) gave every tile its own band; now the tiles of a mosaic share
    one band per resolution (SWISSIMAGE: 6 tiles, 2 bands instead of 12).
  - Aliases (`nameBands`, `resolveBandName`): each band also answers to its asset key, band name and common name, so a
    style naming `B04` or `OLI_B4` finds `red`; resolving through an alias is reported. A common name several bands
    share (`rededge`) is no alias.
  - Each name says where it comes from (`BandNameSource`).
  - A multiband band whose name a single-band asset already has gets the asset key as a prefix (Planetary
    Computer's `visual` gives `visual_red`, not a second `red`).
  - The rule is in `naming.ts`, identical in ria-stac and ria-geotiff, tested by both on the shared fixtures of real
    items `test/fixtures/band-naming.json`.

### Fixed and changed after the implementation review (2026-11-20)

Evidence: the STAC API specifications, the code of other clients and servers, and live runs on Earth Search,
Planetary Computer, Copernicus Data Space, INPE, swisstopo, the eoAPI demo and GEM-15 (`spikes/live-results.md`).

- Relative hrefs of API responses (landing page links, `/collections` pages, search `next` links, item assets) are
  resolved against the URL of the response that carried them; before, only static catalogs were.
- The search method follows the `search` links: POST only when a link declares it (or when no link declares any
  method, as INPE's), GET otherwise; CQL2-text is always sent with GET (POST bodies carry CQL2-JSON only); a
  first-page POST that fails without an HTTP status (a refused CORS preflight) falls back to GET.
- Collections, items and queryables come from links: `{data link}/{id}`, the collection's `items` link (items by id
  through a search when the server has no OGC API - Features endpoint), and the `queryables` link, asked for with
  `Accept: application/schema+json`. Queryables are requested only when the Filter extension is declared (INPE and
  swisstopo answered 404).
- Redirects: a browser hides the target of `redirect: "manual"`, so every redirect of a request with headers or
  parameters was refused. Now a probe without any secret (no headers or parameters of the options, no cookies)
  finds where the redirect ends; the request is sent with its secrets only when that is the same origin, straight to
  the final URL. A redirect to another origin, one that happens only with credentials, a second redirect, and a
  redirected POST are refused. Checked in Chromium: browsers drop `Authorization` on a cross-origin redirect but
  forward other headers such as `X-Api-Key`, and a server may copy query parameters into its redirect, which is why
  following blindly is not safe.
- `Retry-After` is read as seconds or an HTTP date; a server asking to wait longer than `retry.maxWaitMs`
  (default 60 s) is not retried.
- A page of 1000 collections that does not come within 10 s is asked again with the server's default page size.
- `Pick.coverage` gains `"auto"`, the new default: one item when one contains the whole area, else the fewest items
  that cover it, with a warning (swisstopo's 1 km swissALTI3D tiles: 29 picked instead of none).
- `assetBands(asset, item?)` follows STAC 1.1 inheritance: band fields on the asset itself (one band when it has no
  band array), asset-level `raster:scale` / `raster:offset`, then the item's properties.
- Requester-pays storage is found through the storage extension v2 (`storage:refs` and `storage:schemes`).
- Static catalogs: listing collections stops at a collection (`crawl.nestedCollections` to look inside): GEM-15 is
  listed with 1 request instead of 298. `CollectionDescription.itemIndex` reports a stac-geoparquet mirror or
  Planetary Computer's `geoparquet-items` asset.
- Free-text `q` is a list of terms for basic free-text search and one string for advanced
  (`StacCapabilities.freeTextAdvanced`); ranking and sorting fall back to `start_datetime`.
- No dependency on LuciadRIA: `HttpRequestOptions`, `HttpRequestHeaders` and `HttpRequestParameters` are ria-stac's
  own types, with the same shape as LuciadRIA's.

Not done yet (each needs a spike or a live test first): the page-size policy (Copernicus refuses pages above 200),
request pacing, one async access hook with path-prefix scoping, band naming by asset key with aliases, the Fields
extension in `select`, and reading stac-geoparquet indexes.

### First version

- First version, extracted with its history from ria-geotiff's `ria-geotiff/stac` module: `StacClient` (APIs, static
  catalogs, collection URLs), collection filters (server first, then the client), search with CQL2 or the Query
  extension, item picking, asset resolution and Planetary Computer signing.
- Own errors (`RiaStacError`, `RiaStacProblem`, `StacError`) and HTTP layer (`AccessHook`, `AccessKind`,
  `RiaStacRequest`, `HttpRequestOptions`). No dependency on LuciadRIA: `HttpRequestOptions` has the same shape as
  LuciadRIA's, so the same objects serve both.
