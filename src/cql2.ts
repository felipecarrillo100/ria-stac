/**
 * CQL2 for STAC searches: building CQL2-JSON from portable `where` predicates and writing CQL2-text for GET-only
 * servers, here; evaluating filters against items in the browser (to verify that a server applied a filter, or to
 * apply it when the server cannot), with the `ogc-cql2` package.
 */
import type {Cql2Filter} from "ogc-cql2";
import {toPredicate, type EvaluateOptions} from "ogc-cql2/evaluate";
import {toText} from "ogc-cql2/text";
import {itemMediaTypes, normaliseMediaType} from "./bands.js";
import type {StacItemJson} from "./json.js";

/**
 * A CQL2-JSON expression: an operation with arguments, or a boolean literal (`true` matches everything).
 *
 * Arguments are nested expressions, literals (numbers, strings, `null`, arrays), property references
 * `{property: "eo:cloud_cover"}`, temporal literals `{timestamp: "..."}`, `{date: "..."}`, `{interval: [start, end]}`
 * (`".."` for an open end), and spatial literals `{bbox: [w, s, e, n]}` or GeoJSON geometries.
 *
 * @example
 * ```ts
 * const filter: Cql2Json = {op: "and", args: [
 *     {op: "<", args: [{property: "eo:cloud_cover"}, 20]},
 *     {op: "=", args: [{property: "platform"}, "sentinel-2a"]},
 * ]};
 * ```
 *
 * @category Search
 */
export type Cql2Json = {
    /** The operator, case-insensitive: `and`, `or`, `not`, `=`, `<>`, `<`, `<=`, `>`, `>=`, `like`, `in`, `between`, `isNull`, `s_intersects`, `t_intersects`, `t_before`, `t_after`, ... */
    op: string;
    /** The operands, in the order the operator defines (for comparisons: the property first, then the value). */
    args: unknown[];
} | boolean;

/**
 * A portable predicate on one property (the Query extension's shape). Every operator given must hold (they are
 * ANDed). Dates are compared as RFC 3339 strings, for example `{gte: "2024-01-01T00:00:00Z"}`.
 *
 * @example
 * ```ts
 * const where: Record<string, WhereComparison> = {
 *     "eo:cloud_cover": {lt: 20},
 *     "platform": {in: ["sentinel-2a", "sentinel-2b"]},
 * };
 * ```
 *
 * @category Search
 */
export interface WhereComparison {
    /** Equal to this value (CQL2 `=`). */
    eq?: unknown;
    /** Not equal to this value (CQL2 `<>`). */
    neq?: unknown;
    /** Less than (CQL2 `<`). */
    lt?: number | string;
    /** Less than or equal (CQL2 `<=`). */
    lte?: number | string;
    /** Greater than (CQL2 `>`). */
    gt?: number | string;
    /** Greater than or equal (CQL2 `>=`). */
    gte?: number | string;
    /** Equal to one of these values (CQL2 `in`, or an `or` of `=` without advanced-comparison support). */
    in?: unknown[];
    /** Between `[low, high]`, both inclusive (CQL2 `between`, or `>=` and `<=`). */
    between?: [number | string, number | string];
    /**
     * Matches a CQL2 `like` pattern: `%` for any run of characters, `_` for one character (case-sensitive). Has no
     * Query extension equivalent, so a `where` using it cannot be sent through the Query extension.
     */
    like?: string;
}

const prop = (name: string) => ({property: name});

/**
 * CQL2-JSON for `where`; `in` and `between` are rewritten to basic comparisons when `advanced` is false.
 *
 * Each operator of each property becomes one comparison on `{property: name}`; several comparisons are joined with
 * `and`.
 *
 * @param where Predicates per property name (`"eo:cloud_cover"`, `"platform"`, ...).
 * @param advanced Whether the server conforms to CQL2 advanced comparison operators. When `false`, `in` becomes `=`
 *   (one value) or an `or` of `=`, and `between` an `and` of `>=` and `<=`. Default `true`.
 * @returns The expression: a single comparison, an `and` of several, or `undefined` when `where` holds no operator.
 * @example
 * ```ts
 * const maxCloud = 20; // percent, from a slider
 * const filter = whereToCql2({"eo:cloud_cover": {lt: maxCloud}});
 * // {op: "<", args: [{property: "eo:cloud_cover"}, 20]}
 * ```
 *
 * @category Search
 */
