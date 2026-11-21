/**
 * The workflow fixes found by the studio's "Add a layer" tab, for the STAC engine: one error shape, a collection URL
 * as the start of a client, cancellable selections with progress and candidates.
 */
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    bboxesIntersect, itemFootprints, itemKey, RiaStacError, SELECT_MAX_ITEMS, SELECT_MAX_ITEMS_LIMIT, selectionToRequest, StacClient, StacError,
    type RiaStacRequest, type StacCollectionJson, type StacItemJson, type StacProgress,
} from "../src/index.js";
import {checkSelection, type CollectionDetails} from "../src/catalog.js";
import {startRangeServer} from "./helpers.js";

type Server = Awaited<ReturnType<typeof startRangeServer>>;
let servers: Server[] = [];
afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
    vi.unstubAllGlobals();
});
async function serve() {
    const s = await startRangeServer();
    servers.push(s);
    return s;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});

/** An item over a lon/lat box. */
function boxItem(id: string, [w, s, e, n]: number[], datetime: string, cloud = 1): StacItemJson {
    return {
        type: "Feature", stac_version: "1.1.0", id, collection: "s2", bbox: [w, s, e, n],
        geometry: {type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]},
        properties: {datetime, "eo:cloud_cover": cloud, "proj:code": "EPSG:32633"}, assets: {data: {href: `https://x.test/${id}.tif`, type: "image/tiff; application=geotiff; profile=cloud-optimized"}},
    } as unknown as StacItemJson;
}

/** A STAC API at https://stac.test/v1 (and its collection s2), answering every search with `found` in pages of 2. */
function stubApi(found: StacItemJson[], seen: { url: string; headers: Headers }[] = [], {delayMs = 0} = {}) {
    const collection = {
        type: "Collection", stac_version: "1.1.0", id: "s2", title: "Sentinel-2",
        extent: {spatial: {bbox: [[-180, -90, 180, 90]]}, temporal: {interval: [[null, null]]}},
        links: [{rel: "root", href: "https://stac.test/v1"}, {rel: "items", href: "https://stac.test/v1/collections/s2/items"}],
    } as unknown as StacCollectionJson;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push({url, headers: new Headers(init?.headers)});
        if (init?.signal?.aborted) throw init.signal.reason;
        if (delayMs) {
            await new Promise((resolve, reject) => {
                const t = setTimeout(resolve, delayMs);
                init?.signal?.addEventListener("abort", () => { clearTimeout(t); reject(init.signal!.reason); }, {once: true});
            });
        }
        if (url === "https://stac.test/v1") return json({type: "Catalog", stac_version: "1.1.0", id: "api", conformsTo: ["https://api.stacspec.org/v1.0.0/item-search"],
            links: [{rel: "search", href: "https://stac.test/v1/search"}, {rel: "data", href: "https://stac.test/v1/collections"}]});
        if (url === "https://stac.test/v1/collections") return json({collections: [collection]});
        if (url === "https://stac.test/v1/collections/s2") return json(collection);
        if (url.startsWith("https://stac.test/v1/search")) {
            const body = init?.body ? JSON.parse(String(init.body)) : {};
            const page = Number(body.page ?? 0);
            const next = (page + 1) * 2 < found.length ? [{rel: "next", href: "https://stac.test/v1/search", method: "POST", body: {page: page + 1}, merge: true}] : [];
            return json({type: "FeatureCollection", features: found.slice(page * 2, page * 2 + 2), numberMatched: found.length, links: next});
        }
        if (url === "https://other.test/collections/s2") {
            return json({...collection, links: [{rel: "root", href: "https://stac.test/v1"}, {rel: "items", href: "https://stac.test/v1/collections/s2/items"}]});
        }
        return json({}, 404);
    }));
}

describe("one error shape", () => {
    it("makes StacError a RiaStacError with problems and JSON", () => {
        const stac = new StacError("HTTP 404", 404, "https://stac.test/x");
        expect(stac).toBeInstanceOf(StacError);
        expect(stac).toBeInstanceOf(RiaStacError);
        expect(Array.isArray(stac.problems)).toBe(true);
        expect(JSON.parse(JSON.stringify(stac))).toEqual({name: "StacError", message: "HTTP 404", problems: [], status: 404, url: "https://stac.test/x"});
    });
});

