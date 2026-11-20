/**
 * Regression tests of the code issues found by the documentation reviews ("Possible code issues"), for the STAC
 * engine. Each test failed before its fix.
 */
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {
    collectionBands, cql2Predicate, describeCollectionJson, evaluateCql2, formatsFilter, itemFormats, toCql2Text, footprintOf, bboxOf, groupItems, periodOf,
    assetFormat, elevationHint, resolveAsset, solarLongitude, StacClient, StacError, type StacCollectionJson, type StacItemJson,
} from "../src/index.js";
import {bboxesIntersect} from "../src/geometry.js";
import {startRangeServer} from "./helpers.js";

let server: Awaited<ReturnType<typeof startRangeServer>>;
beforeAll(async () => { server = await startRangeServer(); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A STAC item over the Sentinel-2 fixtures (UTM 33N). */
function s2Item(id: string, date: string, extra: Partial<StacItemJson> = {}): StacItemJson {
    return {
        type: "Feature", id, collection: "s2", bbox: [15.0, 45.12, 15.03, 45.15],
        geometry: {type: "Polygon", coordinates: [[[15.0, 45.12], [15.03, 45.12], [15.03, 45.15], [15.0, 45.15], [15.0, 45.12]]]},
        properties: {datetime: date, "eo:cloud_cover": 1},
        assets: {
            red: {href: `${server.url}/s2-red-10m.tif`, type: "image/tiff", "eo:bands": [{common_name: "red"}], "raster:bands": [{scale: 0.0001, offset: -0.1, nodata: 0}]},
            nir: {href: `${server.url}/s2-nir-10m.tif`, type: "image/tiff", "eo:bands": [{common_name: "nir"}], "raster:bands": [{scale: 0.0001, offset: -0.1, nodata: 0}]},
            scl: {href: `${server.url}/s2-scl-20m.tif`, type: "image/tiff", roles: ["data"]},
        },
        ...extra,
    } as StacItemJson;
}

/** An item over a lon/lat box, in a given coordinate reference. */
function boxItem(id: string, [w, s, e, n]: number[], code: string, cloud = 1, datetime = "2024-07-01T10:00:00Z"): StacItemJson {
    return {
        type: "Feature", id, collection: "s2", bbox: [w, s, e, n],
        geometry: {type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]},
        properties: {datetime, "eo:cloud_cover": cloud, "proj:code": code}, assets: {data: {href: `https://x.test/${id}.tif`, type: "image/tiff; application=geotiff; profile=cloud-optimized"}},
    } as StacItemJson;
}

/** A minimal STAC API answering every search with `found`. */
function stubCatalog(found: StacItemJson[]) {
    const realFetch = globalThis.fetch;
    const collection: StacCollectionJson = {id: "s2", title: "Sentinel-2", extent: {spatial: {bbox: [[-180, -90, 180, 90]]}, temporal: {interval: [[null, null]]}}} as StacCollectionJson;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://stac.test")) return realFetch(input, init);
        if (url === "https://stac.test/v1") return json({stac_version: "1.1.0", conformsTo: ["https://api.stacspec.org/v1.0.0/item-search"],
            links: [{rel: "search", href: "https://stac.test/v1/search"}, {rel: "data", href: "https://stac.test/v1/collections"}]});
        if (url === "https://stac.test/v1/collections") return json({collections: [collection]});
        if (url === "https://stac.test/v1/collections/s2") return json(collection);
        if (url.startsWith("https://stac.test/v1/search")) return json({type: "FeatureCollection", features: found, links: []});
        return json({}, 404);
    }));
}

describe("STAC sources", () => {
    it("2. groups solar days at the item's centre longitude, as select does", () => {
        // Longitude 15: solar time is UTC + 1 h. 22:30 UTC is still June 1, 23:30 UTC is June 2.
        const items = [s2Item("a", "2024-06-01T22:30:00Z"), s2Item("b", "2024-06-01T23:30:00Z")];
        expect([...groupItems(items, "solar-day").keys()]).toEqual(["2024-06-01", "2024-06-02"]);
        expect(items.map((i) => periodOf(i, "solar-day", solarLongitude(i)))).toEqual(["2024-06-01", "2024-06-02"]);
    });

    it("2. takes the centre of a bbox across the antimeridian, and of a 3D bbox", () => {
        expect(solarLongitude(boxItem("x", [170, 0, -170, 1], "EPSG:4326"))).toBeCloseTo(180);
        expect(solarLongitude({...boxItem("y", [0, 0, 1, 1], "EPSG:4326"), bbox: [10, 0, -5, 20, 1, 5]})).toBe(15);
    });
});

