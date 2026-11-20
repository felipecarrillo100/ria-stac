// Records trimmed real items as the shared band naming fixtures (test/fixtures/band-naming.json), with the names the
// rule gives today. Run on demand; review the diff of the expected names before committing.
import {writeFileSync} from "node:fs";
import {it} from "vitest";
import {assetBands, isDataAsset, StacClient, type Bbox, type StacItemJson} from "../src/index.js";
import {nameBands} from "../src/naming.js";

const VALE: Bbox = [-43.927, -19.99, -43.861, -19.946], BERN: Bbox = [7.42, 46.93, 7.47, 46.97], SANTA_CRUZ: Bbox = [-122.05, 36.95, -121.95, 37.0];
const SOURCES = [
    {name: "Planetary Computer Sentinel-2", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "sentinel-2-l2a", area: VALE},
    {name: "Earth Search Sentinel-2", url: "https://earth-search.aws.element84.com/v1", collection: "sentinel-2-c1-l2a", area: VALE},
    {name: "INPE Sentinel-2 cube", url: "https://data.inpe.br/bdc/stac/v1", collection: "S2-16D-2", area: VALE},
    {name: "Planetary Computer Landsat", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "landsat-c2-l2", area: VALE},
    {name: "Planetary Computer NAIP", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "naip", area: SANTA_CRUZ},
    {name: "swisstopo swissALTI3D", url: "https://data.geo.admin.ch/api/stac/v1", collection: "ch.swisstopo.swissalti3d", area: BERN},
    {name: "swisstopo SWISSIMAGE", url: "https://data.geo.admin.ch/api/stac/v1", collection: "ch.swisstopo.swissimage-dop10", area: BERN},
];
const KEEP = ["href", "type", "roles", "title", "gsd", "nodata", "data_type", "unit", "bands", "eo:bands", "raster:bands", "eo:common_name", "raster:scale", "raster:offset"];
const trim = (item: StacItemJson) => ({
    id: item.id, collection: item.collection,
    assets: Object.fromEntries(Object.entries(item.assets).map(([k, a]) => [k, Object.fromEntries(Object.entries(a).filter(([f]) => KEEP.includes(f)))])),
});

it("records fixtures", async () => {
    const cases = [];
    for (const s of SOURCES) {
        const client = await StacClient.connect(s.url);
        const items = await client.search({collections: [s.collection], area: s.area, datetime: s.collection.includes("swiss") || s.collection === "naip" ? undefined : "2024-06-01/2024-09-30", maxItems: 2}).collect(2);
        for (const raw of items) {
            const item = trim(raw) as unknown as StacItemJson;
            const assets = Object.keys(item.assets).filter((k) => isDataAsset(k, item.assets[k])).map((key) => ({key, bands: assetBands(item.assets[key], item)}));
            cases.push({source: s.name, item, expected: nameBands(assets, {itemId: item.id})});
        }
    }
    writeFileSync("test/fixtures/band-naming.json", JSON.stringify({
        description: "Band naming fixtures shared by ria-stac and ria-geotiff: real items (trimmed), with the band names, sources and aliases the naming rule must give. Recorded by spikes/record-naming-fixtures.spike.ts on " + new Date().toISOString().slice(0, 10) + ".",
        cases,
    }, null, 1) + "\n");
});
