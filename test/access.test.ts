import {afterEach, describe, expect, it} from "vitest";
import {StacClient} from "../src/index.js";
import {startRangeServer, type RecordedRequest} from "./helpers.js";

/** Two servers on different ports: two origins. */
type Server = Awaited<ReturnType<typeof startRangeServer>>;
let servers: Server[] = [];
async function origins(filesA: Parameters<typeof startRangeServer>[0] = {}, filesB: Parameters<typeof startRangeServer>[0] = {}) {
    const a = await startRangeServer(filesA), b = await startRangeServer(filesB);
    servers.push(a, b);
    return {a, b};
}
afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
});

const TOKEN = "s3cret-token";
const headers = {Authorization: `Bearer ${TOKEN}`};
const carries = (r: RecordedRequest) => r.headers.authorization !== undefined || r.url.includes(TOKEN);

describe("credentials, headers and parameters reach the intended server only", () => {
    it("does not follow next links to another origin with the client's token, and redacts headers in plans", async () => {
        let second = "";
        const page = (features: unknown[], next?: string) => JSON.stringify({type: "FeatureCollection", features,
            links: next ? [{rel: "next", href: next}] : []});
        const feature = (id: string) => ({type: "Feature", id, bbox: [0, 0, 1, 1], properties: {datetime: "2024-01-01T00:00:00Z"}, assets: {}});
        const {a, b} = await origins({
            "/v1": (o) => JSON.stringify({conformsTo: ["https://api.stacspec.org/v1.0.0/item-search"], links: [{rel: "search", href: `${o}/v1/search`}]}),
            "/v1/search": () => page([feature("one")], `${second}/page2`),
        }, {"/page2": page([feature("two")])});
        second = b.url;
        const client = await StacClient.connect(`${a.url}/v1`, {requestHeaders: headers, requestParameters: {token: TOKEN}, method: "GET", verify: "never"});
        const found = await client.search({}).collect();
        expect(found.map((i) => i.id)).toEqual(["one", "two"]);
        expect(a.requests.every(carries)).toBe(true);
        expect(b.requests.length).toBe(1);
        expect(b.requests.some(carries)).toBe(false);
        const plan = client.plan({});
        expect(plan.code.curl).toContain("Authorization: <redacted>");
        expect(JSON.stringify(plan)).not.toContain(TOKEN);
    });
});
