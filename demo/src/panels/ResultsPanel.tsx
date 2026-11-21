import {useEffect} from "react";
import {Alert, Box, Button, ButtonGroup, Checkbox, Chip, FormControlLabel, LinearProgress, List, ListItemButton, Stack, Switch, Tooltip, Typography} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {itemKey, itemMediaTypes, type StacItemJson} from "ria-stac";
import {formatOf} from "../formats.js";
import {Thumbnail} from "../components/Thumbnail.js";
import {DISPLAY_PAGE, explorer, shownItems, useExplorer} from "../state/explorer.js";
import {cloudOf, dateOf, explainError, thumbnailOf} from "../util.js";

function formatsOf(item: StacItemJson): string[] {
    return [...new Set(itemMediaTypes(item).map(formatOf))];
}

function Row({item}: { item: StacItemJson }) {
    const s = useExplorer();
    const key = itemKey(item);
    const thumb = thumbnailOf(item as never);
    const cloud = cloudOf(item);
    const chosen = !!s.chosen[key];
    return (
        <ListItemButton id={`row-${key}`} selected={s.selectedItem === key}
            // A click on the row shows the item; selecting is the checkbox's job.
            onClick={() => explorer.selectItem(key)}
            onMouseEnter={() => explorer.hoverItem(key)} onMouseLeave={() => explorer.hoverItem(null)}
            sx={{gap: 1, alignItems: "flex-start", borderRadius: 1, pl: 0.5,
                ...(chosen ? {bgcolor: "rgba(56,189,248,0.08)"} : {}),
                ...(s.hoveredItem === key ? {outline: "1px solid", outlineColor: "warning.main"} : {})}}>
            <Checkbox size="small" checked={chosen} sx={{p: 0.5, mt: 1.25}} slotProps={{input: {"aria-label": `Select ${item.id}`}}}
                onClick={(e) => { e.stopPropagation(); explorer.toggleChosen(key); }}/>
            <Thumbnail src={thumb}/>
            <Box sx={{minWidth: 0, flex: 1}}>
                <Typography variant="body2" sx={{fontWeight: 600}}>{dateOf(item).replace("T", " ").slice(0, 16) || "no date"}</Typography>
                <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{fontFamily: "JetBrains Mono, monospace"}}>{item.id}</Typography>
                <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5}}>
                    {cloud !== undefined && <Chip label={`☁ ${cloud.toFixed(0)} %`} sx={{height: 20}}/>}
                    {formatsOf(item).slice(0, 4).map((f) => <Chip key={f} label={f} variant="outlined" sx={{height: 20}}/>)}
                </Box>
            </Box>
        </ListItemButton>
    );
}

