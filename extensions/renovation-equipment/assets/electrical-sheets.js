import { markerPosition, renderOverviewPlan, roomGeometry } from "./floorplan.js";
import { HOUSE_ZONE_BY_ID } from "./house-geometry.js";
import { diagramPointSymbol, OUTLET_POINT_WARNINGS } from "./outlet-diagram.js";
import { isDedicatedCircuit, isSocket, isWeakCurrent } from "./socket-plan.js";
import { isQuotedEquipment } from "./budget.js";
import { trackLengthCm } from "./track-lighting.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const lightTypes = { ceiling: "吸頂燈", recessed: "崁燈", track: "軌道燈" };
const positive = (value) => Number.isFinite(value) && value > 0;
const count = (value) => Number.isInteger(value) && value >= 0 ? value : null;
const spec = (value, unit) => positive(value) ? `${value}${unit}` : `${unit}待核`;
const origin = (item) => isQuotedEquipment(item) ? "原報" : "另列";
const layers = Object.freeze({
    furniture: false, outlets: false, lights: false, switches: false,
});

export function electricalSheetData(state) {
    if (state?.version !== 5 || !Number.isSafeInteger(state.revision) ||
        state.revision < 0 ||
        !Array.isArray(state.rooms) || !Array.isArray(state.items) ||
        !Array.isArray(state.products)) {
        throw new TypeError("只讀配置圖需要完整的 v5 房間、物件與商品資料。");
    }
    const { rooms, items } = state;
    const roomIds = new Set(rooms.filter((room) =>
        HOUSE_ZONE_BY_ID.has(room.id)).map((room) => room.id));
    const placed = (item) => roomIds.has(item.roomId) &&
        Number.isFinite(item.placement?.x) && Number.isFinite(item.placement?.y);
    const endpoints = items.filter((item) => !isDedicatedCircuit(item) &&
        (item.outletPlanPointId || isSocket(item) || isWeakCurrent(item)));
    const lights = items.filter((item) => Object.hasOwn(lightTypes, item.lightType));
    const switches = items.filter((item) => item.switchType);
    const headCount = (item) => count(item.lightType === "track"
        ? item.spotlightQuantity : item.quantity);
    const placedLights = lights.filter(placed);
    return {
        rooms, items, endpoints, placedEndpoints: endpoints.filter(placed),
        circuits: items.filter(isDedicatedCircuit),
        lights, placedLights,
        activeSwitches: switches.filter((item) =>
            item.switchPlanStatus === "active" && placed(item)),
        removedSwitches: switches.filter((item) =>
            item.switchPlanStatus === "removed"),
        unresolvedSwitches: switches.filter((item) =>
            item.switchPlanStatus !== "removed" &&
            (item.switchPlanStatus !== "active" || !placed(item))),
        counts: Object.fromEntries(["R", "B", "C"].map((prefix) =>
            [prefix, endpoints.filter((item) =>
                item.outletPlanPointId?.startsWith(prefix)).length])),
        heads: placedLights.reduce((sum, item) => sum + (headCount(item) ?? 0), 0),
        unknownHeads: placedLights.filter((item) => headCount(item) === null).length,
    };
}

function lightDescription(item) {
    const track = item.lightType === "track";
    const heads = track ? count(item.spotlightQuantity) : count(item.quantity);
    return `${lightTypes[item.lightType]}｜${origin(item)}｜${track
        ? `${positive(item.trackLengthCm)
            ? `${item.trackLengthCm / 100}m` : "長度待核"}軌道；` : ""}` +
        `${heads ?? "數量待核"}頭；每頭${spec(item.lightWatts, "W")}；` +
        `${item.brandModel || "型號待核"}${track
            ? `；燈頭：${item.spotlightModel || "型號待核"}` : ""}；` +
        `${spec(item.lightLumens, "lm")}／${spec(item.beamAngleDeg, "°")}；` +
        `${item.lightSpecSource || "光學來源待核"}`;
}

function marker(item, geometry, label, description, category, body, extra,
    labelBoxes, positions) {
    const { x, y } = markerPosition(item, geometry);
    const right = item.placement.x > .85;
    const width = 4 + [...label].reduce((sum, char) =>
        sum + (char.charCodeAt(0) > 127 ? 16 : 9), 0);
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
    const candidates = [right, !right].flatMap((end) =>
        [-10, 24, -30, 44, -50, 64].map((dy) => {
            const dx = end ? -13 : 13;
            const box = {
                x: x + dx - (end ? width : 0), y: y + dy - 21,
                width, height: 27,
            };
            const collisions = [...labelBoxes, ...positions]
                .filter((other) => overlaps(box, other)).length;
            return {
                dx, dy, end, box,
                collisions: collisions +
                    (box.x < 10 || box.x + width > 935 ? 100 : 0),
            };
        }));
    const chosen = candidates.find((candidate) => candidate.collisions === 0) ??
        candidates.reduce((best, candidate) =>
            candidate.collisions < best.collisions ? candidate : best);
    labelBoxes.push(chosen.box);
    return `<g class="sheet-marker sheet-${category}"
        transform="translate(${x} ${y})" tabindex="0" role="img"
        aria-label="${escape(description)}" ${extra}>
        <title>${escape(description)}</title>${body}
        ${chosen.dy !== -10 || chosen.end !== right
            ? `<path class="sheet-label-leader"
                data-label-for="${escape(item.id)}"
                d="M0 0 L${chosen.dx} ${chosen.dy - 5}"/>` : ""}
        <text class="sheet-marker-label" x="${chosen.dx}" y="${chosen.dy}"
            text-anchor="${chosen.end ? "end" : "start"}">${escape(label)}</text>
    </g>`;
}

