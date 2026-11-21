import {useState} from "react";
import type {TimeDomain, TimeRangeMode, TimeRangeValue} from "./TimeRangePicker.js";
import type {TimeExtent} from "ria-stac";
import type {ExceptSpan} from "../state/explorer.js";

/** A form's period ("" for an open end) as the picker's value, and back. */
export const toValue = (p: { from: string; to: string; except: ExceptSpan[] }): TimeRangeValue =>
    ({from: p.from || null, to: p.to || null, except: p.except});
export const fromValue = (v: TimeRangeValue) => ({from: v.from ?? "", to: v.to ?? "", except: v.except});

const SOURCE = {items: "from the first and last items", declared: "as declared", seen: "widened by the items read"} as const;

/** A ria-stac time extent as the picker's domain, saying where each end comes from. */
export function domainOf(e: TimeExtent | null, fallback: TimeDomain = {min: null, max: null, openEnd: true}): TimeDomain {
    if (!e) return fallback;
    const sources = [...new Set([e.minSource, e.maxSource].filter((s): s is NonNullable<typeof s> => !!s))].map((s) => SOURCE[s]);
    return {min: e.min, max: e.max, openStart: e.openStart, openEnd: e.openEnd, ...(sources.length ? {note: sources.join(", ")} : {})};
}

const KEY = "stac-explorer:period-mode";

/** The picker's mode, remembered in the browser and shared by Browse and Search. */
export function usePeriodMode(): [TimeRangeMode, (m: TimeRangeMode) => void] {
    const read = (): TimeRangeMode => { try { return localStorage.getItem(KEY) === "slider" ? "slider" : "fields"; } catch { return "fields"; } };
    const [mode, setMode] = useState<TimeRangeMode>(read);
    return [mode, (m) => { setMode(m); try { localStorage.setItem(KEY, m); } catch { /* private window */ } }];
}
