/**
 * Band descriptions of STAC assets, from STAC 1.1 `bands` (with `eo:` and `raster:` fields inside) or STAC 1.0
 * `eo:bands` + `raster:bands`. One normalised shape for both.
 */
import type {StacAssetJson} from "./json.js";

/** One band of an asset, normalised from STAC 1.1 `bands` or STAC 1.0 `eo:bands` + `raster:bands`.
 *
 * @category Assets and bands */
export interface BandDescriptor {
    /** Band name in the catalog (`B04`, `red`, ...). */
    name?: string;
    /** EO common name (`red`, `nir`, `swir16`, ...), when declared. */
    commonName?: string;
    /** Centre wavelength in micrometres. */
    centerWavelength?: number;
    /** Multiplier from raw to physical values (`value = raw * scale + offset`), when declared. */
    scale?: number;
    /** Offset from raw to physical values (`value = raw * scale + offset`), when declared. */
    offset?: number;
    /** Raw value that marks missing data, when declared (`"nan"`, `"inf"` and `"-inf"` become NaN and infinities). */
    nodata?: number;
    /** Raw data type of the band (`uint16`, `float32`, ...), when declared. */
    dataType?: string;
    /** Unit of the physical values (`m`, `K`, ...), when declared. */
    unit?: string;
    /** Spatial resolution in metres. */
    resolution?: number;
}

const num = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v === "nan") return Number.NaN;
    if (v === "inf") return Infinity;
    if (v === "-inf") return -Infinity;
    return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** The EO extension's common band names; other values (some catalogs use "quality", "cloud") are not roles.
 *
 * @category Assets and bands */
export const EO_COMMON_NAMES = new Set(["coastal", "blue", "green", "red", "yellow", "pan", "rededge", "rededge071", "rededge075",
    "rededge078", "nir", "nir08", "nir09", "cirrus", "swir16", "swir22", "lwir", "lwir11", "lwir12"]);

/**
 * The bands of an asset (an empty list when it describes none).
 *
 * Band `i` merges entry `i` of `bands` (STAC 1.1, `eo:` / `raster:` prefixed fields), `eo:bands` and
 * `raster:bands` (STAC 1.0); the first defined value wins in that order. Fields the bands leave out are inherited,
 * as STAC 1.1 common metadata says: from the asset (`nodata`, `data_type`, `unit`, `gsd`, `raster:scale`,
 * `raster:offset`, `eo:common_name`), then from the item's properties when `item` is given. A single-band asset
 * that puts these fields on the asset itself, with no band array, gives one band. Common names outside
 * `EO_COMMON_NAMES` are dropped, numbers given as strings are parsed, and fields without a value are omitted.
 *
 * @param asset A STAC asset (its `href` is not needed).
 * @param item The item the asset belongs to, for fields declared once for all its assets. Optional.
 * @returns One descriptor per band, as many as the longest of the three band arrays (one when only the asset or
 *   the item describes it; none when nothing does).
 * @example
 * ```ts
 * const item: StacItemJson = searchResult;  // an item returned by a search
 * for (const [key, asset] of Object.entries(item.assets)) {
 *     const bands = assetBands(asset);
 *     console.log(key, bands.map((b) => b.commonName ?? b.name), bands[0]?.scale, bands[0]?.nodata);
 * }
 * ```
 *
 * @category Assets and bands
 */
export function assetBands(asset: Omit<StacAssetJson, "href">, item?: { properties?: Record<string, unknown> }): BandDescriptor[] {
    // STAC 1.1: `bands` with eo:/raster: prefixed fields; 1.0: separate eo:bands and raster:bands arrays.
    const unified = Array.isArray(asset.bands) ? asset.bands : [];
    const eo = Array.isArray(asset["eo:bands"]) ? asset["eo:bands"] : [];
    const raster = Array.isArray(asset["raster:bands"]) ? asset["raster:bands"] : [];
    const a = asset as Record<string, unknown>;
    const p = (item?.properties ?? {}) as Record<string, unknown>;
    // Band fields on the asset itself (STAC 1.1 allows them there for a single-band asset): one band.
    const assetLevel = ["nodata", "data_type", "unit", "raster:scale", "raster:offset", "eo:common_name", "statistics"].some((k) => a[k] !== undefined);
    const count = Math.max(unified.length, eo.length, raster.length, assetLevel ? 1 : 0);
    const out: BandDescriptor[] = [];
    for (let i = 0; i < count; i++) {
        const u = (unified[i] ?? {}) as Record<string, unknown>;
        const e = (eo[i] ?? {}) as Record<string, unknown>;
        const r = (raster[i] ?? {}) as Record<string, unknown>;
        const pick = (...values: unknown[]) => values.find((v) => v !== undefined && v !== null);
        out.push(clean({
            name: str(pick(u.name, e.name, r.name)),
            commonName: ((c) => (c && EO_COMMON_NAMES.has(c) ? c : undefined))(str(pick(u["eo:common_name"], u.common_name, e.common_name, count === 1 ? a["eo:common_name"] : undefined))),
            centerWavelength: num(pick(u["eo:center_wavelength"], u.center_wavelength, e.center_wavelength)),
            // eo:bands as the last band-level fallback: some catalogs (INPE BDC) put scale and nodata there; then the
            // asset, then the item.
            scale: num(pick(u["raster:scale"], u.scale, r.scale, e.scale, a["raster:scale"], p["raster:scale"])),
            offset: num(pick(u["raster:offset"], u.offset, r.offset, e.offset, a["raster:offset"], p["raster:offset"])),
            nodata: num(pick(u.nodata, r.nodata, a.nodata, e.nodata, p.nodata)),
            dataType: str(pick(u.data_type, r.data_type, a.data_type, e.data_type, p.data_type)),
            unit: str(pick(u.unit, r.unit, a.unit, p.unit)),
            resolution: num(pick(u["raster:spatial_resolution"], r.spatial_resolution, u.gsd, a.gsd, p.gsd)),
        }));
    }
    return out;
}

