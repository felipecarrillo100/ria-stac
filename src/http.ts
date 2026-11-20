/**
 * Protected data: credentials, headers and parameters (LuciadRIA's HttpRequestOptions), sent only to the origin
 * they were given for, with redirects to another origin refused.
 */
/**
 * HTTP headers sent with a request, by name.
 *
 * The same shape as LuciadRIA's `HttpRequestHeaders`, so the objects an application gives LuciadRIA (or
 * ria-geotiff) can be given here as they are.
 *
 * @category Protected data
 */
export interface HttpRequestHeaders {
    [headerName: string]: string;
}

/**
 * Query parameters added to a request URL, by name; `null` and `undefined` values are left out.
 *
 * The same shape as LuciadRIA's `HttpRequestParameters`.
 *
 * @category Protected data
 */
export interface HttpRequestParameters {
    [parameterName: string]: string | number | boolean | null | undefined;
}

/**
 * Credentials, headers and query parameters of a request: what {@link StacClientOptions} and an
 * {@link AccessHook} give. The same shape as LuciadRIA's `HttpRequestOptions`, so one object serves both.
 *
 * @category Protected data
 */
export interface HttpRequestOptions {
    /**
     * Cookies and HTTP authentication: `true` sends them to every origin (`"include"`), `false` or unset only to the
     * page's own origin (`"same-origin"`), or a fetch `credentials` mode.
     */
    credentials?: boolean | RequestCredentials;
    /** Headers added to the request, or null for none. */
    requestHeaders?: HttpRequestHeaders | null;
    /** Query parameters added to the request URL, or null for none. */
    requestParameters?: HttpRequestParameters | null;
}

/**
 * What a request is for, as passed to an {@link AccessHook}: `"stac-api"` (STAC API, catalog, collection and item
 * documents) or `"stac-asset"` (a STAC asset). A hook written for a library with more kinds (ria-geotiff's also has
 * `"file"`, `"manifest"` and `"source"`) can be passed as it is.
 *
 * @category Protected data */
export type AccessKind = "stac-api" | "stac-asset";

/**
 * Decides per request which credentials, headers and parameters to send, replacing the library's rule (options only
 * to the origin of a URL the application gave for them).
 *
 * @param url The URL that is about to be requested (without added parameters).
 * @param kind What the request is for.
 * @returns The options for that request, or `null` to send none.
 *
 * @category Protected data
 */
export type AccessHook = (url: URL, kind: AccessKind) => HttpRequestOptions | null;

/**
 * The fetch `credentials` mode of the `credentials` option (`true`, `false` or a fetch mode, as in LuciadRIA).
 *
 * @internal
 *
 * @category Protected data
 */
export function credentialsMode(credentials: boolean | RequestCredentials | undefined): RequestCredentials {
    return credentials === true ? "include" : credentials === false || credentials === undefined ? "same-origin" : credentials;
}

/**
 * Adds request parameters to a URL (keeping its query string and fragment).
 *
 * @internal
 *
 * @category Protected data
 */
export function addParameters(url: string, params: HttpRequestParameters | null | undefined): string {
    if (!params) return url;
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return url;
    const [base, hash] = url.split("#", 2);
    const query = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    return `${base}${base.includes("?") ? "&" : "?"}${query}${hash !== undefined ? `#${hash}` : ""}`;
}

/**
 * The origin of a URL, or null when it is not absolute.
 *
 * @internal
 *
 * @category Protected data
 */
export function originOf(url: string | URL): string | null {
    try {
        return new URL(String(url)).origin;
    } catch {
        return null;
    }
}

const isEmpty = (o: object | null | undefined) => !o || Object.keys(o).length === 0;

/**
 * Error of a redirect to another origin, for a request that carried headers or parameters.
 *
 * @internal
 *
 * @category Protected data
 */
export class RedirectWithheldError extends Error {
    /**
     * Creates the error.
     *
     * @param host The host the credentials were withheld from.
     * @param url The URL that redirected (without added parameters).
     * @param why Why the redirect was refused, when the host alone does not say it.
     */
    constructor(readonly host: string, url: string, why?: string) {
        super(`${url} redirects to ${host}${why ? ` (${why})` : ""}: the request's credentials, headers and parameters were withheld from that host. `
            + "Use the URL it redirects to, or an access hook.");
        this.name = "RedirectWithheldError";
    }
}

/**
 * Fetches `url` with the given options. A request with headers or parameters uses `redirect: "manual"`: redirects on
 * the same origin are followed (at most 5), a redirect to another origin rejects with a
 * {@link RedirectWithheldError}. Browsers hide the target of a manual redirect: it is found with a probe that
 * carries no secrets first (see `followHidden`).
 *
 * @internal
 *
 * @category Protected data
 */
export async function accessFetch(url: string, access: HttpRequestOptions | null, init: RequestInit = {}, fetchFn: typeof fetch = fetch,
    observe?: Observe): Promise<Response> {
    if (!observe?.onRequest) return accessFetchOnce(url, access, init, fetchFn);
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const range = new Headers(init.headers as HeadersInit | undefined).get("Range") ?? undefined;
    const report = (status: number | undefined, error?: unknown) => {
        const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
        try {
            observe.onRequest!({url: observe.url ?? url, kind: observe.kind, method: init.method ?? "GET", ...(range ? {range} : {}),
                ...(status !== undefined ? {status} : {}), ms, ...(error !== undefined ? {error: (error as Error)?.message ?? String(error)} : {})});
        } catch (e) {
            console.error("onRequest listener failed", e);
        }
    };
    try {
        const response = await accessFetchOnce(url, access, init, fetchFn);
        report(response.status);
        return response;
    } catch (e) {
        report(undefined, e);
        throw e;
    }
}

