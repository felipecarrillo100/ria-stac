import {it} from "vitest";
import {StacClient} from "../src/index.js";
it("media types offered", async () => {
    for (const [url, id] of [["https://data.geo.admin.ch/api/stac/v1", "ch.swisstopo.swissalti3d"], ["https://data.geo.admin.ch/api/stac/v1", "ch.swisstopo.swisstlm3d"],
        ["https://earth-search.aws.element84.com/v1", "sentinel-2-c1-l2a"], ["https://stac.dataspace.copernicus.eu/v1", "sentinel-2-l2a"]]) {
        const c = await StacClient.connect(url);
        for (const n of [1, 20]) {
            const f = await c.collectionMediaTypes(id, {sampleItems: n});
            console.log(`${id} (${f.source}, ${f.items} items): ${f.mediaTypes.map((x) => `${x.mediaType} ×${x.keys.length}`).join(", ")}`);
            if (f.source === "item_assets") break;
        }
    }
});
