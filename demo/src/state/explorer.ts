/**
 * The explorer's state and actions, outside React: one store, read with useExplorer(). Everything goes through
 * ria-stac's public API; nothing reads a data file.
 */
import {useSyncExternalStore} from "react";
import {fromText} from "ogc-cql2/parse";
import {
    itemKey, mediaTypesFilter, StacClient, toCql2Text, type Bbox, type CollectionDetails, type CollectionMediaTypes, type CollectionSummary, type Cql2Json,
    type DateRange, type TimeExtent, type RiaStacRequest, type SearchPage, type SearchPlan, type ServerCollectionSearch, type StacItemJson, type StacSearchRequest,
} from "ria-stac";
import {gem15LinkBbox} from "../endpoints.js";
import {formatOf, mediaTypesOf} from "../formats.js";

export type Step = "catalog" | "collections" | "search" | "results";

/** Where to look: the whole world, the map view (follows the map), or a box the user drew or typed. */
export type AreaMode = "world" | "view" | "bbox";
/** How the collection list is ordered (in the browser, the same on every server). */
export type CollectionSort = "server" | "name-asc" | "name-desc" | "newest" | "oldest";
/** A left-out period: RFC 3339 UTC, null for an open end. */
export interface ExceptSpan { from: string | null; to: string | null }
export interface CollectionFilters {
    area: AreaMode; regional: boolean; from: string; to: string; except: ExceptSpan[]; text: string; sort: CollectionSort; formats: string[];
    /** With a format filter: also show the collections that might have the formats (not seen, not read yet). */
    showUnsure: boolean;
}
export interface SearchForm {
    area: AreaMode;
    from: string;
    to: string;
    except: ExceptSpan[];
    maxCloud: number | null;
    formats: string[];
    cql2: string;
    sort: "" | "datetime-desc" | "datetime-asc" | "cloud-asc";
    maxItems: number;
}

export interface ExplorerState {
    step: Step;
    url: string;
    connecting: boolean;
    error: string | null;
    client: StacClient | null;
    collections: CollectionSummary[];
    allCollections: number;
    collectionsLoading: boolean;
    serverStep: ServerCollectionSearch | null;
    collectionFilters: CollectionFilters;
    collection: CollectionDetails | null;
    collectionLoading: boolean;
    /** The chosen collection's media types (item_assets, else items read): Search's format choice. */
    mediaTypes: CollectionMediaTypes | null;
    /**
     * Media types read from items, per collection without item_assets (Browse samples the cards in view): the
     * result, or that it is being read or failed.
     */
    sampled: Record<string, CollectionMediaTypes | "reading" | "failed">;
    form: SearchForm;
    plan: SearchPlan | null;
    cql2Error: string | null;
    items: StacItemJson[];
    pages: SearchPage[];
    searching: boolean;
    searchError: string | null;
    hasMore: boolean;
    /** The item whose details are shown (focused), by itemKey; a click on a row or a footprint. */
    selectedItem: string | null;
    /**
     * The chosen items, by itemKey: one selection shared by the list and the map, kept across display pages and
     * searches (the items are kept with it, so a new search does not lose them).
     */
    chosen: Record<string, StacItemJson>;
    /** An item the list should scroll to (and its page show), with a counter so the same item can be asked again. */
    reveal: { key: string; n: number } | null;
    hoveredItem: string | null;
    hoveredCollection: string | null;
    /** A place the map should show (a collection's extent from Browse), with a counter so the same place can be asked again. */
    zoom: { bbox: Bbox; n: number } | null;
    requests: RiaStacRequest[];
    viewBbox: Bbox | null;
    /** The bounding box of the "bbox" area mode (shared by Browse and Search). */
    bbox: Bbox | null;
    /** Drawing a bounding box on the map. */
    drawing: boolean;
    details: "collection" | "item" | null;
    requestsOpen: boolean;
    /** Re-run the search by itself when the form or the map view changes (debounced, the running one cancelled). */
    autoUpdate: boolean;
    /** The form (or the map view) differs from the last search: its results are out of date. */
    dirty: boolean;
    /** When the shown results were fetched (ms since the epoch). */
    fetchedAt: number | null;
    /** When the collections were read from the server. */
    collectionsAt: number | null;
    /** The display page shown in the list and on the map (0-based), of DISPLAY_PAGE items. */
    view: number;
    /** The dates of the items here (area and filters, any period): from the items where the server sorts, else declared. */
    dataRange: DateRange | null;
    dataRangeLoading: boolean;
    /** The times of all the source's collections (declared, widened by the items read): Browse's period limits. */
    sourceExtent: TimeExtent | null;
    /** The times of the chosen collection (its first and last items where the server sorts): Search's period limits. */
    collectionExtent: TimeExtent | null;
}

