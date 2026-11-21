import {useEffect, useState} from "react";
import {AppBar, Autocomplete, Badge, Box, Button, Chip, CircularProgress, IconButton, TextField, Toolbar, Tooltip, Typography} from "@mui/material";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import {ENDPOINTS} from "./endpoints.js";
import {explorer, useExplorer} from "./state/explorer.js";

const RECENT_KEY = "stac-explorer:recent";
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };
const saveRecent = (urls: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(urls.slice(0, 8))); } catch { /* private mode */ } };

interface Option { url: string; label: string; group: string; note?: string }

/** Any URL the user gives; the known servers and recent URLs are suggestions only. */
function SourceBox() {
    const s = useExplorer();
    const [text, setText] = useState(s.url);
    const [recent, setRecent] = useState(loadRecent);
    useEffect(() => setText(s.url), [s.url]);
    const options: Option[] = [
        ...recent.map((url) => ({url, label: url, group: "Recent"})),
        ...ENDPOINTS.filter((e) => !recent.includes(e.url)).map((e) => ({url: e.url, label: e.label, group: e.group, note: e.note})),
    ];
    const connect = (url: string) => {
        const u = url.trim();
        if (!u) return;
        const next = [u, ...recent.filter((r) => r !== u)];
        setRecent(next);
        saveRecent(next);
        const params = new URLSearchParams(location.search);
        params.set("source", u);
        history.replaceState(null, "", `?${params}`);
        void explorer.connect(u);
    };
    return (
        <Box component="form" onSubmit={(e) => { e.preventDefault(); connect(text); }} sx={{display: "flex", gap: 1, alignItems: "center", flex: "1 1 560px", maxWidth: 720}}>
            <Autocomplete<Option, false, false, true>
                freeSolo fullWidth options={options} groupBy={(o) => o.group}
                getOptionLabel={(o) => (typeof o === "string" ? o : o.url)}
                filterOptions={(opts, {inputValue}) => opts.filter((o) => `${o.label} ${o.url}`.toLowerCase().includes(inputValue.toLowerCase()) || inputValue === s.url)}
                inputValue={text} onInputChange={(_e, v) => setText(v)}
                onChange={(_e, v) => { if (v) connect(typeof v === "string" ? v : v.url); }}
                renderOption={(props, o) => (
                    <Box component="li" {...props} key={`${o.group}:${o.url}`} sx={{display: "block !important"}}>
                        <Typography variant="body2" sx={{fontWeight: 600}}>{o.label}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{wordBreak: "break-all"}}>{o.note ? `${o.note} · ` : ""}{o.url}</Typography>
                    </Box>
                )}
                renderInput={(params) => <TextField {...params} placeholder="Paste any STAC API, catalog or collection URL" aria-label="STAC source URL"/>}
            />
            <Button type="submit" variant="contained" disabled={s.connecting || !text.trim()} sx={{flex: "none"}}>
                {s.connecting ? <CircularProgress size={16} color="inherit"/> : "Connect"}
            </Button>
        </Box>
    );
}

/** What the server declares (and what the client saw it do), greyed when unsupported. */
function Capabilities() {
    const {client} = useExplorer();
    if (!client) return null;
    const c = client.capabilities, p = client.profile;
    const chips: [string, boolean, string][] = c.staticCatalog
        ? [["Static catalog", true, "Crawled through its links and filtered in the browser"]]
        : [
            ["Item search", c.itemSearch, "STAC API Item Search: searches across collections"],
            ["Collection search", c.collectionSearch, "Filters collections on the server by area and period"],
            ["CQL2", !!c.filter, c.filter ? `Filter extension: ${[c.filter.cql2Json && "JSON", c.filter.cql2Text && "text"].filter(Boolean).join(" and ")}` : "No CQL2 filtering: filters run here, or through the Query extension"],
            ["Query", c.query, "The older Query extension for property filters"],
            ["Sort", c.sort, "Results can be sorted by the server"],
            ["Free text", c.freeText, "Free-text search (q)"],
        ];
    return (
        <Box sx={{display: "flex", gap: 0.5, flexWrap: "wrap"}} aria-label="Server capabilities">
            {chips.map(([label, on, tip]) => (
                <Tooltip key={label} title={tip}><Chip label={label} variant={on ? "filled" : "outlined"} color={on ? "primary" : "default"}
                    sx={on ? {bgcolor: "rgba(56,189,248,0.14)", color: "primary.light"} : {color: "text.disabled"}}/></Tooltip>
            ))}
            {p.filterApplied === "ignored" && <Tooltip title="The server declares CQL2 but returned items that do not match: filters now run here"><Chip color="warning" label="CQL2 ignored"/></Tooltip>}
            {p.maxLimit && <Tooltip title="The largest page the server accepted"><Chip color="warning" variant="outlined" label={`Pages ≤ ${p.maxLimit}`}/></Tooltip>}
        </Box>
    );
}

export function TopBar() {
    const s = useExplorer();
    // Requests the explorer cancelled (an auto update replacing a search) are not failures.
    const failed = s.requests.filter((r) => (r.status === undefined && !/abort/i.test(r.error ?? "")) || (r.status ?? 0) >= 400).length;
    return (
        <AppBar position="static" color="default" elevation={0} sx={{borderBottom: 1, borderColor: "divider", bgcolor: "background.paper"}}>
            <Toolbar variant="dense" sx={{gap: 2, py: 1, flexWrap: "wrap"}}>
                <Box sx={{display: "flex", alignItems: "center", gap: 1, flex: "none"}}>
                    <TravelExploreIcon color="primary"/>
                    <Box>
                        <Typography variant="h6" sx={{lineHeight: 1.1}}>STAC Explorer</Typography>
                        <Typography variant="caption" color="text.secondary">ria-stac demo</Typography>
                    </Box>
                </Box>
                <SourceBox/>
                <Box sx={{flex: "1 1 auto", minWidth: 0}}>
                    {s.client && <Typography variant="caption" color="text.secondary" component="div" noWrap>
                        {String(s.client.landing.title ?? s.client.landing.id ?? s.client.url)}
                    </Typography>}
                    <Capabilities/>
                </Box>
                <Tooltip title="Requests the library made">
                    <IconButton onClick={() => explorer.toggleRequests()} aria-label="Show requests">
                        <Badge badgeContent={failed || s.requests.length} color={failed ? "error" : "default"} max={999}><SwapVertIcon/></Badge>
                    </IconButton>
                </Tooltip>
            </Toolbar>
        </AppBar>
    );
}
