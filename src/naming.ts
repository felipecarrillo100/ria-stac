/**
 * How the bands of STAC assets are named: one rule, the same in ria-stac and ria-geotiff (this file is identical in
 * both, and both run the shared fixtures of `test/fixtures/band-naming.json`).
 *
 * Names are roles first: an asset's EO common name (`red`, `nir`) when no other asset of the list has it, else its
 * key. Styles store these names, so a style written on one catalog works on another. Two things make the names
 * stable and the styles portable:
 * - **Stable keys**: an asset key that starts with the item's id loses it. swisstopo names assets after the tile
 *   (`swissalti3d_2019_2598-1198_0.5_2056_5728.tif`), so every tile would get its own band name; without the id,
 *   30 tiles give 4 keys, one per resolution and format.
 * - **Aliases**: each band also answers to its asset key, its band `name` and its common name, so a style that
 *   names `B04` (Planetary Computer) or `OLI_B4` (Landsat) finds the band named `red`. An alias never replaces a
 *   name; resolving through one is reported (see {@link resolveBandName}).
 *
 * Evidence: the band naming spike of ria-stac (`spikes/BAND-NAMING.md`), on nine real collections.
 */
import type {BandDescriptor} from "./bands.js";

/**
 * Where a band name comes from:
 * - `"common-name"`: the EO common name (`red`), or a role alias of it (`nir08` named `nir`);
 * - `"key"`: the asset key;
 * - `"key-without-item-id"`: the asset key without the item's id (per-tile keys);
 * - `"band-name"`: the band's `name`, in a multiband asset;
 * - `"band-index"`: `{key}_b{n}`, a multiband band without a name.
 *
 * @category Assets and bands
 */
export type BandNameSource = "common-name" | "key" | "key-without-item-id" | "band-name" | "band-index";

/** One named band. @category Assets and bands */
export interface NamedBand {
    /** The band name (a valid identifier). */
    name: string;
    /** Where the name comes from. */
    source: BandNameSource;
    /** Other names that resolve to this band: its asset key, band name and common name, as identifiers. */
    aliases: string[];
}

/** The named bands of one asset. @category Assets and bands */
export interface NamedAsset {
    /** The asset key, as in the item. */
    key: string;
    /** The key without the item's id (the same as `key` when it does not start with it). */
    stableKey: string;
    /** One entry per band of the asset (one for a single-band or undescribed asset). */
    bands: NamedBand[];
}

/**
 * A name made a valid band identifier: other characters become `_`, a leading digit gets a `_` prefix.
 *
 * @param s Any text.
 * @returns An identifier (`[A-Za-z_][A-Za-z0-9_]*`).
 *
 * @category Assets and bands
 */
export const bandIdentifier = (s: string): string => {
    const name = s.replace(/[^A-Za-z0-9_]/g, "_");
    return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
};

/**
 * An asset key without the item's id: `swissalti3d_2019_2598-1198_0.5_2056_5728.tif` of item
 * `swissalti3d_2019_2598-1198` is `0.5_2056_5728.tif`. Separators after the id (`_`, `-`, `.`) go too. A key that
 * does not start with the id, or is only the id, is returned as it is.
 *
 * @param key The asset key.
 * @param itemId The item's id. Optional: without it the key is returned.
 * @returns The stable key.
 *
 * @category Assets and bands
 */
export function stableAssetKey(key: string, itemId?: string): string {
    if (!itemId || !key.startsWith(itemId)) return key;
    const rest = key.slice(itemId.length).replace(/^[_\-.\s]+/, "");
    return rest || key;
}

/** Common names that differ between sensors for the same role; used when the plain name is free. */
const ROLE_ALIASES: Record<string, string> = {nir08: "nir", lwir11: "lwir"};

/**
 * The bands of a list of assets, named by the one naming rule.
 *
 * - Keys first lose the item's id ({@link stableAssetKey}) when `itemId` is given.
 * - A single-band (or undescribed) asset takes its EO common name when `naming` is `"common-name"` and no other
 *   single-band asset of the list shares it (Sentinel-2's three `rededge` assets keep their keys); otherwise, or
 *   when that name is taken, its stable key (else its key, when two stable keys collide).
 * - A multiband asset takes one name per band: its common name (unless `naming` is `"asset-key"`), else its name,
 *   else `{stable key}_b{n}` (1-based). A name a single-band asset already has gets the stable key as a prefix:
 *   Planetary Computer's 3-band `visual` gives `visual_red`, `visual_green`, `visual_blue` beside `red` (B04).
 * - Every name is made a valid identifier.
 * - Landsat's `nir08` / `lwir11` (single-band) become `nir` / `lwir` when no band of the list has that name.
 * - Aliases: each band's asset key, stable key, band name and common name (as identifiers), unless that is a band
 *   name already, or another band claimed it first (fewer-band assets first, then in list order). A common name that
 *   several bands share (Sentinel-2's three `rededge`) is no alias: it would mean a different band on each catalog.
 *
 * @param assets The assets, in order, with their bands (from `assetBands`).
 * @param options `naming`: `"common-name"` (default) or `"asset-key"`; `itemId`: the item's id, for stable keys.
 * @returns One entry per asset, in the order of `assets`.
 * @example
 * ```ts
 * const named = nameBands(Object.entries(item.assets).map(([key, a]) => ({key, bands: assetBands(a, item)})), {itemId: item.id});
 * // [{key: "B04", stableKey: "B04", bands: [{name: "red", source: "common-name", aliases: ["B04"]}]}, ...]
 * ```
 *
 * @category Assets and bands
 */
