import {useEffect, useMemo, useRef} from "react";
import {Alert, Box, Button, Card, CardActionArea, Chip, FormControlLabel, IconButton, InputAdornment, LinearProgress, Link, MenuItem, Stack, Switch, TextField, Tooltip, Typography} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import {isGlobalBbox, mediaTypeMatch, type CollectionMediaTypes, type CollectionSummary, type MediaTypeMatch} from "ria-stac";
import PublicIcon from "@mui/icons-material/Public";
import {explorer, useExplorer, type CollectionSort} from "../state/explorer.js";
import {explainError, shortDate} from "../util.js";
import {AreaChooser} from "./AreaChooser.js";
import {TimeRangePicker} from "../components/TimeRangePicker.js";
import {domainOf, fromValue, toValue, usePeriodMode} from "../components/periodValue.js";
import {FormatPicker} from "./FormatPicker.js";
import {formatOf, groupFormats, mediaTypesOf} from "../formats.js";

/** The formats of a collection, as far as known: from item_assets (declared) or from an item read (sampled). */
function formatsOfKnown(known: CollectionSummary | CollectionMediaTypes | null): { formats: string[]; declared: boolean; noItems: boolean } | null {
    if (!known) return null;
    const types = "mediaTypeSource" in known ? known.mediaTypes : known.mediaTypes.map((t) => t.mediaType);
    const declared = "mediaTypeSource" in known || known.source === "item_assets";
    return {formats: [...new Set(types.map(formatOf))], declared, noItems: !("mediaTypeSource" in known) && known.source === "none"};
}

/** A card's formats: chips (dashed when read from one item), or what is being done to learn them. */
function CardFormats({c, verdict}: { c: CollectionSummary; verdict: MediaTypeMatch | null }) {
    const s = useExplorer();
    const sample = s.sampled[c.id];
    const known = formatsOfKnown(explorer.knownMediaTypes(c));
    const note = verdict === "not-in-sample" ? "none of the chosen formats in the item read" : verdict === "unknown" ? "formats not known: kept" : null;
    return (
        <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center", mt: 1}}>
            {known ? known.formats.map((f) => (
                <Tooltip key={f} title={known.declared ? "Declared by the collection (item_assets)" : "Seen in one of its items: others may differ"}>
                    <Chip label={f} size="small" color="primary" variant="outlined" sx={{height: 20, fontSize: 11, ...(known.declared ? {} : {borderStyle: "dashed"})}}/>
                </Tooltip>
            )) : <Typography variant="caption" color="text.secondary">{sample === "reading" ? "Reading its formats…" : sample === "failed" ? "Its formats could not be read" : "Formats not known yet"}</Typography>}
            {known && !known.formats.length && <Typography variant="caption" color="text.secondary">{known.noItems ? "No items to read formats from" : "No data assets"}</Typography>}
            {note && <Chip label={note} size="small" color="warning" variant="outlined" sx={{height: 20, fontSize: 11}}/>}
        </Box>
    );
}

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

function matches(c: CollectionSummary, text: string): boolean {
    if (!text) return true;
    const t = text.toLowerCase();
    return [c.id, c.title, c.description, ...(c.keywords ?? [])].some((v) => v?.toLowerCase().includes(t));
}

/** The period of a collection as a small bar over 1970..today, for comparing at a glance. */
function PeriodBar({interval}: { interval: [string | null, string | null] }) {
    const t0 = Date.UTC(1970, 0, 1), t1 = Date.now();
    const a = interval[0] ? Date.parse(interval[0]) : t0, b = interval[1] ? Date.parse(interval[1]) : t1;
    const left = Math.max(0, (a - t0) / (t1 - t0)) * 100, width = Math.max(1.5, ((b - a) / (t1 - t0)) * 100);
    return (
        <Box sx={{position: "relative", height: 4, bgcolor: "rgba(148,163,184,0.15)", borderRadius: 2, mt: 0.75}} aria-hidden>
            <Box sx={{position: "absolute", left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, top: 0, bottom: 0, bgcolor: "secondary.main", borderRadius: 2}}/>
        </Box>
    );
}

