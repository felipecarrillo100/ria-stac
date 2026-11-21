/**
 * The LuciadRIA map of the explorer: a basemap, collection extents, item footprints and the search area. STAC only:
 * nothing here reads data files; footprints and extents come from the STAC documents.
 */
import {WebGLMap} from "@luciad/ria/view/WebGLMap.js";
import {getReference} from "@luciad/ria/reference/ReferenceProvider.js";
import {createBounds, createPoint, createPolygon} from "@luciad/ria/shape/ShapeFactory.js";
import {createTransformation} from "@luciad/ria/transformation/TransformationFactory.js";
import {UrlTileSetModel} from "@luciad/ria/model/tileset/UrlTileSetModel.js";
import {RasterTileSetLayer} from "@luciad/ria/view/tileset/RasterTileSetLayer.js";
import {LayerType} from "@luciad/ria/view/LayerType.js";
import {Feature} from "@luciad/ria/model/feature/Feature.js";
import {FeatureModel} from "@luciad/ria/model/feature/FeatureModel.js";
import {MemoryStore} from "@luciad/ria/model/store/MemoryStore.js";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec.js";
import {FeatureLayer} from "@luciad/ria/view/feature/FeatureLayer.js";
import {FeaturePainter} from "@luciad/ria/view/feature/FeaturePainter.js";
import type {Handle} from "@luciad/ria/util/Evented.js";
import {BasicCreateController} from "@luciad/ria/view/controller/BasicCreateController.js";
import {ShapeType} from "@luciad/ria/shape/ShapeType.js";
import type {RIAMap} from "@luciad/ria/view/RIAMap.js";
import {itemFootprints, itemKey, type Bbox, type StacItemJson} from "ria-stac";

const crs84 = getReference("CRS:84");
const webMercator = getReference("EPSG:3857");
const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{-y}/{x}";

export interface Palette { accent: string; hover: string; extent: string; area: string }

/** A collection extent to draw. */
export interface Extent { id: string; title: string; bbox: Bbox }

/** A vector layer of keyed features with hover and selection, drawn by a style function. */
class KeyedLayer {
    readonly layer: FeatureLayer;
    private readonly store = new MemoryStore({reference: crs84});
    private readonly features = new Map<string, Feature>();
    private readonly painter = new FeaturePainter();
    hot: string | null = null;
    focus: string | null = null;

    constructor(map: WebGLMap, label: string, style: (key: string, state: { hot: boolean; chosen: boolean; focus: boolean }) => { stroke: string; fill: string; width: number },
        selectable = true) {
        this.painter.paintBody = (canvas, feature, shape, _l, _m, state) => {
            const key = String(feature.id);
            // Selected (chosen) is LuciadRIA's own selection state; hover from the map or from the list.
            const s = style(key, {hot: this.hot === key || state.hovered, chosen: state.selected, focus: this.focus === key});
            canvas.drawShape(shape, {stroke: {color: s.stroke, width: s.width}, fill: {color: s.fill}});
        };
        this.layer = new FeatureLayer(new FeatureModel(this.store, {reference: crs84}), {label, painter: this.painter, selectable, hoverable: true});
        map.layerTree.addChild(this.layer, "top");
    }

    set(entries: { key: string; shape: Feature["shape"]; properties?: Record<string, unknown> }[]) {
        this.store.clear();
        this.features.clear();
        for (const e of entries) {
            if (!e.shape) continue;
            const f = new Feature(e.shape, e.properties ?? {}, e.key);
            this.features.set(e.key, f);
            this.store.add(f);
        }
    }

    feature(key: string) { return this.features.get(key); }
    keys() { return [...this.features.keys()]; }
    invalidate() { this.painter.invalidateAll(); }
}

