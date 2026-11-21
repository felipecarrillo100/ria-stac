# STAC Explorer: design

A demo of ria-stac, made for finding data. STAC only: catalogs, collections, items, assets and metadata, with
footprints and extents on a LuciadRIA map. It reads no data files. No format is preferred: the user chooses formats
from what each collection offers.

**Formats and media types.** ria-stac stays close to STAC and speaks media types (asset `type`, such as
`image/tiff; application=geotiff; profile=cloud-optimized`). The explorer shows formats people know ("COG",
"GeoTIFF", "JPEG 2000"), and `src/formats.ts` is the only place that maps one to the other:

- "COG" only where the media type declares `profile=cloud-optimized`; any other TIFF is "GeoTIFF (COG not
  declared)". Catalogs often leave the profile out, so the user can tick both.
- A format chosen by name is sent to ria-stac as every media type behind it: its usual spellings, and the ones seen
  in the catalog.
- The media types behind each format are in its tooltip, for those who want them.

Sources: the UI research of 2026-11-20 (`research_notes/STAC client implementation review/stac_ui_patterns.md`). It
covers STAC Browser, Planetary Computer Explorer, Copernicus Browser, FilmDrop (the Earth Search console), stac-map,
QGIS, Earthdata Search and EarthExplorer. The pattern numbers below refer to its top-15 list.

## Layout: the one most tools converge on

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STAC Explorer   [ Source: Earth Search ▾ ]  ● Item search  ● Query  ○ CQL2  ● Sort   ⓘ  ⇅ Requests │
├──────────────────────┬──────────────────────────────────────────────┬──────────────────┤
│ ① Browse ② Search ③ Results │                                       │  Item / Collection │
│                      │                                              │  details drawer   │
│  (left panel, 420px) │              LuciadRIA map                   │  (opens on click) │
│                      │   extents (collections) · footprints (items) │                  │
│                      │   ┌──────────────────────────────┐           │  Overview         │
│                      │   │ 142 items · Next · Fetch all │  ← result │  Metadata         │
│                      │   └──────────────────────────────┘    bar    │  Assets           │
│                      │   "Zoom in to search this area" (actions)    │  Links · JSON     │
├──────────────────────┴──────────────────────────────────────────────┴──────────────────┤
│ Requests (drawer): GET /search 200 412 ms · copy as curl                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Tabs, not a wizard.** The three numbered tabs (Browse, Search, Results) can be visited in any order; the next
  one opens by itself when its step is done (choosing a collection opens Search; searching opens Results).
  EarthExplorer's forced wizard is the anti-pattern.
- **The map is the area, unless the user says otherwise.** The view is the search area by default; the area can
  also be the whole world or a bounding box drawn or typed by the user (pattern 9).
  Collection extents and item footprints have distinct styles.

## Top bar

- **Source: any URL the user gives.** A free-entry box (MUI Autocomplete in free-solo mode): type or paste the URL of
  any STAC source and press Enter or Connect.
  - It accepts a STAC API, a static catalog, a collection, or an item collection, from any server. `StacClient.connect`
    works out which it is, and the box says what was found ("STAC API · Item search, CQL2").
  - The known servers are suggestions only, grouped and with a short note ("CQL2; assets need tokens"). They never
    restrict what can be entered.
  - Recently used URLs are remembered in the browser and offered first.
  - The source is in the page URL (`?source=…`), so a link opens the same server.
  - A URL that fails gets its cause explained (CORS, not STAC, not found, needs credentials), with what to try.
- **Capability chips**, from `client.capabilities` and what the client learned (`client.profile`):
  - Item search, Collection search, CQL2 (text/JSON), Query, Sort, Free text, Static catalog.
  - Unsupported ones are greyed out, not hidden, and a tooltip explains each (pattern 1).
  - Learned facts get a warning chip: "CQL2 declared but ignored", "Pages limited to 200".
- **Requests button** with a badge counting failed requests. It opens the requests drawer.

## ① Browse

- **Search field:** a text search on id, title, description and keywords, as you type and on the client. Servers
  search whole words, so the client does it.
- **Filter chips:** Area (The world / Map view, the default / Bounding box, as in Search), "Hide global", "Period"
  (from–to), and "Formats": the same searchable, grouped multi-select as in Search, over the formats of all listed
  collections, with how many collections offer each.
  - A collection's formats come from its `item_assets` (no request), else from one of its items, read when its card
    comes into view (at most 4 at once). "Check the other n" reads the rest, one request each.
  - The list shows the matches. A collection known not to match (its `item_assets` have none of the chosen formats)
    is left out. One that might match (its item read has none of them, or it is not read yet) is behind a line
    "n more might have …: Show them"; shown, it follows the matches, dimmed. A sample shows which formats exist,
    not which do not, so these are never called non-matching.
  - The map draws the extents of exactly the collections listed (text search and formats included), the unsure
    ones faint.
  - The formats ticked here are carried into Search, where the chosen collection offers them.
- **A summary line under them:** "381 of 428 collections · server filtered by area and period, then here", in the
  words of `ServerCollectionSearch` (pattern 8).
- **Collection cards:**
  - title, id, period bar, license
  - keyword chips
  - the formats it offers: solid chips when declared (`item_assets`), dashed when seen in one item
    (`collectionMediaTypes`), or "Formats not known yet"
  - a thumbnail when the collection has one
- **Map link:** hovering a card highlights its extent, clicking a card zooms to it and opens its details, and
  clicking an extent on the map selects the card (pattern 3).
- **Static catalogs** get a tree that loads on demand instead of a flat list.
- **Empty state with one-click fixes:** "No collection in this view: [Search everywhere] [Clear the period]".

## ② Search

The form is built from what the server and the collection support (patterns 1, 2):