function CollectionCard({c, verdict}: { c: CollectionSummary; verdict: MediaTypeMatch | null }) {
    const s = useExplorer();
    const active = s.collection?.id === c.id;
    // Learn the formats of a collection without item_assets when its card comes into view (one item read).
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el || c.mediaTypeSource !== "none" || typeof IntersectionObserver === "undefined") return;
        const seen = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { explorer.sampleCollections([c.id]); seen.disconnect(); }
        });
        seen.observe(el);
        return () => seen.disconnect();
    }, [c.id, c.mediaTypeSource]);
    return (
        <Card ref={ref} variant="outlined" sx={{opacity: verdict && verdict !== "match" ? 0.6 : 1, borderColor: active ? "primary.main" : s.hoveredCollection === c.id ? "warning.main" : "divider", bgcolor: "transparent"}}
            onMouseEnter={() => explorer.hoverCollection(c.id)} onMouseLeave={() => explorer.hoverCollection(null)}>
            <CardActionArea sx={{p: 1.25}} onClick={() => void explorer.chooseCollection(c.id)}>
                <Box sx={{display: "flex", alignItems: "flex-start", gap: 1}}>
                    <Typography variant="subtitle2" sx={{lineHeight: 1.3, flex: 1}}>{c.title ?? c.id}</Typography>
                    {c.bbox && isGlobalBbox(c.bbox) && (
                        <Tooltip title="Its extent covers the whole world">
                            <Chip icon={<PublicIcon/>} label="Global" color="secondary" variant="outlined" sx={{height: 20, flex: "none", "& .MuiChip-icon": {fontSize: 14}}}/>
                        </Tooltip>
                    )}
                </Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{fontFamily: "JetBrains Mono, monospace"}} noWrap>{c.id}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                    {shortDate(c.interval[0])} – {c.interval[1] ? shortDate(c.interval[1]) : "today"}
                    {c.bands.length ? ` · ${c.bands.length} band${c.bands.length === 1 ? "" : "s"}` : ""}
                </Typography>
                <PeriodBar interval={c.interval}/>
                <CardFormats c={c} verdict={verdict}/>
                {!!c.keywords?.length && <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1}}>
                    {c.keywords.slice(0, 5).map((k) => <Chip key={k} label={k} variant="outlined" sx={{height: 20, fontSize: 11}}/>)}
                </Box>}
            </CardActionArea>
        </Card>
    );
}

