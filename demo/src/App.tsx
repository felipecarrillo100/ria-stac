import {Component, useEffect, useRef, type ReactNode} from "react";
import {Alert, Badge, Button} from "@mui/material";
import {Box, Tab, Tabs} from "@mui/material";
import {TopBar} from "./TopBar.js";
import {MapPanel} from "./MapPanel.js";
import {DetailsDrawer} from "./DetailsDrawer.js";
import {RequestsDrawer} from "./RequestsDrawer.js";
import {BrowsePanel} from "./panels/BrowsePanel.js";
import {SearchPanel} from "./panels/SearchPanel.js";
import {ResultsPanel} from "./panels/ResultsPanel.js";
import {explorer, useExplorer, type Step} from "./state/explorer.js";
import type {StacMap} from "./map/StacMap.js";

/** One panel failing shows its error and a way back, instead of a blank page. */
class Guard extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
    state = {error: null as Error | null};
    static getDerivedStateFromError(error: Error) { return {error}; }
    render() {
        if (!this.state.error) return this.props.children;
        return <Alert severity="error" sx={{m: 2}} action={<Button color="inherit" onClick={() => this.setState({error: null})}>Retry</Button>}>
            The {this.props.name} could not be shown: {this.state.error.message}</Alert>;
    }
}

export function App() {
    const s = useExplorer();
    const map = useRef<StacMap | null>(null);
    // A source in the page URL (?source=…) connects at once, so a link opens the same server.
    useEffect(() => {
        const source = new URLSearchParams(location.search).get("source");
        if (source) void explorer.connect(source);
    }, []);
    // Zoom to a collection when it is chosen.
    useEffect(() => {
        const b = s.collection?.bbox;
        if (b && b[2] - b[0] < 359) map.current?.fit(b);
    }, [s.collection?.id]);
    const tab: Step = s.step === "catalog" ? "collections" : s.step;
    return (
        <Box sx={{display: "flex", flexDirection: "column", height: "100%"}}>
            <TopBar/>
            <Box sx={{display: "flex", flex: 1, minHeight: 0}}>
                <Box component="nav" aria-label="Find data" sx={{width: 430, flex: "none", borderRight: 1, borderColor: "divider", display: "flex", flexDirection: "column", bgcolor: "background.paper", minHeight: 0}}>
                    <Tabs value={tab} onChange={(_e, v: Step) => explorer.setStep(v)} variant="fullWidth">
                        <Tab value="collections" label="1  Browse"/>
                        <Tab value="search" label={<Badge variant="dot" color="warning" invisible={!(s.dirty && !s.autoUpdate)}>2  Search</Badge>} disabled={!s.collection}/>
                        <Tab value="results" label={`3  Results${s.pages.at(-1)?.matched ? ` (${s.pages.at(-1)!.matched!.value.toLocaleString()})` : s.items.length ? ` (${s.items.length})` : ""}`} disabled={!s.pages.length && !s.searching}/>
                    </Tabs>
                    {/* Each panel keeps its header in place and scrolls only its data. */}
                    <Box sx={{flex: 1, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column"}}>
                        <Guard name={tab} key={tab}>
                            {tab === "collections" && <BrowsePanel/>}
                            {tab === "search" && <SearchPanel/>}
                            {tab === "results" && <ResultsPanel/>}
                        </Guard>
                    </Box>
                </Box>
                {/* The details float over the map: opening them does not change the map view (nor a "Map view" search). */}
                <Box sx={{position: "relative", flex: 1, minWidth: 0, display: "flex"}}>
                    <MapPanel onMap={(m) => { map.current = m; }}/>
                    <Box sx={{position: "absolute", top: 0, right: 0, bottom: 0, display: "flex", zIndex: 2, boxShadow: s.details ? 6 : 0}}>
                        <Guard name="details" key={`${s.details}:${s.selectedItem}:${s.collection?.id}`}><DetailsDrawer onZoom={(b) => map.current?.fit(b)}/></Guard>
                    </Box>
                </Box>
            </Box>
            <RequestsDrawer/>
        </Box>
    );
}