describe("StacClient.connect with a collection URL", () => {
    it("connects to the API of the collection and preselects it", async () => {
        stubApi([]);
        const client = await StacClient.connect("https://stac.test/v1/collections/s2");
        expect(client.url).toBe("https://stac.test/v1");
        expect(client.collectionId).toBe("s2");
        expect(client.capabilities.itemSearch).toBe(true);
        const api = await StacClient.connect("https://stac.test/v1");
        expect(api.collectionId).toBeUndefined();
    });

    it("sends no headers to an API on another origin than the URL given", async () => {
        const seen: { url: string; headers: Headers }[] = [];
        stubApi([], seen);
        const client = await StacClient.connect("https://other.test/collections/s2", {requestHeaders: {Authorization: "Bearer secret"}});
        expect(client.url).toBe("https://stac.test/v1");
        expect(seen.find((r) => r.url === "https://other.test/collections/s2")!.headers.get("Authorization")).toBe("Bearer secret");
        expect(seen.filter((r) => r.url.startsWith("https://stac.test")).every((r) => !r.headers.has("Authorization"))).toBe(true);
    });

    it("crawls a static collection itself", async () => {
        const s = await serve();
        const client = await StacClient.connect(`${s.url}/static-catalog/s2-sample/collection.json`);
        expect(client.collectionId).toBe("s2-sample");
        expect(client.capabilities.staticCatalog).toBe(true);
        expect((await client.collections()).map((c) => c.id)).toEqual(["s2-sample"]);
    });
});

describe("select: progress, cancel and candidates", () => {
    const area: [number, number, number, number] = [15, 45, 15.1, 45.1];
    const items = [
        boxItem("full-cloudy", [14.9, 44.9, 15.2, 45.2], "2024-06-10T10:00:00Z", 30),
        boxItem("full-clear", [14.9, 44.9, 15.2, 45.2], "2024-07-10T10:00:00Z", 2),
        boxItem("half", [15.05, 44.9, 15.2, 45.2], "2024-07-12T10:00:00Z", 0),
        boxItem("winter", [14.9, 44.9, 15.2, 45.2], "2024-01-10T10:00:00Z", 0),
    ];

    it("reports progress per page, and every candidate with the reason it was not picked", async () => {
        stubApi(items);
        const client = await StacClient.connect("https://stac.test/v1");
        const progress: StacProgress[] = [];
        const found = await client.select({collection: "s2", area, pick: {months: [6, 7, 8]}}, {onProgress: (p) => progress.push(p)});
        expect(progress.map((p) => p.step)).toEqual(["collection", "search", "search", "pick"]);
        expect(progress[1]).toEqual({step: "search", pages: 1, scanned: 2, kept: 2, matched: 4});
        expect(progress[3]).toMatchObject({pages: 2, scanned: 4, kept: 4});
        expect(found.items.map((i) => i.id)).toEqual(["full-clear"]);
        const reasons = Object.fromEntries(found.candidates.map((c) => [c.item.id, c.picked ? "picked" : c.reason]));
        expect(reasons).toEqual({"full-cloudy": "rank", "full-clear": "picked", half: "coverage", winter: "months"});
        expect(found.candidates.find((c) => c.item.id === "half")!.coverage).toBeCloseTo(0.5, 1);
        expect(found.candidates.find((c) => c.item.id === "full-clear")!.coverage).toBe(1);
    });

    it("says which rule excluded the items when none is left", async () => {
        stubApi([items[2], items[3]]);
        const client = await StacClient.connect("https://stac.test/v1");
        const error = await client.select({collection: "s2", area, pick: {months: [6, 7, 8], coverage: "full"}}).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(StacError);
        expect((error as StacError).problems.map((p) => p.path)).toEqual(["pick.months", "pick.coverage"]);
        expect((error as StacError).problems[1].message).toContain('use coverage "best"');
    });

    it("picks one covering item when there is one, else a mosaic of tiles (coverage auto, the default)", async () => {
        // Four tiles that each cover a quarter of the area, as swisstopo's 1 km swissALTI3D tiles do for a view.
        const [w, s, e, n] = [7.4, 46.9, 7.6, 47.1];
        const mx = (w + e) / 2, my = (s + n) / 2;
        const tiles = [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]].map((b, i) => boxItem(`tile${i}`, b as [number, number, number, number], "2024-06-01T10:00:00Z"));
        stubApi(tiles);
        let client = await StacClient.connect("https://stac.test/v1");
        let found = await client.select({collection: "s2", area: [w + 0.01, s + 0.01, e - 0.01, n - 0.01]});
        expect(found.items.map((i) => i.id).sort()).toEqual(["tile0", "tile1", "tile2", "tile3"]);
        expect(found.problems.map((p) => p.path)).toContain("pick.coverage");
        // One item that contains the area: that item alone.
        stubApi([...tiles, boxItem("big", [w - 1, s - 1, e + 1, n + 1], "2024-05-01T10:00:00Z")]);
        client = await StacClient.connect("https://stac.test/v1");
        found = await client.select({collection: "s2", area: [w + 0.01, s + 0.01, e - 0.01, n - 0.01]});
        expect(found.items.map((i) => i.id)).toEqual(["big"]);
    });

    it("aborts the requests and rejects with the signal's reason", async () => {
        stubApi(items, [], {delayMs: 50});
        const client = await StacClient.connect("https://stac.test/v1");
        const controller = new AbortController();
        const pending = client.select({collection: "s2", area}, {signal: controller.signal, onProgress: (p) => { if (p.step === "search") controller.abort(); }});
        await expect(pending).rejects.toMatchObject({name: "AbortError"});
        const search = client.search({collections: ["s2"]}, {signal: AbortSignal.abort()});
        await expect(search.collect()).rejects.toMatchObject({name: "AbortError"});
    });
});

