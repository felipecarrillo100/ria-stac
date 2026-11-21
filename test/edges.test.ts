import {afterEach, describe, expect, it, vi} from "vitest";
import {retryAfterMs, StacClient} from "../src/client.js";
import {mediaTypeMatch} from "../src/catalog.js";
import {accessFetch} from "../src/http.js";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", ...headers}});
/** What a browser gives for `redirect: "manual"`: an opaque response, status 0, no readable Location. */
const at = (r: Response, url: string) => Object.defineProperty(r, "url", {value: url});
const opaque = () => ({type: "opaqueredirect", status: 0, ok: false, headers: new Headers(), url: ""}) as unknown as Response;

describe("redirects a browser hides", () => {
    /** A browser: manual redirects are opaque; follow ends at `final` (with `redirected` set). */
    function browser(final: string, options: { redirectsOnlyWithCredentials?: boolean; finalRedirects?: boolean } = {}) {
        const calls: { url: string; redirect?: RequestRedirect; headers: Record<string, string>; credentials?: RequestCredentials }[] = [];
        const f = vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push({url, redirect: init?.redirect, headers: {...(init?.headers as Record<string, string> ?? {})}, credentials: init?.credentials});
            if (url.startsWith(final) && !(options.finalRedirects && init?.redirect === "manual")) return at(json({ok: true}), url);
            if (init?.redirect === "manual") return opaque();
            if (options.redirectsOnlyWithCredentials) return at(json({}, 401), url);
            return Object.defineProperty(at(json({ok: true}), final), "redirected", {value: true});
        }) as unknown as typeof fetch;
        return {f, calls};
    }
    const secret = {requestHeaders: {Authorization: "Bearer T", "X-Api-Key": "K"}, requestParameters: {token: "P"}};
    const leaks = (c: { url: string; headers: Record<string, string> }) => c.url.includes("token=") || "Authorization" in c.headers || "X-Api-Key" in c.headers;

    it("finds the target with a probe that carries no secrets, then sends them straight to a same-origin target", async () => {
        const {f, calls} = browser("https://api.test/v1/");
        const r = await accessFetch("https://api.test/v1", secret, {headers: {Accept: "application/json"}}, f);
        expect(await r.json()).toEqual({ok: true});
        expect(calls.map((c) => c.redirect)).toEqual(["manual", "follow", "manual"]);
        expect(leaks(calls[1])).toBe(false);
        expect(calls[1]).toMatchObject({url: "https://api.test/v1", credentials: "omit", headers: {Accept: "application/json"}});
        expect(calls[2]).toMatchObject({url: "https://api.test/v1/?token=P", headers: {Authorization: "Bearer T", "X-Api-Key": "K"}});
    });

    it("refuses a redirect to another origin without sending it any secret", async () => {
        const {f, calls} = browser("https://other.test/data");
        await expect(accessFetch("https://api.test/v1", secret, {}, f)).rejects.toThrow(/redirects to other\.test/);
        expect(calls.filter((c) => !c.url.startsWith("https://api.test/v1?") && c.redirect !== "manual").every((c) => !leaks(c))).toBe(true);
        expect(calls.some((c) => c.url.startsWith("https://other.test") && leaks(c))).toBe(false);
    });

    it("refuses when the target cannot be found without the credentials, when it redirects again, and for POST", async () => {
        await expect(accessFetch("https://api.test/v1", secret, {}, browser("https://api.test/v1/", {redirectsOnlyWithCredentials: true}).f))
            .rejects.toThrow(/does not redirect without the credentials/);
        await expect(accessFetch("https://api.test/v1", secret, {}, browser("https://api.test/v1/", {finalRedirects: true}).f))
            .rejects.toThrow(/redirects again/);
        const post = browser("https://api.test/v1/");
        await expect(accessFetch("https://api.test/v1", secret, {method: "POST", body: "{}"}, post.f)).rejects.toThrow(/POST request was redirected/);
        expect(post.calls).toHaveLength(1);
    });
});

