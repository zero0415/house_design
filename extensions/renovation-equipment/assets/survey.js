import { EXTERIOR_PLATFORM, HOUSE_SIZE, PLAN_PIXELS_PER_CM } from "./house-geometry.js";
import { planWindows, renderReferenceSchematic } from "./floorplan.js";

// Annotation centers transcribed from the plan, registered to the schematic coordinates.
const DOOR_HEIGHTS = [
    { x: 1037.2, y: 1217.4, label: "DH:208（現況入口）" },
    { x: 799.2, y: 654.8, label: "DH:204.5" },
    { x: 1338.4, y: 659.8, label: "DH:204.5" },
    { x: 1507.6, y: 655.7, label: "DH:204.5" },
    { x: 1554.9, y: 656.5, label: "DH:204.5" },
    { x: 1677.0, y: 719.2, label: "DH:204.5" },
    { x: 1608.7, y: 847.6, label: "DH:204.5" },
    { x: 1599.3, y: 919.7, label: "DH:206" },
    { x: 881.6, y: 679.2, label: "DH:204.5" },
].map(({ x, y, label }) => ({ x: 1254 - y, y: x - 95, label }));

const CROP = { x: -40, y: -50, width: HOUSE_SIZE.width + 80, height: HOUSE_SIZE.height + 100 };
export const SURVEY_PIXELS_PER_CM = PLAN_PIXELS_PER_CM;
const METER = 100 * PLAN_PIXELS_PER_CM;
const EXTERIOR_PLATFORM_PATH = `M${EXTERIOR_PLATFORM.x} ${EXTERIOR_PLATFORM.y}
    H${EXTERIOR_PLATFORM.x + EXTERIOR_PLATFORM.width}
    V${EXTERIOR_PLATFORM.y + EXTERIOR_PLATFORM.height} H${EXTERIOR_PLATFORM.x}`;

function windowHighlight(window) {
    const label = `W:${window.widthCm}/${window.heightCm}（cm，原圖標註）`;
    const align = window.side === "right" ? "end" : "start";
    const x = window.x + (window.side === "right" ? -14 : 14);
    return `<g class="survey-window" role="img" aria-label="${label}">
        <title>${label}；藍圈表示示意窗洞，不是現場量測位置</title>
        <path class="survey-window-span" d="${window.path}"/>
        <circle cx="${window.x}" cy="${window.y}" r="16"/>
        <text x="${x}" y="${window.y - 17}" text-anchor="${align}">W:${window.widthCm}</text>
    </g>`;
}

function doorHighlight(door) {
    return `<g class="survey-door" role="img" aria-label="原圖門高標註 ${door.label}">
        <title>${door.label}；橙框是轉繪標註，不代表門洞實測或新門報價</title>
        <rect x="${door.x - 12}" y="${door.y - 12}" width="24" height="24" rx="2"/>
        <text x="${door.x}" y="${door.y - 17}" text-anchor="middle">${door.label}</text>
    </g>`;
}

export function renderSurvey(options, rooms) {
    const imageWidth = options.zoom === "fit" ? "min(100%, 35vh, 390px)"
        : `${Math.round(CROP.width * Number(options.zoom))}px`;
    return `<section class="survey-view">
        <p class="plan-disclaimer"><strong>去識別化門窗示意</strong>：房間輪廓由規劃器幾何重畫，
            含新增隔間，不是原始現況掃描。藍圈表示 W 窗洞、橙框表示原圖 DH 門高；
            標註位置僅供討論，不是施工門位或現場實測。</p>
        <div class="survey-toolbar">
            <label>縮放
                <select data-survey-zoom>
                    <option value="fit" ${options.zoom === "fit" ? "selected" : ""}>顯示全圖</option>
                    <option value="1" ${options.zoom === "1" ? "selected" : ""}>圖面 100%</option>
                    <option value="1.5" ${options.zoom === "1.5" ? "selected" : ""}>放大 150%</option>
                </select>
            </label>
            <button type="button" data-action="survey-grid" aria-pressed="${options.grid}">1 公尺格線</button>
            <button type="button" data-action="survey-windows" aria-pressed="${options.windows}">W 窗洞</button>
            <button type="button" data-action="survey-doors" aria-pressed="${options.doors}">DH 門位</button>
            <button type="button" data-action="survey-exterior-rail"
                aria-pressed="${options.exteriorRail}">外推鐵窗</button>
        </div>
        <div class="survey-scroll">
            <svg class="survey-svg" viewBox="${CROP.x} ${CROP.y} ${CROP.width} ${CROP.height}"
                style="width:${imageWidth}" role="group"
                aria-label="重繪格局與按圖面比例校準的 1 公尺格線、門窗尺寸標註">
                <defs><pattern id="meter-grid" x="0" y="0" width="${METER}" height="${METER}"
                    patternUnits="userSpaceOnUse">
                    <path d="M${METER} 0 H0 V${METER}" class="survey-grid-line"/>
                </pattern></defs>
                <rect class="survey-paper" x="0" y="0"
                    width="${HOUSE_SIZE.width}" height="${HOUSE_SIZE.height}"/>
                ${renderReferenceSchematic(rooms, {
                    proposed: true, windowsVisible: false, doorsVisible: false,
                })}
                ${options.grid ? `<rect x="0" y="0"
                    width="${HOUSE_SIZE.width}" height="${HOUSE_SIZE.height}"
                    fill="url(#meter-grid)" pointer-events="none"/>
                    <g class="survey-scale" transform="translate(690 1945)">
                        <rect x="-12" y="-31" width="150" height="52" rx="4"/>
                        <path d="M0 0 H${METER} M0 -6 V6 M${METER} -6 V6"/>
                        <text x="${METER / 2}" y="-11" text-anchor="middle">100 cm</text>
                    </g>` : ""}
                ${options.windows ? planWindows.map(windowHighlight).join("") : ""}
                ${options.doors ? DOOR_HEIGHTS.map(doorHighlight).join("") : ""}
                ${options.exteriorRail ? `<g class="survey-exterior-rail" role="img"
                    aria-label="外側 U 形外推輪廓；室外機與烘衣機暫位">
                    <title>轉繪外推輪廓並作設備暫位；材質、載重及許可均未確認。</title>
                    <path d="${EXTERIOR_PLATFORM_PATH}"/>
                </g>` : ""}
            </svg>
        </div>
        <p class="muted survey-note">格線依圖面 1:60 比例轉繪，每格約 100 cm；
            W／DH 數值從原圖標註轉寫，原圖及 PDF 未收錄，仍須現場丈量。
            W:209.5/0 沒有窗高，未當成窗戶。</p>
        <p class="muted survey-note">示意圖含規劃新增隔間；門洞、開向與已報價門片
            請以「格局圖」頁的規劃標示和報價明細對照，不得直接據圖施工。</p>
        <p class="muted survey-note">紫線表示外側的暫定設備區，
            沒有承重、材質或核准資料，不得推定室外機或烘衣機可安全安裝。</p>
    </section>`;
}
