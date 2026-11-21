import {useEffect, useRef} from "react";
import {Alert, Box, Button, Card, CardActionArea, Chip, FormControlLabel, IconButton, InputAdornment, LinearProgress, Link, MenuItem, Stack, Switch, TextField, Tooltip, Typography} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import {isGlobalBbox, type CollectionMediaTypes, type CollectionSummary, type MediaTypeMatch} from "ria-stac";
import PublicIcon from "@mui/icons-material/Public";
import ZoomInMapIcon from "@mui/icons-material/ZoomInMap";
import {explorer, useExplorer, type CollectionSort} from "../state/explorer.js";
import {useBrowseList} from "../state/browseList.js";
import {explainError, shortDate} from "../util.js";
import {AreaChooser} from "./AreaChooser.js";
import {TimeRangePicker} from "../components/TimeRangePicker.js";
import {domainOf, fromValue, toValue, usePeriodMode} from "../components/periodValue.js";
import {FormatPicker} from "./FormatPicker.js";
import {formatOf} from "../formats.js";

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
        <Card ref={ref} variant="outlined" sx={{opacity: verdict && verdict !== "match" ? 0.6 : 1, borderWidth: 1.5, bgcolor: "transparent", position: "relative",
            // A border that stands out from the panel; amber on hover, sky for the chosen collection.
            borderColor: active ? "primary.main" : s.hoveredCollection === c.id ? "warning.main" : "rgba(148,163,184,0.45)"}}
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
            {/* Where it is, without choosing it: outside the card's own button. */}
            {c.bbox && (
                <Tooltip title={isGlobalBbox(c.bbox) ? "Show the world (its extent is global)" : "Show where it is on the map"}>
                    <IconButton size="small" aria-label={`Show ${c.title ?? c.id} on the map`} onClick={() => explorer.zoomTo(c.bbox!)}
                        sx={{position: "absolute", bottom: 6, right: 6, bgcolor: "background.paper", "&:hover": {bgcolor: "action.hover"}}}>
                        <ZoomInMapIcon fontSize="small"/>
                    </IconButton>
                </Tooltip>
            )}
        </Card>
    );
}

export function BrowsePanel() {
    const s = useExplorer();
    const f = s.collectionFilters;
    const {shown, unsure, showUnsure, verdicts, tally, options} = useBrowseList();
    const matched = showUnsure ? shown.slice(0, shown.length - unsure.length) : shown;
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
            <FormatPicker options={options} unit="collection" scope={`in ${s.collections.length} collection${s.collections.length === 1 ? "" : "s"}`} value={f.formats} onChange={(formats) => explorer.setCollectionFilters({formats})} caption={<>
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
                {f.formats.length > 0 && ` · ${tally.unsure} not sure (${showUnsure ? "shown, dimmed" : "hidden"}) · ${tally.hidden} without ${f.formats.join(" or ")}`}
                {s.client.capabilities.staticCatalog && " · static catalog: crawled"}
                {s.collectionsAt && ` · read ${new Date(s.collectionsAt).toLocaleTimeString()}`}
            </Typography>
            <Tooltip title="Read the collections again from the server (same filters)">
                <span><IconButton size="small" aria-label="Reload collections" disabled={s.collectionsLoading} onClick={() => void explorer.reloadCollections()}><RefreshIcon fontSize="small"/></IconButton></span>
            </Tooltip>
            </Box>
            {!shown.length && !unsure.length && !s.collectionsLoading && (
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
            <Stack spacing={1}>
                {matched.slice(0, 300).map((c) => <CollectionCard key={c.id} c={c} verdict={verdicts.get(c.id) ?? null}/>)}
                {unsure.length > 0 && (
                    <Box sx={{border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1, p: 1.25}}>
                        <Typography variant="body2">{unsure.length} more might have {f.formats.join(" or ")}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                            Not seen in the one item read, or not read yet: their other items may differ.{" "}
                            <Link component="button" variant="caption" onClick={() => explorer.setCollectionFilters({showUnsure: !showUnsure})}>{showUnsure ? "Hide them" : "Show them"}</Link>
                        </Typography>
                    </Box>
                )}
                {showUnsure && unsure.slice(0, 300).map((c) => <CollectionCard key={c.id} c={c} verdict={verdicts.get(c.id) ?? null}/>)}
            </Stack>
            {shown.length > 300 && <Typography variant="caption" color="text.secondary" component="div" sx={{mt: 1}}>Showing 300: narrow the list with the text search.</Typography>}
        </Box>
        </Box>
    );
}