describe("Retry-After and slow pages", () => {
    it("reads delta-seconds and HTTP dates", () => {
        expect(retryAfterMs("3")).toBe(3000);
        expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
        expect(retryAfterMs("soon")).toBeUndefined();
        expect(retryAfterMs(null)).toBeUndefined();
    });

    it("does not retry when the server asks to wait longer than maxWaitMs", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).endsWith("/v1")
            ? json({type: "Catalog", id: "t", stac_version: "1.1.0", conformsTo: ["https://api.stacspec.org/v1.0.0/core"], links: [{rel: "data", href: "https://api.test/v1/collections"}]})
            : json({detail: "slow down"}, 429, {"Retry-After": "120"})));
        const client = await StacClient.connect("https://api.test/v1");
        await expect(client.listCollections()).rejects.toThrow(/asks to wait 120 s/);
    });

    it("lists collections with the default page size when a large page does not come", async () => {
        const urls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "data", href: "https://api.test/v1/collections"}],
                    conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collection-search"]});
            }
            // The large page times out (what AbortSignal.timeout gives after LARGE_PAGE_TIMEOUT_MS).
            if (url.includes("limit=1000")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
            return json({collections: [{type: "Collection", id: "a", links: []}], links: []});
        }));
        const client = await StacClient.connect("https://api.test/v1");
        expect((await client.listCollections()).map((c) => c.id)).toEqual(["a"]);
        expect(urls.filter((u) => u.includes("/collections"))).toEqual(["https://api.test/v1/collections?limit=1000", "https://api.test/v1/collections"]);
    });
});

describe("STAC 1.1 band inheritance and storage v2", () => {
    it("reads band fields from the asset itself and from the item", async () => {
        const {assetBands} = await import("../src/bands.js");
        expect(assetBands({type: "image/tiff", nodata: 0, "raster:scale": 0.0001, "raster:offset": -0.1} as never))
            .toEqual([{scale: 0.0001, offset: -0.1, nodata: 0}]);
        expect(assetBands({type: "image/tiff", bands: [{name: "B04"}]} as never, {properties: {nodata: -9999, data_type: "int16"}}))
            .toEqual([{name: "B04", nodata: -9999, dataType: "int16"}]);
        expect(assetBands({type: "image/tiff"} as never)).toEqual([]);
    });

    it("finds requester-pays storage through storage v2 schemes", async () => {
        const {resolveAsset} = await import("../src/assets.js");
        const item = {type: "Feature", id: "L", collection: "landsat", bbox: [0, 0, 1, 1], geometry: null, links: [],
            properties: {datetime: "2024-01-01T00:00:00Z", "storage:schemes": {aws: {type: "aws-s3", platform: "https://{bucket}.s3.amazonaws.com", bucket: "usgs-landsat", requester_pays: true}}},
            assets: {red: {href: "s3://usgs-landsat/red.tif", type: "image/tiff", "storage:refs": ["aws"]}}};
        expect(resolveAsset(item as never, "red", [])).toMatchObject({readable: "no", reason: "requester-pays storage"});
    });
});

describe("item indexes", () => {
    it("reports a stac-geoparquet mirror or Planetary Computer's geoparquet-items asset", async () => {
        const {describe: describeCollection} = await import("../src/client.js");
        const base = {type: "Collection", id: "c", description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}};
        expect(describeCollection({...base, assets: {items: {href: "https://x/items.parquet", type: "application/vnd.apache.parquet", roles: ["collection-mirror"]}}} as never).itemIndex)
            .toEqual({key: "items", href: "https://x/items.parquet", type: "application/vnd.apache.parquet", roles: ["collection-mirror"]});
        expect(describeCollection({...base, assets: {"geoparquet-items": {href: "abfs://items/s2.parquet", type: "application/x-parquet", roles: ["stac-items"]}}} as never).itemIndex?.key)
            .toBe("geoparquet-items");
        expect(describeCollection({...base, assets: {thumbnail: {href: "https://x/t.png", type: "image/png"}}} as never).itemIndex).toBeUndefined();
    });
});