export function BrowsePanel() {
    const s = useExplorer();
    const f = s.collectionFilters;
    const listed = useMemo(() => sorted(s.collections.filter((c) => matches(c, f.text)), f.sort), [s.collections, f.text, f.sort]);
    // Formats: what each listed collection is known to have (item_assets, else the item read).
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
    // Only a known no-match is hidden; the unsure ones follow the matches, dimmed.
    const shown = useMemo(() => {
        if (!wanted.length) return listed;
        const kept = listed.filter((c) => verdicts.get(c.id) !== "no-match");
        return [...kept.filter((c) => verdicts.get(c.id) === "match"), ...kept.filter((c) => verdicts.get(c.id) !== "match")];
    }, [listed, verdicts, wanted]);
    const tally = {match: 0, unsure: 0, hidden: 0};
    for (const v of verdicts.values()) if (v) { if (v === "match") tally.match++; else if (v === "no-match") tally.hidden++; else tally.unsure++; }
    const declared = s.collections.filter((c) => c.mediaTypeSource === "item_assets").length;
    const sampledOk = s.collections.filter((c) => c.mediaTypeSource === "none" && typeof s.sampled[c.id] === "object").length;
    const unread = s.collections.filter((c) => c.mediaTypeSource === "none" && !s.sampled[c.id]).map((c) => c.id);
    const reading = Object.values(s.sampled).filter((r) => r === "reading").length;
    const [mode, setMode] = usePeriodMode();
    if (!s.client) {
        return (
            <Stack spacing={2} sx={{p: 2}}>
                {s.error ? <Alert severity="error"><strong>{explainError(s.error).title}</strong><br/>{explainError(s.error).hint}</Alert>
                    : <Typography color="text.secondary">Paste the URL of any STAC API, static catalog or collection above, or pick one of the suggestions.</Typography>}
                {s.connecting && <LinearProgress/>}
            </Stack>
        );
    }
    const step = s.serverStep;
    return (
        <Box sx={{display: "flex", flexDirection: "column", flex: 1, minHeight: 0}}>
        <Stack spacing={1.5} sx={{p: 2, pb: 1.5, borderBottom: 1, borderColor: "divider", flex: "none"}}>
            <AreaChooser value={f.area} onChange={(area) => explorer.setCollectionFilters({area})} worldNote="Every collection, wherever its data is."/>
            <TimeRangePicker value={toValue(f)} onChange={(v) => explorer.setCollectionFilters(fromValue(v))} labels={["Data from", "Data to"]}
                domain={domainOf(s.sourceExtent)} mode={mode} onModeChange={setMode}/>
            <FormatPicker options={options} unit="collection" value={f.formats} onChange={(formats) => explorer.setCollectionFilters({formats})} caption={<>
                Formats known for {declared + sampledOk} of {s.collections.length} collections ({declared} declared, {sampledOk} from one item{reading ? `, ${reading} being read` : ""}).
                {unread.length > 0 && <>{" "}<Link component="button" variant="caption" onClick={() => explorer.sampleCollections(unread)}>Check the other {unread.length}</Link> (one request each)</>}
                {f.formats.length > 0 && " Only collections known to lack them are hidden."}
            </>}/>
            <FormControlLabel control={<Switch size="small" checked={f.regional} onChange={(e) => explorer.setCollectionFilters({regional: e.target.checked})}/>}
                label={<Typography variant="body2">Hide global collections</Typography>}/>
            {s.collectionsLoading && <LinearProgress/>}
            <Box sx={{display: "flex", alignItems: "center", gap: 1}}>
            <Typography variant="caption" color="text.secondary" role="status" aria-live="polite" sx={{flex: 1}}>
                <strong>{shown.length}</strong> of {s.allCollections} collections
                {step && !step.error && ` · the server kept ${step.count} (${step.sent.join(" and ")}), then the filters ran here`}
                {step?.error && " · the server could not filter: all filtered here"}
                {f.formats.length > 0 && ` · formats: ${tally.match} match, ${tally.unsure} not sure, ${tally.hidden} hidden`}
                {s.client.capabilities.staticCatalog && " · static catalog: crawled"}
                {s.collectionsAt && ` · read ${new Date(s.collectionsAt).toLocaleTimeString()}`}
            </Typography>
            <Tooltip title="Read the collections again from the server (same filters)">
                <span><IconButton size="small" aria-label="Reload collections" disabled={s.collectionsLoading} onClick={() => void explorer.reloadCollections()}><RefreshIcon fontSize="small"/></IconButton></span>
            </Tooltip>
            </Box>
            {!shown.length && !s.collectionsLoading && (
                <Alert severity="info" action={<Box>
                    {f.area !== "world" && <Button color="inherit" onClick={() => explorer.setCollectionFilters({area: "world"})}>The world</Button>}
                    {(f.from || f.to || f.except.length > 0) && <Button color="inherit" onClick={() => explorer.setCollectionFilters({from: "", to: "", except: []})}>Any period</Button>}
                    {f.text && <Button color="inherit" onClick={() => explorer.setCollectionFilters({text: ""})}>Clear text</Button>}
                    {f.formats.length > 0 && <Button color="inherit" onClick={() => explorer.setCollectionFilters({formats: []})}>Any format</Button>}
                </Box>}>No collection matches here.</Alert>
            )}
            {/* Find and order: as you type, on the list already read (no request). */}
            <Stack direction="row" spacing={1}>
                <TextField placeholder="Find: title, id, keywords, description" value={f.text} fullWidth
                    onChange={(e) => explorer.setCollectionFilters({text: e.target.value})}
                    slotProps={{input: {startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small"/></InputAdornment>,
                        "aria-label": "Find collections"}}}/>
                <TextField select label="Sort" value={f.sort} onChange={(e) => explorer.setCollectionFilters({sort: e.target.value as CollectionSort})} sx={{width: 170, flex: "none"}}>
                    <MenuItem value="server">Server order</MenuItem>
                    <MenuItem value="name-asc">Name A–Z</MenuItem>
                    <MenuItem value="name-desc">Name Z–A</MenuItem>
                    <MenuItem value="newest">Newest data first</MenuItem>
                    <MenuItem value="oldest">Oldest data first</MenuItem>
                </TextField>
            </Stack>
        </Stack>
        <Box sx={{flex: 1, overflow: "auto", minHeight: 0, p: 2, pt: 1.5}}>
            <Stack spacing={1}>{shown.slice(0, 300).map((c) => <CollectionCard key={c.id} c={c} verdict={verdicts.get(c.id) ?? null}/>)}</Stack>
            {shown.length > 300 && <Typography variant="caption" color="text.secondary" component="div" sx={{mt: 1}}>Showing 300: narrow the list with the text search.</Typography>}
        </Box>
        </Box>
    );
}