export function whereToCql2(where: Record<string, WhereComparison>, advanced = true): Cql2Json | undefined {
    const parts: Cql2Json[] = [];
    for (const [name, c] of Object.entries(where)) {
        const p = prop(name);
        if (c.eq !== undefined) parts.push({op: "=", args: [p, c.eq]});
        if (c.neq !== undefined) parts.push({op: "<>", args: [p, c.neq]});
        if (c.lt !== undefined) parts.push({op: "<", args: [p, c.lt]});
        if (c.lte !== undefined) parts.push({op: "<=", args: [p, c.lte]});
        if (c.gt !== undefined) parts.push({op: ">", args: [p, c.gt]});
        if (c.gte !== undefined) parts.push({op: ">=", args: [p, c.gte]});
        if (c.like !== undefined) parts.push({op: "like", args: [p, c.like]});
        if (c.in) {
            parts.push(advanced ? {op: "in", args: [p, c.in]}
                : c.in.length === 1 ? {op: "=", args: [p, c.in[0]]} : {op: "or", args: c.in.map((v) => ({op: "=", args: [p, v]}))});
        }
        if (c.between) {
            parts.push(advanced ? {op: "between", args: [p, ...c.between]}
                : {op: "and", args: [{op: ">=", args: [p, c.between[0]]}, {op: "<=", args: [p, c.between[1]]}]});
        }
    }
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : {op: "and", args: parts};
}

/**
 * The Query extension form of `where`, or undefined when a predicate has no Query equivalent (`like`).
 *
 * Operators map one to one (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`); `between` becomes `gte` and `lte`.
 *
 * @param where Predicates per property name.
 * @returns A Query object such as `{"eo:cloud_cover": {lt: 20}}`, or `undefined` when any property uses `like`.
 *
 * @category Search
 */
export function whereToQuery(where: Record<string, WhereComparison>): Record<string, Record<string, unknown>> | undefined {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, c] of Object.entries(where)) {
        if (c.like !== undefined) return undefined;
        const q: Record<string, unknown> = {};
        if (c.eq !== undefined) q.eq = c.eq;
        if (c.neq !== undefined) q.neq = c.neq;
        if (c.lt !== undefined) q.lt = c.lt;
        if (c.lte !== undefined) q.lte = c.lte;
        if (c.gt !== undefined) q.gt = c.gt;
        if (c.gte !== undefined) q.gte = c.gte;
        if (c.in) q.in = c.in;
        if (c.between) { q.gte = c.between[0]; q.lte = c.between[1]; }
        out[name] = q;
    }
    return out;
}

// ------------------------------------------------------------------------------------------------ CQL2-text

/**
 * CQL2-text of a CQL2-JSON expression, written by the `ogc-cql2` package.
 *
 * Used for servers that accept only GET. Strings are single-quoted, nested expressions are parenthesised, and
 * geometries become WKT or `BBOX(...)`: the text `fromText` of `ogc-cql2/parse` reads back to the same filter.
 *
 * @param e The expression: any valid CQL2-JSON filter, `true` and `false` included.
 * @returns The CQL2-text string, for the `filter` parameter with `filter-lang=cql2-text`.
 * @throws `Cql2Error` (from `ogc-cql2`) for a value that is not a valid filter, or one CQL2-text cannot write (a
 *   property name that is not a CQL2 identifier).
 * @example
 * ```ts
 * const text = toCql2Text({op: "and", args: [
 *     {op: "<", args: [{property: "eo:cloud_cover"}, 20]},
 *     {op: "in", args: [{property: "platform"}, ["sentinel-2a", "sentinel-2b"]]},
 * ]});
 * // "(eo:cloud_cover < 20) AND (platform IN ('sentinel-2a', 'sentinel-2b'))"
 * ```
 *
 * @category Search
 */
export function toCql2Text(e: Cql2Json): string {
    return toText(e as Cql2Filter);
}

// ------------------------------------------------------------------------------------------------ evaluation

/** Reads a property of an item for ogc-cql2: `properties.` prefix ignored; `id`, `collection` and `asset_media_types` derived. */
function itemProperty(item: StacItemJson, name: string): unknown {
    const key = name.replace(/^properties\./, "");
    if (key === "id") return item.id;
    if (key === "collection") return item.collection;
    const value = item.properties?.[key];
    if (value === undefined && key === ASSET_MEDIA_TYPES) return itemMediaTypes(item);
    return value;
}

/** STAC's instant properties, so that CQL2's temporal functions read their RFC 3339 strings as instants. */
const QUERYABLES = Object.fromEntries(["datetime", "start_datetime", "end_datetime", "created", "updated", "published", "expires"]
    .map((name) => [name, {type: "string", format: "date-time"}]));

