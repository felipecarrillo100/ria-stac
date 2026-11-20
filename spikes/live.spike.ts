// Live spike: ria-stac against the catalogs used in the studio, recording requests, time and failures per step.
import {writeFileSync} from "node:fs";
import {it} from "vitest";
import {StacClient, type Bbox, type RiaStacRequest, type StacLink} from "../src/index.js";

/** GEM-15 extents from link names (the studio's rule). */
function gem15LinkBbox(link: StacLink): Bbox | undefined {
    if (!/\/gem-15\//.test(link.href)) return undefined;
    const name = link.title ?? link.href.replace(/\/(catalog|[^/]+)\.json$/, "").split("/").pop() ?? "";
    const sign = (s: string, n: string) => (s === "m" ? -1 : 1) * Number(n);
    let m = /^([pm])(\d+)_([pm])(\d+)$/.exec(name);
    if (m) { const lat = sign(m[1], m[2]), lon = sign(m[3], m[4]); return [lon, lat, lon + 10, lat + 10]; }
    m = /^w([pm]?)(\d+)s([pm]?)(\d+)$/.exec(name);
    if (m) { const lon = sign(m[1], m[2]), lat = sign(m[3], m[4]); return [lon, lat, lon + 1, lat + 1]; }
    return undefined;
}

const VALE: Bbox = [-43.927, -19.99, -43.861, -19.946];   // Águas Claras mine, Brazil
const BERN: Bbox = [7.42, 46.93, 7.47, 46.97];
const CANYON: Bbox = [-112.2, 36.0, -112.0, 36.2];
const TARGETS = [
    {name: "Earth Search", url: "https://earth-search.aws.element84.com/v1", collection: "sentinel-2-c1-l2a", area: VALE, datetime: "2024-06-01/2024-09-30", cloud: 20},
    {name: "Planetary Computer", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "sentinel-2-l2a", area: VALE, datetime: "2024-06-01/2024-09-30", cloud: 20},
    {name: "Copernicus Data Space", url: "https://stac.dataspace.copernicus.eu/v1", collection: "sentinel-2-l2a", area: VALE, datetime: "2024-06-01/2024-09-30", cloud: 20},
    {name: "INPE BDC", url: "https://data.inpe.br/bdc/stac/v1", collection: "S2-16D-2", area: VALE, datetime: "2024-06-01/2024-09-30", cloud: 20},
    {name: "swisstopo", url: "https://data.geo.admin.ch/api/stac/v1", collection: "ch.swisstopo.swissalti3d", area: BERN, datetime: undefined, cloud: undefined},
    {name: "eoAPI demo", url: "https://stac.eoapi.dev", collection: undefined, area: undefined, datetime: undefined, cloud: undefined},
    {name: "GEM-15 (static)", url: "https://storage.googleapis.com/climate-and-sustainability/gem-15/stac/catalog.json", collection: undefined, area: CANYON, datetime: undefined, cloud: undefined},
];

it("runs against the studio's catalogs", async () => {
    const report: string[] = ["| Catalog | Step | Result | Requests | ms |", "|---|---|---|---|---|"];
    for (const t of TARGETS) {
        const requests: RiaStacRequest[] = [];
        const step = async (what: string, run: () => Promise<string>) => {
            const before = requests.length, start = Date.now();
            let result: string;
            try { result = await run(); } catch (e) { result = `✗ ${(e as Error).message.replace(/\s+/g, " ").slice(0, 160)}`; }
            const failed = requests.slice(before).filter((r) => r.status === undefined || r.status >= 400);
            report.push(`| ${t.name} | ${what} | ${result.replace(/\|/g, "/")}${failed.length ? ` (${failed.length} failed: ${[...new Set(failed.map((r) => r.status ?? r.error))].join(", ")})` : ""} | ${requests.length - before} | ${Date.now() - start} |`);
        };
        let client: StacClient | undefined;
        await step("connect", async () => {
            client = await StacClient.connect(t.url, {onRequest: (r) => requests.push(r), crawl: {linkBbox: gem15LinkBbox}});
            const c = client.capabilities;
            return c.staticCatalog ? "static catalog" : `search ${c.itemSearch ? "✓" : "✗"} · CQL2 ${c.filter ? "✓" : "✗"} · query ${c.query ? "✓" : "✗"} · sort ${c.sort ? "✓" : "✗"} · collection search ${(c as {collectionSearch?: unknown}).collectionSearch ? "✓" : "✗"}`;
        });
        if (!client) continue;
        const cl = client;
        await step("all collections", async () => `${(await cl.listCollections()).length}`);
        if (t.area) await step("collections in area, regional", async () => `${(await cl.collections({area: t.area!, regional: true})).length}`);
        const collection = t.collection ?? (await cl.listCollections().catch(() => []))[0]?.id;
        if (!collection) continue;
        await step(`describe ${collection}`, async () => {
            const d = await cl.collection(collection);
            return `bands ${d.bands.length} · queryables ${d.queryables.length} · ${d.interval.join("..")}`;
        });
        await step("select best item", async () => {
            const found = await cl.select({collection, ...(t.area ? {area: t.area} : {}), ...(t.datetime ? {datetime: t.datetime} : {}),
                ...(t.cloud !== undefined ? {maxCloud: t.cloud} : {}), maxItems: 200, pick: {rank: "least-cloud"}});
            return `${found.found} found, ${found.items.length} picked (${found.items[0]?.id ?? "-"}) · ${found.plan.filterEncoding}${found.plan.degradations.length ? ` · ${found.plan.degradations.map((d) => d.kind).join(",")}` : ""}`;
        });
        await step("search first 50", async () => {
            const items = await cl.search({collections: [collection], ...(t.area ? {area: t.area} : {}), ...(t.datetime ? {datetime: t.datetime} : {}), maxItems: 50}).collect();
            return `${items.length} items`;
        });
    }
    console.log(report.join("\n"));
    writeFileSync("spikes/live-results.md", `# Live spike results (${new Date().toISOString().slice(0, 10)})\n\n${report.join("\n")}\n`);
});
