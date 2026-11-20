# Changelog

## 0.1.0 (unreleased)

- First version, extracted with its history from ria-geotiff's `ria-geotiff/stac` module: `StacClient` (APIs, static
  catalogs, collection URLs), collection filters (server first, then the client), search with CQL2 or the Query
  extension, item picking, asset resolution and Planetary Computer signing.
- Own errors (`RiaStacError`, `RiaStacProblem`, `StacError`) and HTTP layer (`AccessHook`, `AccessKind`,
  `RiaStacRequest`); LuciadRIA is a peer dependency used for its `HttpRequestOptions` type only.