describe("item keys and footprints", () => {
    it("keys items by collection and id, and draws footprints with those keys", () => {
        const a = boxItem("x", [15, 45, 15.1, 45.1], "2024-06-01T10:00:00Z");
        const b = {...boxItem("x", [15, 45, 15.1, 45.1], "2024-06-01T10:00:00Z"), collection: "landsat"} as StacItemJson;
        expect([itemKey(a), itemKey(b)]).toEqual(["s2/x", "landsat/x"]);
        const fc = itemFootprints([a, {...b, geometry: undefined} as unknown as StacItemJson]);
        expect(fc.features.map((f) => f.id)).toEqual(["s2/x", "landsat/x"]);
        expect(fc.features[0].properties).toMatchObject({key: "s2/x", id: "x", collection: "s2", "eo:cloud_cover": 1});
        expect((fc.features[1].geometry as { type: string }).type).toBe("MultiPolygon");
    });

    it("gives the search request of a selection", () => {
        expect(selectionToRequest({collection: "s2", area: [15, 45, 16, 46], datetime: "2024", maxCloud: 20, where: {platform: {eq: "a"}}, bands: ["red"]}))
            .toEqual({collections: ["s2"], area: [15, 45, 16, 46], datetime: "2024", where: {platform: {eq: "a"}, "eo:cloud_cover": {lt: 20}}, limit: 100, maxItems: SELECT_MAX_ITEMS});
        expect(SELECT_MAX_ITEMS).toBe(400);
        expect(selectionToRequest({collection: "s2", maxItems: 1000}).maxItems).toBe(1000);
    });

    it("accepts maxItems from 1 to 1000, whole numbers only", () => {
        const details = {id: "s2", interval: [null, null], bands: [], properties: [], bandNaming: "none", queryables: [], assets: [], commonNames: [], raw: {}} as unknown as CollectionDetails;
        const errors = (maxItems: number) => checkSelection({collection: "s2", maxItems}, details).filter((p) => p.path === "maxItems");
        for (const ok of [1, 200, 437, SELECT_MAX_ITEMS_LIMIT]) expect(errors(ok)).toEqual([]);
        for (const bad of [0, -5, 1001, 2.5, Number.NaN]) expect(errors(bad)[0]?.severity).toBe("error");
    });

    it("keeps included collections in a filtered list, without new requests", async () => {
        const seen: { url: string; headers: Headers }[] = [];
        stubApi([], seen);
        const client = await StacClient.connect("https://stac.test/v1");
        expect(await client.collections({area: [100, 0, 101, 1], q: "nothing"})).toEqual([]);
        const before = seen.length;
        expect((await client.collections({q: "nothing", include: ["s2"]})).map((c) => c.id)).toEqual(["s2"]);
        expect(seen.length).toBe(before);
        expect(bboxesIntersect([170, 0, -170, 1], [175, 0, 176, 1])).toBe(true);
    });
});