export function ResultsPanel() {
    const s = useExplorer();
    const last = s.pages.at(-1);
    const matched = last?.matched;
    const shown = shownItems(s);
    const start = s.view * DISPLAY_PAGE;
    const more = s.hasMore && s.items.length < s.form.maxItems;
    const canNext = s.items.length > start + DISPLAY_PAGE || more;
    const chosenCount = Object.keys(s.chosen).length;
    const chosenHere = shown.filter((i) => s.chosen[itemKey(i)]).length;
    // An item picked on the map: scroll its row into view (its page is already shown).
    useEffect(() => {
        const key = s.reveal?.key;
        if (key) requestAnimationFrame(() => document.getElementById(`row-${key}`)?.scrollIntoView({block: "center"}));
    }, [s.reveal?.n, s.view]);
    const download = (which: "chosen" | "loaded") => {
        const blob = new Blob([JSON.stringify(explorer.itemCollection(which), null, 2)], {type: "application/geo+json"});
        const a = Object.assign(document.createElement("a"), {href: URL.createObjectURL(blob), download: `${s.collection?.id ?? "items"}.json`});
        a.click();
        URL.revokeObjectURL(a.href);
    };
    if (!s.items.length && !s.searching && !s.searchError && !s.pages.length) {
        return <Typography color="text.secondary" sx={{p: 2}}>Run a search to see items here.</Typography>;
    }
    return (
        <Stack sx={{flex: 1, minHeight: 0}}>
            <Box sx={{p: 2, pb: 1.5, borderBottom: 1, borderColor: "divider", flex: "none"}}>
                <Typography variant="body2" role="status" aria-live="polite">
                    {shown.length ? <>Items <strong>{start + 1}–{start + shown.length}</strong></> : "No items"}
                    {matched ? ` of ${matched.exact ? "" : "about "}${matched.value.toLocaleString()}` : s.hasMore ? " · more available" : shown.length ? ` of ${s.items.length}` : ""}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                    {s.items.length.toLocaleString()} loaded in {s.pages.length} request{s.pages.length === 1 ? "" : "s"}
                    {s.items.length >= s.form.maxItems && s.hasMore ? ` · stopped at Maximum items (${s.form.maxItems.toLocaleString()})` : ""}
                </Typography>
                <Stack direction="row" spacing={1} sx={{mt: 1, alignItems: "center", flexWrap: "wrap", rowGap: 1}}>
                    <Tooltip title="Run the same search again: the server may have new items">
                        <Button size="small" variant="outlined" startIcon={<RefreshIcon fontSize="small"/>} disabled={s.searching} onClick={() => explorer.reload()}>Search again</Button>
                    </Tooltip>
                    <Tooltip title="Search again by itself when the form or the map view changes">
                        <FormControlLabel sx={{mr: 0}} control={<Switch size="small" checked={s.autoUpdate} onChange={(e) => explorer.setAutoUpdate(e.target.checked)}/>}
                            label={<Typography variant="body2">Auto update</Typography>}/>
                    </Tooltip>
                    {s.fetchedAt && <Typography variant="caption" color="text.secondary">Updated {new Date(s.fetchedAt).toLocaleTimeString()}</Typography>}
                </Stack>
                {s.dirty && !s.autoUpdate && (
                    <Alert severity="warning" sx={{mt: 1}} action={<Button color="inherit" onClick={() => explorer.reload()}>Search again</Button>}>
                        The search changed since these results.</Alert>
                )}
                <Stack direction="row" spacing={1} sx={{mt: 1}}>
                    <ButtonGroup size="small" aria-label="Pages of results">
                        <Button startIcon={<ChevronLeftIcon/>} disabled={s.view === 0} onClick={() => explorer.previousPage()}>Previous</Button>
                        <Button endIcon={<ChevronRightIcon/>} disabled={!canNext || s.searching} onClick={() => void explorer.nextPage()}>Next {DISPLAY_PAGE}</Button>
                        <Button disabled={!s.searching} onClick={() => explorer.cancelSearch()}>Cancel</Button>
                    </ButtonGroup>
                    <Tooltip title={chosenCount ? "The selected items, as a GeoJSON item collection" : "Every item loaded so far, as a GeoJSON item collection"}><span>
                        <Button size="small" startIcon={<DownloadIcon fontSize="small"/>} disabled={!s.items.length} onClick={() => download(chosenCount ? "chosen" : "loaded")}>
                            Download {chosenCount ? `${chosenCount} selected` : s.items.length}</Button></span></Tooltip>
                </Stack>
                {!!shown.length && (
                    <Box sx={{display: "flex", alignItems: "center", gap: 0.5, mt: 1, ml: -0.5}}>
                        <Checkbox size="small" sx={{p: 0.5}} checked={chosenHere === shown.length} indeterminate={chosenHere > 0 && chosenHere < shown.length}
                            slotProps={{input: {"aria-label": "Select every item of this page"}}}
                            onChange={(e) => (e.target.checked ? explorer.chooseItems(shown) : explorer.unchoose(shown))}/>
                        <Typography variant="body2" sx={{flex: 1}}>
                            {chosenCount ? <><strong>{chosenCount}</strong> selected{chosenCount !== chosenHere ? ` (${chosenHere} on this page)` : ""}</> : "Select this page"}
                        </Typography>
                        {chosenCount > 0 && <Button size="small" onClick={() => explorer.unchoose()}>Clear</Button>}
                    </Box>
                )}
                <Typography variant="caption" color="text.secondary" component="div">
                    List: tick to select, click a row to see it. Map: click selects, Shift-click adds, a click where there is no data clears.</Typography>
                {s.searching && <LinearProgress sx={{mt: 1}}/>}
                {s.searchError && <Alert severity="error" sx={{mt: 1}}><strong>{explainError(s.searchError).title}</strong><br/>{explainError(s.searchError).hint}</Alert>}
                {!s.items.length && !s.searching && !s.searchError && (
                    <Alert severity="info" sx={{mt: 1}} action={<Stack>
                        {s.form.area !== "world" && <Button color="inherit" onClick={() => { explorer.setForm({area: "world"}); void explorer.runSearch(); }}>Search the world</Button>}
                        {(s.form.from || s.form.to) && <Button color="inherit" onClick={() => { explorer.setForm({from: "", to: ""}); void explorer.runSearch(); }}>Any period</Button>}
                        {s.form.maxCloud !== null && <Button color="inherit" onClick={() => { explorer.setForm({maxCloud: null}); void explorer.runSearch(); }}>Any cloud cover</Button>}
                        {!!s.form.formats.length && <Button color="inherit" onClick={() => { explorer.setForm({formats: []}); void explorer.runSearch(); }}>Any format</Button>}
                    </Stack>}>No item matches. Widen the search:</Alert>
                )}
            </Box>
            <List dense sx={{px: 1, overflow: "auto", flex: 1, minHeight: 0, opacity: s.searching && s.pages.length === 0 ? 0.45 : 1, transition: "opacity .2s"}}>
                {shown.map((item) => <Row key={itemKey(item)} item={item}/>)}
            </List>
        </Stack>
    );
}
