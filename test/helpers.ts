import {readFileSync} from "node:fs";
import {createServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export interface RecordedRequest {
    url: string;
    range?: string;
    headers: Record<string, string | string[] | undefined>;
}

/** A document served with a status and content type of its own. */
export interface ServedDocument {
    status?: number;
    body?: string;
    contentType?: string;
}

/**
 * Minimal static server with HTTP Range support, recording the requests it receives. `files` adds documents by path
 * (text, or a function of the server's own origin, or a {@link ServedDocument}); `/__redirect/<encoded URL>` answers
 * 302 to it. Other paths are read from test/fixtures. `options.ignoreRange` answers 200 with the whole body, as
 * servers without range support do.
 */
export async function startRangeServer(files: Record<string, string | ((origin: string) => string) | ServedDocument> = {},
    options: { ignoreRange?: boolean } = {}): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
    const requests: RecordedRequest[] = [];
    let origin = "";
    const server: Server = createServer((req, res) => {
        const path = (req.url ?? "/").split("?")[0];
        requests.push({url: req.url ?? "", range: req.headers.range, headers: req.headers});
        if (path.startsWith("/__redirect/")) {
            res.writeHead(302, {Location: decodeURIComponent(path.slice("/__redirect/".length))}).end();
            return;
        }
        let body: Buffer;
        let contentType: string | undefined;
        try {
            const doc = files[path];
            if (doc !== undefined && typeof doc === "object") {
                if (doc.status && doc.status >= 400) {
                    res.writeHead(doc.status, {"Content-Type": doc.contentType ?? "text/plain"}).end(doc.body ?? "");
                    return;
                }
                contentType = doc.contentType;
                body = Buffer.from(doc.body ?? "");
            } else {
                body = doc !== undefined ? Buffer.from(typeof doc === "function" ? doc(origin) : doc)
                    : readFileSync(join(FIXTURES, decodeURIComponent(path)));
            }
        } catch {
            res.writeHead(404).end();
            return;
        }
        const match = options.ignoreRange ? null : /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        const type = contentType ? {"Content-Type": contentType} : {};
        if (match && body.length === 0) {
            res.writeHead(416, {"Content-Range": "bytes */0"}).end();
        } else if (match) {
            const start = Number(match[1]);
            const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${body.length}`,
                "Content-Length": end - start + 1,
                "Accept-Ranges": "bytes", ...type,
            });
            res.end(body.subarray(start, end + 1));
        } else {
            res.writeHead(200, {"Content-Length": body.length, ...(options.ignoreRange ? {} : {"Accept-Ranges": "bytes"}), ...type});
            res.end(body);
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
    return {
        url: origin,
        requests,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
