import {fromText} from "ogc-cql2/parse";
import {afterEach, describe, expect, it, vi} from "vitest";
import {COLLECTION_PAGE_SIZE, isGlobalBbox, SELECT_PAGE_SIZE, 
    assetBands, bestPerPeriod, coverArea, dedupeItems, emptyProfile, evaluateCql2, groupItems,
    itemsCovering, normaliseDatetime, parseCapabilities, planetaryComputerSigner, planSearch, resolveAsset, sortItems,
    StacClient, StacError, splitFilter, formatsFilter, toCql2Text, type StacItemJson,
} from "../src/index.js";

// ------------------------------------------------------------------------------------------------ fixtures

const C = (s: string) => `https://api.stacspec.org/v1.0.0/${s}`;
const CQL2 = (s: string) => `http://www.opengis.net/spec/cql2/1.0/conf/${s}`;

function item(id: string, props: Record<string, unknown>, bbox: [number, number, number, number] = [0, 0, 10, 10], assets: Record<string, unknown> = {}): StacItemJson {
    const [w, s, e, n] = bbox;
    return {
        type: "Feature", id, collection: "s2", bbox,
        geometry: {type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]},
        properties: {datetime: "2024-07-01T10:00:00Z", ...props},
        assets: assets as StacItemJson["assets"],
    };
}

/** A tiny STAC API with configurable quirks, answering through a stubbed fetch. */
function mockServer(options: {
    conformsTo?: string[];
    ignoresFilter?: boolean;
    ignoresQuery?: boolean;
    post405?: boolean;
    maxLimit?: number;
    landingNeedsSlash?: boolean;
    items: StacItemJson[];
    pageSize?: number;
    mergePaging?: boolean;
    /** The JSON Schema served at /collections/s2/queryables (404 without). */
    queryables?: Record<string, unknown>;
    /** Answer 400 to a filter whose JSON matches. */
    refuses?: RegExp;
    /** Answer 504 to this search page (from 1), as Planetary Computer does past page 1 for some collections. */
    failsPage?: number;
}) {
    const base = "https://stac.test/v1";
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
    const handler = async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        calls.push({method, url: url.toString(), body});
        if (url.pathname === "/v1" || url.pathname === "/v1/") {
            if (options.landingNeedsSlash && url.pathname === "/v1") throw new TypeError("Failed to fetch");
            return json(200, {type: "Catalog", id: "test", stac_version: "1.1.0", conformsTo: options.conformsTo ?? [],
                links: [{rel: "search", href: `${base}/search`, type: "application/geo+json"}, {rel: "data", href: `${base}/collections`}]});
        }
        if (url.pathname === "/v1/collections/s2/queryables" && options.queryables) return json(200, options.queryables);
        if (url.pathname === "/v1/collections/s2" && options.failsPage !== undefined) {
            return json(200, {type: "Collection", id: "s2", stac_version: "1.1.0", description: "", license: "proprietary", links: [],
                extent: {spatial: {bbox: [[-180, -90, 180, 90]]}, temporal: {interval: [[null, null]]}}});
        }
        if (url.pathname === "/v1/search") {
            if (method === "POST" && options.post405) return json(405, {detail: "Method Not Allowed"});
            const params: Record<string, unknown> = {...(body ?? Object.fromEntries(url.searchParams.entries()))};
            // CQL2-text is read as a CQL2 server would; a GET filter in JSON arrives as a string too.
            if (typeof params.filter === "string") {
                params.filter = params["filter-lang"] === "cql2-text" ? fromText(params.filter) : JSON.parse(params.filter);
            }
            if (params.filter !== undefined && options.refuses?.test(JSON.stringify(params.filter))) {
                return json(400, {code: "InvalidFilter", description: "Operator not supported"});
            }
            const limit = Number(params.limit ?? 10);
            if (options.maxLimit && limit > options.maxLimit) return json(400, {detail: `limit must be <= ${options.maxLimit}`});
            let matches = options.items;
            const cc = (i: StacItemJson) => Number(i.properties["eo:cloud_cover"]);
            const filter = params.filter as {op: string; args: [unknown, number]} | undefined;
            if (filter && !options.ignoresFilter) matches = matches.filter((i) => evaluateCql2(filter, i));
            const query = typeof params.query === "string" ? JSON.parse(params.query) : params.query as Record<string, {lt?: number}> | undefined;
            if (query && !options.ignoresQuery && query["eo:cloud_cover"]?.lt !== undefined) matches = matches.filter((i) => cc(i) < query["eo:cloud_cover"].lt!);
            const page = Number(params.page ?? 1);
            if (page === options.failsPage) return new Response("upstream request timeout", {status: 504, headers: {"Content-Type": "text/plain"}});
            const size = Math.min(limit, options.pageSize ?? limit);
            const features = matches.slice((page - 1) * size, page * size);
            const links = page * size < matches.length
                ? [method === "POST"
                    ? {rel: "next", href: `${base}/search`, method: "POST", ...(options.mergePaging ? {merge: true, body: {page: page + 1}} : {body: {...params, page: page + 1}})}
                    : {rel: "next", href: `${base}/search?${new URLSearchParams({...Object.fromEntries(url.searchParams), page: String(page + 1)})}`}]
                : [];
            return json(200, {type: "FeatureCollection", features, links, numberMatched: matches.length});
        }
        return json(404, {detail: "not found"});
    };
    vi.stubGlobal("fetch", vi.fn(handler));
    return {base, calls};
}

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------------------------------------------------ CQL2 on the server

