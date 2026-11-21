/** Example endpoints of the explorer: demo conveniences, grouped and labelled. */
import type {Bbox, StacLink} from "ria-stac";

export interface Endpoint { group: string; label: string; url: string; note?: string }

export const ENDPOINTS: Endpoint[] = [
    {group: "STAC APIs", label: "Earth Search (Element 84, AWS)", url: "https://earth-search.aws.element84.com/v1", note: "Query extension, no CQL2"},
    {group: "STAC APIs", label: "Microsoft Planetary Computer", url: "https://planetarycomputer.microsoft.com/api/stac/v1", note: "CQL2; assets need SAS tokens"},
    {group: "STAC APIs", label: "Copernicus Data Space Ecosystem", url: "https://stac.dataspace.copernicus.eu/v1", note: "CQL2 and Collection Search"},
    {group: "STAC APIs", label: "INPE Brazil Data Cube", url: "https://data.inpe.br/bdc/stac/v1"},
    {group: "STAC APIs", label: "swisstopo", url: "https://data.geo.admin.ch/api/stac/v1", note: "Per-tile assets"},
    {group: "STAC APIs", label: "eoAPI demo (pgstac)", url: "https://stac.eoapi.dev", note: "CQL2 and Collection Search"},
    {group: "Static catalogs", label: "GEM-15 global elevation (Google)", url: "https://storage.googleapis.com/climate-and-sustainability/gem-15/stac/catalog.json", note: "13,485 items: search an area"},
];

/**
 * GEM-15 names its sub-catalogs and cells after their extent ("p30_m120": 30..40 N, 120..110 W; "wm112s36": the
 * 1-degree cell 112..111 W, 36..37 N): the crawl skips the ones outside the search area without reading them.
 */
export function gem15LinkBbox(link: StacLink): Bbox | undefined {
    if (!/\/gem-15\//.test(link.href)) return undefined;
    const name = link.title ?? link.href.replace(/\/(catalog|[^/]+)\.json$/, "").split("/").pop() ?? "";
    const sign = (s: string, n: string) => (s === "m" ? -1 : 1) * Number(n);
    let m = /^([pm])(\d+)_([pm])(\d+)$/.exec(name);
    if (m) { const lat = sign(m[1], m[2]), lon = sign(m[3], m[4]); return [lon, lat, lon + 10, lat + 10]; }
    m = /^w([pm]?)(\d+)s([pm]?)(\d+)$/.exec(name);
    if (m) { const lon = sign(m[1], m[2]), lat = sign(m[3], m[4]); return [lon, lat, lon + 1, lat + 1]; }
    return undefined;
}