describe("select: one coordinate reference", () => {
    const area: [number, number, number, number] = [15, 45, 15.1, 45.1];

    it("3. makes a best-coverage mosaic in one reference and reports the dropped items", async () => {
        const west = boxItem("west", [15, 45, 15.05, 45.1], "EPSG:32633", 1);
        const eastA = boxItem("eastA", [15.05, 45, 15.1, 45.1], "EPSG:32634", 2);
        const eastB = boxItem("eastB", [15.05, 45, 15.1, 45.1], "EPSG:32634", 3);
        stubCatalog([west, eastA, eastB]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const found = await catalog.select({collection: "s2", area, pick: {coverage: "best"}});
        // Both references cover half of the area; EPSG:32634 has more candidates.
        expect(found.items.map((i) => i.id)).toEqual(["eastA"]);
        expect(found.dropped).toEqual([{reference: "EPSG:32633", items: [west]}]);
        expect(found.problems).toEqual([expect.objectContaining({path: "pick", severity: "warning"})]);
    });

    it("3. keeps the reference covering most of the area with per, and reports the others", async () => {
        const full = boxItem("full", [14.9, 44.9, 15.2, 45.2], "EPSG:32633", 5, "2023-07-01T10:00:00Z");
        const part1 = boxItem("part1", [15, 45, 15.05, 45.1], "EPSG:32634", 1, "2023-07-01T10:00:00Z");
        const part2 = boxItem("part2", [15, 45, 15.05, 45.1], "EPSG:32634", 1, "2024-07-01T10:00:00Z");
        stubCatalog([full, part1, part2]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const found = await catalog.select({collection: "s2", area, pick: {coverage: "best", per: "year"}});
        expect(found.items.map((i) => i.id)).toEqual(["full"]);
        expect(found.dropped.map((d) => [d.reference, d.items.map((i) => i.id)])).toEqual([["EPSG:32634", ["part1", "part2"]]]);
        // A single item drops nothing.
        const one = await catalog.select({collection: "s2", area, pick: {coverage: "best"}});
        expect(one).toMatchObject({dropped: [], problems: []});
    });

    it("6. declares StacError.problems", async () => {
        const problem = {path: "area", severity: "error" as const, message: "outside"};
        expect(new StacError("x", undefined, undefined, undefined, [problem]).problems).toEqual([problem]);
        stubCatalog([]);
        const catalog = await StacClient.connect("https://stac.test/v1");
        const error = await catalog.select({collection: "s2", area}).catch((e: StacError) => e);
        expect(error).toBeInstanceOf(StacError);
        expect((error as StacError).problems).toEqual([{path: "", severity: "warning", message: "the search found no item: widen the area"}]);
    });

    it("5. calls the client's rewriteUrl with the URL only", async () => {
        stubCatalog([]);
        const rewriteUrl = vi.fn((url: string) => url);
        const catalog = await StacClient.connect("https://stac.test/v1", {rewriteUrl});
        await catalog.listCollections();
        expect(rewriteUrl).toHaveBeenCalled();
        for (const call of rewriteUrl.mock.calls) expect(call.length).toBe(1);
    });
});

describe("STAC metadata", () => {
    it("names asset formats and says which ones a model can open (assetFormat)", () => {
        const f = (type: string | undefined, href = "https://x.test/a") => assetFormat({type, href});
        expect(f("image/tiff; application=geotiff; profile=cloud-optimized")).toEqual({format: "COG", openable: true, cog: true});
        expect(f("image/tiff; application=geotiff")).toEqual({format: "GeoTIFF", openable: true, cog: false});
        expect(f(undefined, "https://x.test/dem.tif?sig=1")).toMatchObject({format: "GeoTIFF", openable: true});
        expect(f("application/x.tiff+zip")).toEqual({format: "GeoTIFF (zipped)", openable: false, cog: false});
        expect(f(undefined, "https://x.test/dem.tif.zip")).toMatchObject({format: "GeoTIFF (zipped)", openable: false});
        expect(f("application/x.interlis+zip; version=2.3").format).toBe("INTERLIS (zipped)");
        expect(f("application/x.ms-access+zip").format).toBe("MS Access (zipped)");
        expect(f("application/zip").format).toBe("ZIP");
        expect(f("application/geopackage+sqlite3").format).toBe("GeoPackage");
        expect(f("text/csv").format).toBe("CSV");
        expect(f("application/geo+json").format).toBe("GeoJSON");
        expect(f("image/jpeg").format).toBe("JPEG");
        expect(f("application/xml").format).toBe("XML");
        expect(f("application/vnd.google-earth.kmz").format).toBe("KML");
        expect(f("application/x-foo").format).toBe("FOO");
    });

    it("samples one item of a collection through the items endpoint, or the crawl of a static catalog", async () => {
        const fixture = await StacClient.connect(`${server.url}/static-catalog/catalog.json`);
        expect((await fixture.sampleItem("s2-sample"))?.collection).toBe("s2-sample");
        const requested: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
            const url = String(input);
            requested.push(url);
            if (url.endsWith("/v1")) return Response.json({type: "Catalog", id: "api", stac_version: "1.0.0", description: "", links: [],
                conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collections"]});
            return Response.json({type: "FeatureCollection", features: [{type: "Feature", id: "one", properties: {}, assets: {}}]});
        }));
        const api = await StacClient.connect("https://api.test/v1");
        expect((await api.sampleItem("a b"))?.id).toBe("one");
        expect(requested.at(-1)).toBe("https://api.test/v1/collections/a%20b/items?limit=1");
    });

    it("hints which collections are elevation, from keywords, title, description or asset keys (elevationHint)", () => {
        const c = (id: string, title: string, description: string, extra: Partial<StacCollectionJson> = {}) =>
            ({type: "Collection", id, title, description, stac_version: "1.0.0", license: "", links: [],
                extent: {spatial: {bbox: [[0, 0, 1, 1]]}, temporal: {interval: [[null, null]]}}, ...extra}) as StacCollectionJson;
        // swisstopo: no keywords, no item_assets: the description says it.
        expect(elevationHint(c("ch.swisstopo.swissaltiregio", "swissALTIRegio",
            "swissALTIRegio is a medium-resolution digital terrain model (10m).")))
            .toBe('its description says "digital terrain model"');
        expect(elevationHint(c("ch.swisstopo.swisssurface3d-raster", "swissSURFACE3D Raster",
            "swissSURFACE3D Raster is a digital surface model (DSM) which represents the earth's surface"))).toMatch(/surface model/);
        expect(elevationHint(c("ch.swisstopo.swissbathy3d", "swissBATHY3D, Bathymetric data of Swiss lakes", "lakebeds"))).toMatch(/Bathymetric/);
        // Earth Search, Planetary Computer: keywords; or an asset key.
        expect(elevationHint(c("cop-dem-glo-30", "Copernicus DEM GLO-30", "…", {keywords: ["Copernicus", "DEM", "DSM", "Elevation"]})))
            .toBe('its keywords include "DEM"');
        expect(elevationHint(c("x", "Heights", "…", {item_assets: {elevation: {type: "image/tiff"}}}))).toBe('its items have an asset "elevation"');
        // Not elevation: imagery, and products derived from heights.
        expect(elevationHint(c("ch.swisstopo.swissimage-dop10", "SWISSIMAGE 10 cm, digital orthophotomosaic of Switzerland",
            "The orthophoto mosaic SWISSIMAGE 10 cm is a composition of new digital color aerial photographs"))).toBeNull();
        expect(elevationHint(c("ch.bafu.landesforstinventar-vegetationshoehenmodell", "Vegetation height model NFI",
            "Countrywide vegetation height models (VHM) were generated from a digital surface model"))).toBeNull();
        expect(elevationHint(c("ch.bafu.landesforstinventar-vegetationshoehenmodell_relief", "Relief shading of vegetation height model NFI",
            "Information on vegetation height"))).toBeNull();
        // "dem" inside a word is no evidence.
        expect(elevationHint(c("academia", "Academic demographics", "Population by academic degree"))).toBeNull();
    });
});

describe("STAC helpers", () => {
    it("14. reports http-only assets as mixed content on https pages", () => {
        const item = {...boxItem("i", [0, 0, 1, 1], "EPSG:4326"), assets: {
            b1: {href: "http://data.test/b1.tif", type: "image/tiff"},
            b2: {href: "http://data.test/b2.tif", type: "image/tiff", alternate: {https: {href: "https://data.test/b2.tif"}}},
        }} as StacItemJson;
        expect(resolveAsset(item, "b1", [])).toMatchObject({readable: "yes", href: "http://data.test/b1.tif"});
        vi.stubGlobal("location", {protocol: "https:", href: "https://app.test/"});
        expect(resolveAsset(item, "b1", [])).toMatchObject({readable: "no", reason: "mixed content", href: "http://data.test/b1.tif"});
        expect(resolveAsset(item, "b2", [])).toMatchObject({readable: "yes", href: "https://data.test/b2.tif"});
    });

    it("15. intersects bounding boxes across the antimeridian", () => {
        expect(bboxesIntersect([170, -10, -170, 10], [175, 0, 176, 1])).toBe(true);
        expect(bboxesIntersect([170, -10, -170, 10], [-175, 0, -174, 1])).toBe(true);
        expect(bboxesIntersect([170, -10, -170, 10], [0, 0, 1, 1])).toBe(false);
        expect(bboxesIntersect([175, 0, 176, 1], [170, -10, -170, 10])).toBe(true);
        expect(bboxesIntersect([170, -10, -170, 10], [160, 20, 179, 30])).toBe(false);
    });

    it("15. finds a collection whose extent crosses the antimeridian", async () => {
        const realFetch = globalThis.fetch;
        const pacific = {id: "pacific", extent: {spatial: {bbox: [[170, -20, -170, 20]]}, temporal: {interval: [[null, null]]}}};
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            if (!url.startsWith("https://stac.test")) return realFetch(input, init);
            const body = url === "https://stac.test/v1" ? {links: [{rel: "data", href: "https://stac.test/v1/collections"}]} : {collections: [pacific]};
            return new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
        }));
        const catalog = await StacClient.connect("https://stac.test/v1");
        expect((await catalog.findCollections({bbox: [175, 0, 176, 1]})).map((c) => c.id)).toEqual(["pacific"]);
        expect((await catalog.collections({area: [-179, 0, -178, 1]})).map((c) => c.id)).toEqual(["pacific"]);
    });

    it("17. evaluates CQL2 with ogc-cql2: arrays and temporal functions, a Spatial Function refused", () => {
        const item = {...boxItem("i", [0, 0, 1, 1], "EPSG:4326"), properties: {datetime: "2024-06-01T00:00:00Z", tags: ["a", "b"]}};
        expect(evaluateCql2({op: "a_contains", args: [{property: "tags"}, ["a"]]}, item)).toBe(true);
        expect(evaluateCql2({op: "a_contains", args: [{property: "missing"}, ["x"]]}, item)).toBe(false);
        expect(evaluateCql2({op: "t_intersects", args: [{property: "datetime"}, {interval: ["2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"]}]}, item)).toBe(true);
        expect(evaluateCql2({op: "t_before", args: [{property: "datetime"}, {timestamp: "2024-01-01T00:00:00Z"}]}, item)).toBe(false);
        expect(evaluateCql2({op: "=", args: [{property: "missing"}, 1]}, item)).toBe(false);
        expect(() => evaluateCql2({op: "s_within", args: [{property: "geometry"}, {bbox: [0, 0, 2, 2]}]}, item)).toThrow(/unsupported|Spatial/i);
    });

    it("17b. filters items by asset format with CQL2: asset_formats, formatsFilter and itemFormats", () => {
        const cog = boxItem("cog", [0, 0, 1, 1], "EPSG:4326");
        const zipped = {...cog, id: "zip", assets: {xyz: {href: "https://x.test/t.xyz.zip", type: "application/x.ascii-xyz+zip"},
            thumbnail: {href: "https://x.test/t.png", type: "image/png", roles: ["thumbnail"]}}};
        const plain = {...cog, id: "tif", assets: {data: {href: "https://x.test/t.tif", type: "image/tiff; application=geotiff"}}};
        expect(itemFormats(cog)).toEqual(["COG"]);
        expect(itemFormats(zipped)).toEqual(["XYZ (zipped)"]);
        const cogOnly = cql2Predicate(formatsFilter(["COG"]));
        expect([cog, zipped, plain].filter(cogOnly).map((i) => i.id)).toEqual(["cog"]);
        expect([cog, zipped, plain].filter(cql2Predicate(formatsFilter(["COG", "GeoTIFF"]))).map((i) => i.id)).toEqual(["cog", "tif"]);
        expect(toCql2Text(formatsFilter(["COG"]))).toBe("A_OVERLAPS(asset_formats, ('COG'))");
        // An item property of that name wins over the derived one.
        expect(cogOnly({...zipped, properties: {...zipped.properties, asset_formats: ["COG"]}})).toBe(true);
    });

    it("19. names the bands of a collection from its item_assets", () => {
        const assets = {
            "b-1": {href: "https://x.test/b1.tif", type: "image/tiff", roles: ["data"]},
            "2nd": {href: "https://x.test/b2.tif", type: "image/tiff", roles: ["data"], "eo:bands": [{common_name: "nir08"}]},
            vis: {href: "https://x.test/v.tif", type: "image/tiff", roles: ["data"], "eo:bands": [{name: "x-1"}, {}]},
        };
        const collection = {id: "c", item_assets: assets} as unknown as StacCollectionJson;
        expect(collectionBands(describeCollectionJson(collection))).toEqual(["b_1", "nir", "x_1", "vis_b2"]);
    });

    it("20. reads 3D bboxes as footprints, and refuses a bbox of a geometry without positions", () => {
        const item = {...boxItem("i", [0, 0, 1, 1], "EPSG:4326"), geometry: null, bbox: [10, 20, -5, 11, 21, 5]} as unknown as StacItemJson;
        expect(footprintOf(item)).toEqual([[[[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]]]]);
        expect(bboxOf({type: "Point", coordinates: [3, 4]})).toEqual([3, 4, 3, 4]);
        expect(bboxOf({type: "LineString", coordinates: [[0, 1], [2, -1]]})).toEqual([0, -1, 2, 1]);
        expect(() => bboxOf({type: "MultiPolygon", coordinates: []})).toThrow(RangeError);
    });
});