- **Collection header:** title, period, and "Change" to go back to Browse.
- **Area:** a three-way choice (segmented buttons):
  - **The world:** no area sent. A note says a search without an area returns the server's first items in its own
    order, not the nearest ones.
  - **Map view** (default): follows the map as it moves, with its size shown ("6 × 5 km").
  - **Bounding box:** drawn on the map (drag a rectangle), or typed as west, south, east, north in degrees.
    - It is drawn as an editable box, with handles to adjust it.
    - "From map view" fills it in from the current view.
    - It stays put while the map moves.
  - The same choice is offered in Browse, for filtering collections.
- **Period:** `TimeRangePicker` (`src/components/`), shared with Browse. It knows nothing about STAC: it takes a
  value (from, to, periods left out; null is an open end) and a domain (the times available), which the explorer
  fills from ria-stac's `timeExtent` (Browse: every collection, declared and widened by the items read; Search: the
  collection's first and last items where the server sorts).
  - **Fields mode:** two date-time fields in UTC, empty for an open end, with presets.
  - **Slider mode:** the whole domain, with a handle for each limited end. A checkbox under each end says whether
    it is limited; unticked, it is open ("any earlier", "any later"), its handle goes and the track runs to the
    edge. Dragging the line between two handles moves both. An ongoing collection runs to now. With auto update,
    the search follows a drag (at most every 0.6 s), not only its release.
  - **Except…:** adds a period to leave out, with its own fields or slider (red), shown as a hatched band on the
    main slider. Sent as a CQL2 filter where the server has CQL2, and tested exactly in the browser.
- **Formats:** a searchable multi-select (Autocomplete with checkboxes; the chosen ones as chips), because a
  collection can offer many formats.
  - Every format offered is listed, grouped by kind: raster (COG, GeoTIFF, JPEG 2000, NetCDF/HDF, Zarr, GRIB),
    vector (GeoJSON, Parquet, GeoPackage, Shapefile, KML, INTERLIS), point clouds and 3D, documents and
    metadata (XML, JSON, PDF, HTML, CSV), and archives (anything zipped).
  - Each format shows how many assets have it, and its media types in a tooltip.
  - None is selected at first; selecting some keeps only items with one of them.
  - The source is shown: "from item_assets (complete)", or "from 1 of the items (may be incomplete)" with a "Look at
    more items" link (`collectionMediaTypes(id, {sampleItems: 25})`).
  - The choice goes to ria-stac as media types (`mediaTypesFilter`), tested in the browser.
- **Typed filters from the queryables:**
  - a number with a range becomes a slider with inputs (cloud cover: 0–100)
  - a list of values becomes a multiselect
  - other properties appear under "More filters"
- **CQL2 (advanced):** a text editor with the queryables as suggestions.
- **Sort:** newest, oldest, least cloud. Hidden when the server cannot sort.
- **Maximum items.**
- **Plan preview** (`client.plan`): "Sent to the server: bbox, datetime, filter (CQL2-JSON) · Tested here: asset
  formats", the degradations in plain words, and "Copy as curl".
- **Search button,** with an "Unapplied changes" badge when the form changed after a search (pattern 8).

## ③ Results

- **Header:** "142 items · 1 page" with an honest count, "n of N" or "n (more available)" (pattern 6).
  - The count is announced to screen readers (`aria-live`), which none of the tools reviewed do.
- **Rows:**
  - date and time, id, cloud cover, coverage of the area
  - format chips, and a thumbnail when one exists
  - virtualised for long lists
- **Map link:**
  - hovering a row highlights its footprint, and hovering a footprint highlights its row
  - clicking either selects the item and opens its details (pattern 3)
  - where footprints overlap, a click lists the hits to choose from (pattern 4)
- **Paging:** a floating result bar on the map with Next page, Fetch all (with a limit) and Cancel (pattern 7).
  Old results are dimmed while new ones load (pattern 5).
- **Timeline:** a strip of the found dates. Clicking a day filters the list.
- **Empty state:** says why, from the library's `rejected` counts and problems, with one-click relaxations
  ("Widen the period", "Search everywhere", "Allow more cloud").
- **Export:** the item collection as JSON (download or copy), the input of ria-geotiff's `stacToManifest`.

## Details drawer (right)

Tabs for a collection or an item:

- **Overview:** key facts (date, platform, cloud, projection, size), the thumbnail, and the bbox with "Zoom to".
- **Metadata:** properties grouped by extension (EO, SAR, Projection, View, Processing…), with human labels and
  units (pattern 12).
- **Assets:** grouped by role (data, overview, metadata), each with format and role chips, its bands named by the
  shared rule (names, aliases), and its access state:
  - "open", "needs a token (Planetary Computer)", "requester pays" or "sign in"
  - plus copy URL and open (pattern 13)
- **Links:** with their relations.
- **JSON:** the raw document, with copy and download.

## Feedback

- **Errors by cause** (pattern 14): CORS ("the server sends no CORS headers: use a proxy"), 401/403 ("needs
  credentials"), 404, 429 ("rate limited: wait"), 5xx, not JSON. Each has a retry button.
- **Map messages with an action** (pattern 10): "Zoom in to search this area", "Zoom to the results".
- **Requests drawer** (pattern 15): every request with method, status, time and redacted URL, copy as curl.
- **URL state:** the source, collection and search are in the URL, so a view can be shared (pattern 15).

## Look

- MUI, dark by default with a light theme, Inter for text and JetBrains Mono for ids and code.
- Dense but calm: small type for metadata, one accent colour (sky) for chosen items and amber for hover, the same on
  the map and in the lists.
- Keyboard: tabs, rows and chips are buttons. Escape closes the drawer, and the arrow keys move through results.