function clean<T extends object>(o: T): T {
    for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
    return o;
}

const TIFF_TYPE = /^image\/tiff\b/i;

/**
 * Whether an asset is a (Cloud Optimized) GeoTIFF by media type, or by file extension when it has no type.
 *
 * @param asset The asset; `type` and `href` are read.
 * @returns `true` when `type` is `image/tiff` (any parameters, case-insensitive), or, without `type`, when `href`
 *   ends in `.tif` or `.tiff` (before any query string).
 *
 * @category Assets and bands
 */
export function isGeoTiffAsset(asset: Partial<StacAssetJson>): boolean {
    if (asset.type) return TIFF_TYPE.test(asset.type.trim());
    return typeof asset.href === "string" && /\.tiff?($|\?)/i.test(asset.href);
}

/**
 * A media type in one canonical spelling, so that equal media types compare equal as strings.
 *
 * Media types (RFC 6838, the values of STAC's asset `type`) are case-insensitive in their type, subtype and
 * parameter names, and the order of their parameters and the spaces around them carry no meaning. This writes the
 * type, subtype, parameter names and values in lower case, without quotes or extra spaces, with the parameters
 * sorted by name: `Image/TIFF;profile=cloud-optimized; application="geotiff"` becomes
 * `image/tiff; application=geotiff; profile=cloud-optimized`. A value that is not of the form `type/subtype` is only
 * trimmed and written in lower case.
 *
 * @param mediaType A media type, as found in an asset's `type`.
 * @returns The same media type, canonically spelled.
 * @example
 * ```ts
 * normaliseMediaType("image/tiff;application=geotiff;profile=cloud-optimized");
 * // "image/tiff; application=geotiff; profile=cloud-optimized"
 * ```
 *
 * @category Assets and bands
 */
export function normaliseMediaType(mediaType: string): string {
    const [essence, ...rest] = mediaType.split(";");
    const base = essence.trim().toLowerCase().replace(/\s+/g, "");
    if (!/^[^/]+\/[^/]+$/.test(base)) return mediaType.trim().toLowerCase();
    const params = rest.map((p) => {
        const at = p.indexOf("=");
        const name = (at < 0 ? p : p.slice(0, at)).trim().toLowerCase();
        const value = at < 0 ? "" : p.slice(at + 1).trim().replace(/^"(.*)"$/, "$1").toLowerCase();
        return [name, value] as const;
    }).filter(([name]) => name).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return [base, ...params.map(([n, v]) => (v ? `${n}=${v}` : n))].join("; ");
}

/** The media type of a STAC asset, see {@link assetMediaType}.
 *
 * @category Assets and bands */
export interface AssetMediaType {
    /** The media type, canonically spelled ({@link normaliseMediaType}); `null` when neither `type` nor the file extension tells. */
    mediaType: string | null;
    /** Whether it was inferred from the file extension of `href`, because the asset declares no `type`. */
    inferred: boolean;
}

/**
 * File extensions to the media types STAC's best practices and IANA give them, for assets that declare no `type`.
 * Only extensions with one clear media type; others (`.zarr` folders, `.xyz`) give none.
 */
