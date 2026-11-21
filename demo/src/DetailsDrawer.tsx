import {useState} from "react";
import {Box, Button, Chip, Divider, IconButton, Link, Stack, Tab, Table, TableBody, TableCell, TableRow, Tabs, Tooltip, Typography} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ZoomInMapIcon from "@mui/icons-material/ZoomInMap";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LockIcon from "@mui/icons-material/Lock";
import {assetBands, assetMediaType, isDataAsset, itemKey, nameBands, resolveAsset, type StacItemJson} from "ria-stac";
import {explorer, useExplorer} from "./state/explorer.js";
import {formatOf} from "./formats.js";
import {dateOf, fmtBbox, itemBbox, thumbnailOf} from "./util.js";

/** Properties grouped by extension prefix (eo:, proj:, sat:, view:, ...), core ones first. */
function groups(props: Record<string, unknown>): [string, [string, unknown][]][] {
    const by = new Map<string, [string, unknown][]>();
    for (const [k, v] of Object.entries(props)) {
        const g = k.includes(":") ? k.split(":")[0] : "core";
        by.set(g, [...(by.get(g) ?? []), [k, v]]);
    }
    const label: Record<string, string> = {core: "General", eo: "Electro-optical", proj: "Projection", sat: "Satellite", view: "View geometry",
        sar: "SAR", processing: "Processing", raster: "Raster", s2: "Sentinel-2", landsat: "Landsat", grid: "Grid", mgrs: "MGRS", storage: "Storage"};
    return [...by].sort(([a], [b]) => (a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b))).map(([g, kv]) => [label[g] ?? g, kv]);
}

const show = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : JSON.stringify(v));

function Metadata({props}: { props: Record<string, unknown> }) {
    return (
        <Stack spacing={1.5}>
            {groups(props).map(([g, kv]) => (
                <Box key={g}>
                    <Typography variant="overline" color="text.secondary">{g}</Typography>
                    <Table size="small"><TableBody>{kv.map(([k, v]) => (
                        <TableRow key={k}>
                            <TableCell sx={{color: "text.secondary", width: "42%", fontFamily: "JetBrains Mono, monospace", fontSize: 11, verticalAlign: "top"}}>{k}</TableCell>
                            <TableCell sx={{fontSize: 12, wordBreak: "break-word"}}>{show(v).slice(0, 400)}</TableCell>
                        </TableRow>
                    ))}</TableBody></Table>
                </Box>
            ))}
        </Stack>
    );
}