/** The explorer's map. */
export class StacMap {
    readonly map: WebGLMap;
    private readonly toLonLat;
    private readonly extents: KeyedLayer;
    private readonly footprints: KeyedLayer;
    private readonly area: KeyedLayer;
    private readonly handles: Handle[] = [];
    private readonly codec = new GeoJsonCodec();
    /**
     * Called when LuciadRIA's selection of footprints changes (a click selects, Shift-click adds or removes, a click
     * where there is no data clears): the keys selected now. Not called for changes made with setSelection.
     */
    onSelectionChange: (keys: string[]) => void = () => undefined;
    /** Called when a collection extent is selected on the map. */
    onCollectionClick: (id: string) => void = () => undefined;
    private syncing = false;
    /** Called when the pointer enters or leaves a footprint. */
    onHover: (key: string | null) => void = () => undefined;
    /** Called when the view stops moving. */
    onViewChange: () => void = () => undefined;

    constructor(node: HTMLElement, palette: Palette) {
        this.map = new WebGLMap(node, {reference: webMercator});
        this.toLonLat = createTransformation(this.map.reference, crs84);
        const r = 20037508.342789244;
        const basemap = new UrlTileSetModel({
            baseURL: ESRI_IMAGERY,
            structure: {reference: webMercator, bounds: createBounds(webMercator, [-r, 2 * r, -r, 2 * r]),
                level0Columns: 1, level0Rows: 1, tileWidth: 256, tileHeight: 256, levelCount: 20},
        });
        this.map.layerTree.addChild(new RasterTileSetLayer(basemap, {label: "Esri World Imagery", layerType: LayerType.BASE}), "bottom");
        this.area = new KeyedLayer(this.map, "Search area", () => ({stroke: palette.area, fill: "rgba(0,0,0,0)", width: 2}));
        this.extents = new KeyedLayer(this.map, "Collection extents", (_k, s) => ({
            stroke: s.hot ? palette.hover : palette.extent, width: s.hot ? 2.5 : 1, fill: s.hot ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0)",
        }));
        // Items: chosen in the accent colour, the focused one (its details shown) thicker, hover in amber.
        this.footprints = new KeyedLayer(this.map, "Item footprints", (_k, s) => ({
            stroke: s.hot ? palette.hover : s.chosen || s.focus ? palette.accent : "rgba(255,255,255,0.6)",
            width: s.hot ? 3 : s.focus ? 3.5 : s.chosen ? 2 : 1,
            fill: s.hot ? "rgba(253,230,138,0.22)" : s.chosen ? "rgba(56,189,248,0.18)" : s.focus ? "rgba(56,189,248,0.08)" : "rgba(0,0,0,0)",
        }));
        // LuciadRIA's default selection: click selects, Shift-click adds or removes, a click on empty ground clears.
        this.handles.push(this.map.on("SelectionChanged", () => {
            if (this.syncing) return;
            const items = this.map.selectedObjects.filter((p) => p.layer === this.footprints.layer).flatMap((p) => p.selected.map((f) => String(f.id)));
            const coll = this.map.selectedObjects.find((p) => p.layer === this.extents.layer)?.selected[0];
            if (coll) this.onCollectionClick(String(coll.id));
            this.onSelectionChange(items);
        }));
        // The view settles: tell the explorer once, after a short pause (panning fires many changes).
        let timer = 0;
        this.handles.push(this.map.on("MapChange", () => {
            clearTimeout(timer);
            timer = window.setTimeout(() => this.onViewChange(), 350);
        }));
    }

    /** The part of the world the view shows, in longitude/latitude; null when it shows no ground. */
    viewBbox(): Bbox | null {
        // A 2D map: its view-to-map transformation (a 3D map would need a location mode).
        const viewToMap = this.map.viewToMapTransformation;
        const [w, h] = this.map.viewSize;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
                try {
                    const p = this.toLonLat.transform(viewToMap.transform(createPoint(null, [(i / 8) * w, (j / 8) * h])));
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                } catch {
                    // outside the world
                }
            }
        }
        if (!(minX < maxX)) return null;
        return [Math.max(-180, minX), Math.max(-90, minY), Math.min(180, maxX), Math.min(90, maxY)];
    }

    /** Moves the view to a longitude/latitude box, with a margin. */
    fit(bbox: Bbox) {
        const [w, s, e, n] = bbox;
        const dx = Math.max(e - w, 0.02) * 0.15, dy = Math.max(n - s, 0.02) * 0.15;
        const box = [Math.max(-180, w - dx), Math.max(-85, s - dy), Math.min(180, e + dx), Math.min(85, n + dy)];
        void this.map.mapNavigator.fit({bounds: createBounds(crs84, [box[0], box[2] - box[0], box[1], box[3] - box[1]]), animate: {duration: 900}})
            .then(() => this.onViewChange(), () => undefined);
    }

    private boxShape(b: Bbox) {
        const [w, s, e, n] = b;
        return createPolygon(crs84, [createPoint(crs84, [w, s]), createPoint(crs84, [e, s]), createPoint(crs84, [e, n]), createPoint(crs84, [w, n])]);
    }

    /** Draws collection extents (the overall bbox of each). */
    setExtents(extents: Extent[]) {
        this.extents.set(extents.filter((e) => e.bbox[2] - e.bbox[0] < 359).map((e) => ({key: e.id, shape: this.boxShape(e.bbox), properties: {title: e.title}})));
    }

    /** Draws item footprints, keyed by itemKey. */
    setItems(items: StacItemJson[]) {
        const fc = itemFootprints(items);
        this.footprints.set(fc.features.map((f) => ({key: f.id, shape: this.codec.decodeGeometryObject(f.geometry as never, crs84) as Feature["shape"]})));
    }

    /** Highlights one footprint (from the list) without selecting it. */
    hoverItem(key: string | null) {
        this.footprints.hot = key;
        this.footprints.invalidate();
    }

    hoverCollection(id: string | null) {
        this.extents.hot = id;
        this.extents.invalidate();
    }

    /** Makes LuciadRIA's selection these footprints (the ones drawn), without calling onSelectionChange. */
    setSelection(keys: Iterable<string>) {
        const features = [...keys].map((k) => this.footprints.feature(k)).filter((f): f is Feature => !!f);
        const current = new Set(this.map.selectedObjects.filter((p) => p.layer === this.footprints.layer).flatMap((p) => p.selected.map((f) => String(f.id))));
        if (features.length === current.size && features.every((f) => current.has(String(f.id)))) return;
        this.syncing = true;
        try {
            this.map.selectObjects(features.length ? [{layer: this.footprints.layer, objects: features}] : []);
        } finally {
            this.syncing = false;
        }
    }

    /** Marks the focused item (whose details are shown). */
    focusItem(key: string | null) {
        this.footprints.focus = key;
        this.footprints.invalidate();
    }

    /** Whether a footprint is drawn (its item is on the display page shown). */
    hasItem(item: StacItemJson) { return !!this.footprints.feature(itemKey(item)); }

    /** Draws the search area (or none). */
    setArea(bbox: Bbox | null) {
        this.area.set(bbox ? [{key: "area", shape: this.boxShape(bbox)}] : []);
    }

    /** Lets the user drag a box on the map; `done` gets it in longitude/latitude (null: cancelled). */
    drawBox(done: (bbox: Bbox | null) => void) {
        const layer = this.area.layer;
        const map = this.map;
        class BoxController extends BasicCreateController {
            override onChooseLayer() { return layer; }
            override onObjectCreated(_map: RIAMap, _layer: FeatureLayer, feature: Feature) {
                const b = feature.shape!.bounds!;
                done([b.x, b.y, b.x + b.width, b.y + b.height]);
                queueMicrotask(() => { map.controller = null; });
            }
        }
        map.controller = new BoxController(ShapeType.BOUNDS);
    }

    cancelDraw() { this.map.controller = null; }

    destroy() {
        this.handles.forEach((h) => h.remove());
        this.map.destroy();
    }
}