function lightSymbol(item, geometry) {
    if (item.lightType !== "track") {
        const heads = count(item.quantity);
        return `<circle class="sheet-light-head" ${heads === 1
            ? "data-light-head" : `data-head-group="${heads ?? "unknown"}"`}
            r="${item.lightType === "ceiling" ? 13 : 8}"/>${heads === 1
            ? '<path d="M-5 -5 L5 5 M-5 5 L5 -5"/>' :
                `<text y="4" text-anchor="middle">${heads ?? "?"}</text>`}`;
    }
    const length = positive(item.trackLengthCm) && item.trackLengthCm <= 3000
        ? trackLengthCm(item.trackLengthCm) * geometry.cmScale : null;
    const heads = count(item.spotlightQuantity);
    // An unknown length must not silently reuse the old 150cm track template.
    return `<g transform="rotate(${item.orientation ?? 0})"
        data-track-length="${length ?? "unknown"}">
        ${length === null ? '<rect x="-10" y="-10" width="20" height="20"/>' :
            `<path class="sheet-track" d="M0 ${-length / 2} V${length / 2}"/>`}
        ${heads === null || length === null
            ? '<text y="5" text-anchor="middle">?</text>' :
                Array.from({ length: heads }, (_, index) =>
                    `<circle class="sheet-light-head" data-light-head
                        cx="0" cy="${length * ((index + .5) / heads - .5)}"
                        r="7"/>`).join("")}
    </g>`;
}