describe("CQL2 on the server, by the classes it declares", () => {
    const items = [
        item("S2A_1", {"eo:cloud_cover": 5, platform: "sentinel-2a"}),
        item("S2B_2", {"eo:cloud_cover": 8, platform: "sentinel-2b"}),
        item("L8_3", {"eo:cloud_cover": 3, platform: "landsat-8"}),
        item("S2A_4", {"eo:cloud_cover": 60, platform: "sentinel-2a"}),
    ];
    const ids = (found: StacItemJson[]) => found.map((i) => i.id).sort();
    const where = {"eo:cloud_cover": {lt: 20}, platform: {like: "sentinel-%"}};
    const basic = [C("item-search"), C("item-search#filter"), CQL2("basic-cql2"), CQL2("cql2-json"), CQL2("cql2-text")];

    it("maps declared classes, older names included, to CQL2 1.0 URIs", () => {
        // Digital Earth Australia and Africa (datacube-explorer) declare spatial-operators.
        const dea = parseCapabilities({conformsTo: [C("item-search#filter"), CQL2("basic-cql2"), CQL2("advanced-comparison-operators"), CQL2("spatial-operators"), CQL2("cql2-json")]});
        expect(dea.filter!.conformance).toEqual([CQL2("basic-cql2"), CQL2("advanced-comparison-operators"), CQL2("basic-spatial-functions"),
            CQL2("basic-spatial-functions-plus"), CQL2("spatial-functions")]);
        expect(parseCapabilities({conformsTo: basic}).filter!.conformance).toEqual([CQL2("basic-cql2")]);
    });

    it("basic CQL2 only (Planetary Computer, Copernicus): the server gets the comparison, the client the LIKE", async () => {
        const {calls} = mockServer({conformsTo: basic, items});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({collections: ["s2"], where});
        expect(ids(await search.collect())).toEqual(["S2A_1", "S2B_2"]);
        const sent = calls.find((c) => c.url.endsWith("/search"))!.body!;
        expect(sent.filter).toEqual({op: "<", args: [{property: "eo:cloud_cover"}, 20]});
        expect(search.plan).toMatchObject({filterEncoding: "cql2-json", serverFilter: sent.filter,
            clientFilter: {op: "like", args: [{property: "platform"}, "sentinel-%"]}});
        expect(search.plan.degradations).toContainEqual(expect.objectContaining({kind: "filter-split", client: "platform LIKE 'sentinel-%'",
            reason: expect.stringMatching(/advanced-comparison-operators/)}));
        expect(client.profile.filterApplied).toBe("yes");   // the check covers only the part sent
    });

    it("advanced comparison (Digital Earth Australia): the whole filter goes to the server", async () => {
        const {calls} = mockServer({conformsTo: [...basic, CQL2("advanced-comparison-operators")], items});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({collections: ["s2"], where});
        expect(ids(await search.collect())).toEqual(["S2A_1", "S2B_2"]);
        expect(JSON.stringify(calls.find((c) => c.url.endsWith("/search"))!.body!.filter)).toMatch(/like/);
        expect(search.plan.clientFilter).toBeUndefined();
        expect(search.plan.degradations.map((d) => d.kind)).not.toContain("filter-split");
    });

    it("CQL2-text only (DLR): the filter is written as text, and the server reads it", async () => {
        const {calls} = mockServer({conformsTo: [C("item-search"), C("item-search#filter"), CQL2("basic-cql2"), CQL2("advanced-comparison-operators"), CQL2("cql2-text")], items});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({collections: ["s2"], where});
        expect(ids(await search.collect())).toEqual(["S2A_1", "S2B_2"]);
        expect(search.plan.filterEncoding).toBe("cql2-text");
        expect(calls.find((c) => c.url.endsWith("/search"))!.body!.filter).toBe("(eo:cloud_cover < 20) AND (platform LIKE 'sentinel-%')");
    });

    it("an asset-format filter stays on the client, beside a server-side comparison", async () => {
        const cog = {data: {href: "https://x.test/a.tif", type: "image/tiff; application=geotiff; profile=cloud-optimized"}};
        const zip = {data: {href: "https://x.test/a.zip", type: "application/x.ascii-xyz+zip"}};
        const mixed = [item("cog", {"eo:cloud_cover": 1}, undefined, cog), item("zip", {"eo:cloud_cover": 1}, undefined, zip),
            item("cloudy", {"eo:cloud_cover": 90}, undefined, cog)];
        mockServer({conformsTo: basic, items: mixed});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({collections: ["s2"], where: {"eo:cloud_cover": {lt: 20}}, filter: formatsFilter(["COG"])});
        expect(ids(await search.collect())).toEqual(["cog"]);
        expect(search.plan.serverFilter).toEqual({op: "<", args: [{property: "eo:cloud_cover"}, 20]});
        expect(search.plan.clientFilter).toEqual(formatsFilter(["COG"]));
    });

    it("select asks for large pages, and keeps the items of earlier pages when a later one fails", async () => {
        const cog = {data: {href: "https://x.test/a.tif", type: "image/tiff; application=geotiff; profile=cloud-optimized"}};
        const tiles = [0, 1, 2, 3, 4].map((i) => item(`t${i}`, {"eo:cloud_cover": i}, [i, 0, i + 1, 1], cog));
        const {calls} = mockServer({items: tiles, pageSize: 2, failsPage: 2});
        const client = await StacClient.connect("https://stac.test/v1", {retry: {attempts: 1}});
        const result = await client.select({collection: "s2", area: [0, 0, 5, 1], pick: {coverage: "best"}});
        expect(calls.find((c) => c.url.endsWith("/search"))!.body!.limit).toBe(SELECT_PAGE_SIZE);
        // Page 2 answered 504: the two items of page 1 are picked among, with a warning, instead of an error.
        expect(result.items.map((i) => i.id)).toEqual(["t0", "t1"]);
        expect(result).toMatchObject({scanned: 2, truncated: true, interrupted: {page: 2, status: 504}});
        expect(result.problems).toContainEqual(expect.objectContaining({path: "search", severity: "warning", message: expect.stringMatching(/page 2 failed \(HTTP 504\)/)}));
        // A first page that fails is still an error: there is nothing to pick among.
        mockServer({items: tiles, failsPage: 1});
        const other = await StacClient.connect("https://stac.test/v1", {retry: {attempts: 1}});
        await expect(other.select({collection: "s2", area: [0, 0, 5, 1]})).rejects.toThrow(/504/);
    });

    it("queryables: a property the schema forbids stays on the client; additional properties may go", async () => {
        const strict = {type: "object", properties: {"eo:cloud_cover": {type: "number"}}, additionalProperties: false};
        mockServer({conformsTo: [...basic, CQL2("advanced-comparison-operators")], items, queryables: strict});
        let client = await StacClient.connect("https://stac.test/v1");
        let search = client.search({collections: ["s2"], where});
        expect(ids(await search.collect())).toEqual(["S2A_1", "S2B_2"]);
        expect(search.plan.clientFilter).toEqual({op: "like", args: [{property: "platform"}, "sentinel-%"]});
        expect(search.plan.degradations).toContainEqual(expect.objectContaining({kind: "filter-split", reason: expect.stringMatching(/platform/)}));
        mockServer({conformsTo: [...basic, CQL2("advanced-comparison-operators")], items, queryables: {...strict, additionalProperties: true}});
        client = await StacClient.connect("https://stac.test/v1");
        search = client.search({collections: ["s2"], where});
        await search.collect();
        expect(search.plan.clientFilter).toBeUndefined();
    });

    it("a filter the server refuses with 400 is tested on the client instead", async () => {
        const {calls} = mockServer({conformsTo: [...basic, CQL2("advanced-comparison-operators")], items, refuses: /like/});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({collections: ["s2"], where});
        expect(ids(await search.collect())).toEqual(["S2A_1", "S2B_2"]);
        expect(search.plan.degradations).toContainEqual({kind: "filter-refused", encoding: "cql2-json", message: "Operator not supported"});
        // CQL2-JSON refused, then CQL2-text (also refused), then the client.
        expect(calls.filter((c) => c.url.endsWith("/search")).length).toBeGreaterThanOrEqual(3);
        expect(search.plan.filterEncoding).toBe("client");
    });

    it("a success that is not JSON is an error that says so: an HTML error page, a bot check's empty 202", async () => {
        const landing = {type: "Catalog", id: "t", stac_version: "1.1.0", conformsTo: basic,
            links: [{rel: "search", href: "https://waf.test/v1/search"}, {rel: "data", href: "https://waf.test/v1/collections"}]};
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            if (/\/v1\/?$/.test(url)) return new Response(JSON.stringify(landing), {status: 200});
            if (url.endsWith("/collections")) return new Response("<!DOCTYPE html><title>Server error</title>", {status: 200, headers: {"Content-Type": "text/html"}});
            return new Response("", {status: 202, headers: {"x-amzn-waf-action": "challenge"}});   // the search
        }));
        const client = await StacClient.connect("https://waf.test/v1");
        await expect(client.listCollections()).rejects.toThrow(/HTTP 200 .* is not JSON \(it starts with "<!DOCTYPE html>/);
        const error = await client.search({collections: ["s2"]}).collect().catch((e: StacError) => e);
        expect(error).toBeInstanceOf(StacError);
        expect(error).toMatchObject({status: 202, message: expect.stringMatching(/not JSON \(it starts with an empty body\)/)});
    });

    it("splitFilter keeps the parts a server can take, and says why the others stay", () => {
        const filter = {op: "and", args: [{op: "<", args: [{property: "eo:cloud_cover"}, 20]},
            {op: "t_intersects", args: [{property: "datetime"}, {interval: ["2024-01-01T00:00:00Z", "2024-12-31T23:59:59Z"]}]}]};
        const split = splitFilter(filter, [CQL2("basic-cql2")]);
        expect(split.server).toEqual(filter.args[0]);
        expect(split.client).toEqual(filter.args[1]);
        expect(split.reason).toMatch(/temporal-functions/);
        expect(splitFilter(filter, [CQL2("basic-cql2"), CQL2("temporal-functions")]).client).toBeUndefined();
    });
});

