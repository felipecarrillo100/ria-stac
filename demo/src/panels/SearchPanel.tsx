import {Alert, Box, Button, Chip, Collapse, FormControlLabel, LinearProgress, Link, MenuItem, Slider, Stack, Switch, TextField, Tooltip, Typography} from "@mui/material";
import {useState} from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {cql2Text, explorer, useExplorer} from "../state/explorer.js";
import {explainError, shortDate} from "../util.js";
import {AreaChooser} from "./AreaChooser.js";
import {TimeRangePicker} from "../components/TimeRangePicker.js";
import {domainOf, fromValue, toValue, usePeriodMode} from "../components/periodValue.js";
import {FormatPicker} from "./FormatPicker.js";
import {groupFormats} from "../formats.js";

/** Degradations, in plain words. */
const DEGRADATION: Record<string, string> = {
    "datetime-normalised": "dates written as the server expects",
    "filter-via-query": "the filter goes through the older Query extension",
    "filter-client-side": "the filter is tested here, in the browser",
    "filter-split": "part of the filter is tested here",
    "operators-rewritten": "operators rewritten for the server",
    "sort-dropped": "the server cannot sort: results come in its own order",
    "fields-dropped": "fields extension not supported",
    "q-dropped": "free text not supported",
    "limit-clamped": "page size lowered to what the server accepts",
    "static-catalog": "static catalog: crawled and filtered here",
    "filter-refused": "the server refused the filter: tested here",
};

function Plan() {
    const s = useExplorer();
    const [copied, setCopied] = useState(false);
    const p = s.plan;
    if (!p) return null;
    return (
        <Box sx={{border: 1, borderColor: "divider", borderRadius: 1, p: 1.25, bgcolor: "rgba(148,163,184,0.05)"}}>
            <Typography variant="caption" color="text.secondary" component="div">
                <strong>Sent to the server:</strong> {p.serverApplies.length ? p.serverApplies.join(", ") : "nothing beyond the collection"}
            </Typography>
            {!!p.clientApplies.length && <Typography variant="caption" color="text.secondary" component="div">
                <strong>Tested here:</strong> {p.clientApplies.map((c) => (c === "exceptDatetime" ? "excluded periods (exactly, for items that cover a span)" : c)).join(", ")}{p.clientFilter ? ` (${cql2Text(p.clientFilter)})` : ""}</Typography>}
            {p.serverFilter && <Typography variant="caption" component="div" sx={{fontFamily: "JetBrains Mono, monospace", color: "primary.light", wordBreak: "break-word"}}>
                {cql2Text(p.serverFilter)}</Typography>}
            {!!p.degradations.length && <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.75}}>
                {p.degradations.map((d, i) => <Chip key={i} variant="outlined" color="warning" label={DEGRADATION[d.kind] ?? d.kind}/>)}</Box>}
            <Button size="small" startIcon={<ContentCopyIcon fontSize="small"/>} sx={{mt: 0.5}}
                onClick={() => { void navigator.clipboard.writeText(p.code.curl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? "Copied" : "Copy as curl"}</Button>
        </Box>
    );
}

/** The dates of the items here, and how they are known; one click makes them the period. */
function DataRange() {
    const s = useExplorer();
    const r = s.dataRange;
    const fmt = (v: string | null, end: boolean) => (v ? v.replace("T", " ").slice(0, 16) : end ? "ongoing" : "…");
    return (
        <Box sx={{display: "flex", alignItems: "center", gap: 1, mb: 1, minHeight: 24}}>
            <Typography variant="caption" color="text.secondary" sx={{flex: 1}}>
                {s.dataRangeLoading ? "Finding the dates of the items here…"
                    : !r ? ""
                        : r.empty ? "No item here, at any date."
                            : <>Data here: <strong>{fmt(r.first, false)}</strong> – <strong>{fmt(r.last, true)}</strong> UTC
                                {" "}<Tooltip title={r.source === "items" ? "The oldest and newest items for this area and filters (two sorted one-item searches)"
                                    : "The server cannot sort: these are the dates the collection declares, which may be wider than the data"}>
                                    <Chip label={r.source === "items" ? "from the items" : "declared"} variant="outlined" color={r.source === "items" ? "success" : "warning"} sx={{height: 18, fontSize: 10.5}}/>
                                </Tooltip></>}
            </Typography>
            {r && !r.empty && (r.first || r.last) && <Button size="small" onClick={() => explorer.setForm({from: r.first ?? "", to: r.last ?? ""})}>Use</Button>}
        </Box>
    );
}