describe("free text and paths from links", () => {
    it("sends q as a list of terms for basic free text and as one string for advanced", async () => {
        const {parseCapabilities, planSearch, emptyProfile} = await import("../src/index.js");
        const landing = (uri: string) => ({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "search", href: "https://x/search", method: "POST"}],
            conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/item-search", uri]});
        const basic = planSearch("https://x/search", {q: "sentinel, landsat cloud"}, parseCapabilities(landing("https://api.stacspec.org/v1.0.0-rc.1/item-search#free-text") as never), emptyProfile("https://x"));
        expect(basic.http.body?.q).toEqual(["sentinel", "landsat", "cloud"]);
        const advanced = planSearch("https://x/search", {q: "sentinel AND cloud"}, parseCapabilities(landing("https://api.stacspec.org/v1.0.0-rc.1/item-search#advanced-free-text") as never), emptyProfile("https://x"));
        expect(advanced.http.body?.q).toBe("sentinel AND cloud");
    });

    it("reads items by search when there is no items endpoint, and asks for queryables only under the Filter extension", async () => {
        const urls: string[] = [];
        const item = {type: "Feature", stac_version: "1.1.0", id: "a", collection: "c", bbox: [0, 0, 1, 1], properties: {datetime: "2024-01-01T00:00:00Z"}, assets: {}, links: []};
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "search", href: "https://api.test/v1/search", method: "GET"}, {rel: "data", href: "https://api.test/v1/collections"}],
                    conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/item-search", "https://api.stacspec.org/v1.0.0/collections"]});
            }
            if (url.includes("/search")) return json({type: "FeatureCollection", features: [item], links: []});
            if (url.endsWith("/collections/c")) return json({type: "Collection", id: "c", description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}, summaries: {"eo:cloud_cover": {minimum: 0, maximum: 100}}});
            return json({detail: "not found"}, 404);
        }));
        const client = await StacClient.connect("https://api.test/v1");
        expect((await client.items([{collection: "c", id: "a"}])).map((i) => i.id)).toEqual(["a"]);
        expect(urls.some((u) => u.includes("/items/"))).toBe(false);
        expect((await client.queryables("c")).map((q) => q.name)).toEqual(["eo:cloud_cover"]);
        expect(urls.some((u) => u.includes("queryables"))).toBe(false);
    });
});

describe("media types a collection offers", () => {
    it("reads them from item_assets, else from one item, with no preference", async () => {
        const urls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "data", href: "https://api.test/v1/collections"}, {rel: "search", href: "https://api.test/v1/search", method: "GET"}],
                    conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collections", "https://api.stacspec.org/v1.0.0/ogcapi-features"]});
            }
            const base = {type: "Collection", description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}};
            if (url.endsWith("/collections/declared")) {
                return json({...base, id: "declared", item_assets: {B04: {type: "image/jp2", roles: ["data"]}, dem: {type: "image/tiff; application=geotiff; profile=cloud-optimized", roles: ["data"]},
                    thumbnail: {type: "image/png", roles: ["thumbnail"]}}});
            }
            if (url.endsWith("/collections/plain")) return json({...base, id: "plain"});
            if (url.includes("/collections/plain/items")) {
                return json({type: "FeatureCollection", features: [{type: "Feature", id: "i", collection: "plain", bbox: [0, 0, 1, 1], properties: {datetime: null},
                    assets: {a: {href: "https://x/a.tif", type: "image/tiff; application=geotiff"}, b: {href: "https://x/b.xyz.zip", type: "application/x.ascii-xyz+zip"}, c: {href: "https://x/c.zip", type: "application/x.ascii-xyz+zip"},
                        d: {href: "https://x/d.zarr", roles: ["data"]}, e: {href: "https://x/e.tif"}}}], links: []});
            }
            return json({}, 404);
        }));
        const client = await StacClient.connect("https://api.test/v1");
        const COG = "image/tiff; application=geotiff; profile=cloud-optimized";
        const declared = await client.collectionMediaTypes("declared");
        expect(declared).toEqual({source: "item_assets", items: 0, untyped: [], mediaTypes: [{mediaType: "image/jp2", keys: ["B04"], inferred: false}, {mediaType: COG, keys: ["dem"], inferred: false}]});
        const plain = await client.collectionMediaTypes("plain");
        expect(plain).toEqual({source: "sample-item", items: 1, sampleItem: "i", untyped: ["d"],
            mediaTypes: [{mediaType: "image/tiff; application=geotiff", keys: ["a"], inferred: false}, {mediaType: "application/x.ascii-xyz+zip", keys: ["b", "c"], inferred: false},
                {mediaType: "image/tiff", keys: ["e"], inferred: true}]});
        // What is known decides: item_assets say no for sure, a sample only "not seen".
        expect(mediaTypeMatch(declared, [COG])).toBe("match");
        expect(mediaTypeMatch(declared, ["application/zip"])).toBe("no-match");
        expect(mediaTypeMatch(plain, ["IMAGE/TIFF;application=geotiff"])).toBe("match");
        expect(mediaTypeMatch(plain, [COG])).toBe("not-in-sample");
        expect(mediaTypeMatch(null, [COG])).toBe("unknown");
        expect(mediaTypeMatch(plain, [])).toBe("match");
        const before = urls.length;
        await client.collectionMediaTypes("plain");
        expect(urls.length).toBe(before);   // cached
    });
});

