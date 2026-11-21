/**
 * A period picker that knows nothing about STAC: a range of times, open or bounded at each end, with periods left
 * out, in two modes (date-time fields, or a slider over the times the data covers). The caller gives the limits
 * (`domain`), for example from ria-stac's `timeExtent`.
 */
import {useRef, useState, type ReactNode} from "react";
import dayjs, {type Dayjs} from "dayjs";
import {Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Slider, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography} from "@mui/material";
import {DateTimePicker} from "@mui/x-date-pickers/DateTimePicker";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";

/** A span of time: RFC 3339 instants in UTC; null is an open end (no limit). */
export interface TimeSpan {
    from: string | null;
    to: string | null;
}

/** The value: a span, and spans left out of it. */
export interface TimeRangeValue extends TimeSpan {
    except: TimeSpan[];
}

/** The times available: the slider's full extent, and the fields' limits. */
export interface TimeDomain {
    /** The earliest time of the data, or null when unknown. */
    min: string | null;
    /** The latest time of the data, or null when unknown. */
    max: string | null;
    /** The data may begin before `min` (no declared start). */
    openStart?: boolean;
    /** The data goes on after `max` (ongoing): the slider then runs to now. */
    openEnd?: boolean;
    /** Where the limits come from, shown under the picker. */
    note?: ReactNode;
}

export type TimeRangeMode = "fields" | "slider";

export interface TimeRangePickerProps {
    value: TimeRangeValue;
    onChange: (value: TimeRangeValue) => void;
    domain: TimeDomain;
    /** Controlled mode; without it the picker keeps its own, starting at `defaultMode`. */
    mode?: TimeRangeMode;
    defaultMode?: TimeRangeMode;
    onModeChange?: (mode: TimeRangeMode) => void;
    /** Quick choices (last 24 h, 7 days, ...). Default true. */
    presets?: boolean;
    /** Allow periods to be left out. Default true. */
    allowExcept?: boolean;
    /** Labels of the two ends. */
    labels?: [string, string];
}

// ------------------------------------------------------------------------------------------------ time helpers

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
const toPicker = (v: string | null): Dayjs | null => (v ? dayjs.utc(v) : null);
const fromPicker = (v: Dayjs | null): string | null => (v && v.isValid() ? iso(v.valueOf()) : null);
const label = (v: string | null, end: boolean, short = false) =>
    v ? v.replace("T", " ").slice(0, short ? 10 : 16) : end ? "any later" : "any earlier";

/** The slider's limits in milliseconds: the domain, an open end running to now, a default of the last 10 years. */
function extentOf(domain: TimeDomain, value: TimeRangeValue): [number, number] {
    const now = Date.now();
    const known = [value.from, value.to, ...value.except.flatMap((e) => [e.from, e.to])].map(ms).filter(Number.isFinite);
    let lo = ms(domain.min), hi = ms(domain.max);
    if (domain.openEnd || !Number.isFinite(hi)) hi = Math.max(Number.isFinite(hi) ? hi : -Infinity, now);
    if (!Number.isFinite(lo)) lo = Math.min(hi - 10 * 365.25 * 86_400_000, ...known);
    // Chosen times outside the domain widen the slider, so they are never moved by showing them.
    lo = Math.min(lo, ...known);
    hi = Math.max(hi, ...known);
    if (hi <= lo) hi = lo + 86_400_000;
    return [lo, hi];
}

/** Rounds a time from the slider to what its resolution can mean: days, hours or minutes. */
function rounded(t: number, span: number, end: boolean): number {
    const unit = span > 60 * 86_400_000 ? "day" : span > 2 * 86_400_000 ? "hour" : "minute";
    const d = dayjs.utc(t);
    return (end ? d.endOf(unit).millisecond(0).second(59) : d.startOf(unit)).valueOf();
}