export function nameBands(assets: { key: string; bands: BandDescriptor[] }[],
    options: { naming?: "common-name" | "asset-key"; itemId?: string } = {}): NamedAsset[] {
    const naming = options.naming ?? "common-name";
    const list = assets.map((a) => ({...a, stableKey: stableAssetKey(a.key, options.itemId)}));
    const single = list.filter((a) => a.bands.length <= 1);
    const commonOf = (a: { bands: BandDescriptor[] }) => (naming === "common-name" ? a.bands[0]?.commonName : undefined);
    const counts = new Map<string, number>();
    for (const a of single) { const c = commonOf(a); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }
    const named = new Map<string, NamedBand[]>();
    const taken = new Set<string>();
    const keySource = (a: { key: string; stableKey: string }): BandNameSource => (a.stableKey !== a.key ? "key-without-item-id" : "key");
    for (const a of single) {
        // A common name shared by several assets is ambiguous: those assets keep their keys.
        const c = commonOf(a);
        const common = c && counts.get(c) === 1 && !taken.has(bandIdentifier(c)) ? bandIdentifier(c) : undefined;
        let name = common ?? bandIdentifier(a.stableKey);
        let source: BandNameSource = common ? "common-name" : keySource(a);
        if (taken.has(name)) { name = bandIdentifier(a.key); source = "key"; }
        named.set(a.key, [{name, source, aliases: []}]);
        taken.add(name);
    }
    for (const a of list) {
        if (a.bands.length <= 1) continue;
        const bands = a.bands.map((b, i): NamedBand => {
            const band: NamedBand = naming !== "asset-key" && b.commonName ? {name: bandIdentifier(b.commonName), source: "common-name", aliases: []}
                : b.name ? {name: bandIdentifier(b.name), source: "band-name", aliases: []}
                    : {name: bandIdentifier(`${a.stableKey}_b${i + 1}`), source: "band-index", aliases: []};
            if (taken.has(band.name)) band.name = bandIdentifier(`${a.stableKey}_${band.name}`);
            return band;
        });
        named.set(a.key, bands);
        bands.forEach((b) => taken.add(b.name));
    }
    // Role aliases (Landsat nir08 → nir) only where the plain name is free: Sentinel-2 has both nir (B08) and nir08 (B8A).
    for (const a of single) {
        const [band] = named.get(a.key)!;
        const role = ROLE_ALIASES[band.name];
        if (role && !taken.has(role)) { taken.delete(band.name); taken.add(role); band.name = role; band.source = "common-name"; }
    }
    // Aliases: other names a style may use for the band. Fewer-band assets claim first; a band name is never an alias,
    // nor a common name several bands share.
    const shared = new Map<string, number>();
    for (const a of list) for (const b of a.bands) if (b.commonName) shared.set(bandIdentifier(b.commonName), (shared.get(bandIdentifier(b.commonName)) ?? 0) + 1);
    const claimed = new Set<string>();
    const order = [...list].sort((x, y) => Math.max(1, x.bands.length) - Math.max(1, y.bands.length));
    for (const a of order) {
        const bands = named.get(a.key)!;
        bands.forEach((band, i) => {
            const b = a.bands[i] ?? {};
            const candidates = [b.commonName, b.name, ...(bands.length === 1 ? [a.key, a.stableKey] : [])]
                .filter((x): x is string => !!x).map(bandIdentifier);
            for (const alias of candidates) {
                if (alias === band.name || taken.has(alias) || claimed.has(alias) || (shared.get(alias) ?? 0) > 1) continue;
                claimed.add(alias);
                band.aliases.push(alias);
            }
        });
    }
    return list.map((a) => ({key: a.key, stableKey: a.stableKey, bands: named.get(a.key)!}));
}

/**
 * The band names of a list of assets, by {@link nameBands}: asset key to its band names (one for a single-band
 * asset), in the order of `assets`.
 *
 * @param assets The assets, in order, with their bands.
 * @param naming `"common-name"` (default) or `"asset-key"`.
 * @param itemId The item's id, for stable keys. Optional.
 * @returns Asset key to band names.
 *
 * @internal
 *
 * @category Assets and bands
 */
export function nameAssetBands(assets: { key: string; bands: BandDescriptor[] }[], naming: "common-name" | "asset-key" = "common-name",
    itemId?: string): Record<string, string[]> {
    return Object.fromEntries(nameBands(assets, {naming, ...(itemId ? {itemId} : {})}).map((a) => [a.key, a.bands.map((b) => b.name)]));
}

/** A band found by {@link resolveBandName}. @category Assets and bands */
export interface ResolvedBandName {
    /** The band's name. */
    name: string;
    /** The alias it was found through; undefined when the name itself is a band name. */
    via?: string;
}

/**
 * Finds a band by a name a style uses: the band of that name, else the band that has it as an alias.
 *
 * @param name The name in the style (`red`, `B04`, `OLI_B4`).
 * @param named The named bands, from {@link nameBands}.
 * @returns The band's name and, when it was found through an alias, `via`: the alias. Undefined when no band has
 *   that name or alias.
 * @example
 * ```ts
 * resolveBandName("B04", nameBands(assets, {itemId: item.id})); // {name: "red", via: "B04"} on Earth Search
 * ```
 *
 * @category Assets and bands
 */
export function resolveBandName(name: string, named: NamedAsset[]): ResolvedBandName | undefined {
    const bands = named.flatMap((a) => a.bands);
    if (bands.some((b) => b.name === name)) return {name};
    const found = bands.find((b) => b.aliases.includes(name));
    return found ? {name: found.name, via: name} : undefined;
}