describe("filtering collections by media type", () => {
    it("drops only collections whose item_assets lack them, unless told to drop the unsure ones too", async () => {
        const base = {type: "Collection", stac_version: "1.1.0", description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}};
        const COG = "image/tiff; application=geotiff; profile=cloud-optimized";
        const collections = [
            {...base, id: "cog", item_assets: {dem: {type: "image/tiff;profile=cloud-optimized;application=geotiff", roles: ["data"]}, thumbnail: {type: "image/png", roles: ["thumbnail"]}}},
            {...base, id: "zip", item_assets: {xyz: {type: "application/x.ascii-xyz+zip", roles: ["data"]}, thumbnail: {type: COG, roles: ["thumbnail"]}}},
            {...base, id: "bare"},
        ];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "data", href: "https://api.test/v1/collections"}],
                    conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collections"]});
            }
            if (url.includes("/v1/collections")) return json({collections, links: []});
            return json({}, 404);
        }));
        const client = await StacClient.connect("https://api.test/v1");
        const ids = (list: { id: string }[]) => list.map((c) => c.id);
        expect(ids(await client.findCollections({mediaTypes: [COG]}))).toEqual(["cog", "bare"]);
        expect(ids(await client.findCollections({mediaTypes: [COG], mediaTypesUnsure: "drop"}))).toEqual(["cog"]);
        expect(ids(await client.findCollections({mediaTypes: []}))).toEqual(["cog", "zip", "bare"]);
        // Thumbnails do not count, and summaries carry what item_assets say.
        const summaries = await client.collections();
        expect(summaries.map((c) => [c.id, c.mediaTypeSource, c.mediaTypes])).toEqual([
            ["cog", "item_assets", [COG]], ["zip", "item_assets", ["application/x.ascii-xyz+zip"]], ["bare", "none", []]]);
        expect(summaries.map((c) => mediaTypeMatch(c, [COG]))).toEqual(["match", "no-match", "unknown"]);
    });
});

describe("reloading collections", () => {
    it("keeps collections until reloadCollections, then reads them again", async () => {
        let version = 1;
        const urls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", links: [{rel: "data", href: "https://api.test/v1/collections"}],
                    conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collections"]});
            }
            const c = (id: string) => ({type: "Collection", id, description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}});
            return json({collections: version === 1 ? [c("a")] : [c("a"), c("b")], links: []});
        }));
        const client = await StacClient.connect("https://api.test/v1");
        expect((await client.listCollections()).map((c) => c.id)).toEqual(["a"]);
        version = 2;
        expect((await client.listCollections()).map((c) => c.id)).toEqual(["a"]);   // cached
        client.reloadCollections();
        expect((await client.listCollections()).map((c) => c.id)).toEqual(["a", "b"]);
        expect(urls.filter((u) => u.includes("/collections")).length).toBe(2);
    });
});

