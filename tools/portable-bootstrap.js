const bundle = JSON.parse(document.querySelector("#portable-bundle").textContent);
const moduleURLs = new Map();

try {
    for (const entry of bundle.modules) {
        let source = entry.source.replace(/\bfrom\s+(["'])(\.[^"']+)\1/g,
            (_match, _quote, relative) => {
                const path = new URL(relative, `https://offline.invalid/${entry.path}`)
                    .pathname.slice(1);
                const dependency = moduleURLs.get(path);
                if (!dependency) throw new Error(`離線程式缺少相依模組：${path}`);
                return `from "${dependency}"`;
            });
        moduleURLs.set(entry.path,
            URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    }
    const { validateState } = await import(moduleURLs.get("state-browser.mjs"));
    const { PLANNER_STATE_VERSION } = await import(moduleURLs.get("assets/socket-plan.js"));
    const storageKey = `renovation-equipment-offline-v1:${location.pathname}`;
    let current = null;
    let damagedStorage = null;
    let unavailableStorage = null;
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) current = validateState(JSON.parse(saved));
    } catch (error) {
        if (error.name === "SecurityError") unavailableStorage = error;
        else damagedStorage = error;
    }
    window.addEventListener("storage", (event) => {
        if (event.key !== storageKey) return;
        if (event.newValue === null) {
            current = null;
            damagedStorage = null;
            return;
        }
        try {
            current = validateState(JSON.parse(event.newValue));
            damagedStorage = null;
        } catch (error) {
            damagedStorage = error;
        }
    });

    globalThis.__RENOVATION_OFFLINE_STORE__ = {
        async read() {
            if (damagedStorage) {
                throw new Error("瀏覽器暫存資料無法驗證；請用「讀檔 JSON」還原存檔。");
            }
            if (!current) {
                const error = new Error(unavailableStorage
                    ? "瀏覽器不允許自動儲存；請讀入 JSON 並定期下載存檔。"
                    : "請先讀入 JSON 設備規劃存檔。");
                error.noState = true;
                throw error;
            }
            return structuredClone(current);
        },
        async update(candidate) {
            if (candidate?.version !== PLANNER_STATE_VERSION) {
                throw new Error("畫布資料結構已更新，請重新載入新版離線 HTML。");
            }
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    let latest;
                    try {
                        latest = validateState(JSON.parse(saved));
                    } catch (error) {
                        if (!candidate.importing || !damagedStorage) {
                            throw new Error("瀏覽器暫存資料無法驗證；請用 JSON 存檔還原。");
                        }
                    }
                    if (latest && (!current || latest.revision !== current.revision)) {
                        current = latest;
                        const conflict = new Error(
                            "另一個離線分頁已更新規劃；請重新載入後再讀檔或編輯。");
                        conflict.conflict = true;
                        throw conflict;
                    }
                }
            } catch (error) {
                if (error.conflict) throw error;
                if (error.name === "SecurityError") unavailableStorage = error;
                else throw error;
            }
            const revision = current?.revision ?? 0;
            if (candidate.expectedRevision !== revision) {
                const error = new Error("規劃已在另一個頁面更新；請重新讀檔後再修改。");
                error.conflict = true;
                throw error;
            }
            const next = validateState({
                version: PLANNER_STATE_VERSION,
                revision: revision + 1,
                updatedAt: new Date().toISOString(),
                rooms: candidate.rooms,
                items: candidate.items,
                products: candidate.products,
                undo: candidate.undo ?? null,
            });
            let warning = null;
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
                damagedStorage = null;
                unavailableStorage = null;
            } catch (error) {
                warning = `瀏覽器未允許自動儲存（${error.name}）。` +
                    "目前資料只在此分頁，請立即按「存檔 JSON」下載備份。";
            }
            current = structuredClone(next);
            return { ...next, storageWarning: warning };
        },
    };
    await import(moduleURLs.get("assets/app.js"));
} catch (error) {
    document.querySelector("#content").textContent =
        "離線規劃器無法啟動。請確認 HTML 檔案完整，並使用最新版 Chrome 或 Edge。";
    const status = document.querySelector("#save-status");
    status.textContent = error.message;
    status.dataset.kind = "error";
}