// ------------------------------------------------------------------------------------------------ tests

describe("capabilities and requests", () => {
    it("matches conformance classes by pattern, whatever their version segment", () => {
        const caps = parseCapabilities({conformsTo: [
            C("core"), C("item-search"), "https://api.stacspec.org/v1.0.0-rc.2/item-search#filter", C("item-search#query"),
            "https://api.stacspec.org/v1.0.0-rc.1/item-search#sort", CQL2("cql2-json"), CQL2("basic-cql2"),
        ]});
        expect(caps.itemSearch).toBe(true);
        expect(caps.filter).toMatchObject({cql2Json: true, cql2Text: false, advancedComparison: false});
        expect(caps.query && caps.sort).toBe(true);
        expect(parseCapabilities({conformsTo: [C("item-search")]}).filter).toBeNull();
    });

    it("normalises dates: partial dates are whole periods, times get Z", () => {
        expect(normaliseDatetime("2024")).toBe("2024-01-01T00:00:00Z/2024-12-31T23:59:59.999Z");
        expect(normaliseDatetime("2024-02")).toBe("2024-02-01T00:00:00Z/2024-02-29T23:59:59.999Z");
        expect(normaliseDatetime(["2018", null])).toBe("2018-01-01T00:00:00Z/..");
        expect(normaliseDatetime("2018/2026")).toBe("2018-01-01T00:00:00Z/2026-12-31T23:59:59.999Z");
        expect(normaliseDatetime("2024-06-15T10:00:00")).toBe("2024-06-15T10:00:00Z");
    });

    it("compiles a request per server: CQL2-JSON, the Query extension, or a client-side filter", () => {
        const request = {collections: ["s2"], area: [0, 0, 1, 1] as [number, number, number, number], where: {"eo:cloud_cover": {lt: 5}},
            sortby: [{field: "datetime", direction: "desc" as const}]};
        const pgstac = parseCapabilities({conformsTo: [C("item-search"), C("item-search#filter"), CQL2("cql2-json"), CQL2("cql2-text"), C("item-search#sort")]});
        const a = planSearch("https://x/search", request, pgstac, emptyProfile("https://x"));
        expect(a.filterEncoding).toBe("cql2-json");
        expect(a.http.body).toMatchObject({filter: {op: "<", args: [{property: "eo:cloud_cover"}, 5]}, "filter-lang": "cql2-json",
            sortby: [{field: "properties.datetime", direction: "desc"}], bbox: [0, 0, 1, 1], limit: 50});

        const stacServer = parseCapabilities({conformsTo: [C("item-search"), C("item-search#query")]});
        const b = planSearch("https://x/search", request, stacServer, emptyProfile("https://x"));
        expect(b.filterEncoding).toBe("query");
        expect(b.http.body?.query).toEqual({"eo:cloud_cover": {lt: 5}});
        expect(b.degradations.map((d) => d.kind)).toContain("sort-dropped");

        const bare = planSearch("https://x/search", request, parseCapabilities({conformsTo: [C("item-search")]}), emptyProfile("https://x"));
        expect(bare.filterEncoding).toBe("client");
        expect(bare.clientApplies).toContain("where/filter");

        // GET: CQL2-text, and a polygon goes as its bbox plus a client-side test.
        const polygon = {type: "Polygon" as const, coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]]};
        const get = planSearch("https://x/search", {...request, area: polygon}, pgstac, {...emptyProfile("https://x"), postToGet: true});
        expect(get.http.method).toBe("GET");
        expect(new URL(get.http.url).searchParams.get("filter")).toBe("eo:cloud_cover < 5");
        expect(new URL(get.http.url).searchParams.get("bbox")).toBe("0,0,2,2");
        expect(get.clientApplies).toContain("polygon");
        expect(get.code.curl).toMatch(/^curl 'https:\/\/x\/search\?/);
    });

    it("writes and evaluates the CQL2 subset", () => {
        const e = {op: "and", args: [{op: "<", args: [{property: "eo:cloud_cover"}, 10]}, {op: "in", args: [{property: "platform"}, ["s2a", "s2b"]]},
            {op: "like", args: [{property: "id"}, "S2%"]}]};
        expect(toCql2Text(e)).toBe("(eo:cloud_cover < 10) AND (platform IN ('s2a', 's2b')) AND (id LIKE 'S2%')");
        expect(evaluateCql2(e, item("S2X", {"eo:cloud_cover": 3, platform: "s2b"}))).toBe(true);
        expect(evaluateCql2(e, item("S2X", {"eo:cloud_cover": 30, platform: "s2b"}))).toBe(false);
        // Regression: a timestamp literal compared as a number with the datetime string, so nothing matched.
        const after = {op: ">", args: [{property: "datetime"}, {timestamp: "2024-06-01T00:00:00Z"}]};
        expect(evaluateCql2(after, item("late", {datetime: "2024-07-01T10:00:00Z"}))).toBe(true);
        expect(evaluateCql2(after, item("early", {datetime: "2024-05-01T10:00:00Z"}))).toBe(false);
        const july = {op: "t_intersects", args: [{property: "datetime"}, {interval: ["2024-06-01T00:00:00Z", "2024-08-01T00:00:00Z"]}]};
        expect(evaluateCql2(july, item("late", {datetime: "2024-07-01T10:00:00Z"}))).toBe(true);
        expect(evaluateCql2(july, item("early", {datetime: "2024-05-01T10:00:00Z"}))).toBe(false);
        // CQL2 compares numbers with BETWEEN, not instants: ogc-cql2 refuses it, as a CQL2 server would.
        expect(() => evaluateCql2({op: "between", args: [{property: "datetime"}, {date: "2024-06-01"}, {date: "2024-08-01"}]}, item("x", {}))).toThrow(/BETWEEN/);
        expect(evaluateCql2({op: "s_intersects", args: [{property: "geometry"}, {type: "Polygon", coordinates: [[[5, 5], [20, 5], [20, 20], [5, 5]]]}]},
            item("a", {}))).toBe(true);
    });
});

