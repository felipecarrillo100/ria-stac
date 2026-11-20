import {it} from "vitest";
import {StacClient, type RiaStacRequest} from "../src/index.js";
it("cdse", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        const r = await real(url, init);
        if (init?.method === "POST" && r.status >= 400) console.log("BODY", String(init.body).slice(0, 700), "\nANSWER", (await r.clone().text()).slice(0, 400));
        return r;
    }) as typeof fetch;
    const reqs: RiaStacRequest[] = [];
    const c = await StacClient.connect("https://stac.dataspace.copernicus.eu/v1", {onRequest: (r) => reqs.push(r)});
    const t0 = Date.now();
    await c.listCollections().catch((e) => console.log("list", e.message));
    console.log("list ms", Date.now() - t0);
    try {
        await c.select({collection: "sentinel-2-l2a", area: [-43.927, -19.99, -43.861, -19.946], datetime: "2024-06-01/2024-09-30", maxCloud: 20, maxItems: 200, pick: {rank: "least-cloud"}});
    } catch (e) { console.log("select", (e as Error).message); }
    for (const r of reqs) console.log(r.method, r.status ?? r.error, r.ms.toFixed(0), decodeURIComponent(r.url).slice(0, 300));
});
