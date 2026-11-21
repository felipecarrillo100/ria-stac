/** Formatting helpers of the explorer. */
import {bboxOf, type Bbox, type StacItemJson} from "ria-stac";

export const dateOf = (i: StacItemJson) => String(i.properties.datetime ?? i.properties.start_datetime ?? "");
export const shortDate = (s: string | null | undefined) => (s ? s.slice(0, 10) : "…");
export const cloudOf = (i: StacItemJson) => (typeof i.properties["eo:cloud_cover"] === "number" ? i.properties["eo:cloud_cover"] as number : undefined);

/** "6.1 × 4.8 km" for a lon/lat box. */
export function bboxSize(b: Bbox): string {
    const [w, s, e, n] = b;
    const lat = ((s + n) / 2) * Math.PI / 180;
    const km = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
    return `${km((e - w) * 111.32 * Math.cos(lat))} × ${km((n - s) * 110.57)} km`;
}

export const fmtBbox = (b: Bbox) => b.map((v) => v.toFixed(4)).join(", ");

/** A thumbnail of an item or collection: an asset with role thumbnail (or key thumbnail / preview), https only. */
export function thumbnailOf(doc: { assets?: Record<string, { href?: string; roles?: string[]; type?: string }> }): string | undefined {
    const entries = Object.entries(doc.assets ?? {});
    const hit = entries.find(([, a]) => a.roles?.includes("thumbnail")) ?? entries.find(([k]) => /^(thumbnail|preview|rendered_preview)$/i.test(k))
        ?? entries.find(([, a]) => a.roles?.includes("overview") && /png|jpe?g|webp/i.test(a.type ?? ""));
    const href = hit?.[1].href;
    return href && /^https:/.test(href) && /png|jpe?g|webp|gif/i.test(`${hit?.[1].type ?? ""}${href}`) ? href : undefined;
}

/** Why a request failed, in words a user can act on. */
export function explainError(message: string): { title: string; hint: string } {
    if (/CORS|Failed to fetch|NetworkError|Load failed/i.test(message)) {
        return {title: "The server could not be reached from this page", hint: "It may send no CORS headers (it works in a plain browser tab, not here), be offline, or the URL may be wrong."};
    }
    if (/HTTP 401|HTTP 403/.test(message)) return {title: "The server asks for credentials", hint: "This source needs a login or a token."};
    if (/HTTP 404/.test(message)) return {title: "Nothing at that URL", hint: "Check the URL: a STAC API landing page, a catalog.json or a collection."};
    if (/HTTP 429/.test(message)) return {title: "The server limits requests", hint: "Wait a moment, then try again."};
    if (/HTTP 5\d\d/.test(message)) return {title: "The server had an error", hint: "Try again, or narrow the search (area, period)."};
    if (/not JSON/i.test(message)) return {title: "That is not a STAC document", hint: "The URL returned a web page or nothing. Use the API or catalog URL itself."};
    return {title: "Something went wrong", hint: message};
}

/** An item's bbox in 2D: its `bbox`, else the bounds of its geometry; undefined when it has neither. */
export function itemBbox(item: StacItemJson): Bbox | undefined {
    const b = item.bbox;
    if (Array.isArray(b) && b.length >= 4) return (b.length === 6 ? [b[0], b[1], b[3], b[4]] : b.slice(0, 4)) as Bbox;
    try { return item.geometry ? bboxOf(item.geometry as never) : undefined; } catch { return undefined; }
}