describe("StacClient against server quirks", () => {
    const items = Array.from({length: 30}, (_, i) => item(`it${i}`, {"eo:cloud_cover": i * 3, datetime: `2024-0${1 + (i % 9)}-15T10:00:00Z`}));

    it("retries the landing page with a trailing slash (redirects without CORS headers)", async () => {
        mockServer({items, landingNeedsSlash: true, conformsTo: [C("item-search")]});
        const client = await StacClient.connect("https://stac.test/v1");
        expect(client.profile.trailingSlash).toBe(true);
        expect(client.capabilities.itemSearch).toBe(true);
    });

    it("detects a filter the server ignores on the first page and falls back to the Query extension", async () => {
        const {calls} = mockServer({items, ignoresFilter: true, conformsTo: [C("item-search"), C("item-search#filter"), CQL2("cql2-json"), C("item-search#query")]});
        const client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({where: {"eo:cloud_cover": {lt: 10}}});
        const found = await search.collect();
        expect(found.map((i) => i.id)).toEqual(["it0", "it1", "it2", "it3"]);
        expect(search.plan.filterEncoding).toBe("query");
        expect(client.profile.filterApplied).toBe("ignored");
        expect(calls.filter((c) => c.url.endsWith("/search")).length).toBe(2);   // the ignored attempt, then query
    });

    it("filters on the client, within a budget, when the server applies nothing", async () => {
        mockServer({items, ignoresFilter: true, ignoresQuery: true, pageSize: 10, conformsTo: [C("item-search"), C("item-search#query")]});
        const client = await StacClient.connect("https://stac.test/v1");
        const found = await client.search({where: {"eo:cloud_cover": {lt: 10}}, limit: 10}).collect();
        expect(found.map((i) => i.id)).toEqual(["it0", "it1", "it2", "it3"]);
        expect(client.profile.queryApplied).toBe("ignored");
        const capped = client.search({where: {"eo:cloud_cover": {gt: 80}}, limit: 10, maxScanned: 10});
        expect(await capped.collect()).toEqual([]);   // only the first page was scanned
    });

    it("follows next links: merged POST bodies, GET after a 405, smaller pages after a limit error", async () => {
        const merged = mockServer({items, mergePaging: true, pageSize: 10});
        let client = await StacClient.connect("https://stac.test/v1");
        expect((await client.search({limit: 10}).collect()).length).toBe(30);
        expect(merged.calls.filter((c) => c.method === "POST").map((c) => c.body?.page)).toEqual([undefined, 2, 3]);

        mockServer({items, post405: true, pageSize: 10});
        client = await StacClient.connect("https://stac.test/v1");
        expect((await client.search({limit: 10}).collect()).length).toBe(30);
        expect(client.profile.postToGet).toBe(true);

        mockServer({items, maxLimit: 20});
        client = await StacClient.connect("https://stac.test/v1");
        const search = client.search({limit: 50});
        expect((await search.collect()).length).toBe(30);
        expect(client.profile.maxLimit).toBe(12);   // halved twice: 50 → 25 → 12
        expect(await client.search({}).matched()).toEqual({value: 30, exact: true});
    });

    it("remembers what it learned in a JSON profile that a later session reuses", async () => {
        mockServer({items, ignoresFilter: true, conformsTo: [C("item-search"), C("item-search#filter"), CQL2("cql2-json"), C("item-search#query")]});
        const first = await StacClient.connect("https://stac.test/v1");
        await first.search({where: {"eo:cloud_cover": {lt: 10}}}).collect();
        const saved = JSON.parse(JSON.stringify(first.profile));
        const {calls} = mockServer({items, ignoresFilter: true, conformsTo: [C("item-search"), C("item-search#filter"), CQL2("cql2-json"), C("item-search#query")]});
        const second = await StacClient.connect("https://stac.test/v1", {profile: saved});
        expect(second.plan({where: {"eo:cloud_cover": {lt: 10}}}).filterEncoding).toBe("query");
        await second.search({where: {"eo:cloud_cover": {lt: 10}}}).collect();
        expect(calls.filter((c) => c.url.endsWith("/search")).length).toBe(1);   // no rediscovery
    });
});