describe("date range", () => {
    const landing = (conformsTo: string[]) => ({type: "Catalog", id: "t", stac_version: "1.1.0", conformsTo,
        links: [{rel: "data", href: "https://api.test/v1/collections"}, {rel: "search", href: "https://api.test/v1/search", method: "POST"}]});
    const collection = {type: "Collection", id: "c", description: "", license: "MIT", links: [], extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [["2015-06-27T00:00:00Z", null]]}}};
    const item = (id: string, datetime: string | null, extra: Record<string, unknown> = {}) => ({type: "Feature", id, collection: "c", bbox: [0, 0, 1, 1],
        geometry: {type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}, properties: {datetime, ...extra}, assets: {}, links: []});

    it("finds the first and last item dates with two sorted one-item searches, without the request's period", async () => {
        const items = [item("b", "2020-05-01T10:00:00Z"), item("a", "2016-01-02T10:00:00Z"), item("c", null, {start_datetime: "2021-01-01T00:00:00Z", end_datetime: "2024-03-01T00:00:00Z"})];
        const bodies: Record<string, unknown>[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/v1")) return json(landing(["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/item-search", "https://api.stacspec.org/v1.0.0/item-search#sort"]));
            if (url.endsWith("/search")) {
                const body = JSON.parse(String(init?.body)) as { sortby: { direction: string }[] };
                bodies.push(body);
                const key = (i: ReturnType<typeof item>) => { const p = i.properties as Record<string, unknown>; return String(p.datetime ?? (body.sortby[0].direction === "asc" ? p.start_datetime : p.end_datetime)); };
                const sorted = [...items].sort((x, y) => key(x).localeCompare(key(y)) * (body.sortby[0].direction === "asc" ? 1 : -1));
                return json({type: "FeatureCollection", features: sorted.slice(0, 1), links: []});
            }
            return json(collection);
        }));
        const client = await StacClient.connect("https://api.test/v1");
        expect(await client.dateRange({collections: ["c"], area: [0, 0, 1, 1], datetime: "2020"})).toEqual({first: "2016-01-02T10:00:00Z", last: "2024-03-01T00:00:00Z", source: "items"});
        expect(bodies.every((b) => b.datetime === undefined && b.limit === 1)).toBe(true);
    });

    it("gives the declared period where the server cannot sort", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).endsWith("/v1")
            ? json(landing(["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/item-search", "https://api.stacspec.org/v1.0.0/collections"]))
            : json(collection)));
        const client = await StacClient.connect("https://api.test/v1");
        expect(await client.dateRange({collections: ["c"]})).toEqual({first: "2015-06-27T00:00:00Z", last: null, source: "declared", openEnd: true});
    });
});

describe("oversized pages that fail without a status", () => {
    it("asks for a smaller page before falling back to GET (a gateway 502 without CORS headers)", async () => {
        const sent: { method: string; limit: number }[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/v1")) {
                return json({type: "Catalog", id: "t", stac_version: "1.1.0", conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/item-search"],
                    links: [{rel: "search", href: "https://api.test/v1/search", method: "GET"}, {rel: "search", href: "https://api.test/v1/search", method: "POST"}]});
            }
            const limit = init?.body ? JSON.parse(String(init.body)).limit : Number(new URL(url).searchParams.get("limit"));
            sent.push({method: init?.method ?? "GET", limit});
            if (limit > 250) throw new TypeError("Failed to fetch");   // what a browser shows for a 502 without CORS headers
            return json({type: "FeatureCollection", features: [], links: []});
        }));
        const client = await StacClient.connect("https://api.test/v1", {retry: {attempts: 1}});
        await client.search({collections: ["c"], limit: 500}).collect();
        expect(sent).toEqual([{method: "POST", limit: 500}, {method: "POST", limit: 250}]);
        expect(client.profile).toMatchObject({maxLimit: 250, postToGet: false});
    });
});