function Json({doc}: { doc: unknown }) {
    const text = JSON.stringify(doc, null, 2);
    return (
        <Box>
            <Button startIcon={<ContentCopyIcon fontSize="small"/>} onClick={() => void navigator.clipboard.writeText(text)}>Copy JSON</Button>
            <Box component="pre" sx={{fontFamily: "JetBrains Mono, monospace", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", m: 0, mt: 1, color: "text.secondary"}}>{text}</Box>
        </Box>
    );
}

function Links({links}: { links?: { rel: string; href: string; title?: string; type?: string }[] }) {
    return (
        <Stack spacing={0.75}>{(links ?? []).map((l, i) => (
            <Box key={i}><Chip label={l.rel} sx={{mr: 1}}/><Link href={l.href} target="_blank" rel="noreferrer" variant="caption" sx={{wordBreak: "break-all"}}>{l.title ?? l.href}</Link></Box>
        ))}</Stack>
    );
}

function Assets({item}: { item: StacItemJson }) {
    const named = nameBands(Object.keys(item.assets).filter((k) => isDataAsset(k, item.assets[k])).map((key) => ({key, bands: assetBands(item.assets[key], item)})), {itemId: item.id});
    const names = new Map(named.map((a) => [a.key, a.bands]));
    const byRole = new Map<string, string[]>();
    for (const [k, a] of Object.entries(item.assets)) {
        const role = isDataAsset(k, a) ? "Data" : a.roles?.includes("thumbnail") || a.roles?.includes("overview") ? "Previews" : "Metadata and other";
        byRole.set(role, [...(byRole.get(role) ?? []), k]);
    }
    return (
        <Stack spacing={2}>{["Data", "Previews", "Metadata and other"].filter((r) => byRole.has(r)).map((role) => (
            <Box key={role}>
                <Typography variant="overline" color="text.secondary">{role} · {byRole.get(role)!.length}</Typography>
                <Stack spacing={1} divider={<Divider flexItem/>}>{byRole.get(role)!.map((k) => {
                    const a = item.assets[k];
                    const access = resolveAsset(item, k);
                    const open = access.readable === "yes";
                    const bands = names.get(k);
                    return (
                        <Box key={k}>
                            <Box sx={{display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap"}}>
                                <Typography variant="body2" sx={{fontWeight: 600, fontFamily: "JetBrains Mono, monospace", fontSize: 12, wordBreak: "break-all"}}>{k}</Typography>
                                <Tooltip title={assetMediaType(a).mediaType ?? "no media type"}><Chip label={formatOf(assetMediaType(a).mediaType)} color="primary" variant="outlined"/></Tooltip>
                                {(a.roles ?? []).map((r) => <Chip key={r} label={r} variant="outlined"/>)}
                            </Box>
                            {a.title && <Typography variant="caption" color="text.secondary" component="div">{a.title}</Typography>}
                            {!!bands?.length && <Typography variant="caption" component="div">
                                Bands: {bands.map((b) => `${b.name}${b.aliases.length ? ` (${b.aliases.join(", ")})` : ""}`).join(" · ")}</Typography>}
                            <Box sx={{display: "flex", alignItems: "center", gap: 1, mt: 0.5}}>
                                <Tooltip title={access.reason ?? (access.readable === "signed" ? "Needs a token, added when read" : "Open access")}>
                                    <Chip icon={open ? <LockOpenIcon/> : <LockIcon/>} color={open ? "success" : "warning"} variant="outlined"
                                        label={open ? "Open" : access.readable === "signed" ? "Token needed" : access.reason ?? access.readable}/>
                                </Tooltip>
                                <IconButton size="small" aria-label={`Copy URL of ${k}`} onClick={() => void navigator.clipboard.writeText(a.href)}><ContentCopyIcon fontSize="inherit"/></IconButton>
                                <Link href={a.href} target="_blank" rel="noreferrer" variant="caption">Open</Link>
                            </Box>
                        </Box>
                    );
                })}</Stack>
            </Box>
        ))}</Stack>
    );
}

export function DetailsDrawer({onZoom}: { onZoom: (b: [number, number, number, number]) => void }) {
    const s = useExplorer();
    const [tab, setTab] = useState(0);
    const item = s.details === "item" ? s.items.find((i) => itemKey(i) === s.selectedItem) : undefined;
    const collection = s.details === "collection" ? s.collection : null;
    if (!item && !collection) return null;
    const doc = item ?? collection!.raw;
    const thumb = thumbnailOf(doc as never);
    const bbox = item ? itemBbox(item) : collection!.bbox;
    const tabs = item ? ["Overview", "Metadata", "Assets", "Links", "JSON"] : ["Overview", "Metadata", "Links", "JSON"];
    const t = Math.min(tab, tabs.length - 1);
    return (
        <Box sx={{width: 400, flex: "none", borderLeft: 1, borderColor: "divider", display: "flex", flexDirection: "column", bgcolor: "background.paper", minHeight: 0}}>
            <Box sx={{p: 2, pb: 0, display: "flex", gap: 1}}>
                <Box sx={{flex: 1, minWidth: 0}}>
                    <Typography variant="caption" color="text.secondary">{item ? "Item" : "Collection"}</Typography>
                    <Typography variant="subtitle2" sx={{wordBreak: "break-word"}}>{item ? item.id : collection!.title ?? collection!.id}</Typography>
                </Box>
                <IconButton aria-label="Close details" onClick={() => explorer.showDetails(null)}><CloseIcon/></IconButton>
            </Box>
            <Tabs value={t} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{px: 1}}>{tabs.map((l) => <Tab key={l} label={l}/>)}</Tabs>
            <Divider/>
            <Box sx={{p: 2, overflow: "auto", flex: 1}}>
                {tabs[t] === "Overview" && (
                    <Stack spacing={1.5}>
                        {thumb && <img src={thumb} alt="Preview" style={{width: "100%", borderRadius: 8}}/>}
                        {item ? <Typography variant="body2">{dateOf(item).replace("T", " ").slice(0, 19)} · {item.collection}</Typography>
                            : <Typography variant="body2" color="text.secondary" sx={{whiteSpace: "pre-wrap"}}>{(collection!.description ?? "").slice(0, 800)}</Typography>}
                        {collection?.license && <Typography variant="caption">License: {collection.license}</Typography>}
                        {bbox && <Box sx={{display: "flex", alignItems: "center", gap: 1}}>
                            <Typography variant="caption" sx={{fontFamily: "JetBrains Mono, monospace"}}>{fmtBbox(bbox)}</Typography>
                            <Button size="small" startIcon={<ZoomInMapIcon fontSize="small"/>} onClick={() => onZoom(bbox)}>Zoom to</Button>
                        </Box>}
                        {collection && !!collection.assets.length && <Box>
                            <Typography variant="overline" color="text.secondary">Item assets</Typography>
                            {collection.assets.map((a) => <Typography key={a.key} variant="caption" component="div">
                                <strong>{a.key}</strong> · {formatOf(a.mediaType)}{a.bands.some((b) => b.commonName ?? b.name) ? ` · ${a.bands.map((b) => b.commonName ?? b.name).filter(Boolean).join(", ")}` : ""}</Typography>)}
                        </Box>}
                    </Stack>
                )}
                {tabs[t] === "Metadata" && <Metadata props={item ? item.properties as Record<string, unknown> : Object.fromEntries(Object.entries(collection!.raw).filter(([k]) => !["links", "assets", "item_assets", "extent", "description"].includes(k)))}/>}
                {tabs[t] === "Assets" && item && <Assets item={item}/>}
                {tabs[t] === "Links" && <Links links={(doc as {links?: never}).links}/>}
                {tabs[t] === "JSON" && <Json doc={doc}/>}
            </Box>
        </Box>
    );
}