describe("selection", () => {
    const area = [2, 2, 8, 8] as [number, number, number, number];

    it("covers an area with the fewest, best items", () => {
        const west = item("west", {"eo:cloud_cover": 1}, [0, 0, 5, 10]);
        const east = item("east", {"eo:cloud_cover": 2}, [5, 0, 10, 10]);
        const all = item("all", {"eo:cloud_cover": 40}, [0, 0, 10, 10]);
        const r = coverArea([all, east, west], area);
        expect(r.items.map((i) => i.id)).toEqual(["west", "east"]);
        expect(r.coverage).toBeGreaterThan(0.99);
        expect(itemsCovering([west, east, all], area).map((i) => i.id)).toEqual(["all"]);
    });

    it("covers a wide area with many small tiles, each under minGain of it, but skips slivers", () => {
        // 1° tiles over a 20° × 20° area: each is 0.25 % of it, below the 0.5 % minGain.
        const tiles = [];
        for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) tiles.push(item(`t${x}_${y}`, {}, [x, y, x + 1, y + 1]));
        const wide = coverArea(tiles, [0, 0, 20, 20]);
        expect(wide.items.length).toBeGreaterThan(390);   // it stops at the 99 % target
        expect(wide.coverage).toBeGreaterThan(0.99);
        // A big item mostly covered by earlier ones, adding a sliver, is still skipped.
        const left = item("left", {"eo:cloud_cover": 1}, [0, 0, 9.98, 10]);
        const big = item("big", {"eo:cloud_cover": 50}, [0, 0, 10, 10]);
        expect(coverArea([left, big], [0, 0, 10, 10]).items.map((i) => i.id)).toEqual(["left"]);
    });

    it("picks the best item per period, groups, dedupes and sorts", () => {
        const a = item("a", {datetime: "2023-07-01T10:00:00Z", "eo:cloud_cover": 5});
        const b = item("b", {datetime: "2023-08-01T10:00:00Z", "eo:cloud_cover": 1});
        const c = item("c", {datetime: "2024-07-01T10:00:00Z", "eo:cloud_cover": 9, "proj:code": "EPSG:32723"});
        expect(bestPerPeriod([a, b, c], {period: "year"}).map((p) => [p.period, p.items[0].id])).toEqual([["2023", "b"], ["2024", "c"]]);
        expect(bestPerPeriod([a, b, c], {period: "month"}).map((p) => p.period)).toEqual(["2023-07", "2023-08", "2024-07"]);
        expect([...groupItems([a, c], "crs").keys()]).toEqual(["unknown", "EPSG:32723"]);
        expect(dedupeItems([a, a, b]).map((i) => i.id)).toEqual(["a", "b"]);
        expect(sortItems([a, b, c], [{field: "eo:cloud_cover", direction: "desc"}]).map((i) => i.id)).toEqual(["c", "a", "b"]);
    });
});