export function SearchPanel() {
    const s = useExplorer();
    const [advanced, setAdvanced] = useState(false);
    const [mode, setMode] = usePeriodMode();
    const c = s.collection;
    if (s.collectionLoading) return <Box sx={{p: 2}}><LinearProgress/></Box>;
    if (!c) return <Typography color="text.secondary" sx={{p: 2}}>Choose a collection in Browse first.</Typography>;
    const form = s.form;
    const caps = s.client!.capabilities;
    const cloud = c.queryables.find((q) => q.name === "eo:cloud_cover");
    const sortable = caps.sort || caps.staticCatalog;
    return (
        <Box sx={{display: "flex", flexDirection: "column", flex: 1, minHeight: 0}}>
            <Box sx={{display: "flex", alignItems: "flex-start", gap: 1, p: 2, pb: 1.5, borderBottom: 1, borderColor: "divider", flex: "none"}}>
                <Box sx={{flex: 1, minWidth: 0}}>
                    <Typography variant="subtitle2">{c.title ?? c.id}</Typography>
                    <Typography variant="caption" color="text.secondary">{shortDate(c.interval[0])} – {c.interval[1] ? shortDate(c.interval[1]) : "today"}</Typography>
                </Box>
                <Button onClick={() => explorer.setStep("collections")}>Change</Button>
            </Box>
            <Stack spacing={2} sx={{flex: 1, overflow: "auto", minHeight: 0, p: 2}}>
            <Box>
                <Typography variant="overline" color="text.secondary">Area</Typography>
                <AreaChooser value={form.area} onChange={(area) => explorer.setForm({area})}
                    worldNote="No area is sent: the server returns its first items in its own order, not the nearest ones."/>
            </Box>
            <Box>
                <Typography variant="overline" color="text.secondary">Period</Typography>
                <DataRange/>
                <TimeRangePicker value={toValue(form)} onChange={(v) => explorer.setForm(fromValue(v), {live: true})} mode={mode} onModeChange={setMode}
                    domain={domainOf(s.collectionExtent, {min: c.interval[0], max: c.interval[1], openStart: !c.interval[0], openEnd: !c.interval[1], note: "declared"})}/>
            </Box>
            <Box>
                <Typography variant="overline" color="text.secondary">Data</Typography>
                <FormatPicker options={groupFormats((s.mediaTypes?.mediaTypes ?? []).map((t) => ({mediaType: t.mediaType, count: t.keys.length})))} unit="asset" scope="in this collection"
                    value={form.formats} onChange={(formats) => explorer.setForm({formats})} loading={!s.mediaTypes} caption={<>
                        {!s.mediaTypes ? "Reading what the collection offers…"
                            : s.mediaTypes.source === "item_assets" ? "From the collection's item_assets (complete)."
                                : s.mediaTypes.source === "none" ? "The collection has no items to read formats from."
                                    : <>From {s.mediaTypes.items} of its items: may be incomplete.{" "}
                                        <Link component="button" variant="caption" onClick={() => void explorer.sampleMoreFormats()}>Look at more items</Link></>}
                        {" "}None picked keeps every item.
                    </>}/>
            </Box>
            {cloud && (
                <Box>
                    <FormControlLabel control={<Switch size="small" checked={form.maxCloud !== null} onChange={(e) => explorer.setForm({maxCloud: e.target.checked ? 20 : null})}/>}
                        label={<Typography variant="body2">Cloud cover at most {form.maxCloud ?? "…"} %</Typography>}/>
                    {form.maxCloud !== null && <Slider size="small" value={form.maxCloud} min={0} max={100} valueLabelDisplay="auto"
                        onChange={(_e, v) => explorer.setForm({maxCloud: v as number})} aria-label="Maximum cloud cover"/>}
                </Box>
            )}
            <Stack direction="row" spacing={1}>
                <Tooltip title={sortable ? "" : "The server cannot sort"}>
                    <TextField select label="Sort" value={form.sort} onChange={(e) => explorer.setForm({sort: e.target.value as typeof form.sort})} fullWidth disabled={!sortable}>
                        <MenuItem value="">Server order</MenuItem>
                        <MenuItem value="datetime-desc">Newest first</MenuItem>
                        <MenuItem value="datetime-asc">Oldest first</MenuItem>
                        {cloud && <MenuItem value="cloud-asc">Least cloud first</MenuItem>}
                    </TextField>
                </Tooltip>
                <TextField type="number" label="Maximum items" value={form.maxItems} onChange={(e) => explorer.setForm({maxItems: Math.max(1, Math.min(10000, Number(e.target.value) || 1))})}
                    sx={{width: 160}}/>
            </Stack>
            <Box>
                <Button onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "More filters"} (CQL2)</Button>
                <Collapse in={advanced || !!form.cql2}>
                    <TextField multiline minRows={2} fullWidth label="CQL2 filter (text)" value={form.cql2} onChange={(e) => explorer.setForm({cql2: e.target.value})}
                        placeholder="platform = 'sentinel-2a' AND eo:cloud_cover < 10" error={!!s.cql2Error} helperText={s.cql2Error ?? undefined}
                        slotProps={{htmlInput: {style: {fontFamily: "JetBrains Mono, monospace", fontSize: 12}}}}/>
                    {!!c.queryables.length && <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1}}>
                        {c.queryables.slice(0, 40).map((q) => (
                            <Tooltip key={q.name} title={[q.title, q.type, q.enum ? `one of ${q.enum.slice(0, 8).join(", ")}` : "", q.minimum !== undefined ? `${q.minimum}..${q.maximum}` : ""].filter(Boolean).join(" · ")}>
                                <Chip label={q.name} variant="outlined" onClick={() => explorer.setForm({cql2: `${form.cql2}${form.cql2 ? " AND " : ""}${q.name} `})} sx={{fontFamily: "JetBrains Mono, monospace", fontSize: 11}}/>
                            </Tooltip>
                        ))}
                    </Box>}
                </Collapse>
            </Box>
            <Plan/>
            {s.searchError && <Alert severity="error"><strong>{explainError(s.searchError).title}</strong><br/>{explainError(s.searchError).hint}</Alert>}
            </Stack>
            {/* The search button stays in reach while the form scrolls. */}
            <Box sx={{p: 2, pt: 1.5, borderTop: 1, borderColor: "divider", flex: "none"}}>
                <Button variant="contained" size="medium" fullWidth disabled={!s.plan || s.searching || (form.area === "bbox" && !s.bbox)} onClick={() => void explorer.runSearch()}>
                    Search {c.title ?? c.id}</Button>
                <Typography variant="caption" color="text.secondary" component="div" sx={{mt: 0.75, textAlign: "center"}}>
                    {s.fetchedAt ? (s.autoUpdate ? "Auto update is on: the results follow your changes." : s.dirty ? "Changed since the last search." : "The results match this form.")
                        : "Nothing is sent until you search."}</Typography>
            </Box>
        </Box>
    );
}