// The slider runs 0..1000 over the domain. An open end has no handle: the checkboxes under the slider say which
// ends are limited, so dragging can never make an end open by mistake.
const LO = 0, HI = 1000;

function positionOf(v: string | null, end: boolean, [lo, hi]: [number, number]): number {
    if (v === null) return end ? HI : LO;
    return LO + (HI - LO) * Math.min(1, Math.max(0, (ms(v) - lo) / (hi - lo)));
}

function valueAt(p: number, end: boolean, [lo, hi]: [number, number]): string {
    const t = lo + (hi - lo) * Math.min(1, Math.max(0, (p - LO) / (HI - LO)));
    return iso(Math.min(hi, Math.max(lo, rounded(t, hi - lo, end))));
}

// ------------------------------------------------------------------------------------------------ parts

/** Two date-time fields; an empty one is open. A "to" of a whole day (00:00 chosen) means that day's end. */
function Fields({span, onChange, domain, labels}: {
    span: TimeSpan; onChange: (s: TimeSpan) => void; domain: TimeDomain; labels: [string, string];
}) {
    const limits = {
        ...(domain.min && !domain.openStart ? {minDateTime: dayjs.utc(domain.min)} : {}),
        ...(domain.max && !domain.openEnd ? {maxDateTime: dayjs.utc(domain.max)} : {}),
    };
    const slot = (text: string) => ({
        textField: {size: "small" as const, fullWidth: true, label: text},
        field: {clearable: true},
        actionBar: {actions: ["clear" as const, "today" as const, "accept" as const]},
    });
    return (
        <Stack spacing={1}>
            <DateTimePicker timezone="UTC" ampm={false} format="YYYY-MM-DD HH:mm" value={toPicker(span.from)}
                onChange={(v) => onChange({...span, from: fromPicker(v)})} {...limits}
                {...(span.to ? {maxDateTime: dayjs.utc(span.to)} : {})} slotProps={slot(labels[0])}/>
            <DateTimePicker timezone="UTC" ampm={false} format="YYYY-MM-DD HH:mm" value={toPicker(span.to)}
                referenceDate={dayjs.utc().endOf("day")}
                onChange={(v) => onChange({...span, to: fromPicker(v && v.isValid() && v.hour() === 0 && v.minute() === 0 && !span.to ? v.endOf("day") : v)})}
                {...limits} {...(span.from ? {minDateTime: dayjs.utc(span.from)} : {})} slotProps={slot(labels[1])}/>
        </Stack>
    );
}