describe("assets", () => {
    const s2 = item("S2", {}, undefined, {
        // Earth Search style (STAC 1.0)
        red: {href: "https://e84.test/B04.tif", type: "image/tiff; application=geotiff; profile=cloud-optimized",
            "eo:bands": [{name: "B04", common_name: "red"}], "raster:bands": [{scale: 0.0001, offset: -0.1, nodata: 0}]},
        nir: {href: "https://e84.test/B08.tif", type: "image/tiff", "eo:bands": [{common_name: "nir"}]},
        nir08: {href: "https://e84.test/B8A.tif", type: "image/tiff", "eo:bands": [{common_name: "nir08"}]},
        scl: {href: "https://e84.test/SCL.tif", type: "image/tiff", roles: ["data"]},
        thumbnail: {href: "https://e84.test/t.jpg", type: "image/jpeg", roles: ["thumbnail"]},
    });
    const pc = Object.assign(item("PC", {}, undefined, {
        // Planetary Computer style: asset keys B04 / B08, STAC 1.1 bands
        B04: {href: "https://acct.blob.core.windows.net/cont/B04.tif", type: "image/tiff",
            bands: [{name: "B04", "eo:common_name": "red", "raster:scale": 0.0001, "raster:offset": -0.1, nodata: 0}]},
        B08: {href: "https://acct.blob.core.windows.net/cont/B08.tif", type: "image/tiff", bands: [{"eo:common_name": "nir"}]},
        SR_B5: {href: "s3://usgs/x.tif", type: "image/tiff", "storage:requester_pays": true, "eo:bands": [{common_name: "nir08"}]},
        // INPE style: scale and nodata inside eo:bands, a non-standard common name for the class band.
        SCL: {href: "https://x/scl.tif", type: "image/tiff", "eo:bands": [{name: "SCL", common_name: "quality", scale: 1, nodata: 0}]},
    }), {links: [{rel: "self", href: "https://planetarycomputer.microsoft.com/api/stac/v1/collections/s2/items/PC"}]});

    it("reads STAC 1.0 and 1.1 band metadata alike", () => {
        expect(assetBands(s2.assets.red)).toEqual([{name: "B04", commonName: "red", scale: 0.0001, offset: -0.1, nodata: 0}]);
        expect(assetBands(pc.assets.B04)).toEqual([{name: "B04", commonName: "red", scale: 0.0001, offset: -0.1, nodata: 0}]);
    });

    it("says which assets need signing and which a browser cannot read", () => {
        expect(resolveAsset(s2, "red")).toMatchObject({href: "https://e84.test/B04.tif", readable: "yes"});
        expect(resolveAsset(pc, "B04").readable).toBe("signed");
        expect(resolveAsset(pc, "SR_B5")).toMatchObject({readable: "no", reason: "requester-pays storage"});
        expect(assetBands(pc.assets.SCL)).toEqual([{name: "SCL", scale: 1, nodata: 0}]);
    });

    it("signs Planetary Computer URLs with a cached token", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({token: "st=1&se=2&sig=abc", "msft:expiry": new Date(Date.now() + 3600_000).toISOString()})));
        vi.stubGlobal("fetch", fetchMock);
        const sign = planetaryComputerSigner("https://pc.test/token");
        expect(await sign("https://acct.blob.core.windows.net/cont/a.tif")).toBe("https://acct.blob.core.windows.net/cont/a.tif?st=1&se=2&sig=abc");
        expect(await sign.sign("https://acct.blob.core.windows.net/cont/b.tif?x=1")).toBe("https://acct.blob.core.windows.net/cont/b.tif?x=1&st=1&se=2&sig=abc");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sign.matches("https://acct.blob.core.windows.net/cont/a.tif", pc)).toBe(true);
        expect(sign.matches("https://e84.test/B04.tif", pc)).toBe(false);
        // Regression: every Azure blob URL matched, so other Azure storage got Planetary Computer tokens.
        expect(sign.matches("https://acct.blob.core.windows.net/cont/a.tif")).toBe(false);
        const other = item("O", {}, undefined, {B04: {href: "https://mine.blob.core.windows.net/c/B04.tif", type: "image/tiff"}});
        expect(sign.matches("https://mine.blob.core.windows.net/c/B04.tif", other)).toBe(false);
        expect(resolveAsset(other, "B04").readable).toBe("yes");
    });
});

// ------------------------------------------------------------------------------------------------ collection filter

