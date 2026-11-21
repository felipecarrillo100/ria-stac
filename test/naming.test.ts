import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {assetBands, isDataAsset, isGeoTiffAsset, nameBands, resolveBandName, stableAssetKey, type NamedAsset, type StacItemJson} from "../src/index.js";
import {FIXTURES} from "./helpers.js";

/** Shared with ria-geotiff: real items and the names the rule must give them. */
const {cases} = JSON.parse(readFileSync(join(FIXTURES, "band-naming.json"), "utf8")) as {
    cases: { source: string; item: StacItemJson; expected: NamedAsset[] }[];
};
// The fixtures name the GeoTIFF data assets: the ones a ria-geotiff model is made of.
const named = (item: StacItemJson) => nameBands(Object.keys(item.assets).filter((k) => isDataAsset(k, item.assets[k]) && isGeoTiffAsset(item.assets[k]))
    .map((key) => ({key, bands: assetBands(item.assets[key], item)})), {itemId: item.id});
const names = (n: NamedAsset[]) => n.flatMap((a) => a.bands.map((b) => b.name));

describe("band naming, on the shared fixtures of real items", () => {
    it.each(cases.map((c) => [`${c.source}: ${c.item.id}`, c] as const))("%s", (_, c) => {
        const result = named(c.item);
        expect(result).toEqual(c.expected);
        expect(new Set(names(result)).size).toBe(names(result).length);   // no name twice in one model
    });

    it("gives every item of a collection the same names, per-tile keys included", () => {
        const bySource = new Map<string, string[]>();
        for (const c of cases) {
            const key = names(named(c.item)).sort().join(",");
            expect(bySource.get(c.source) ?? [key]).toEqual([key]);
            bySource.set(c.source, [key]);
        }
    });

    it("names bands by role, so a style written on one catalog works on another", () => {
        const roles = ["red", "green", "blue", "nir", "swir16", "swir22"];
        for (const source of ["Planetary Computer Sentinel-2", "Earth Search Sentinel-2", "INPE Sentinel-2 cube", "Planetary Computer Landsat"]) {
            const n = names(named(cases.find((c) => c.source === source)!.item));
            expect(roles.filter((r) => !n.includes(r)), source).toEqual([]);
        }
    });

    it("resolves another catalog's keys and band names through aliases, and says so", () => {
        const es = named(cases.find((c) => c.source === "Earth Search Sentinel-2")!.item);
        expect(resolveBandName("red", es)).toEqual({name: "red"});
        expect(resolveBandName("B04", es)).toEqual({name: "red", via: "B04"});   // a Planetary Computer style
        const landsat = named(cases.find((c) => c.source === "Planetary Computer Landsat")!.item);
        expect(resolveBandName("nir08", landsat)).toEqual({name: "nir", via: "nir08"});
        expect(resolveBandName("OLI_B4", landsat)).toEqual({name: "red", via: "OLI_B4"});
        // A common name several bands share is no alias: it would mean another band on each catalog.
        expect(resolveBandName("rededge", es)).toBeUndefined();
        expect(resolveBandName("nope", es)).toBeUndefined();
    });

    it("strips the item id from asset keys", () => {
        expect(stableAssetKey("swissalti3d_2019_2598-1198_0.5_2056_5728.tif", "swissalti3d_2019_2598-1198")).toBe("0.5_2056_5728.tif");
        expect(stableAssetKey("B04", "S2A_T23KPT")).toBe("B04");
        expect(stableAssetKey("item", "item")).toBe("item");
        expect(stableAssetKey("red")).toBe("red");
    });
});