/** A slider over the domain with a handle per limited end (an open end has none). Left-out spans show as hatched bands. */
function SpanSlider({span, onChange, extent, bands = [], color = "primary", ariaLabel}: {
    span: TimeSpan; onChange: (s: TimeSpan) => void; extent: [number, number]; bands?: TimeSpan[];
    color?: "primary" | "error"; ariaLabel: string;
}) {
    const positions: [number, number] = [positionOf(span.from, false, extent), positionOf(span.to, true, extent)];
    const bounded = {from: span.from !== null, to: span.to !== null};
    const text = (p: number, end: boolean) => label(valueAt(p, end, extent), end);
    // One handle per limited end: two, one (the track runs on to the open side), or none (the whole track).
    const slider = bounded.from && bounded.to
        ? {value: positions, track: "normal" as const, ends: [false, true]}
        : bounded.from ? {value: positions[0], track: "inverted" as const, ends: [false]}
            : bounded.to ? {value: positions[1], track: "normal" as const, ends: [true]}
                : {value: [LO, HI], track: "normal" as const, ends: []};
    return (
        <Box sx={{position: "relative", px: 1.25}}>
            {/* The left-out spans, under the track. */}
            <Box sx={{position: "absolute", left: 10, right: 10, top: "50%", height: 10, mt: "-5px", pointerEvents: "none"}}>
                {bands.map((b, i) => {
                    const a = positionOf(b.from, false, extent), z = positionOf(b.to, true, extent);
                    return <Box key={i} sx={{position: "absolute", left: `${a / 10}%`, width: `${Math.max(0.4, (z - a) / 10)}%`, height: "100%", borderRadius: 0.5,
                        backgroundImage: "repeating-linear-gradient(135deg, rgba(248,113,113,.75) 0 3px, transparent 3px 6px)"}}/>;
                })}
            </Box>
            <DragStrip span={span} onChange={onChange} extent={extent} positions={positions}/>
            <Slider value={slider.value} min={LO} max={HI} step={0.5} color={color} disableSwap size="small" track={slider.track}
                disabled={slider.ends.length === 0}
                valueLabelDisplay="auto" valueLabelFormat={(p, i) => text(p, slider.ends[i] ?? false)}
                getAriaValueText={(p, i) => text(p, slider.ends[i] ?? false)}
                getAriaLabel={(i) => `${ariaLabel}: ${slider.ends[i] ? "end" : "start"}`}
                onChange={(_, v) => {
                    const values = Array.isArray(v) ? v : [v];
                    const next = {...span};
                    slider.ends.forEach((end, i) => { next[end ? "to" : "from"] = valueAt(values[i], end, extent); });
                    onChange(next);
                }}
                sx={{"& .MuiSlider-rail": {opacity: 0.25}, "&.Mui-disabled .MuiSlider-track": {color: "primary.dark", opacity: 0.6}, "&.Mui-disabled .MuiSlider-thumb": {display: "none"},
                    "& .MuiSlider-valueLabel": {fontSize: 11, fontFamily: "JetBrains Mono, monospace"}}}/>
        </Box>
    );
}

/**
 * The part of the track between the handles, to drag the whole span. With both ends bounded the span keeps its
 * length and stops at the domain's ends; with one end open, only the limited one moves. It leaves room at each end for the handles.
 */
function DragStrip({span, onChange, extent, positions}: {
    span: TimeSpan; onChange: (s: TimeSpan) => void; extent: [number, number]; positions: [number, number];
}) {
    const [a, b] = positions;
    if (span.from === null && span.to === null) return null;
    const onPointerDown = (down: React.PointerEvent<HTMLDivElement>) => {
        const strip = down.currentTarget;
        const width = strip.parentElement!.getBoundingClientRect().width;
        const [lo, hi] = extent;
        const from0 = ms(span.from), to0 = ms(span.to);
        const perPx = (hi - lo) / ((HI - LO) / 1000 * width);
        try { strip.setPointerCapture(down.pointerId); } catch { /* not an active pointer */ }
        down.preventDefault();
        const move = (e: PointerEvent) => {
            const dt = (e.clientX - down.clientX) * perPx;
            if (span.from !== null && span.to !== null) {
                const length = to0 - from0;
                const start = rounded(Math.min(hi - length, Math.max(lo, from0 + dt)), hi - lo, false);
                const clamped = Math.min(hi - length, Math.max(lo, start));
                onChange({from: iso(clamped), to: iso(clamped + length)});
            } else if (span.from !== null) {
                onChange({...span, from: iso(Math.min(hi, Math.max(lo, rounded(from0 + dt, hi - lo, false))))});
            } else {
                onChange({...span, to: iso(Math.min(hi, Math.max(lo, rounded(to0 + dt, hi - lo, true))))});
            }
        };
        const up = () => { strip.removeEventListener("pointermove", move); strip.removeEventListener("pointerup", up); strip.removeEventListener("pointercancel", up); };
        strip.addEventListener("pointermove", move);
        strip.addEventListener("pointerup", up);
        strip.addEventListener("pointercancel", up);
    };
    return (
        <Box sx={{position: "absolute", left: 10, right: 10, top: "50%", height: 16, mt: "-8px", pointerEvents: "none", zIndex: 1}}>
            <Tooltip title="Drag to move the period" placement="top" enterDelay={600}>
                <Box onPointerDown={onPointerDown} aria-hidden
                    sx={{position: "absolute", left: `calc(${a / 10}% + 9px)`, width: `max(0px, calc(${(b - a) / 10}% - 18px))`, height: "100%",
                        pointerEvents: "auto", cursor: "grab", touchAction: "none", "&:active": {cursor: "grabbing"}}}/>
            </Tooltip>
        </Box>
    );
}