describe("collection filter: the server first (Collection Search), then the same tests in the client", () => {
    const COLLECTION_SEARCH = "https://api.stacspec.org/v1.0.0-rc.1/collection-search";
    const coll = (id: string, bbox: [number, number, number, number], interval: [string | null, string | null], extra: Record<string, unknown> = {}) => ({
        type: "Collection", id, stac_version: "1.1.0", description: "", license: "proprietary", links: [],
        extent: {spatial: {bbox: [bbox]}, temporal: {interval: [interval]}}, ...extra,
    });
    const all = [
        coll("world-dem", [-180, -90, 180, 90], ["2015-01-01T00:00:00Z", null], {keywords: ["elevation"]}),
        coll("spain-ortho", [-10, 35, 5, 44], ["2020-01-01T00:00:00Z", "2022-12-31T00:00:00Z"]),
        coll("arizona-lidar", [-115, 31, -109, 37], ["2023-01-01T00:00:00Z", null], {keywords: ["elevation"], title: "Arizona LiDAR"}),
        coll("sentinel-2-l2a", [-180, -90, 180, 90], ["2017-03-28T00:00:00Z", null]),
    ];
    /** A collections endpoint: filters by bbox and datetime unless loose; fails or caps the page size on request. */
    function collectionsServer(options: { search?: boolean; loose?: boolean; fails?: boolean; maxLimit?: number } = {}) {
        const base = "https://coll.test/v1";
        const calls: string[] = [];
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = new URL(String(input));
            calls.push(url.toString());
            if (url.pathname === "/v1" || url.pathname === "/v1/") {
                return json(200, {type: "Catalog", id: "c", stac_version: "1.1.0", links: [{rel: "data", href: `${base}/collections`}],
                    conformsTo: [C("core"), C("collections"), ...(options.search === false ? [] : [COLLECTION_SEARCH])]});
            }
            if (url.pathname !== "/v1/collections") return json(404, {});
            const p = url.searchParams;
            if (options.fails && (p.has("bbox") || p.has("datetime"))) return json(500, {code: "PostgresSyntaxError"});
            if (options.maxLimit && Number(p.get("limit") ?? 10) > options.maxLimit) return json(400, {detail: "limit too large"});
            let found = all;
            if (!options.loose && p.has("bbox")) {
                const [w, so, e, n] = p.get("bbox")!.split(",").map(Number);
                found = found.filter((c) => { const [cw, cs, ce, cn] = c.extent.spatial.bbox[0]; return cw <= e && ce >= w && cs <= n && cn >= so; });
            }
            if (!options.loose && p.has("datetime")) {
                const [a, b] = p.get("datetime")!.split("/").map((t) => (t === ".." ? NaN : Date.parse(t)));
                found = found.filter((c) => {
                    const [i0, i1] = c.extent.temporal.interval[0].map((t) => (t ? Date.parse(t) : NaN));
                    return !(i0 > b) && !(i1 < a);
                });
            }
            return json(200, {collections: found, links: []});
        }));
        return {base, calls};
    }
    const ids = (cs: { id: string }[]) => cs.map((c) => c.id).sort();
    const arizona: [number, number, number, number] = [-112.5, 36, -111.8, 36.4];

    it("sends the bbox and the period (never q) with a large limit, then tests everything again", async () => {
        const {base, calls} = collectionsServer();
        const client = await StacClient.connect(base);
        const steps: unknown[] = [];
        const found = await client.collections({area: arizona, datetime: ["2024-01-01", null], q: "elev", onServer: (s) => steps.push(s)});
        expect(ids(found)).toEqual(["arizona-lidar", "world-dem"]);
        const sent = new URL(calls.find((u) => u.includes("bbox="))!);
        expect(sent.searchParams.get("bbox")).toBe("-112.5,36,-111.8,36.4");
        expect(sent.searchParams.get("datetime")).toBe("2024-01-01T00:00:00.000Z/..");
        expect(sent.searchParams.get("limit")).toBe(String(COLLECTION_PAGE_SIZE));
        expect(sent.searchParams.has("q")).toBe(false);
        expect(steps).toEqual([{sent: ["bbox", "datetime"], url: sent.toString(), count: 3}]);
        // The full list was never read.
        expect(calls.some((u) => u === `${base}/collections`)).toBe(false);
        // The full list, when needed, comes in large pages too.
        await client.listCollections();
        expect(calls).toContain(`${base}/collections?limit=${COLLECTION_PAGE_SIZE}`);
        // Regional drops the whole-world collections.
        expect(ids(await client.collections({area: arizona, regional: true}))).toEqual(["arizona-lidar"]);
    });

    it("gives the same list when the server ignores the parameters, cannot filter, or fails", async () => {
        const filter = {area: arizona, datetime: ["2024-01-01", null] as [string, null], regional: true};
        const expected = ["arizona-lidar"];
        for (const options of [{loose: true}, {search: false}, {fails: true}]) {
            const {base, calls} = collectionsServer(options);
            const client = await StacClient.connect(base);
            const steps: { error?: string; count?: number }[] = [];
            expect(ids(await client.collections({...filter, onServer: (s) => steps.push(s)}))).toEqual(expected);
            if (options.search === false) {
                expect(steps).toEqual([]);
                expect(calls.some((u) => u.includes("limit="))).toBe(false);
                expect(calls.some((u) => u.includes("bbox="))).toBe(false);
            }
            if (options.fails) expect(steps[0].error).toMatch(/500/);
            if (options.loose) expect(steps[0].count).toBe(4);
            vi.unstubAllGlobals();
        }
    });

    it("asks again without limit when the server refuses it, and caches each answer", async () => {
        const {base, calls} = collectionsServer({maxLimit: 100});
        const client = await StacClient.connect(base);
        expect(ids(await client.collections({area: arizona}))).toEqual(["arizona-lidar", "sentinel-2-l2a", "world-dem"]);
        const searches = () => calls.filter((u) => u.includes("bbox=")).length;
        expect(searches()).toBe(2);
        await client.collections({area: arizona, q: "lidar"});
        expect(searches()).toBe(2);
    });

    it("reads a date-only end as the end of that day; tells global extents from regional ones", async () => {
        collectionsServer({search: false});
        const client = await StacClient.connect("https://coll.test/v1");
        // arizona-lidar starts 2023-01-01T00:00Z: inside a period ending on that date.
        expect(ids(await client.findCollections({datetime: [null, "2023-01-01"]}))).toContain("arizona-lidar");
        expect(ids(await client.findCollections({datetime: [null, "2022-12-31"]}))).not.toContain("arizona-lidar");
        expect(isGlobalBbox([-180, -90, 180, 90])).toBe(true);
        expect(isGlobalBbox([-180, -60, 180, 84])).toBe(true);
        expect(isGlobalBbox([-180, 0, 180, 90])).toBe(false);
        expect(isGlobalBbox([170, -90, -170, 90])).toBe(false);
    });
});