const EXTENSION_TYPES: Record<string, string> = {
    tif: "image/tiff", tiff: "image/tiff", jp2: "image/jp2", j2k: "image/jp2", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", json: "application/json", geojson: "application/geo+json",
    parquet: "application/vnd.apache.parquet", gpkg: "application/geopackage+sqlite3", shp: "application/vnd.shp",
    fgb: "application/vnd.flatgeobuf", kml: "application/vnd.google-earth.kml+xml", kmz: "application/vnd.google-earth.kmz",
    nc: "application/x-netcdf", h5: "application/x-hdf5", hdf: "application/x-hdf", grib2: "application/wmo-grib2",
    laz: "application/vnd.laszip", las: "application/vnd.las", glb: "model/gltf-binary", gltf: "model/gltf+json",
    xml: "application/xml", csv: "text/csv", txt: "text/plain", html: "text/html", htm: "text/html", pdf: "application/pdf",
    zip: "application/zip", xtf: "application/interlis+xml", dxf: "image/vnd.dxf", dwg: "image/vnd.dwg",
};

/**
 * The media type of a STAC asset: its `type`, canonically spelled ({@link normaliseMediaType}); for an asset that
 * declares none, the media type of its file extension (`.tif` → `image/tiff`, `.copc.laz` → `application/vnd.laszip+copc`),
 * marked `inferred`. No media type is preferred: which ones matter is the application's choice. Grouping media
 * types into formats for people (a "COG" is `image/tiff; application=geotiff; profile=cloud-optimized`) is left to
 * the application too, since STAC does not define one.
 *
 * @param asset The asset; `type` and `href` are read.
 * @returns The media type and whether it was inferred; `mediaType` is `null` when neither tells.
 * @example
 * ```ts
 * for (const [key, asset] of Object.entries(item.assets)) {
 *     const {mediaType, inferred} = assetMediaType(asset);
 *     console.log(`${key}: ${mediaType ?? "unknown"}${inferred ? " (from the file name)" : ""}`);
 * }
 * ```
 *
 * @category Assets and bands
 */
export function assetMediaType(asset: Partial<StacAssetJson>): AssetMediaType {
    if (typeof asset.type === "string" && asset.type.trim()) return {mediaType: normaliseMediaType(asset.type), inferred: false};
    const path = typeof asset.href === "string" ? asset.href.replace(/[?#].*$/, "").toLowerCase() : "";
    if (/\.copc\.laz$/.test(path)) return {mediaType: "application/vnd.laszip+copc", inferred: true};
    const ext = path.match(/\.([a-z0-9]+)$/)?.[1];
    const type = ext ? EXTENSION_TYPES[ext] : undefined;
    return type ? {mediaType: type, inferred: true} : {mediaType: null, inferred: false};
}

/**
 * Assets that hold the item's data, in any format: not thumbnails, overviews, previews or metadata.
 *
 * @param key The asset key in the item.
 * @param asset The asset; `roles` is read.
 * @returns `false` for the roles `thumbnail`, `overview` or `metadata`, for `visual` without `data`, and for keys
 *   `thumbnail`, `preview`, `rendered_preview` and `tilejson`; `true` otherwise, whatever the format (filter by
 *   {@link assetMediaType} or {@link isGeoTiffAsset} for a particular one).
 *
 * @category Assets and bands
 */
export function isDataAsset(key: string, asset: Partial<StacAssetJson>): boolean {
    return isContentAsset(key, asset);
}

/** Not a thumbnail, overview, preview or metadata asset (see {@link isDataAsset}). */
function isContentAsset(key: string, asset: Partial<StacAssetJson>): boolean {
    const roles = asset.roles ?? [];
    if (roles.some((r) => r === "thumbnail" || r === "overview" || r === "metadata")) return false;
    if (roles.includes("visual") && !roles.includes("data")) return false;
    return !/^(thumbnail|preview|rendered_preview|tilejson)$/i.test(key);
}

/**
 * The media types of an item's content assets, as {@link assetMediaType} gives them (inferred ones included), each
 * once: `["image/tiff; application=geotiff; profile=cloud-optimized"]`, `["application/zip", "application/pdf"]`.
 * Thumbnails, overviews, previews and metadata are left out, by the rule of {@link isDataAsset}. This is the
 * `asset_media_types` property CQL2 filters read on the client (see `cql2Predicate` and `mediaTypesFilter`).
 *
 * @param item The item; its `assets` are read.
 * @returns The media types, in the order of the assets.
 * @example
 * ```ts
 * const zarr = items.filter((item) => itemMediaTypes(item).includes("application/vnd+zarr"));
 * ```
 *
 * @category Assets and bands
 */
export function itemMediaTypes(item: { assets?: Record<string, Partial<StacAssetJson>> }): string[] {
    const types = Object.entries(item.assets ?? {}).filter(([key, asset]) => isContentAsset(key, asset))
        .map(([, asset]) => assetMediaType(asset).mediaType).filter((t): t is string => t !== null);
    return [...new Set(types)];
}

export {bandIdentifier, nameAssetBands} from "./naming.js";
