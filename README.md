# ria-stac

STAC client for LuciadRIA applications: STAC APIs and static catalogs, collection filters, item search and picking
with CQL2, with credentials sent only to the origins they belong to.

ria-stac finds data. It returns plain STAC JSON (collections, items, assets), and another library opens the assets:
[ria-geotiff](https://github.com/felipecarrillo100/geotifftilesetmodel) for Cloud Optimized GeoTIFFs. The two do not
depend on each other: the application passes items from one to the other.

## Install

```bash
npm install ria-stac @luciad/ria
```

`@luciad/ria` is a peer dependency used for its types only (`HttpRequestOptions`): ria-stac contains no LuciadRIA
code, and none of it runs at run time.

## Workflow

```ts
import {StacClient} from "ria-stac";

// 1. Capabilities: connect to an API, a static catalog or a collection URL.
const client = await StacClient.connect("https://earth-search.aws.element84.com/v1");
const collections = await client.collections({area: [15.0, 45.1, 15.1, 45.2], regional: true});

// 2. Choose: check a selection against the collection, then search and pick.
const collection = await client.collection("sentinel-2-c1-l2a");
const problems = client.check({collection: collection.id, area: [15.0, 45.1, 15.1, 45.2], datetime: "2024"}, collection);
const found = await client.select({
    collection: collection.id, area: [15.0, 45.1, 15.1, 45.2], datetime: "2024", maxCloud: 20,
    pick: {coverage: "full", per: "month"},
});

// 3. Open: hand the items to the library that reads their assets, for example ria-geotiff.
// const model = await GeoTiffTileSetModel.create({stac: {items: found.items, per: "month"}});
```

- **Collections** are filtered on the server when it declares STAC Collection Search (map view and period), then
  every test runs again in the client (formats, text, regional), so every server gives the same answer.
- **Search** uses CQL2 on the server when the server declares it, the Query extension otherwise, and tests the rest
  in the client (`ogc-cql2`). `search().plan` says what ran where.
- **Static catalogs** are crawled through their links; an area search skips children whose extent misses the area
  (`crawl.linkBbox` gives extents the catalog does not declare).
- **Pick** chooses the best items: covering the area, the least cloudy, one per period for a time series.

## Protected data

Every request carries LuciadRIA's `credentials`, `requestHeaders` and `requestParameters` (`HttpRequestOptions`).
They are sent only to the origin of the URL they were given for; a redirect to another origin is refused. An
`access` hook decides per request instead, for example to return a renewed token.

## Scripts

`npm run verify` type-checks, tests, builds, checks that no LuciadRIA code is in `lib/`, and lints the package.
`npm run docs` writes the API reference to `build/docs`.

## License

MIT