// ------------------------------------------------------------------------------------------------ static crawl by area

describe("static catalog search: parts outside the area are not read", () => {
    const base = "https://tiles.test";
    const box = (b: number[]) => `box:${b.join(",")}`;
    const feature = (id: string, b: [number, number, number, number]) => ({...item(id, {}, b), collection: "tiles", links: []});
    const docs: Record<string, unknown> = {
        "/catalog.json": {type: "Catalog", id: "root", stac_version: "1.0.0", description: "", links: [{rel: "child", href: "./c/collection.json"}]},
        "/c/collection.json": {type: "Collection", id: "tiles", stac_version: "1.0.0", description: "", license: "proprietary",
            extent: {spatial: {bbox: [[-180, -90, 180, 90]]}, temporal: {interval: [[null, null]]}},
            links: [
                {rel: "child", href: "./p0_p0/catalog.json", title: box([0, 0, 10, 10])},
                {rel: "child", href: "./p0_p10/catalog.json", title: box([10, 0, 20, 10])},
                {rel: "child", href: "./p10_p0/catalog.json", title: box([0, 10, 10, 20])},
                // No title to read: followed, then skipped for its declared extent.
                {rel: "child", href: "./far/collection.json"},
            ]},
        "/c/p0_p0/catalog.json": {type: "Catalog", id: "p0_p0", stac_version: "1.0.0", description: "",
            links: [{rel: "item", href: "./a.json", title: box([2, 2, 3, 3])}, {rel: "item", href: "./b.json", title: box([5, 5, 6, 6])}]},
        "/c/p0_p10/catalog.json": {type: "Catalog", id: "p0_p10", stac_version: "1.0.0", description: "", links: [{rel: "item", href: "./c.json"}]},
        "/c/p10_p0/catalog.json": {type: "Catalog", id: "p10_p0", stac_version: "1.0.0", description: "", links: [{rel: "item", href: "./d.json"}]},
        "/c/far/collection.json": {type: "Collection", id: "far", stac_version: "1.0.0", description: "", license: "proprietary",
            extent: {spatial: {bbox: [[100, 50, 110, 60]]}, temporal: {interval: [[null, null]]}}, links: [{rel: "item", href: "./e.json"}]},
        "/c/p0_p0/a.json": feature("a", [2, 2, 3, 3]),
        "/c/p0_p0/b.json": feature("b", [5, 5, 6, 6]),
        "/c/p0_p10/c.json": feature("c", [12, 2, 13, 3]),
        "/c/p10_p0/d.json": feature("d", [2, 12, 3, 13]),
        "/c/far/e.json": feature("e", [101, 51, 102, 52]),
    };
    function serve() {
        const calls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const path = new URL(String(input)).pathname;
            calls.push(path);
            const doc = docs[path];
            return new Response(JSON.stringify(doc ?? {}), {status: doc ? 200 : 404, headers: {"Content-Type": "application/json"}});
        }));
        return calls;
    }
    const linkBbox = (link: { title?: string }) => (link.title?.startsWith("box:") ? link.title.slice(4).split(",").map(Number) as [number, number, number, number] : undefined);

    it("skips links whose crawl.linkBbox misses the area, and children whose extent does", async () => {
        const calls = serve();
        const client = await StacClient.connect(`${base}/catalog.json`, {crawl: {linkBbox}});
        // Listing the collections reads every child once (nested collections may hide anywhere); it is cached.
        await client.listCollections();
        calls.length = 0;
        const progress: number[] = [];
        const found = await client.search({collections: ["tiles"], area: [2.2, 2.2, 2.8, 2.8]}, {onProgress: (p) => progress.push(p.pruned ?? 0)}).collect();
        expect(found.map((i) => i.id)).toEqual(["a"]);
        for (const unread of ["/c/p0_p10/catalog.json", "/c/p10_p0/catalog.json", "/c/p0_p0/b.json", "/c/far/e.json"]) expect(calls).not.toContain(unread);
        // Two sub-catalogs and one item by their link, the far collection by its extent.
        expect(Math.max(...progress)).toBe(4);
    });

    it("finds the same items without linkBbox, reading everything but the far collection's items", async () => {
        const calls = serve();
        const client = await StacClient.connect(`${base}/catalog.json`);
        expect((await client.search({collections: ["tiles"], area: [2.2, 2.2, 2.8, 2.8]}).collect()).map((i) => i.id)).toEqual(["a"]);
        expect(calls).toContain("/c/p0_p10/c.json");
        expect(calls).not.toContain("/c/far/e.json");
        // Without an area nothing is skipped.
        expect((await client.search({collections: ["tiles"]}).collect()).map((i) => i.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    });
});