describe("excluded periods (exceptDatetime)", () => {
    const C = (s: string) => `https://api.stacspec.org/v1.0.0/${s}`;
    const CQL2 = (s: string) => `http://www.opengis.net/spec/cql2/1.0/conf/${s}`;
    const item = (p: Record<string, unknown>) => ({type: "Feature", stac_version: "1.0.0", id: "a", geometry: null, properties: p, assets: {}, links: []}) as never;
    const at = (t: string) => item({datetime: t});
    const span = (s: string, e: string) => item({datetime: null, start_datetime: s, end_datetime: e});

    it("leaves out items whose time overlaps a period, instants and spans alike", async () => {
        const {itemMatches} = await import("../src/index.js");
        const r = {exceptDatetime: ["2020-03/2020-05"]};
        expect(itemMatches(at("2020-04-10T00:00:00Z"), r)).toBe(false);
        expect(itemMatches(at("2020-05-31T23:59:59Z"), r)).toBe(false);
        expect(itemMatches(at("2020-06-01T00:00:00Z"), r)).toBe(true);
        expect(itemMatches(at("2020-02-29T23:59:59Z"), r)).toBe(true);
        expect(itemMatches(span("2020-01-01T00:00:00Z", "2020-03-02T00:00:00Z"), r)).toBe(false);
        expect(itemMatches(span("2019-01-01T00:00:00Z", "2019-03-02T00:00:00Z"), r)).toBe(true);
        // pgstac gives instant items start and end equal to datetime.
        expect(itemMatches(item({datetime: "2020-04-10T00:00:00Z", start_datetime: "2020-04-10T00:00:00Z", end_datetime: "2020-04-10T00:00:00Z"}), r)).toBe(false);
        // Open ends, several periods, and with datetime.
        expect(itemMatches(at("2021-04-10T00:00:00Z"), {exceptDatetime: [["2021-01-01", null]]})).toBe(false);
        expect(itemMatches(at("2020-12-31T00:00:00Z"), {exceptDatetime: [["2021-01-01", null]]})).toBe(true);
        expect(itemMatches(at("2019-07-01T00:00:00Z"), {datetime: "2018/2020", exceptDatetime: ["2018-06", "2019-07"]})).toBe(false);
        expect(itemMatches(at("2019-08-01T00:00:00Z"), {datetime: "2018/2020", exceptDatetime: ["2018-06", "2019-07"]})).toBe(true);
    });

    it("sends basic CQL2 to servers with CQL2, and tests on the client elsewhere", async () => {
        const {parseCapabilities, planSearch, emptyProfile, toCql2Text, exceptFilter} = await import("../src/index.js");
        expect(toCql2Text(exceptFilter(["2020-03/2020-05"])!)).toBe(
            "((start_datetime IS NULL) AND ((datetime < TIMESTAMP('2020-03-01T00:00:00Z')) OR (datetime > TIMESTAMP('2020-05-31T23:59:59.999Z'))))"
            + " OR (end_datetime < TIMESTAMP('2020-03-01T00:00:00Z')) OR (start_datetime > TIMESTAMP('2020-05-31T23:59:59.999Z'))");
        const request = {collections: ["s2"], datetime: "2020", exceptDatetime: ["2020-03/2020-05"], where: {"eo:cloud_cover": {lt: 5}}};
        const cql2 = parseCapabilities({conformsTo: [C("item-search"), C("item-search#filter"), CQL2("basic-cql2"), CQL2("cql2-json"), CQL2("cql2-text")]});
        const a = planSearch("https://x/search", request, cql2, emptyProfile("https://x"));
        expect(a.filterEncoding).toBe("cql2-json");
        expect(a.http.body?.datetime).toBe("2020-01-01T00:00:00Z/2020-12-31T23:59:59.999Z");
        // Only datetime and end_datetime go to the server (pgstac fails on start_datetime and IS NULL); spans are tested here.
        const sent = JSON.stringify(a.http.body?.filter);
        expect(sent).toContain("end_datetime");
        expect(sent).not.toContain("start_datetime");
        expect(sent).not.toContain("isNull");
        expect(a.clientApplies).not.toContain("where/filter");
        expect(a.clientApplies).toContain("exceptDatetime");

        const query = parseCapabilities({conformsTo: [C("item-search"), C("item-search#query")]});
        const b = planSearch("https://x/search", request, query, emptyProfile("https://x"));
        expect(b.filterEncoding).toBe("query");
        expect(b.http.body?.query).toEqual({"eo:cloud_cover": {lt: 5}});
        expect(b.clientApplies).toContain("exceptDatetime");
        expect(b.degradations.find((d) => d.kind === "filter-split")).toBeTruthy();

        const bare = planSearch("https://x/search", {exceptDatetime: ["2020"]}, parseCapabilities({conformsTo: [C("item-search")]}), emptyProfile("https://x"));
        expect(bare.filterEncoding).toBe("client");
        expect(bare.http.body?.filter).toBeUndefined();
    });

    it("tests spans exactly on the client after a CQL2 server's coarser filter, without taking it for an ignored filter", async () => {
        const landing = {type: "Catalog", id: "x", description: "", stac_version: "1.0.0", links: [{rel: "search", href: "https://x/search", method: "POST"}],
            conformsTo: [C("core"), C("item-search"), C("item-search#filter"), CQL2("basic-cql2"), CQL2("cql2-json")]};
        // pgstac: a span item has datetime = its start; Feb–Apr overlaps the excluded March, yet datetime < March 1 keeps it on the server.
        const items = [{...(span("2020-02-01T00:00:00Z", "2020-04-01T00:00:00Z") as object), id: "overlaps", properties: {datetime: "2020-02-01T00:00:00Z", start_datetime: "2020-02-01T00:00:00Z", end_datetime: "2020-04-01T00:00:00Z"}},
            {...(at("2020-07-01T00:00:00Z") as object), id: "after"}];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/search") ? json({type: "FeatureCollection", features: items, links: []}) : json(landing)));
        const client = await StacClient.connect("https://x/");
        const search = client.search({exceptDatetime: ["2020-03"]});
        expect((await search.collect()).map((i) => i.id)).toEqual(["after"]);
        expect(client.profile.filterApplied).not.toBe("ignored");
    });

    it("keeps the server's Query results trusted: the excluded period is not taken for an ignored query", async () => {
        const landing = {type: "Catalog", id: "x", description: "", stac_version: "1.0.0", links: [{rel: "search", href: "https://x/search", method: "POST"}],
            conformsTo: [C("core"), C("item-search"), C("item-search#query")]};
        const items = [at("2020-04-10T00:00:00Z"), at("2020-07-10T00:00:00Z")].map((i, n) => ({...(i as object), id: `i${n}`, properties: {...(i as {properties: object}).properties, "eo:cloud_cover": 1}}));
        vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/search") ? json({type: "FeatureCollection", features: items, links: []}) : json(landing)));
        const client = await StacClient.connect("https://x/");
        const found = await client.search({where: {"eo:cloud_cover": {lt: 5}}, exceptDatetime: ["2020-04"]}).collect();
        expect(found.map((i) => i.id)).toEqual(["i1"]);
        expect(client.profile.queryApplied).not.toBe("ignored");
    });

    it("drops collections whose whole period lies in an excluded one", async () => {
        const col = (id: string, interval: [string | null, string | null]) => ({type: "Collection", stac_version: "1.0.0", id, description: "", license: "x", links: [],
            extent: {spatial: {bbox: [[-1, -1, 1, 1]]}, temporal: {interval: [interval]}}});
        const landing = {type: "Catalog", id: "x", description: "", stac_version: "1.0.0", links: [{rel: "data", href: "https://x/collections"}], conformsTo: [C("core"), C("collections")]};
        vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/collections")
            ? json({collections: [col("old", ["2001-01-01T00:00:00Z", "2005-01-01T00:00:00Z"]), col("long", ["2001-01-01T00:00:00Z", null])], links: []}) : json(landing)));
        const client = await StacClient.connect("https://x/");
        const kept = await client.findCollections({exceptDatetime: [[null, "2010-01-01"]], server: false});
        expect(kept.map((c) => c.id)).toEqual(["long"]);
    });
});