const initial: ExplorerState = {
    step: "catalog", url: "", connecting: false, error: null, client: null,
    collections: [], allCollections: 0, collectionsLoading: false, serverStep: null,
    collectionFilters: {area: "view", regional: false, from: "", to: "", except: [], text: "", sort: "server", formats: [], showUnsure: false},
    collection: null, collectionLoading: false, mediaTypes: null, sampled: {},
    form: {area: "view", from: "", to: "", except: [], maxCloud: null, formats: [], cql2: "", sort: "", maxItems: 5000},
    plan: null, cql2Error: null,
    items: [], pages: [], searching: false, searchError: null, hasMore: false,
    selectedItem: null, chosen: {}, reveal: null, hoveredItem: null, hoveredCollection: null, zoom: null, requests: [], viewBbox: null,
    bbox: null, drawing: false, details: null, requestsOpen: false,
    autoUpdate: true, dirty: false, fetchedAt: null, collectionsAt: null, dataRange: null, dataRangeLoading: false, view: 0,
    sourceExtent: null, collectionExtent: null,
};

/** A list's left-out periods as a request's `exceptDatetime`, or nothing. */
const exceptOf = (except: ExceptSpan[]) => (except.length ? {exceptDatetime: except.map((e) => [e.from, e.to] as [string | null, string | null])} : {});

/** Items per display page: the list and the map show this many at a time, whatever each server returns per request. */
export const DISPLAY_PAGE = 500;

/** The items of the display page shown (the list and the map draw only these). */
export function shownItems(s: Pick<ExplorerState, "items" | "view">): StacItemJson[] {
    return s.items.slice(s.view * DISPLAY_PAGE, (s.view + 1) * DISPLAY_PAGE);
}

/** Items asked for per search page. Servers that accept fewer say so; the client lowers it and remembers. */
export const PAGE_SIZE = 500;

/** How many collections Browse reads an item of at once, to learn their formats. */
const SAMPLE_CONCURRENCY = 4;

/** Pause after the last change before an automatic search: one request when the user stops, not one per move. */
const AUTO_DELAY_MS = 800;
/** While a period is dragged: at most one search per this many milliseconds (the running one is cancelled). */
const LIVE_INTERVAL_MS = 600;