describe("static crawls with broken links", () => {
    const docs: Record<string, unknown> = {
        "https://static.test/catalog.json": {type: "Catalog", stac_version: "1.1.0", id: "root", links: [
            {rel: "child", href: "./good/collection.json"}, {rel: "child", href: "./gone/collection.json"}]},
        "https://static.test/good/collection.json": {type: "Collection", stac_version: "1.1.0", id: "good",
            extent: {spatial: {bbox: [[15, 45, 16, 46]]}, temporal: {interval: [[null, null]]}},
            links: [{rel: "item", href: "./a.json"}, {rel: "item", href: "./missing.json"}]},
        "https://static.test/good/a.json": {...boxItem("a", [15, 45, 15.1, 45.1], "2024-06-01T10:00:00Z"), collection: "good"},
    };
    const stub = () => vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
        const doc = docs[String(input)];
        return doc ? json(doc) : json({}, 404);
    }));

    it("skips documents that cannot be read and lists them", async () => {
        stub();
        const client = await StacClient.connect("https://static.test/catalog.json", {retry: {attempts: 1}});
        expect((await client.collections()).map((c) => c.id)).toEqual(["good"]);
        const items = await client.search({collections: ["good"]}).collect();
        expect(items.map((i) => i.id)).toEqual(["a"]);
        expect(client.crawlProblems.map((p) => [p.url, p.status])).toEqual([
            ["https://static.test/gone/collection.json", 404], ["https://static.test/good/missing.json", 404]]);
    });

    it("throws with crawl.onError: throw", async () => {
        stub();
        const client = await StacClient.connect("https://static.test/catalog.json", {retry: {attempts: 1}, crawl: {onError: "throw"}});
        await expect(client.collections()).rejects.toMatchObject({status: 404});
    });
});

describe("OGC API - Features without item search", () => {
    const items = [boxItem("a", [15, 45, 15.2, 45.2], "2024-06-01T10:00:00Z", 5), boxItem("b", [15, 45, 15.2, 45.2], "2024-07-01T10:00:00Z", 50),
        boxItem("c", [15, 45, 15.2, 45.2], "2024-08-01T10:00:00Z", 1)];
    const stubFeatures = (requests: string[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
        const url = String(input).replace(/^https:\/\/features\.test\/$/, "https://features.test");
        requests.push(url);
        const collection = {type: "Collection", id: "s2", extent: {spatial: {bbox: [[-180, -90, 180, 90]]}, temporal: {interval: [[null, null]]}}, links: []};
        if (url === "https://features.test/collections/s2") return json(collection);
        if (url === "https://features.test") return json({type: "Catalog", stac_version: "1.1.0", id: "f",
            conformsTo: ["http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core"], links: [{rel: "data", href: "https://features.test/collections"}]});
        if (url === "https://features.test/collections") return json({collections: [collection]});
        if (url.startsWith("https://features.test/collections/s2/items")) {
            const page = Number(new URL(url).searchParams.get("page") ?? 0);
            const next = page === 0 ? [{rel: "next", href: `https://features.test/collections/s2/items?page=1`}] : [];
            return json({type: "FeatureCollection", features: items.slice(page * 2, page * 2 + 2), links: next});
        }
        return json({}, 404);
    }));

    it("select keeps every media type by default, and with mediaTypes skips items without one, so they do not use up maxItems", async () => {
        const zipped = (id: string) => ({...boxItem(id, [15, 45, 15.1, 45.1], "2024-06-01T00:00:00Z"),
            assets: {xyz: {href: `https://x.test/${id}.xyz.zip`, type: "application/x.ascii-xyz+zip"}}});
        const original = [...items];
        const COG = "image/tiff; application=geotiff; profile=cloud-optimized", TIFF = "image/tiff; application=geotiff";
        try {
            // The stub serves two pages of two: the COG comes after three zipped tiles, beyond maxItems: 2.
            items.splice(0, items.length, zipped("z1"), zipped("z2"), zipped("z3"), boxItem("cog", [14.9, 44.9, 15.2, 45.2], "2024-05-28T00:00:00Z"));
            stubFeatures([]);
            const client = await StacClient.connect("https://features.test");
            // No media type preferred: the zipped tiles count like any other item.
            const all = await client.select({collection: "s2", area: [15, 45, 15.1, 45.1], maxItems: 2, pick: {coverage: "best"}});
            expect(all).toMatchObject({found: 2, skipped: 0});
            const result = await client.select({collection: "s2", area: [15, 45, 15.1, 45.1], maxItems: 2, mediaTypes: [COG, TIFF], pick: {coverage: "best"}});
            expect(result.items.map((i) => i.id)).toEqual(["cog"]);
            expect(result).toMatchObject({found: 1, skipped: 3});
            expect(result.candidates.map((c) => c.item.id)).toEqual(["cog"]);
            expect(result).toMatchObject({scanned: 4, truncated: false});
            // maxScanned stops the search before the COG: said in the error, with advice in its problems.
            const stopped = await client.select({collection: "s2", area: [15, 45, 15.1, 45.1], maxScanned: 2, mediaTypes: [COG, TIFF]}).catch((e: StacError) => e);
            expect((stopped as StacError).message).toMatch(/stopped after reading 2 items \(maxScanned\)/);
            expect((stopped as StacError).problems).toContainEqual(expect.objectContaining({path: "mediaTypes", message: expect.stringMatching(/narrow the area or the period/)}));
            // mediaTypes: [COG] skips a GeoTIFF without the COG profile; an unopenable format is refused.
            const plain = {...boxItem("plain", [14.9, 44.9, 15.2, 45.2], "2024-05-29T00:00:00Z"),
                assets: {data: {href: "https://x.test/plain.tif", type: "image/tiff; application=geotiff"}}};
            items.splice(0, items.length, plain, boxItem("cog", [14.9, 44.9, 15.2, 45.2], "2024-05-28T00:00:00Z"));
            const cogs = await client.select({collection: "s2", area: [15, 45, 15.1, 45.1], mediaTypes: [COG], pick: {coverage: "best"}});
            expect(cogs).toMatchObject({found: 1, skipped: 1});
            // Any media type works, and an empty list is refused.
            items.splice(0, items.length, zipped("z1"), zipped("z2"), boxItem("cog", [14.9, 44.9, 15.2, 45.2], "2024-05-28T00:00:00Z"));
            expect((await client.select({collection: "s2", area: [15, 45, 15.1, 45.1], mediaTypes: ["application/x.ascii-xyz+zip"], pick: {coverage: "best"}})).items.every((i) => i.id.startsWith("z"))).toBe(true);
            await expect(client.select({collection: "s2", mediaTypes: []})).rejects.toThrow(/mediaTypes must list at least one media type/);
            items.splice(0, items.length, zipped("z1"), zipped("z2"));
            await expect(client.select({collection: "s2", area: [15, 45, 15.1, 45.1], mediaTypes: [COG, TIFF]})).rejects.toThrow(/2 more had no asset of type image\/tiff; application=geotiff; profile=cloud-optimized or image\/tiff; application=geotiff and were skipped/);
        } finally {
            items.splice(0, items.length, ...original);
        }
    });

    it("searches a collection through its items endpoint, filtering on the client", async () => {
        const requests: string[] = [];
        stubFeatures(requests);
        const client = await StacClient.connect("https://features.test");
        expect(client.capabilities.search).toBe("collection-items");
        const search = client.search({collections: ["s2"], area: [15, 45, 15.1, 45.1], datetime: "2024", where: {"eo:cloud_cover": {lt: 10}}});
        expect(search.plan.filterEncoding).toBe("client");
        expect(search.plan.degradations.map((d) => d.kind)).toContain("collection-items");
        expect((await search.collect()).map((i) => i.id)).toEqual(["a", "c"]);
        const first = new URL(requests.find((u) => u.includes("/items"))!);
        expect(first.searchParams.get("bbox")).toBe("15,45,15.1,45.1");
        expect(first.searchParams.get("datetime")).toMatch(/^2024-01-01T00:00:00(\.000)?Z\/2024-12-31T23:59:59(\.999)?Z$/);
        expect(() => client.search({collections: ["s2", "other"]})).toThrow(StacError);
        const found = await client.select({collection: "s2", area: [15, 45, 15.1, 45.1]});
        expect(found.items.map((i) => i.id)).toEqual(["c"]);
    });
});