describe("time extents", () => {
    const C = (s: string) => `https://api.stacspec.org/v1.0.0/${s}`;
    const col = (id: string, interval: [string | null, string | null]) => ({type: "Collection", stac_version: "1.0.0", id, description: "", license: "x", links: [],
        extent: {spatial: {bbox: [[-1, -1, 1, 1]]}, temporal: {interval: [interval]}}});
    const item = (id: string, collection: string, p: Record<string, unknown>) => ({type: "Feature", stac_version: "1.0.0", id, collection, geometry: null, properties: p, assets: {}, links: []});
    function server(sort: boolean) {
        const landing = {type: "Catalog", id: "x", description: "", stac_version: "1.0.0", links: [{rel: "search", href: "https://x/search", method: "POST"}, {rel: "data", href: "https://x/collections"}],
            conformsTo: [C("core"), C("collections"), C("item-search"), ...(sort ? [C("item-search#sort")] : [])]};
        const items = [item("a", "s2", {datetime: "2016-05-01T00:00:00Z"}), item("b", "s2", {datetime: null, start_datetime: "2019-01-01T00:00:00Z", end_datetime: "2030-01-01T00:00:00Z"})];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u.endsWith("/search")) {
                const body = JSON.parse(String(init?.body ?? "{}"));
                const dir = body.sortby?.[0]?.direction;
                const features = dir === "asc" ? [items[0]] : dir === "desc" ? [items[1]] : items;
                return json({type: "FeatureCollection", features, links: []});
            }
            const cols = [col("s2", ["2017-01-01T00:00:00Z", null]), col("old", ["2001-01-01T00:00:00Z", "2005-01-01T00:00:00Z"])];
            const one = /\/collections\/([^/?]+)$/.exec(u);
            if (one) return json(cols.find((c) => c.id === one[1]));
            if (u.includes("/collections")) return json({collections: cols, links: []});
            return json(landing);
        }));
    }

    it("is the declared period, widened by the items read", async () => {
        server(false);
        const client = await StacClient.connect("https://x/");
        expect(await client.timeExtent(["s2"])).toEqual({min: "2017-01-01T00:00:00Z", max: null, minSource: "declared", maxSource: null, openStart: false, openEnd: true, seen: 0});
        await client.search({collections: ["s2"]}).collect();
        expect(client.seenTimeExtent(["s2"])).toEqual({min: "2016-05-01T00:00:00.000Z", max: "2030-01-01T00:00:00.000Z", items: 2});
        expect(await client.timeExtent(["s2"])).toMatchObject({min: "2016-05-01T00:00:00.000Z", minSource: "seen", max: "2030-01-01T00:00:00.000Z", maxSource: "seen", openEnd: true, seen: 2});
        // Every collection listed: the union, open at the end because s2 is ongoing.
        expect(await client.timeExtent()).toMatchObject({min: "2001-01-01T00:00:00Z", minSource: "declared", openEnd: true});
        expect(client.seenTimeExtent(["old"]).items).toBe(0);
    });

    it("asks the server for the first and last items when exact", async () => {
        server(true);
        const client = await StacClient.connect("https://x/");
        expect(await client.timeExtent(["s2"], {exact: true})).toMatchObject({min: "2016-05-01T00:00:00Z", minSource: "items", max: "2030-01-01T00:00:00Z", maxSource: "items"});
    });
});
