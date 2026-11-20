// Band naming spike: today's common-name-first names against odc-stac's "asset key + aliases", on real items of the
// catalogs used in the session, replaying the style presets (what saved styles refer to).
import {writeFileSync} from "node:fs";
import {it} from "vitest";
import {assetBands, isDataAsset, StacClient, type BandDescriptor, type Bbox, type StacItemJson} from "../src/index.js";
import {bandIdentifier, nameAssetBands} from "../src/bands.js";
import {STYLE_PRESETS} from "../../geotifftilesetmodel/src/rs/presets.js";

const VALE: Bbox = [-43.927, -19.99, -43.861, -19.946], BERN: Bbox = [7.42, 46.93, 7.47, 46.97], SANTA_CRUZ: Bbox = [-122.05, 36.95, -121.95, 37.0];
const SOURCES: { name: string; url: string; collection: string; area: Bbox; datetime?: string }[] = [
    {name: "PC Sentinel-2", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "sentinel-2-l2a", area: VALE, datetime: "2024-01-01/2024-12-31"},
    {name: "ES Sentinel-2", url: "https://earth-search.aws.element84.com/v1", collection: "sentinel-2-c1-l2a", area: VALE, datetime: "2024-01-01/2024-12-31"},
    {name: "INPE Sentinel-2 cube", url: "https://data.inpe.br/bdc/stac/v1", collection: "S2-16D-2", area: VALE, datetime: "2024-01-01/2024-12-31"},
    {name: "PC Landsat", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "landsat-c2-l2", area: VALE, datetime: "2024-01-01/2024-12-31"},
    {name: "ES Landsat", url: "https://earth-search.aws.element84.com/v1", collection: "landsat-c2-l2", area: VALE, datetime: "2024-01-01/2024-12-31"},
    {name: "PC NAIP", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "naip", area: SANTA_CRUZ},
    {name: "PC WorldCover", url: "https://planetarycomputer.microsoft.com/api/stac/v1", collection: "esa-worldcover", area: VALE},
    {name: "swisstopo SWISSIMAGE", url: "https://data.geo.admin.ch/api/stac/v1", collection: "ch.swisstopo.swissimage-dop10", area: BERN},
    {name: "swisstopo swissALTI3D", url: "https://data.geo.admin.ch/api/stac/v1", collection: "ch.swisstopo.swissalti3d", area: BERN},
];

type Asset = { key: string; bands: BandDescriptor[] };
const dataAssets = (item: StacItemJson): Asset[] => Object.keys(item.assets).filter((k) => isDataAsset(k, item.assets[k]))
    .map((key) => ({key, bands: assetBands(item.assets[key], item)}));

/** Today: one name per band, common name first (ria-stac nameAssetBands). */
const today = (assets: Asset[]) => new Set(Object.values(nameAssetBands(assets)).flat());

/** odc-stac style: canonical names from asset keys, common names and band names as aliases. */
function keyed(assets: Asset[]) {
    const canonical: string[] = [];
    const alias = new Map<string, string>();
    const keys = new Set(assets.map((a) => bandIdentifier(a.key)));
    // Fewer-band assets first, then by key: they win an ambiguous alias.
    const ordered = [...assets].sort((a, b) => Math.max(1, a.bands.length) - Math.max(1, b.bands.length) || a.key.localeCompare(b.key));
    for (const a of ordered) {
        const n = Math.max(1, a.bands.length);
        for (let i = 0; i < n; i++) {
            const name = n === 1 ? bandIdentifier(a.key) : `${bandIdentifier(a.key)}_b${i + 1}`;
            canonical.push(name);
            const b = a.bands[i] ?? {};
            for (const al of [b.commonName, b.name].filter((x): x is string => !!x).map(bandIdentifier)) {
                if (!keys.has(al) && !alias.has(al)) alias.set(al, name);
            }
        }
    }
    // Landsat: nir08 answers to nir when nothing else does.
    if (!alias.has("nir") && !keys.has("nir") && alias.has("nir08")) alias.set("nir", alias.get("nir08")!);
    return {canonical: new Set(canonical), alias};
}

it("compares naming schemes", async () => {
    const lines: string[] = [];
    const presetIds = STYLE_PRESETS.map((p) => p.id);
    const rows: string[] = ["| Source | Items | Today: names (varies across items?) | Keyed: canonical (varies?) | Presets usable today | Presets usable keyed |", "|---|---|---|---|---|---|"];
    const savedFrom: Record<string, Set<string>> = {};
    const keyedOf: Record<string, ReturnType<typeof keyed>> = {};
    for (const s of SOURCES) {
        let items: StacItemJson[] = [];
        try {
            const client = await StacClient.connect(s.url);
            items = await client.search({collections: [s.collection], area: s.area, ...(s.datetime ? {datetime: s.datetime} : {}), maxItems: 20}).collect();
        } catch (e) {
            rows.push(`| ${s.name} | ✗ ${(e as Error).message.slice(0, 80)} | | | | |`);
            continue;
        }
        if (!items.length) { rows.push(`| ${s.name} | 0 | | | | |`); continue; }
        const todays = items.map((i) => [...today(dataAssets(i))].sort().join(","));
        const keyeds = items.map((i) => keyed(dataAssets(i)));
        const k0 = keyeds[0];
        const t0 = new Set(todays[0].split(","));
        const varies = (xs: string[]) => new Set(xs).size > 1 ? `**varies: ${new Set(xs).size} sets**` : "same";
        const usableToday = STYLE_PRESETS.filter((p) => p.requires.every((b) => t0.has(b))).map((p) => p.id);
        const usableKeyed = STYLE_PRESETS.filter((p) => p.requires.every((b) => k0.canonical.has(b) || k0.alias.has(b))).map((p) => p.id);
        rows.push(`| ${s.name} | ${items.length} | ${todays[0]} (${varies(todays)}) | ${[...k0.canonical].sort().join(",")} (${varies(keyeds.map((k) => [...k.canonical].sort().join(",")))}) | ${usableToday.join(", ") || "-"} | ${usableKeyed.join(", ") || "-"} |`);
        savedFrom[s.name] = t0;
        keyedOf[s.name] = k0;
        lines.push(`- ${s.name} aliases: ${[...k0.alias].map(([a, c]) => `${a}→${c}`).join(", ")}`);
    }
    // A style saved on one source and opened on another: today it stores today's names; keyed, it would store
    // canonical names (they mean one file each), or aliases (they mean a role, e.g. "nir").
    const names = Object.keys(savedFrom);
    const cross: string[] = ["| Saved on → opened on | " + names.join(" | ") + " |", "|---|" + names.map(() => "---").join("|") + "|"];
    for (const from of names) {
        const cells = names.map((to) => {
            const need = [...savedFrom[from]].filter((b) => STYLE_PRESETS.some((p) => p.requires.includes(b)));   // role-like names a style would use
            const t = need.filter((b) => savedFrom[to].has(b)).length;
            const k = need.filter((b) => keyedOf[to].canonical.has(b) || keyedOf[to].alias.has(b)).length;
            return need.length ? `${t}/${need.length} · ${k}/${need.length}` : "-";
        });
        cross.push(`| ${from} | ${cells.join(" | ")} |`);
    }
    const out = ["# Band naming spike", "", `Presets: ${presetIds.join(", ")}`, "", ...rows, "", ...lines, "",
        "Role names (those the presets use) of a style saved on a source, found on another: today · keyed (canonical or alias).", "", ...cross].join("\n");
    console.log(out);
    writeFileSync("spikes/band-naming-results.md", out + "\n");
});