const OPTIONS: EvaluateOptions<StacItemJson> = {getProperty: itemProperty, queryables: QUERYABLES};

/**
 * A CQL2-JSON filter compiled once to a test on STAC items, by the `ogc-cql2` package (OGC 21-065r2, every class but
 * the Spatial Functions beyond `s_intersects`). For many items, compile once with this rather than calling
 * {@link evaluateCql2} for each.
 *
 * Property references read `item.properties` (a `properties.` prefix is ignored), except `id` and `collection`,
 * which read the item, and `geometry`, the item's footprint. `asset_media_types`, when the item has no such
 * property, is derived: the media types of its data assets (see {@link itemMediaTypes}), for filters such as
 * `A_OVERLAPS(asset_media_types, ('image/tiff; application=geotiff; profile=cloud-optimized'))`. `datetime`, `start_datetime`, `end_datetime`, `created`, `updated`,
 * `published` and `expires` are instants (RFC 3339 strings), so `T_INTERSECTS(datetime, INTERVAL(...))` works; as
 * CQL2 requires, an instant is not compared with a date (`DATE(...)`, an interval of dates): use timestamps.
 * CQL2's three-valued logic applies: a comparison on a missing property is unknown, and an unknown item does not
 * match.
 *
 * @param e The expression, as built by {@link whereToCql2} or given by the application.
 * @returns A predicate: `true` for the items the filter selects.
 * @throws `Cql2Error` (from `ogc-cql2`) `invalid-filter` for a value that is not a valid filter (`BETWEEN` on
 *   dates, for example), `unsupported` for a Spatial Function other than `s_intersects`.
 * @example
 * ```ts
 * const clear = cql2Predicate({op: "<", args: [{property: "eo:cloud_cover"}, 20]});
 * const items = page.features.filter(clear);   // items returned by a server
 * ```
 *
 * @category Search
 */
export function cql2Predicate(e: Cql2Json): (item: StacItemJson) => boolean {
    const key = JSON.stringify(e);
    let predicate = compiled.get(key);
    if (!predicate) {
        predicate = toPredicate<StacItemJson>(e as Cql2Filter, OPTIONS);
        if (compiled.size >= 64) compiled.delete(compiled.keys().next().value!);
        compiled.set(key, predicate);
    }
    return predicate;
}

/** Filters compiled recently, by their JSON: a search tests the same filter on every item of every page. */
const compiled = new Map<string, (item: StacItemJson) => boolean>();

/**
 * Evaluates a CQL2-JSON filter against an item, with the `ogc-cql2` package: see {@link cql2Predicate}, which
 * compiles a filter once for many items.
 *
 * @param e The expression, as built by {@link whereToCql2} or given by the application.
 * @param item The STAC item to test.
 * @returns `true` when the filter selects the item (CQL2 TRUE); `false` for FALSE and unknown alike.
 * @throws `Cql2Error` (from `ogc-cql2`) for an invalid or unsupported filter, see {@link cql2Predicate}.
 * @example
 * ```ts
 * const items: StacItemJson[] = page.features; // items returned by a server
 * const clear = items.filter((item) => evaluateCql2({op: "<", args: [{property: "eo:cloud_cover"}, 20]}, item));
 * ```
 *
 * @category Search
 */
export function evaluateCql2(e: Cql2Json, item: StacItemJson): boolean {
    return cql2Predicate(e)(item);
}

/** The derived property holding the media types of an item's data assets, see {@link cql2Predicate}. */
export const ASSET_MEDIA_TYPES = "asset_media_types";

/**
 * The CQL2 filter that keeps items with a data asset of one of these media types:
 * `A_OVERLAPS(asset_media_types, (...))`, evaluated on the client with {@link cql2Predicate} (servers do not know
 * `asset_media_types`). The media types are compared canonically spelled ({@link normaliseMediaType}) and otherwise
 * exactly: `image/tiff; application=geotiff` does not match a COG, whose media type also has
 * `profile=cloud-optimized`. List every media type wanted.
 *
 * @param mediaTypes Media types, as STAC assets declare them in `type`.
 * @returns The CQL2-JSON filter.
 * @example
 * ```ts
 * const cogOnly = cql2Predicate(mediaTypesFilter(["image/tiff; application=geotiff; profile=cloud-optimized"]));
 * const cogs = items.filter(cogOnly);
 * ```
 *
 * @category Search
 */
export function mediaTypesFilter(mediaTypes: readonly string[]): Cql2Json {
    return {op: "a_overlaps", args: [{property: ASSET_MEDIA_TYPES}, [...new Set(mediaTypes.map(normaliseMediaType))]]};
}