// ------------------------------------------------------------------------------------------- low findings 16–21

describe("onRequest, empty-selection reasons, band naming", () => {
    it("reports every request of a client", async () => {
        const stac: RiaStacRequest[] = [];
        stubApi([]);
        await StacClient.connect("https://stac.test/v1", {onRequest: (r) => stac.push(r)});
        expect(stac[0]).toMatchObject({url: "https://stac.test/v1", kind: "stac-api", status: 200});
    });

    it("says which requirement tested in the browser excluded the items", async () => {
        const s = await serve();
        const client = await StacClient.connect(`${s.url}/static-catalog/catalog.json`);
        const area: [number, number, number, number] = [15.002, 45.145, 15.012, 45.15];
        const error = await client.select({collection: "s2-sample", area, datetime: ["2024-07-01", "2025-05-31"]}).catch((e: unknown) => e);
        expect((error as StacError).problems).toEqual([{path: "datetime", severity: "warning", message: "excluded 2 of the 2 item(s) read: widen it to keep them"}]);
        const cloud = await client.select({collection: "s2-sample", area, maxCloud: 1}).catch((e: unknown) => e);
        expect((cloud as StacError).problems.map((p) => p.path)).toEqual(["maxCloud"]);
        expect((await client.collections())[0].bandNaming).toBe("common-names");
    });
});
