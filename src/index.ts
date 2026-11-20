/**
 * ria-stac: find data through STAC, for LuciadRIA applications.
 *
 * Connect to a STAC API, a static catalog or a collection ({@link StacClient.connect}), learn what it offers
 * ({@link StacClient.collections}, {@link StacClient.collection}), check a selection ({@link StacClient.check}) and
 * pick items ({@link StacClient.select}). Power users plan and run searches themselves ({@link StacClient.search},
 * {@link planSearch}, {@link StacSearch}), choose items ({@link coverArea}, {@link bestPerPeriod}, ...), and
 * resolve and sign assets ({@link resolveAsset}). Everything is plain STAC JSON in and out: the items found go to
 * the library that opens their assets, for example ria-geotiff for Cloud Optimized GeoTIFFs.
 *
 * Requests carry `credentials`, `requestHeaders` and `requestParameters` ({@link HttpRequestOptions}, the same shape
 * as LuciadRIA's), sent only to the origin they were given for. ria-stac has no dependency on LuciadRIA.
 *
 * @packageDocumentation
 * @module ria-stac
 */
export {StacClient, StacSearch, StacError, describe as describeCollectionJson, followNext} from "./client.js";
export {COLLECTION_PAGE_SIZE} from "./client.js";
export type {CollectionDescription, CollectionFilter, ServerCollectionSearch, PageCursor, Queryable, SearchPage, StacClientOptions, StacProgress} from "./client.js";
export {parseCapabilities, emptyProfile} from "./capabilities.js";
export type {ServerProfile, StacCapabilities} from "./capabilities.js";
export {planSearch, normaliseDatetime, itemMatches, requestFilter, splitFilter} from "./plan.js";
export type {FilterSplit, QueryablesSchema} from "./plan.js";
export type {Degradation, FilterEncoding, HttpRequestSpec, SearchPlan, StacSearchRequest} from "./plan.js";
export {ASSET_FORMATS, cql2Predicate, evaluateCql2, formatsFilter, toCql2Text, whereToCql2, whereToQuery} from "./cql2.js";
export type {Cql2Json, WhereComparison} from "./cql2.js";
export {bestPerPeriod, coverArea, dedupeItems, defaultScore, groupItems, itemFootprints, itemKey, itemsCovering, periodOf, solarLongitude, sortItems} from "./select.js";
export type {Period} from "./select.js";
export {DEFAULT_SIGNERS, isPlanetaryComputerItem, isPlanetaryComputerUrl, planetaryComputerSigner, resolveAsset} from "./assets.js";
export type {AssetSigner, ResolvedAsset} from "./assets.js";
export {nameBands, resolveBandName, stableAssetKey} from "./naming.js";
export type {BandNameSource, NamedAsset, NamedBand, ResolvedBandName} from "./naming.js";
export {assetBands, assetFormat, isDataAsset, itemFormats, isGeoTiffAsset, type AssetFormat} from "./bands.js";
export type {BandDescriptor} from "./bands.js";
export {bboxesIntersect, bboxOf, coverageOf, footprintOf, intersectsArea, isGlobalBbox} from "./geometry.js";
export {RiaStacError} from "./errors.js";
export type {RiaStacProblem} from "./errors.js";
export type {AccessHook, AccessKind, HttpRequestHeaders, HttpRequestOptions, HttpRequestParameters, RiaStacRequest, RiaStacRequestListener} from "./http.js";
export type {Bbox, GeoJsonArea, StacAssetJson, StacCatalogJson, StacCollectionJson, StacItemCollectionJson, StacItemJson, StacLink} from "./json.js";
export {collectionBands, elevationHint, SELECT_MAX_ITEMS, SELECT_MAX_ITEMS_LIMIT, SELECT_PAGE_SIZE, SELECT_SCAN_LIMIT, selectionToRequest} from "./catalog.js";
export type {CollectionDetails, CollectionSummary, Pick, StacCandidate, StacSelection, StacSelectionResult} from "./catalog.js";