export function renderElectricalSheet(state, view) {
    if (!["outlet-sheet", "lighting-sheet"].includes(view)) {
        throw new RangeError("未知的配置圖檢視。");
    }
    const data = electricalSheetData(state);
    const outlets = view === "outlet-sheet";
    const title = outlets ? "插座配置圖" : "燈具配置圖";
    const points = new Set(data.placedEndpoints);
    const lights = new Set(data.placedLights);
    const switches = new Set(data.activeSwitches);
    const labelBoxes = [];
    const positions = [...(outlets ? points :
        new Set([...lights, ...switches]))].map((item) => {
        const p = markerPosition(item, roomGeometry(
            data.rooms.find((room) => room.id === item.roomId)));
        return { x: p.x - 9, y: p.y - 9, width: 18, height: 18 };
    });
    const products = new Map(state.products.map((product) => [product.id, product]));
    const lightLabels = new Map(data.lights.map((item, index) =>
        [item.id, `L${String(index + 1).padStart(2, "0")}`]));
    const switchLabels = new Map(data.activeSwitches.map((item, index) =>
        [item.id, `S${String(index + 1).padStart(2, "0")}`]));
    const linkedWarning = (item) => item.productId &&
        !products.has(item.productId) ? "；已連結商品不存在，規格待核" : "";
    const description = (item) =>
        `${item.name}；${item.lightType ? lightDescription(item) :
            item.brandModel || "型號待核"}${linkedWarning(item)}`;
    const draw = (item, geometry, roomName) => {
        if (outlets) {
            if (!points.has(item)) return "";
            const id = item.outletPlanPointId;
            const validId = /^(R(?:0[1-9]|[1-4][0-9]|5[01])|B0[1-9]|C0[1-7])$/
                .test(id ?? "");
            return marker(item, geometry, id || "未編號",
                `${roomName}；${description(item)}；${item.note || ""}`,
                validId ? id[0] : "unassigned",
                validId ? diagramPointSymbol(item) : '<circle r="8"/>',
                `data-sheet-point="${escape(id || item.id)}"`,
                labelBoxes, positions);
        }
        if (lights.has(item)) {
            return marker(item, geometry,
                `${lightLabels.get(item.id)} ${origin(item)} ${spec(item.lightWatts, "W")}`,
                `${roomName}；${description(item)}`, item.lightType,
                lightSymbol(item, geometry),
                `data-sheet-light="${escape(item.id)}"`,
                labelBoxes, positions);
        }
        if (switches.has(item)) {
            return marker(item, geometry, switchLabels.get(item.id),
                `${roomName}；${description(item)}；有效開關位置，控制對象與配線未核`,
                "switch",
                '<rect x="-7" y="-7" width="14" height="14"/>' +
                    '<text y="4" text-anchor="middle">S</text>',
                `data-sheet-switch="${escape(item.id)}"`,
                labelBoxes, positions);
        }
        return "";
    };
    const listed = outlets ? data.endpoints : [...data.lights, ...data.activeSwitches];
    const unplaced = outlets
        ? data.endpoints.length - data.placedEndpoints.length
        : data.lights.length - data.placedLights.length;
    const warnings = outlets ? Object.entries(OUTLET_POINT_WARNINGS)
        .filter(([id]) => data.endpoints.some((item) =>
            item.outletPlanPointId === id))
        .map(([id, text]) =>
            `<li><strong>${id}</strong>：${escape(text)}</li>`).join("") : "";
    const removed = data.removedSwitches.map((item) =>
        escape(item.name)).join("、");
    const legend = outlets
        ? `<span class="sheet-R">● R 一般 ${data.counts.R}</span>
           <span class="sheet-B">● B 專用端點 ${data.counts.B}</span>
           <span class="sheet-C">□ C 弱電 ${data.counts.C}</span>
           <span>已標 ${data.placedEndpoints.length} 個端點／
               ${data.endpoints.length} 筆；
               專用迴路資料 ${data.circuits.length} 筆（不另畫插座）</span>`
        : `<span class="sheet-ceiling">⊗ 吸頂 ${data.placedLights.filter(
            (item) => item.lightType === "ceiling").length}</span>
           <span class="sheet-recessed">⊗ 崁燈 ${data.placedLights.filter(
            (item) => item.lightType === "recessed").length}</span>
           <span class="sheet-track">● 軌道 ${data.placedLights.filter(
            (item) => item.lightType === "track").length}</span>
           <span>${data.placedLights.length} 個已放置燈具物件／已知
               ${data.heads} 頭${data.unknownHeads
                   ? `；${data.unknownHeads} 筆頭數未定` : ""}</span>
           <span class="sheet-switch">□ 有效已放置開關
               ${data.activeSwitches.length}</span>
           <span>原報＝原報額度物件；另列＝額度外物件，非安裝核可。</span>`;
    return `<article class="electrical-sheet" data-sheet="${view}">
        <header><h2>${title}</h2>
            <p>非施工圖／目前資料版本 v${escape(state.version)}・r${escape(state.revision)}
                ｜只讀位置圖，不是印刷比例或配線圖</p></header>
        <div class="sheet-legend" aria-label="圖例與目前數量">${legend}</div>
        <p class="sheet-caution">${outlets
            ? "R／B／C 均依目前存檔，來源衝突不自動移位；C 是弱電／網路，不是電源。專用迴路只是關聯資料，不是額外插座或已核實線路。"
            : "開關只表示位置，控制對象未核；不畫模擬控制線或實際配線。W 不能推算照度，lm／光束角不足不做照度估算。"}底圖沿用現況牆、窗、門與目前方案；不得據此施工。</p>
        ${unplaced ? `<p class="sheet-caution">${unplaced} 筆缺位置或可對應房間，
            未畫入底圖；請查下方清單。</p>` : ""}
        ${warnings ? `<details class="sheet-warnings">
            <summary>來源位置警示（${Object.keys(OUTLET_POINT_WARNINGS)
                .filter((id) => data.endpoints.some((item) =>
                    item.outletPlanPointId === id)).join("／")}，未解決</summary>
            <ul>${warnings}</ul></details>` : ""}
        ${!outlets ? `<p>移除開關 ${data.removedSwitches.length}
            （不畫有效標位）：${removed || "無"}。
            狀態／位置未定 ${data.unresolvedSwitches.length}。</p>` : ""}
        <p class="muted">可水平捲動查看圖面；聚焦或指向標記可讀規格，
            完整文字清單在圖下方。符號非實機占地；
            短灰線只連同一標記的文字，不是配線或控制關係。</p>
        <div class="sheet-scroll" tabindex="0" role="region"
            aria-label="${title}可捲動圖面">
            ${renderOverviewPlan(data.rooms, data.items, false, null,
                layers, null, 80, draw)}
        </div>
        <details class="sheet-schedule">
            <summary>${outlets ? "端點" : "燈具與有效開關"}文字清單
                （${listed.length} 筆）</summary>
            <ul>${listed.map((item) =>
                `<li><strong>${escape(item.outletPlanPointId ||
                    lightLabels.get(item.id) || switchLabels.get(item.id) ||
                    "未編號")}・${escape(data.rooms.find((room) =>
                        room.id === item.roomId)?.name || "房間未定")}</strong>
                    ${escape(description(item))}${outlets
                        ? `<details><summary>位置／供電待核說明</summary>
                            <p>${escape(item.note || "待核")}</p></details>` : ""}</li>`
            ).join("")}</ul>
        </details>
    </article>`;
}
