import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createStore, StoreError, summarize } from "./state.mjs";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const filesDirectory = resolve(extensionDirectory, "..", "..", "files");
const store = createStore(join(filesDirectory, "設備規劃.json"));
const assets = new Map([
    ["/", [join(extensionDirectory, "assets", "index.html"), "text/html; charset=utf-8"]],
    ["/style.css", [join(extensionDirectory, "assets", "style.css"), "text/css; charset=utf-8"]],
    ["/app.js", [join(extensionDirectory, "assets", "app.js"), "text/javascript; charset=utf-8"]],
    ["/file-actions.js", [join(extensionDirectory, "assets", "file-actions.js"), "text/javascript; charset=utf-8"]],
    ["/state-transport.js", [join(extensionDirectory, "assets", "state-transport.js"), "text/javascript; charset=utf-8"]],
    ["/floorplan.js", [join(extensionDirectory, "assets", "floorplan.js"), "text/javascript; charset=utf-8"]],
    ["/house-geometry.js", [join(extensionDirectory, "assets", "house-geometry.js"), "text/javascript; charset=utf-8"]],
    ["/furniture.js", [join(extensionDirectory, "assets", "furniture.js"), "text/javascript; charset=utf-8"]],
    ["/bathroom-installation.js", [join(extensionDirectory, "assets", "bathroom-installation.js"), "text/javascript; charset=utf-8"]],
    ["/kitchen-icons.js", [join(extensionDirectory, "assets", "kitchen-icons.js"), "text/javascript; charset=utf-8"]],
    ["/kitchen-plan.js", [join(extensionDirectory, "assets", "kitchen-plan.js"), "text/javascript; charset=utf-8"]],
    ["/outlet-diagram.js", [join(extensionDirectory, "assets", "outlet-diagram.js"), "text/javascript; charset=utf-8"]],
    ["/plan-icons.js", [join(extensionDirectory, "assets", "plan-icons.js"), "text/javascript; charset=utf-8"]],
    ["/plan-visibility.js", [join(extensionDirectory, "assets", "plan-visibility.js"), "text/javascript; charset=utf-8"]],
    ["/equipment-catalog.js", [join(extensionDirectory, "assets", "equipment-catalog.js"), "text/javascript; charset=utf-8"]],
    ["/product-database.js", [join(extensionDirectory, "assets", "product-database.js"), "text/javascript; charset=utf-8"]],
    ["/socket-plan.js", [join(extensionDirectory, "assets", "socket-plan.js"), "text/javascript; charset=utf-8"]],
    ["/lighting-preview.js", [join(extensionDirectory, "assets", "lighting-preview.js"), "text/javascript; charset=utf-8"]],
    ["/circuit-preview.js", [join(extensionDirectory, "assets", "circuit-preview.js"), "text/javascript; charset=utf-8"]],
    ["/door-options.js", [join(extensionDirectory, "assets", "door-options.js"), "text/javascript; charset=utf-8"]],
    ["/slide-tracks.js", [join(extensionDirectory, "assets", "slide-tracks.js"), "text/javascript; charset=utf-8"]],
    ["/partition-options.js", [join(extensionDirectory, "assets", "partition-options.js"), "text/javascript; charset=utf-8"]],
    ["/switch-options.js", [join(extensionDirectory, "assets", "switch-options.js"), "text/javascript; charset=utf-8"]],
    ["/downlights.js", [join(extensionDirectory, "assets", "downlights.js"), "text/javascript; charset=utf-8"]],
    ["/ceiling-lights.js", [join(extensionDirectory, "assets", "ceiling-lights.js"), "text/javascript; charset=utf-8"]],
    ["/track-lighting.js", [join(extensionDirectory, "assets", "track-lighting.js"), "text/javascript; charset=utf-8"]],
    ["/lighting-options.js", [join(extensionDirectory, "assets", "lighting-options.js"), "text/javascript; charset=utf-8"]],
    ["/bathroom-fixtures.js", [join(extensionDirectory, "assets", "bathroom-fixtures.js"), "text/javascript; charset=utf-8"]],
    ["/ac-outdoors.js", [join(extensionDirectory, "assets", "ac-outdoors.js"), "text/javascript; charset=utf-8"]],
    ["/corridor-plan.js", [join(extensionDirectory, "assets", "corridor-plan.js"), "text/javascript; charset=utf-8"]],
    ["/air-conditioning-plan.js", [join(extensionDirectory, "assets", "air-conditioning-plan.js"), "text/javascript; charset=utf-8"]],
    ["/quote-provenance.js", [join(extensionDirectory, "assets", "quote-provenance.js"), "text/javascript; charset=utf-8"]],
    ["/laundry-notes.js", [join(extensionDirectory, "assets", "laundry-notes.js"), "text/javascript; charset=utf-8"]],
    ["/budget.js", [join(extensionDirectory, "assets", "budget.js"), "text/javascript; charset=utf-8"]],
    ["/survey.js", [join(extensionDirectory, "assets", "survey.js"), "text/javascript; charset=utf-8"]],
    ["/portable.html", [resolve(extensionDirectory, "..", "..", "portable",
        "裝修設備規劃.html"), "text/html; charset=utf-8"]],
]);
const servers = new Map();