/**
 * One checkbox per end: ticked, the end is limited (it has a handle and a date); unticked, it is open ("any
 * earlier", "any later"). Ticking an end again restores its last date, else the domain's end.
 */
function Ends({span, onChange, extent}: { span: TimeSpan; onChange: (s: TimeSpan) => void; extent: [number, number] }) {
    const last = useRef<TimeSpan>({from: null, to: null});
    if (span.from) last.current.from = span.from;
    if (span.to) last.current.to = span.to;
    const end = (which: "from" | "to") => {
        const limited = span[which] !== null;
        const restore = () => {
            const kept = last.current[which];
            const inside = kept && ms(kept) >= extent[0] && ms(kept) <= extent[1]
                && (which === "from" ? !span.to || ms(kept) <= ms(span.to) : !span.from || ms(kept) >= ms(span.from));
            return inside ? kept : iso(which === "from" ? extent[0] : rounded(extent[1], extent[1] - extent[0], true));
        };
        return (
            <FormControlLabel sx={{m: 0, ...(which === "to" ? {flexDirection: "row-reverse"} : {})}}
                control={<Checkbox size="small" checked={limited} sx={{p: 0.5}}
                    onChange={(e) => onChange({...span, [which]: e.target.checked ? restore() : null})}
                    slotProps={{input: {"aria-label": which === "from" ? "Limit the start" : "Limit the end"}}}/>}
                label={<Typography component="span" sx={{fontSize: 11.5, fontFamily: "JetBrains Mono, monospace", color: limited ? "text.primary" : "text.secondary"}}>
                    {which === "from" ? "From " : "To "}{label(span[which], which === "to")}
                </Typography>}/>
        );
    };
    return (
        <Box sx={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1}}>
            {end("from")}{end("to")}
        </Box>
    );
}

// ------------------------------------------------------------------------------------------------ picker

