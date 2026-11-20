// Per-tile asset keys (swisstopo): is "asset key without the item id" stable across a collection's items?
import {it} from "vitest";
import {StacClient, type Bbox} from "../src/index.js";

it("tile keys", async () => {
    const BERN: Bbox = [7.42, 46.93, 7.47, 46.97];
    const client = await StacClient.connect("https://data.geo.admin.ch/api/stac/v1");
    for (const collection of ["ch.swisstopo.swissalti3d", "ch.swisstopo.swissimage-dop10", "ch.swisstopo.swisssurface3d-raster"]) {
        const items = await client.search({collections: [collection], area: BERN, maxItems: 30}).collect();
        const raw = new Set(items.flatMap((i) => Object.keys(i.assets)));
        const stripped = new Set(items.flatMap((i) => Object.keys(i.assets).map((k) => (k.startsWith(i.id) ? k.slice(i.id.length) : k))));
        const sample = items[0] ? Object.entries(items[0].assets).map(([k, a]) => `${k} (${a.type}, gsd ${(a as {gsd?: number}).gsd ?? "-"})`) : [];
        console.log(`${collection}: ${items.length} items, ${raw.size} distinct keys → ${stripped.size} after stripping the item id: ${[...stripped].join(" | ")}\n   e.g. ${items[0]?.id}: ${sample.join("; ")}`);
    }
});