function jsonResponse(response, status, data) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
}

async function jsonRequest(request) {
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        throw new StoreError(415, "請使用 JSON 格式送出設備資料。");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {
            throw new StoreError(413, "設備清單超過 4 MB 容量限制。");
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new StoreError(400, "送出的設備 JSON 格式不正確。");
        }
        throw error;
    }
}

async function handleRequest(request, response, port) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;

    if (request.method === "GET" && assets.has(path)) {
        const [file, type] = assets.get(path);
        const content = await readFile(file);
        response.writeHead(200, {
            "Content-Type": type,
            ...(path === "/" ? {
                "Content-Security-Policy":
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self'; connect-src 'self'; base-uri 'none'",
            } : {}),
        });
        response.end(content);
        return;
    }
    if (request.method === "GET" && path === "/api/state") {
        jsonResponse(response, 200, await store.read());
        return;
    }
    if (request.method === "PUT" && path === "/api/state") {
        const origin = request.headers.origin;
        if (origin && origin !== "null" && origin !== `http://127.0.0.1:${port}`) {
            throw new StoreError(403, "不接受其他來源對設備清單的修改。");
        }
        const body = await jsonRequest(request);
        if (!Number.isSafeInteger(body?.expectedRevision) || body.expectedRevision < 0) {
            throw new StoreError(400, "缺少有效的資料修訂版次。");
        }
        jsonResponse(response, 200, await store.update(body.expectedRevision, body));
        return;
    }
    jsonResponse(response, 404, { error: "找不到此設備規劃頁面或 API。" });
}

async function startServer(instanceId) {
    const server = createServer((request, response) => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        void handleRequest(request, response, port).catch((error) => {
            if (response.headersSent) {
                response.end();
                return;
            }
            if (!(error instanceof StoreError)) process.stderr.write(`${error.stack || error}\n`);
            jsonResponse(response, error instanceof StoreError ? error.status : 500, {
                error: error instanceof StoreError
                    ? error.message
                    : "設備資料讀取或儲存失敗；請檢查擴充功能日誌。",
                ...(error instanceof StoreError && error.latest ? { latest: error.latest } : {}),
            });
        });
    });
    await new Promise((resolveListening, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolveListening();
        });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

await joinSession({
    canvases: [
        createCanvas({
            id: "renovation-equipment",
            displayName: "裝修設備規劃",
            description: "編輯格局圖、拖放家具與設備，並對照等比例現況門窗及尺寸格線。",
            actions: [
                {
                    name: "snapshot",
                    description: "讀取目前房間與設備清單及已填價格的小計，不修改資料。",
                    handler: async () => {
                        const state = await store.read();
                        return { ...state, summary: summarize(state) };
                    },
                },
            ],
            open: async (ctx) => {
                try {
                    await store.read();
                } catch (error) {
                    if (error instanceof StoreError) {
                        throw new CanvasError("equipment_data_error", error.message);
                    }
                    throw error;
                }
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "裝修設備規劃｜格局圖／現況門窗／房間／物件",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