export function TimeRangePicker({value, onChange, domain, mode: controlled, defaultMode = "fields", onModeChange,
    presets = true, allowExcept = true, labels = ["From", "To"]}: TimeRangePickerProps) {
    const [own, setOwn] = useState<TimeRangeMode>(defaultMode);
    const mode = controlled ?? own;
    const setMode = (m: TimeRangeMode) => { setOwn(m); onModeChange?.(m); };
    const extent = extentOf(domain, value);
    const now = dayjs.utc();
    const choices: [string, () => TimeSpan][] = [
        ["24 h", () => ({from: iso(now.subtract(24, "hour").valueOf()), to: null})],
        ["7 days", () => ({from: iso(now.subtract(7, "day").startOf("day").valueOf()), to: null})],
        ["30 days", () => ({from: iso(now.subtract(30, "day").startOf("day").valueOf()), to: null})],
        ["This year", () => ({from: iso(now.startOf("year").valueOf()), to: null})],
        ["Any time", () => ({from: null, to: null})],
    ];
    const setSpan = (s: TimeSpan) => onChange({...value, ...s});
    const setExcept = (i: number, s: TimeSpan | null) =>
        onChange({...value, except: s ? value.except.map((e, j) => (j === i ? s : e)) : value.except.filter((_, j) => j !== i)});
    const addExcept = () => {
        // A tenth of the shown span, in its middle.
        const [lo, hi] = [Number.isFinite(ms(value.from)) ? ms(value.from) : extent[0], Number.isFinite(ms(value.to)) ? ms(value.to) : extent[1]];
        const mid = (lo + hi) / 2, half = (hi - lo) / 20;
        onChange({...value, except: [...value.except, {from: iso(rounded(mid - half, hi - lo, false)), to: iso(rounded(mid + half, hi - lo, true))}]});
    };
    const dataLine = `Data: ${domain.min ? label(domain.min, false, true) : domain.openStart ? "no declared start" : "?"} – ${
        domain.openEnd ? "ongoing" : domain.max ? label(domain.max, true, true) : "?"}`;
    const summary = !value.from && !value.to ? "Any time" : `${label(value.from, false)} → ${label(value.to, true)}`;
    return (
        <Stack spacing={1}>
            <Box sx={{display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap"}}>
                {presets && choices.map(([text, make]) => {
                    const active = text === "Any time" && !value.from && !value.to;
                    return <Chip key={text} size="small" label={text} variant={active ? "filled" : "outlined"} color={active ? "primary" : "default"}
                        onClick={() => setSpan(make())}/>;
                })}
                <Box sx={{flex: 1}}/>
                <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, m) => m && setMode(m)} aria-label="Period input">
                    <ToggleButton value="fields" sx={{py: 0.25, px: 1, fontSize: 11}}>Fields</ToggleButton>
                    <ToggleButton value="slider" sx={{py: 0.25, px: 1, fontSize: 11}}>Slider</ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {mode === "fields"
                ? <Fields span={value} onChange={setSpan} domain={domain} labels={labels}/>
                : <Box>
                    <SpanSlider span={value} onChange={setSpan} extent={extent} bands={value.except} ariaLabel="Period"/>
                    <Box sx={{display: "flex", justifyContent: "space-between", mt: -0.5, mb: 0.5, px: 0.5}}>
                        {[extent[0], extent[1]].map((t, i) => (
                            <Typography key={i} variant="caption" color="text.secondary" sx={{fontSize: 10.5, fontFamily: "JetBrains Mono, monospace"}}>
                                {i === 1 && domain.openEnd ? "now" : iso(t).slice(0, 10)}
                            </Typography>
                        ))}
                    </Box>
                    <Ends span={value} onChange={setSpan} extent={extent}/>
                </Box>}

            {allowExcept && value.except.map((e, i) => (
                <Box key={i} sx={{border: 1, borderColor: "error.dark", borderStyle: "dashed", borderRadius: 1, p: 1, pt: 0.5}}>
                    <Box sx={{display: "flex", alignItems: "center"}}>
                        <Typography variant="caption" color="error.light" sx={{flex: 1}}>Except {label(e.from, false)} → {label(e.to, true)}</Typography>
                        <Tooltip title="Stop leaving this period out">
                            <IconButton size="small" aria-label="Remove this excluded period" onClick={() => setExcept(i, null)}><CloseIcon fontSize="inherit"/></IconButton>
                        </Tooltip>
                    </Box>
                    {mode === "fields"
                        ? <Box sx={{pt: 0.5}}><Fields span={e} onChange={(s) => setExcept(i, s)} domain={domain} labels={["Except from", "Except to"]}/></Box>
                        : <><SpanSlider span={e} onChange={(s) => setExcept(i, s)} extent={extent} color="error" ariaLabel={`Excluded period ${i + 1}`}/>
                            <Ends span={e} onChange={(s) => setExcept(i, s)} extent={extent}/></>}
                </Box>
            ))}

            <Box sx={{display: "flex", alignItems: "center", gap: 1}}>
                <Typography variant="caption" color="text.secondary" sx={{flex: 1}}>
                    UTC · {summary}{value.except.length ? ` · ${value.except.length} left out` : ""}
                    <br/>{dataLine}{domain.note ? <> · {domain.note}</> : null}
                </Typography>
                {allowExcept && <Tooltip title="Leave a period out (for example a cloudy season or a sensor fault)">
                    <Button size="small" startIcon={<AddIcon/>} onClick={addExcept}>Except…</Button>
                </Tooltip>}
            </Box>
        </Stack>
    );
}