/** The area of a mode, or undefined for the whole world (or a mode without a box yet). */
export function areaOf(mode: AreaMode, s: Pick<ExplorerState, "viewBbox" | "bbox">): Bbox | undefined {
    if (mode === "view") return s.viewBbox ?? undefined;
    if (mode === "bbox") return s.bbox ?? undefined;
    return undefined;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Explorer {
    private state: ExplorerState = initial;
    private readonly listeners = new Set<() => void>();
    private search: AsyncGenerator<SearchPage> | null = null;
    private searchAbort: AbortController | null = null;
    private filling = 0;
    /** The request of the last search, as JSON, to tell whether the form changed since. */
    private lastRequest: string | null = null;
    private autoTimer = 0;
    /** A live (throttled) search is scheduled; when the last one started. */
    private livePending = false;
    private lastLive = 0;
    private rangeKey = "";
    private rangeTimer = 0;
    private rangeAbort: AbortController | null = null;
    private fresh = false;

    get = () => this.state;
    subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
    private set(update: Partial<ExplorerState>) {
        this.state = {...this.state, ...update};
        this.listeners.forEach((l) => l());
    }

    setStep(step: Step) { this.set({step}); }
    setUrl(url: string) { this.set({url}); }
    setView(viewBbox: Bbox | null) {
        const moved = JSON.stringify(viewBbox) !== JSON.stringify(this.state.viewBbox);
        this.set({viewBbox});
        if (!moved) return;
        if (this.state.client && this.state.collectionFilters.area === "view") void this.fillCollections();
        if (this.state.form.area === "view") this.updatePlan();
    }
    setBbox(bbox: Bbox | null) {
        this.set({bbox, drawing: false});
        if (this.state.collectionFilters.area === "bbox") void this.fillCollections();
        if (this.state.form.area === "bbox") this.updatePlan();
    }
    setDrawing(drawing: boolean) { this.set({drawing}); }
    hoverItem(key: string | null) { this.set({hoveredItem: key}); }
    hoverCollection(id: string | null) { this.set({hoveredCollection: id}); }
    /** Moves the map to a box, without choosing anything (a look at where a collection is). */
    zoomTo(bbox: Bbox) { this.set({zoom: {bbox, n: (this.state.zoom?.n ?? 0) + 1}}); }
    /** Shows an item's details; `reveal` also brings its row into view (opening its display page). */
    selectItem(key: string | null, reveal = false) {
        const update: Partial<ExplorerState> = {selectedItem: key, details: key ? "item" : this.state.details === "item" ? null : this.state.details};
        if (key && reveal) {
            const index = this.state.items.findIndex((i) => itemKey(i) === key);
            if (index >= 0) update.view = Math.floor(index / DISPLAY_PAGE);
            update.reveal = {key, n: (this.state.reveal?.n ?? 0) + 1};
        }
        this.set(update);
    }

    // ------------------------------------------------------------------------------------------- selection

    private itemOf(key: string) { return this.state.items.find((i) => itemKey(i) === key) ?? this.state.chosen[key]; }

    /** Adds or removes one item from the selection. */
    toggleChosen(key: string) {
        const chosen = {...this.state.chosen};
        if (chosen[key]) delete chosen[key];
        else { const item = this.itemOf(key); if (item) chosen[key] = item; }
        this.set({chosen});
    }

    /** Adds items to the selection (a box drawn on the map, all items of a page). */
    chooseItems(items: StacItemJson[]) {
        const chosen = {...this.state.chosen};
        for (const item of items) chosen[itemKey(item)] = item;
        this.set({chosen});
    }

    /**
     * The map's selection changed (LuciadRIA: click, Shift-click, click on empty ground): the items of the page shown
     * are now exactly `keys`; chosen items of other pages stay. The item just added (a click) is shown and its row
     * brought into view.
     */
    setMapSelection(keys: string[]) {
        const shown = new Set(shownItems(this.state).map(itemKey));
        const before = new Set(Object.keys(this.state.chosen));
        const chosen: Record<string, StacItemJson> = {};
        for (const [k, item] of Object.entries(this.state.chosen)) if (!shown.has(k)) chosen[k] = item;
        for (const k of keys) { const item = this.itemOf(k); if (item) chosen[k] = item; }
        const added = keys.filter((k) => !before.has(k));
        this.set({chosen});
        if (added.length === 1) this.selectItem(added[0], true);
    }

    /** Removes items from the selection, or all of them. */
    unchoose(items?: StacItemJson[]) {
        if (!items) { this.set({chosen: {}}); return; }
        const chosen = {...this.state.chosen};
        for (const item of items) delete chosen[itemKey(item)];
        this.set({chosen});
    }
    showDetails(details: ExplorerState["details"]) { this.set({details}); }
    toggleRequests(open?: boolean) { this.set({requestsOpen: open ?? !this.state.requestsOpen}); }
    /** More items for the formats offered, when they come from a sample. */
    async sampleMoreFormats() {
        const {client, collection} = this.state;
        if (!client || !collection) return;
        const mediaTypes = await client.collectionMediaTypes(collection.id, {sampleItems: 25}).catch(() => null);
        if (mediaTypes && this.state.collection?.id === collection.id) { this.set({mediaTypes}); this.updatePlan(); }
    }

    /** Collections waiting for one of their items to be read (Browse, cards in view), and how many are being read. */
    private sampleQueue: string[] = [];
    private sampling = 0;
    /** Reads one item of each of these collections (those without item_assets), at most SAMPLE_CONCURRENCY at once. */
    sampleCollections(ids: string[]) {
        const client = this.state.client;
        if (!client) return;
        const todo = ids.filter((id) => !this.state.sampled[id] && !this.sampleQueue.includes(id)
            && this.state.collections.find((c) => c.id === id)?.mediaTypeSource === "none");
        if (!todo.length) return;
        this.sampleQueue.push(...todo);
        this.pumpSamples(client);
    }
    private pumpSamples(client: StacClient) {
        while (this.sampling < SAMPLE_CONCURRENCY && this.sampleQueue.length) {
            const id = this.sampleQueue.shift()!;
            this.sampling++;
            this.set({sampled: {...this.state.sampled, [id]: "reading"}});
            client.collectionMediaTypes(id).then((r) => r, () => "failed" as const).then((r) => {
                this.sampling--;
                if (this.state.client !== client) return;
                this.set({sampled: {...this.state.sampled, [id]: r}});
                this.pumpSamples(client);
            });
        }
    }
    /** What is known of a collection's media types: item_assets, else the item read, else nothing yet. */
    knownMediaTypes(c: CollectionSummary): CollectionSummary | CollectionMediaTypes | null {
        if (c.mediaTypeSource === "item_assets") return c;
        const r = this.state.sampled[c.id];
        return r && r !== "reading" && r !== "failed" ? r : null;
    }
    /** Every media type Browse has seen (item_assets and items read): what its format names expand to. */
    seenMediaTypes(): string[] {
        const seen = new Set<string>();
        for (const c of this.state.collections) for (const t of c.mediaTypes) seen.add(t);
        for (const r of Object.values(this.state.sampled)) if (typeof r === "object") for (const t of r.mediaTypes) seen.add(t.mediaType);
        return [...seen];
    }

    private logRequest = (r: RiaStacRequest) => {
        const requests = [r, ...this.state.requests].slice(0, 500);
        this.set({requests});
    };
    clearRequests() { this.set({requests: []}); }

    async connect(url: string) {
        this.searchAbort?.abort();
        this.set({...initial, url, connecting: true, requests: this.state.requests, viewBbox: this.state.viewBbox, step: "catalog"});
        try {
            const client = await StacClient.connect(url.trim(), {onRequest: this.logRequest, crawl: {linkBbox: gem15LinkBbox}});
            this.set({client, connecting: false});
            await this.fillCollections();
            if (client.collectionId) await this.chooseCollection(client.collectionId);
        } catch (e) {
            this.set({connecting: false, error: message(e)});
        }
    }

    setCollectionFilters(update: Partial<CollectionFilters>) {
        this.set({collectionFilters: {...this.state.collectionFilters, ...update}});
        // Text, sort and formats run on the list already read: no request (formats: only the items Browse samples).
        if (Object.keys(update).some((k) => !["text", "sort", "formats", "showUnsure"].includes(k))) void this.fillCollections();
    }

    /** The same collection filters again, read fresh from the server (it may have added or changed collections). */
    async reloadCollections() {
        this.state.client?.reloadCollections();
        this.set({collectionsAt: null, sourceExtent: null});
        await this.fillCollections();
    }

    /** The collections, filtered: the server first when it can (Collection Search), then the same tests here. */
    async fillCollections() {
        const client = this.state.client;
        if (!client) return;
        const f = this.state.collectionFilters;
        const mine = ++this.filling;
        this.set({collectionsLoading: true});
        try {
            const all = await client.listCollections();
            let serverStep: ServerCollectionSearch | null = null;
            const area = areaOf(f.area, this.state);
            const list = await client.collections({
                ...(area ? {area} : {}), ...(f.from || f.to ? {datetime: [f.from || null, f.to || null] as [string | null, string | null]} : {}),
                ...exceptOf(f.except), ...(f.regional ? {regional: true} : {}), onServer: (s) => { serverStep = s; },
            });
            if (mine !== this.filling) return;
            // Cards no longer listed need no sample: what is queued is dropped (what is being read finishes, cached).
            this.sampleQueue = this.sampleQueue.filter((id) => list.some((c) => c.id === id));
            this.set({collections: list, allCollections: all.length, serverStep, collectionsLoading: false, collectionsAt: this.state.collectionsAt ?? Date.now()});
            if (!this.state.sourceExtent) this.refreshSourceExtent();
        } catch (e) {
            if (mine === this.filling) this.set({collectionsLoading: false, error: message(e)});
        }
    }

    /** Browse's period limits: every collection's declared period, widened by the items read (no request). */
    refreshSourceExtent() {
        const client = this.state.client;
        client?.timeExtent().then((sourceExtent) => { if (this.state.client === client) this.set({sourceExtent}); }, () => undefined);
        // The chosen collection's limits too, unless they came from its first and last items.
        const id = this.state.collection?.id, known = this.state.collectionExtent;
        if (client && id && known && (known.minSource !== "items" || known.maxSource !== "items")) {
            client.timeExtent([id]).then((e) => {
                if (this.state.collection?.id !== id) return;
                // Keep what the first and last items said; take the rest from the new extent.
                const k = this.state.collectionExtent ?? e;
                this.set({collectionExtent: {...e, ...(k.minSource === "items" ? {min: k.min, minSource: k.minSource} : {}), ...(k.maxSource === "items" ? {max: k.max, maxSource: k.maxSource} : {})}});
            }, () => undefined);
        }
    }

    async chooseCollection(id: string) {
        const client = this.state.client;
        if (!client) return;
        this.lastRequest = null;
        this.rangeKey = "";
        clearTimeout(this.autoTimer);
        this.search = null;
        this.searchAbort?.abort();
        this.set({collectionLoading: true, collection: null, mediaTypes: null, step: "search", plan: null, items: [], pages: [], hasMore: false, selectedItem: null, chosen: {},
            details: "collection", dirty: false, fetchedAt: null, searching: false, dataRange: null, collectionExtent: null});
        try {
            const collection = await client.collection(id);
            this.set({collection, collectionLoading: false, form: {...this.state.form, formats: []}});
            this.updatePlan();
            // Search's period limits: the first and last items (two one-item sorted searches where the server sorts).
            client.timeExtent([id], {exact: true}).then((collectionExtent) => {
                if (this.state.collection?.id === id) this.set({collectionExtent});
            }, () => undefined);
            // What it offers, for the format choice: item_assets, else one item. The formats ticked in Browse
            // carry over, where the collection offers them.
            client.collectionMediaTypes(id).then((mediaTypes) => {
                if (this.state.collection?.id !== id) return;
                const offered = new Set(mediaTypes.mediaTypes.map((t) => formatOf(t.mediaType)));
                const carried = this.state.collectionFilters.formats.filter((f) => offered.has(f));
                this.set({mediaTypes, ...(carried.length && !this.state.form.formats.length ? {form: {...this.state.form, formats: carried}} : {})});
                this.updatePlan();
            }, () => undefined);
        } catch (e) {
            this.set({collectionLoading: false, error: message(e)});
        }
    }

    /**
     * Changes the form. `live` (the period, changed while dragging): with auto update, the search follows during the
     * drag, at most once per LIVE_INTERVAL_MS, instead of after a pause.
     */
    setForm(update: Partial<SearchForm>, options: { live?: boolean } = {}) {
        this.set({form: {...this.state.form, ...update}});
        this.updatePlan(options.live);
    }

    /** The search request of the form, or null with the reason in cql2Error. */
    private request(): StacSearchRequest | null {
        const {collection, form} = this.state;
        if (!collection) return null;
        let filter: Cql2Json | undefined;
        try {
            filter = form.cql2.trim() ? fromText(form.cql2.trim()) as Cql2Json : undefined;
            this.state.cql2Error = null;
        } catch (e) {
            this.state.cql2Error = message(e);
            return null;
        }
        // The formats the user chose, as the media types behind them, are tested on the client (no server filters on
        // asset media types).
        // The expansion uses the collection's own media types (and the usual spellings), so it stays the same while
        // results come in.
        const formats = form.formats.length ? mediaTypesFilter(mediaTypesOf(form.formats, this.state.mediaTypes?.mediaTypes.map((t) => t.mediaType))) : undefined;
        const combined = filter && formats ? {op: "and", args: [filter, formats]} as Cql2Json : filter ?? formats;
        const sortby = form.sort === "datetime-desc" ? [{field: "datetime", direction: "desc" as const}]
            : form.sort === "datetime-asc" ? [{field: "datetime", direction: "asc" as const}]
                : form.sort === "cloud-asc" ? [{field: "eo:cloud_cover", direction: "asc" as const}] : undefined;
        return {
            collections: [collection.id],
            ...(areaOf(form.area, this.state) ? {area: areaOf(form.area, this.state)} : {}),
            ...(form.from || form.to ? {datetime: [form.from || null, form.to || null] as [string | null, string | null]} : {}),
            ...exceptOf(form.except),
            ...(form.maxCloud !== null ? {where: {"eo:cloud_cover": {lte: form.maxCloud}}} : {}),
            ...(combined ? {filter: combined} : {}),
            ...(sortby ? {sortby} : {}),
            // Pages of 500 (fewer when Maximum items is smaller: no use asking for more than will be kept).
            limit: Math.min(PAGE_SIZE, form.maxItems),
            maxItems: form.maxItems,
        };
    }

    updatePlan(live = false) {
        const client = this.state.client;
        const request = this.request();
        const dirty = this.lastRequest !== null && request !== null && JSON.stringify(request) !== this.lastRequest;
        this.set({plan: client && request ? client.plan(request) : this.state.plan, cql2Error: this.state.cql2Error, dirty});
        if (request) this.scheduleRange(request);
        // Auto update: once a search ran, a change runs it again after a pause (the running one is cancelled then).
        if (live && dirty && this.state.autoUpdate) {
            // Throttled: the scheduled search reads the form when it starts, so the last change is never lost.
            if (!this.livePending) {
                clearTimeout(this.autoTimer);
                this.livePending = true;
                // A search still running is let finish (its results show), then the next starts from the form as it is then.
                const fire = () => {
                    if (this.state.searching) { this.autoTimer = window.setTimeout(fire, 100); return; }
                    this.lastLive = Date.now();
                    void this.runSearch(true);
                };
                this.autoTimer = window.setTimeout(fire, Math.max(0, LIVE_INTERVAL_MS - (Date.now() - this.lastLive)));
            }
            return;
        }
        clearTimeout(this.autoTimer);
        this.livePending = false;
        if (dirty && this.state.autoUpdate) this.autoTimer = window.setTimeout(() => void this.runSearch(true), AUTO_DELAY_MS);
    }

    /**
     * The true date range for the area and filters (not the period), after a pause, when they changed: two tiny
     * sorted searches where the server sorts.
     */
    private scheduleRange(request: StacSearchRequest) {
        const {datetime: _d, exceptDatetime: _x, limit: _l, maxItems: _m, sortby: _s, ...rest} = request;
        const key = JSON.stringify(rest);
        if (key === this.rangeKey) return;
        this.rangeKey = key;
        clearTimeout(this.rangeTimer);
        this.rangeAbort?.abort();
        this.set({dataRangeLoading: true});
        this.rangeTimer = window.setTimeout(() => {
            const client = this.state.client;
            if (!client) return;
            const abort = this.rangeAbort = new AbortController();
            client.dateRange(rest, {signal: abort.signal}).then((dataRange) => {
                if (key === this.rangeKey) this.set({dataRange, dataRangeLoading: false});
            }, () => { if (key === this.rangeKey) this.set({dataRangeLoading: false}); });
        }, 900);
    }

    setAutoUpdate(autoUpdate: boolean) {
        this.set({autoUpdate});
        if (autoUpdate && this.state.dirty) void this.runSearch(true);
    }

    /** The same search again: fresh results from the server (new items arrive, metadata changes). */
    reload() {
        if (this.lastRequest !== null) void this.runSearch(true);
    }

    async runSearch(keepStep = false) {
        const client = this.state.client;
        const request = this.request();
        if (!client || !request) return;
        clearTimeout(this.autoTimer);
        this.livePending = false;
        this.lastRequest = JSON.stringify(request);
        this.searchAbort?.abort();
        const abort = this.searchAbort = new AbortController();
        this.search = client.search(request, {signal: abort.signal}).pages();
        // An automatic search keeps the user where they are (the Search tab, or a selected item's details).
        const auto = keepStep || this.state.step !== "search";
        this.set({pages: [], searching: true, searchError: null, hasMore: false, dirty: false, view: 0,
            ...(auto ? {} : {step: "results" as Step, selectedItem: null, details: null})});
        this.fresh = true;
        await this.more();
        await this.fillTo(DISPLAY_PAGE);
    }

    /** Server pages until `count` items are loaded (or the search ends, fails or is cancelled). */
    private async fillTo(count: number) {
        const search = this.search;
        while (this.search === search && this.state.hasMore && this.state.items.length < count && !this.searchAbort?.signal.aborted) {
            await this.more();
            if (this.state.searchError) break;
        }
    }

    /** The next display page: loads the server pages it needs first. */
    async nextPage() {
        const target = (this.state.view + 2) * DISPLAY_PAGE;
        await this.fillTo(target);
        if (this.state.items.length > (this.state.view + 1) * DISPLAY_PAGE) this.set({view: this.state.view + 1});
    }

    /** The previous display page (already loaded: no request). */
    previousPage() { this.set({view: Math.max(0, this.state.view - 1)}); }

    /** The next page of results. */
    async more() {
        const search = this.search;
        if (!search) return;
        this.set({searching: true});
        try {
            const next = await search.next();
            if (search !== this.search) return;
            if (next.done) { this.set({searching: false, hasMore: false}); return; }
            const page = next.value;
            // The previous results stay (dimmed) until the first page of a new search replaces them.
            const before = this.fresh ? [] : this.state.items;
            this.fresh = false;
            const seen = new Set(before.map(itemKey));
            const items = [...before, ...page.items.filter((i) => !seen.has(itemKey(i)))];
            this.set({items, pages: [...this.state.pages, page], plan: page.plan, searching: false, hasMore: page.next !== undefined,
                ...(page.index === 0 ? {fetchedAt: Date.now()} : {}),
                ...(this.state.selectedItem && !items.some((i) => itemKey(i) === this.state.selectedItem) ? {selectedItem: null, details: null} : {})});
            // The items read may reach beyond the declared periods: Browse's limits follow.
            this.refreshSourceExtent();
        } catch (e) {
            if (search === this.search && !this.searchAbort?.signal.aborted) this.set({searching: false, searchError: message(e)});
        }
    }

    cancelSearch() {
        this.searchAbort?.abort();
        this.set({searching: false});
    }

    /** Items as an item collection, for another tool (ria-geotiff's stacToManifest): the selection, else all loaded. */
    itemCollection(which: "chosen" | "loaded" = "loaded") {
        return {type: "FeatureCollection", features: which === "chosen" ? Object.values(this.state.chosen) : this.state.items, links: []};
    }
}

export const explorer = new Explorer();
export const useExplorer = () => useSyncExternalStore(explorer.subscribe, explorer.get);
export const cql2Text = (f: Cql2Json | undefined) => (f === undefined ? "" : (() => { try { return toCql2Text(f); } catch { return JSON.stringify(f); } })());
