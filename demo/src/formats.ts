/**
 * Formats: the explorer's names for media types. ria-stac speaks STAC (asset `type`, a media type such as
 * `image/tiff; application=geotiff; profile=cloud-optimized`); people know formats ("COG", "GeoTIFF", "JPEG 2000").
 * This file is the only place that maps one to the other.
 */
import {normaliseMediaType} from "ria-stac";

/** Media type patterns to format names, first match wins (tested on the media type before any `+zip`). */
const NAMES: [RegExp, string][] = [
    [/interlis/i, "INTERLIS"], [/ms-?access/i, "MS Access"], [/geopackage/i, "GeoPackage"], [/shapefile|esri-shape|vnd\.shp/i, "Shapefile"],
    [/flatgeobuf/i, "FlatGeobuf"], [/geo\+json/i, "GeoJSON"], [/geoparquet/i, "GeoParquet"], [/parquet/i, "Parquet"], [/x-ndjson/i, "NDJSON"],
    [/google-earth/i, "KML"], [/gml/i, "GML"], [/json/i, "JSON"], [/csv/i, "CSV"], [/xml/i, "XML"], [/jp2|jpeg2000/i, "JPEG 2000"],
    [/jpeg/i, "JPEG"], [/png/i, "PNG"], [/webp/i, "WEBP"], [/pdf/i, "PDF"], [/ascii-xyz/i, "XYZ"], [/netcdf|x-hdf/i, "NetCDF/HDF"],
    [/zarr/i, "Zarr"], [/grib/i, "GRIB"], [/copc/i, "COPC"], [/las/i, "Point cloud"], [/dxf|dwg/i, "CAD"], [/gltf|3d-tiles/i, "3D"],
    [/html/i, "HTML"], [/text\/plain/i, "Text"],
];

/**
 * The format name of a media type, for people. GeoTIFFs are "COG" only when the media type declares
 * `profile=cloud-optimized`; any other TIFF is "GeoTIFF" (it may still be a COG nobody declared). Zipped media types
 * are "… (zipped)", or "ZIP".
 */
export function formatOf(mediaType: string | null | undefined): string {
    if (!mediaType) return "Unknown";
    const t = normaliseMediaType(mediaType);
    const zipped = /\+zip\b/.test(t) || /^application\/(x-)?zip\b/.test(t);
    const inner = t.replace(/\+zip\b/, "");
    if (/^image\/tiff\b/.test(inner) || /tiff/.test(inner)) {
        if (zipped) return "GeoTIFF (zipped)";
        return /profile=cloud-optimized/.test(t) ? "COG" : "GeoTIFF";
    }
    if (zipped) {
        const named = /^application\/(x-)?zip\b/.test(t) ? undefined : NAMES.find(([p]) => p.test(inner))?.[1];
        return named ? `${named} (zipped)` : "ZIP";
    }
    return NAMES.find(([p]) => p.test(t))?.[1] ?? t.split(";")[0].replace(/^[a-z]+\/(x[.-]|vnd\.)?/, "").toUpperCase();
}

/** A short explanation of a format, where its name alone could mislead. */
export function formatNote(format: string): string | undefined {
    if (format === "COG") return "Cloud Optimized GeoTIFF, as declared by the catalog.";
    if (format === "GeoTIFF") return "COG not declared: it may or may not be cloud-optimized. Tick COG too to take both.";
    if (/zipped|^ZIP$/.test(format)) return "A download: it has to be fetched whole and unpacked.";
    if (format === "Parquet") return "May be GeoParquet (with geometries) or a plain table: the media type does not tell.";
    return undefined;
}

/** Usual spellings of a format's media types, so that a choice also matches media types not read yet. */
const KNOWN: Record<string, string[]> = {
    "COG": ["image/tiff; application=geotiff; profile=cloud-optimized", "image/tiff; profile=cloud-optimized"],
    "GeoTIFF": ["image/tiff; application=geotiff", "image/tiff", "image/geotiff"],
    "JPEG 2000": ["image/jp2"], "PNG": ["image/png"], "JPEG": ["image/jpeg"],
    "NetCDF/HDF": ["application/x-netcdf", "application/netcdf", "application/x-hdf5", "application/x-hdf"],
    "Zarr": ["application/vnd+zarr", "application/vnd.zarr"], "Parquet": ["application/vnd.apache.parquet", "application/x-parquet"],
    "GeoJSON": ["application/geo+json"], "GeoPackage": ["application/geopackage+sqlite3"], "ZIP": ["application/zip"],
};

/** What a format is, for grouping a long list. */
export function kindOf(format: string): string {
    if (/zipped|^ZIP$/.test(format)) return "Archives";
    if (/COG|GeoTIFF|JPEG 2000|NetCDF|Zarr|GRIB|^TIFF|HDF/i.test(format)) return "Raster";
    if (/GeoJSON|Parquet|GeoPackage|Shapefile|KML|INTERLIS|FlatGeobuf|MS Access|GML/i.test(format)) return "Vector";
    if (/Point cloud|3D|COPC|LAS/i.test(format)) return "Point clouds and 3D";
    if (/JPEG|PNG|WEBP|GIF/i.test(format)) return "Images";
    return "Documents and other";
}
export const KIND_ORDER = ["Raster", "Vector", "Point clouds and 3D", "Images", "Documents and other", "Archives"];

/** A format to choose from: its name, the media types behind it, and how many assets or collections have it. */
export interface FormatOption { format: string; mediaTypes: string[]; count: number }

/** Media types (with a count each) grouped by format, in display order. */
export function groupFormats(entries: Iterable<{ mediaType: string; count: number }>): FormatOption[] {
    const by = new Map<string, FormatOption>();
    for (const {mediaType, count} of entries) {
        const format = formatOf(mediaType);
        const o = by.get(format) ?? {format, mediaTypes: [], count: 0};
        if (!o.mediaTypes.includes(mediaType)) o.mediaTypes.push(mediaType);
        o.count += count;
        by.set(format, o);
    }
    return [...by.values()].sort((a, b) => KIND_ORDER.indexOf(kindOf(a.format)) - KIND_ORDER.indexOf(kindOf(b.format)) || a.format.localeCompare(b.format));
}

/**
 * The media types to ask ria-stac for, for formats chosen by name: the usual spellings of each format, plus every
 * media type seen so far that has that name. ria-stac compares media types exactly, so a spelling never seen and not
 * usual would not match: that is the limit of naming formats.
 */
export function mediaTypesOf(formats: readonly string[], seen: Iterable<string> = []): string[] {
    const wanted = new Set(formats);
    const out = new Set<string>();
    for (const f of formats) for (const t of KNOWN[f] ?? []) out.add(t);
    for (const t of seen) if (wanted.has(formatOf(t))) out.add(normaliseMediaType(t));
    return [...out];
}
