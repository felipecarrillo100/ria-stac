/**
 * Browse's list, as the panel and the map both show it: the collections read, after the text search, the order
 * and the format filter. One computation, so the list and the extents on the map always agree.
 */
import {useMemo} from "react";
import {mediaTypeMatch, type CollectionSummary, type MediaTypeMatch} from "ria-stac";
import {explorer, useExplorer, type CollectionSort} from "./explorer.js";
import {formatOf, groupFormats, mediaTypesOf, type FormatOption} from "../formats.js";

/** The list in the order asked: names by title (else id), dates by the declared period (ongoing counts as today). */
function sorted(list: CollectionSummary[], sort: CollectionSort): CollectionSummary[] {
    if (sort === "server") return list;
    const name = (c: CollectionSummary) => (c.title ?? c.id).toLowerCase();
    const end = (c: CollectionSummary) => (c.interval[1] ? Date.parse(c.interval[1]) : Date.now());
    const start = (c: CollectionSummary) => (c.interval[0] ? Date.parse(c.interval[0]) : -Infinity);
    const by: Record<Exclude<CollectionSort, "server">, (a: CollectionSummary, b: CollectionSummary) => number> = {
        "name-asc": (a, b) => name(a).localeCompare(name(b)),
        "name-desc": (a, b) => name(b).localeCompare(name(a)),
        newest: (a, b) => end(b) - end(a) || name(a).localeCompare(name(b)),
        oldest: (a, b) => start(a) - start(b) || name(a).localeCompare(name(b)),
    };
    return [...list].sort(by[sort]);
}

function matchesText(c: CollectionSummary, text: string): boolean {
    if (!text) return true;
    const t = text.toLowerCase();
    return [c.id, c.title, c.description, ...(c.keywords ?? [])].some((v) => v?.toLowerCase().includes(t));
}

export interface BrowseList {
    /** What is shown, in order: the matches, then (when asked) the unsure ones. */
    shown: CollectionSummary[];
    /** Collections that might have a chosen format: not seen in the item read, or not read yet. */
    unsure: CollectionSummary[];
    /** Whether the unsure ones are shown (after the matches, dimmed). */
    showUnsure: boolean;
    /** Each listed collection's verdict for the chosen formats; null without a format filter. */
    verdicts: Map<string, MediaTypeMatch | null>;
    /** How many match, are unsure, or are known to lack the chosen formats. */
    tally: { match: number; unsure: number; hidden: number };
    /** The formats to choose from, with how many collections have each. */
    options: FormatOption[];
}

export function useBrowseList(): BrowseList {
    const s = useExplorer();
    const f = s.collectionFilters;
    const listed = useMemo(() => sorted(s.collections.filter((c) => matchesText(c, f.text)), f.sort), [s.collections, f.text, f.sort]);
    // What each collection is known to have (item_assets, else the item read).
    const known = useMemo(() => new Map(s.collections.map((c) => [c.id, explorer.knownMediaTypes(c)])), [s.collections, s.sampled]);
    const options = useMemo(() => {
        const perFormat = new Map<string, number>();
        const entries: { mediaType: string; count: number }[] = [];
        for (const k of known.values()) {
            if (!k) continue;
            const types = "mediaTypeSource" in k ? k.mediaTypes : k.mediaTypes.map((t) => t.mediaType);
            for (const t of types) entries.push({mediaType: t, count: 0});
            for (const fmt of new Set(types.map(formatOf))) perFormat.set(fmt, (perFormat.get(fmt) ?? 0) + 1);
        }
        // Counted per collection (a collection with two GeoTIFF spellings counts once).
        return groupFormats(entries).map((o) => ({...o, count: perFormat.get(o.format) ?? 0}));
    }, [known]);
    const wanted = useMemo(() => (f.formats.length ? mediaTypesOf(f.formats, explorer.seenMediaTypes()) : []), [f.formats, known]);
    const verdicts = useMemo(() => new Map(listed.map((c) => [c.id, wanted.length ? mediaTypeMatch(known.get(c.id), wanted) : null])), [listed, known, wanted]);
    return useMemo(() => {
        const tally = {match: 0, unsure: 0, hidden: 0};
        for (const v of verdicts.values()) if (v) { if (v === "match") tally.match++; else if (v === "no-match") tally.hidden++; else tally.unsure++; }
        if (!wanted.length) return {shown: listed, unsure: [], showUnsure: f.showUnsure, verdicts, tally, options};
        // Known no-matches are hidden; the unsure ones only when asked, after the matches.
        const matched = listed.filter((c) => verdicts.get(c.id) === "match");
        const unsure = listed.filter((c) => { const v = verdicts.get(c.id); return v === "not-in-sample" || v === "unknown"; });
        return {shown: f.showUnsure ? [...matched, ...unsure] : matched, unsure, showUnsure: f.showUnsure, verdicts, tally, options};
    }, [listed, verdicts, wanted, f.showUnsure, options]);
}
