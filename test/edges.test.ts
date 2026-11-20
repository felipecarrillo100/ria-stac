import {afterEach, describe, expect, it, vi} from "vitest";
import {retryAfterMs, StacClient} from "../src/client.js";
import {accessFetch} from "../src/http.js";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", ...headers}});
/** What a browser gives for `redirect: "manual"`: an opaque response, status 0, no readable Location. */
const at = (r: Response, url: string) => Object.defineProperty(r, "url", {value: url});
const opaque = () => ({type: "opaqueredirect", status: 0, ok: false, headers: new Headers(), url: ""}) as unknown as Response;

describe("redirects a browser hides", () => {
    it("lets the browser follow them when only parameters or Authorization are sent", async () => {
        const calls: { url: string; redirect?: RequestRedirect }[] = [];
        const f = vi.fn(async (input: string | URL, init?: RequestInit) => {
            calls.push({url: String(input), redirect: init?.redirect});
            if (init?.redirect === "manual") return opaque();
            return at(json({ok: true}), "https://api.test/v1/");
        }) as unknown as typeof fetch;
        const r = await accessFetch("https://api.test/v1", {requestParameters: {token: "t"}, requestHeaders: {Authorization: "Bearer x"}}, {}, f);
        expect(await r.json()).toEqual({ok: true});
        expect(calls.map((c) => c.redirect)).toEqual(["manual", "follow"]);
    });

    it("refuses them when another header could reach a different origin", async () => {
        const f = vi.fn(async () => opaque()) as unknown as typeof fetch;
        await expect(accessFetch("https://api.test/v1", {requestHeaders: {"X-Api-Key": "k"}}, {}, f))
            .rejects.toThrow(/X-Api-Key could reach another origin/);
    });

    it("retries a same-origin target that refuses the request with the parameters", async () => {
        const urls: string[] = [];
        const f = vi.fn(async (input: string | URL, init?: RequestInit) => {
            urls.push(String(input));
            if (init?.redirect === "manual") return opaque();
            if (String(input).includes("/v1/?")) return json({ok: true});
            return at(json({}, 401), "https://api.test/v1/");
        }) as unknown as typeof fetch;
        const r = await accessFetch("https://api.test/v1", {requestParameters: {token: "t"}}, {}, f);
        expect(r.status).toBe(200);
        expect(urls.at(-1)).toBe("https://api.test/v1/?token=t");
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
