import {useEffect, useRef, useState} from "react";
import {Box, Button, Paper, Tooltip, Typography} from "@mui/material";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import {bboxesIntersect} from "ria-stac";
import {itemBbox} from "./util.js";
import {StacMap} from "./map/StacMap.js";
import {areaOf, DISPLAY_PAGE, explorer, shownItems, useExplorer} from "./state/explorer.js";
import {palette} from "./theme.js";
import {useBrowseList} from "./state/browseList.js";

/** The map, kept in step with the explorer: extents, footprints, hover and selection both ways, the area. */
export function MapPanel({onMap}: { onMap: (m: StacMap) => void }) {
    const node = useRef<HTMLDivElement>(null);
    const ref = useRef<StacMap | null>(null);
    const s = useExplorer();
    const [boxing, setBoxing] = useState(false);

    useEffect(() => {
        const m = new StacMap(node.current!, palette);
        ref.current = m;
        m.onViewChange = () => explorer.setView(m.viewBbox());
        m.onCollectionClick = (id) => void explorer.chooseCollection(id);
        // LuciadRIA's own selection is the shared one: the list follows it.
        m.onSelectionChange = (keys) => explorer.setMapSelection(keys);
        onMap(m);
        if (import.meta.env.DEV) Object.assign(window, {stacMap: m, explorer});
        // The map follows its container (the details drawer opens and closes beside it).
        let sized = false;
        const resize = new ResizeObserver(() => {
            m.map.resize();
            // The first real size: show the inhabited world. Any size change changes the map view.
            if (!sized && node.current!.clientWidth > 0) { sized = true; m.fit([-150, -50, 160, 70]); }
            window.setTimeout(() => explorer.setView(m.viewBbox()), 400);
        });
        resize.observe(node.current!);
        return () => { resize.disconnect(); m.destroy(); };
    }, []);

    // Collection extents while browsing, item footprints after a search.
    // The extents of the collections Browse lists (text search and format filter included), unsure ones faint.
    const browse = useBrowseList();
    useEffect(() => {
        const unsure = new Set(browse.unsure.map((c) => c.id));
        ref.current?.setExtents(s.step === "collections" || s.step === "catalog"
            ? browse.shown.filter((c) => c.bbox).map((c) => ({id: c.id, title: c.title ?? c.id, bbox: c.bbox!, faint: unsure.has(c.id)})) : []);
    }, [browse.shown, browse.unsure, s.step]);
    // The footprints of the display page shown, as in the list.
    const shown = shownItems(s);
    useEffect(() => { ref.current?.setItems(shown); }, [s.items, s.view]);
    useEffect(() => { ref.current?.hoverItem(s.hoveredItem); }, [s.hoveredItem]);
    useEffect(() => { ref.current?.hoverCollection(s.hoveredCollection); }, [s.hoveredCollection]);
    // The list's selection (ticks, ranges, a whole page) becomes the map's selection, for the footprints drawn.
    useEffect(() => { ref.current?.setSelection(Object.keys(s.chosen)); }, [s.chosen, s.items, s.view]);
    useEffect(() => { ref.current?.focusItem(s.selectedItem); }, [s.selectedItem, s.items, s.view]);
    // Box selection: every footprint of the page shown that the box touches is added to the selection.
    useEffect(() => {
        const m = ref.current;
        if (!m || !boxing) return;
        m.drawBox((box) => {
            setBoxing(false);
            if (box) explorer.chooseItems(shown.filter((i) => { const b = itemBbox(i); return b && bboxesIntersect(b, box); }));
        });
        return () => m.cancelDraw();
    }, [boxing]);
    const areaMode = s.step === "collections" || s.step === "catalog" ? s.collectionFilters.area : s.form.area;
    useEffect(() => { ref.current?.setArea(areaMode === "bbox" ? s.bbox : null); }, [areaMode, s.bbox]);
    useEffect(() => {
        const m = ref.current;
        if (!m || boxing) return;
        if (s.drawing) m.drawBox((b) => explorer.setBbox(b));
        else m.cancelDraw();
    }, [s.drawing]);
    // A place asked for from a list (a collection's extent in Browse).
    useEffect(() => { if (s.zoom) ref.current?.fit(s.zoom.bbox); }, [s.zoom]);
    // A whole-world search moves the map to what it found (the user may not know where the data is).
    useEffect(() => {
        if (s.pages.length === 1 && s.form.area === "world" && s.items.length) {
            const boxes = shown.map((i) => itemBbox(i)).filter((b): b is [number, number, number, number] => !!b);
            if (boxes.length) ref.current?.fit([Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]);
        }
    }, [s.pages.length]);

    const chosenCount = Object.keys(s.chosen).length;
    const hint = boxing ? "Drag a box: the footprints it touches are added to the selection." : s.drawing ? "Drag a box on the map to set the area."
        : s.step === "results" && !s.items.length && !s.searching && s.form.area !== "world" && !areaOf(s.form.area, s) ? "The view shows no ground: zoom in." : null;
    const last = s.pages.at(-1);
    return (
        <Box sx={{position: "relative", flex: 1, minWidth: 0}}>
            <Box ref={node} sx={{position: "absolute", inset: 0}}/>
            {s.dirty && !s.autoUpdate && s.step === "results" && s.form.area === "view" && !s.searching && (
                <Button variant="contained" onClick={() => explorer.reload()}
                    sx={{position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", boxShadow: 3}}>Search this area</Button>
            )}
            {hint && <Paper sx={{position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", px: 2, py: 1}}>
                <Typography variant="body2">{hint}</Typography></Paper>}
            {s.step === "results" && (s.items.length > 0 || s.searching) && (
                <Paper sx={{position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", px: 1.5, py: 0.75, display: "flex", gap: 1, alignItems: "center", whiteSpace: "nowrap", maxWidth: "calc(100% - 24px)", overflowX: "auto"}}>
                    <Typography variant="body2" sx={{mr: 1}}>{shown.length ? <>Items <strong>{s.view * DISPLAY_PAGE + 1}–{s.view * DISPLAY_PAGE + shown.length}</strong></> : "Loading…"}
                        {last?.matched ? ` of ${last.matched.value.toLocaleString()}` : s.hasMore ? ", more available" : ""}</Typography>
                    <Button disabled={s.view === 0} onClick={() => explorer.previousPage()}>Previous</Button>
                    <Button disabled={!(s.items.length > (s.view + 1) * DISPLAY_PAGE || (s.hasMore && s.items.length < s.form.maxItems)) || s.searching}
                        onClick={() => void explorer.nextPage()}>Next {DISPLAY_PAGE}</Button>
                    {s.searching && <Button color="warning" onClick={() => explorer.cancelSearch()}>Cancel</Button>}
                    {chosenCount > 0 && <>
                        <Typography variant="body2" sx={{ml: 1}}><strong>{chosenCount}</strong> selected</Typography>
                        <Button onClick={() => {
                            const boxes = Object.values(s.chosen).map(itemBbox).filter((b): b is [number, number, number, number] => !!b);
                            if (boxes.length) ref.current?.fit([Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]);
                        }}>Zoom to</Button>
                        <Button onClick={() => explorer.unchoose()}>Clear</Button>
                    </>}
                    <Tooltip title="Drag a box on the map to add the footprints it touches to the selection">
                        <Button startIcon={<HighlightAltIcon/>} variant={boxing ? "contained" : "text"} onClick={() => setBoxing(!boxing)}>Select in box</Button>
                    </Tooltip>
                </Paper>
            )}
        </Box>
    );
}
