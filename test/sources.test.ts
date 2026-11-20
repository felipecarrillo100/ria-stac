import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {StacClient, type StacCollectionJson, type StacItemJson} from "../src/index.js";
import {startRangeServer} from "./helpers.js";

let server: Awaited<ReturnType<typeof startRangeServer>>;
beforeAll(async () => { server = await startRangeServer(); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
/** A STAC item over the Sentinel-2 fixtures (UTM 33N, 500000 E / 5000000 N). */
function s2Item(id: string, date: string, cloud = 1): StacItemJson {
    return {
        type: "Feature", id, collection: "s2", bbox: [15.0, 45.12, 15.03, 45.15],
        geometry: {type: "Polygon", coordinates: [[[15.0, 45.12], [15.03, 45.12], [15.03, 45.15], [15.0, 45.15], [15.0, 45.12]]]},
        properties: {datetime: date, "eo:cloud_cover": cloud},
        assets: {
            red: {href: `${server.url}/s2-red-10m.tif`, type: "image/tiff", "eo:bands": [{common_name: "red"}], "raster:bands": [{scale: 0.0001, offset: -0.1, nodata: 0}]},
            nir: {href: `${server.url}/s2-nir-10m.tif`, type: "image/tiff", "eo:bands": [{common_name: "nir"}], "raster:bands": [{scale: 0.0001, offset: -0.1, nodata: 0}]},
            scl: {href: `${server.url}/s2-scl-20m.tif`, type: "image/tiff", roles: ["data"]},
        },
    } as StacItemJson;
}

describe("StacClient: capabilities and choice", () => {
    const collection: StacCollectionJson = {
        id: "s2", title: "Sentinel-2", extent: {spatial: {bbox: [[14.9, 45.0, 15.2, 45.3]]}, temporal: {interval: [["2020-01-01T00:00:00Z", null]]}},
        summaries: {"eo:cloud_cover": {minimum: 0, maximum: 100}},
        item_assets: {
            red: {type: "image/tiff", roles: ["data"], "eo:bands": [{common_name: "red"}]},
            nir: {type: "image/tiff", roles: ["data"], "eo:bands": [{common_name: "nir"}]},
            thumbnail: {type: "image/jpeg", roles: ["thumbnail"]},
        },
    };
    const other: StacCollectionJson = {id: "dem", extent: {spatial: {bbox: [[100, 0, 101, 1]]}, temporal: {interval: [[null, null]]}}};

    function stubCatalog(found: StacItemJson[], options: { failCollections?: number } = {}) {
        const realFetch = globalThis.fetch;
        const calls: string[] = [];
        let failures = options.failCollections ?? 0;
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            if (!url.startsWith("https://stac.test")) return realFetch(input, init);
            calls.push(url);
            if (url === "https://stac.test/v1") return json({stac_version: "1.1.0", conformsTo: ["https://api.stacspec.org/v1.0.0/item-search", "https://api.stacspec.org/v1.0.0/item-search#query"],
                links: [{rel: "search", href: "https://stac.test/v1/search"}, {rel: "data", href: "https://stac.test/v1/collections"}]});
            if (url === "https://stac.test/v1/collections") return failures-- > 0 ? json({}, 500) : json({collections: [collection, other]});
            if (url === "https://stac.test/v1/collections/s2") return json(collection);
            if (url === "https://stac.test/v1/collections/s2/queryables") return json({properties: {"eo:cloud_cover": {type: "number"}, datetime: {type: "string"}}});
            if (url.startsWith("https://stac.test/v1/search")) return json({type: "FeatureCollection", features: found, links: [], numberMatched: found.length});
            return json({}, 404);
        }));
        return calls;
    }

    it("lists collections by area and text, and describes one with its queryables", async () => {
        stubCatalog([]);
        const catalog = await StacClient.connect("https://stac.test/v1", {retry: {attempts: 1}});
        expect((await catalog.collections()).map((c) => c.id)).toEqual(["s2", "dem"]);
        expect((await catalog.collections({area: [15, 45.1, 15.1, 45.2]})).map((c) => c.id)).toEqual(["s2"]);
        expect((await catalog.collections({q: "sentinel"}))[0]).toMatchObject({id: "s2", bands: ["red", "nir"], bandNaming: "common-names"});
        const details = await catalog.collection("s2");
        expect(details).toMatchObject({id: "s2", title: "Sentinel-2", interval: ["2020-01-01T00:00:00Z", null]});
        expect(details.queryables.map((q) => q.name)).toEqual(["eo:cloud_cover", "datetime"]);
        expect(details.raw).toBe(details.raw);
    });

    it("checks a selection against the collection before searching", async () => {
        stubCatalog([]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const details = await catalog.collection("s2");
        expect(catalog.check({collection: "s2", area: [15, 45.1, 15.1, 45.2], datetime: "2024", bands: ["red", "nir"], maxCloud: 5}, details)).toEqual([]);
        const problems = catalog.check({collection: "s2", area: [100, 0, 101, 1], datetime: "2010", bands: ["red", "swir16"], where: {platform: {eq: "x"}}});
        expect(problems.map((p) => [p.path, p.severity])).toEqual([["area", "error"], ["datetime", "error"], ["bands", "error"], ["where.platform", "warning"]]);
        expect(catalog.check({collection: "nope"})[0]).toMatchObject({path: "collection", severity: "error"});
    });

    it("selects items: least cloud, per period, closest to a day across the year end", async () => {
        stubCatalog([s2Item("cloudy", "2024-07-01T10:00:00Z", 4), s2Item("clear", "2024-06-01T10:00:00Z", 0.5),
            s2Item("dec", "2023-12-30T10:00:00Z", 2), s2Item("jan", "2024-01-20T10:00:00Z", 2)]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const area: [number, number, number, number] = [15.005, 45.125, 15.02, 45.14];
        const best = await catalog.select({collection: "s2", area, datetime: ["2023-01-01", null], maxCloud: 5});
        expect(best.items.map((i) => i.id)).toEqual(["clear"]);
        expect(best).toMatchObject({found: 4, problems: []});
        expect(best.plan.filterEncoding).toBe("query");
        const yearly = await catalog.select({collection: "s2", area, pick: {per: "year"}});
        expect(yearly.periods).toEqual(["2023", "2024"]);
        expect(yearly.items.map((i) => i.id)).toEqual(["dec", "clear"]);
        // Regression: "01-02" measured Dec 30 against Jan 2 of the same year (363 days instead of 3).
        const winter = await catalog.select({collection: "s2", area, pick: {rank: {closestTo: "01-02"}}});
        expect(winter.items.map((i) => i.id)).toEqual(["dec"]);
        await expect(catalog.select({collection: "s2", area: [100, 0, 101, 1]}))
            .rejects.toMatchObject({problems: [expect.objectContaining({path: "area", severity: "error"})]});
    });

    it("does not cache a failed collection list (regression)", async () => {
        stubCatalog([], {failCollections: 1});
        const catalog = await StacClient.connect("https://stac.test/v1", {retry: {attempts: 1}});
        await expect(catalog.listCollections()).rejects.toThrow();
        expect((await catalog.listCollections()).length).toBe(2);
    });

    it("requests the first page once for matched() and the items (regression)", async () => {
        const calls = stubCatalog([s2Item("clear", "2024-06-01T10:00:00Z", 0.5)]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const search = catalog.search({collections: ["s2"]});
        expect(await search.matched()).toEqual({value: 1, exact: true});
        expect((await search.collect()).length).toBe(1);
        expect(calls.filter((c) => c.includes("/search")).length).toBe(1);
    });
});