/**
 * A request the library made, as given to an `onRequest` listener of {@link StacClient}: for logs, request counters
 * and progress.
 *
 * `url` is the URL as the application gave it or the library found it: without the added `requestParameters`,  and without
 * signing (Planetary Computer tokens). Headers and credentials are never reported.
 *
 * @category Protected data
 */
export interface RiaStacRequest {
    /** The URL, without secrets (see above). */
    url: string;
    /** What was requested: a STAC API document or a STAC asset. */
    kind: AccessKind;
    /** `"GET"` or `"POST"`. */
    method: string;
    /** The `Range` header (`"bytes=0-65535"`), for range requests. */
    range?: string;
    /** The HTTP status; undefined when the request failed (network, CORS, abort, refused redirect). */
    status?: number;
    /** Time until the response headers arrived (or the failure), in milliseconds. */
    ms: number;
    /** Why the request failed, when it did. */
    error?: string;
}

/**
 * Receives every request a {@link StacClient} makes; see
 * {@link RiaStacRequest}. Errors thrown by the listener are logged and ignored.
 *
 * @category Protected data
 */
export type RiaStacRequestListener = (request: RiaStacRequest) => void;

/** What {@link accessFetch} reports, and to whom. @internal */
export interface Observe {
    onRequest?: RiaStacRequestListener;
    kind: AccessKind;
    /** The URL to report (without signing or rewriting); default the URL requested. */
    url?: string;
}

async function accessFetchOnce(url: string, access: HttpRequestOptions | null, init: RequestInit, fetchFn: typeof fetch): Promise<Response> {
    const headers = {...(init.headers as Record<string, string> | undefined ?? {}), ...(access?.requestHeaders ?? {})};
    const params = access?.requestParameters;
    const credentials = credentialsMode(access?.credentials);
    const guarded = !isEmpty(access?.requestHeaders) || !isEmpty(params);
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
        const response = await fetchFn(addParameters(current, params), {...init, headers, credentials, ...(guarded ? {redirect: "manual"} : {})});
        if (!guarded || !(response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400 && response.status !== 304))) return response;
        if (response.type === "opaqueredirect") return followHidden(current, access, init, fetchFn);
        const location = response.headers.get("Location");
        if (!location) throw new RedirectWithheldError("an undisclosed host", current);
        const next = new URL(location, current);
        if (next.origin !== new URL(current).origin) throw new RedirectWithheldError(next.host, current);
        // Same origin: follow, without parameters the server added (they are added again from the options).
        current = next.toString();
    }
    throw new Error(`Too many redirects from ${url}`);
}

/**
 * A redirect whose target a browser hides (`redirect: "manual"` gives an opaque response without `Location`).
 *
 * Following it blindly could send secrets to another origin: browsers drop `Authorization` on a cross-origin
 * redirect, but forward other headers (an API key in `X-Api-Key`), and a server may copy the query parameters into
 * its `Location`. So the target is found first with a probe that carries no secrets (no headers or parameters of the
 * options, no cookies), and the request is sent with them only when the redirect ends on the same origin, straight
 * to the final URL. That costs one more request, and only when a redirect happens.
 *
 * Refused (a {@link RedirectWithheldError}): a redirect that ends on another origin, one the probe does not reach
 * (the redirect only happens with the credentials, so its target stays unknown), a final URL that redirects again,
 * and a redirected request other than GET (its body would be lost or resent elsewhere).
 */
async function followHidden(url: string, access: HttpRequestOptions | null, init: RequestInit, fetchFn: typeof fetch): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") throw new RedirectWithheldError("an undisclosed host", url, `a ${method} request was redirected`);
    const probe = await fetchFn(url, {method: "GET", headers: init.headers, signal: init.signal, credentials: "omit", redirect: "follow"});
    await probe.body?.cancel().catch(() => undefined);
    let final: URL | null = null;
    try { final = probe.url ? new URL(probe.url) : null; } catch { final = null; }
    if (!final || !probe.redirected) {
        throw new RedirectWithheldError("an undisclosed host", url, "the browser does not show where it goes, and it does not redirect without the credentials");
    }
    if (final.origin !== new URL(url).origin) throw new RedirectWithheldError(final.host, url);
    const headers = {...(init.headers as Record<string, string> | undefined ?? {}), ...(access?.requestHeaders ?? {})};
    const response = await fetchFn(addParameters(final.toString(), access?.requestParameters), {...init, headers, credentials: credentialsMode(access?.credentials), redirect: "manual"});
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400 && response.status !== 304)) {
        throw new RedirectWithheldError("an undisclosed host", final.toString(), "it redirects again");
    }
    return response;
}

/**
 * Header values replaced by `<redacted>`, for display.
 *
 * @internal
 *
 * @category Protected data
 */
export function redactHeaders(headers: HttpRequestHeaders | null | undefined): Record<string, string> {
    return Object.fromEntries(Object.keys(headers ?? {}).map((k) => [k, "<redacted>"]));
}
