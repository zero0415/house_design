export const ROBOT_ID = "living-auto-water-robot";
export const ROBOT_LABEL = "掃拖機器人／自動上下水（條件暫位）";
export const ROBOT_TAG = "[auto-water-robot:1]";
export const ROBOT_FEATURE_VERSION = 1;
export const ROBOT_SYMBOL_SIZE = 24;
export const ROBOT_CAUTION =
    "條件式暫位／非施工：客餐廳乾側靠主浴入口，非主臥側或浴室內。" +
    "型號、機身／基座寬深高及門扇、逃生、維修淨空均未量；圖示不是實機占地。" +
    "自動上下水只是需求；進水、污水路徑、排水坡度、防回流、防漏、防淹、檢修及合法施工須現勘。" +
    "電壓、接地及濕區防護須合格電工核對；未指定任何 R／B 標位、插座或專用迴路，" +
    "既有掃地機充電插座不代表供電已核可。" +
    "機器、基座、材料與安裝均未報價，不可視為免費或已含原工程。";

export const isPlannedRobot = (item) =>
    item?.id === ROBOT_ID && item.kind === "equipment";

export function hasRobotPlan(state) {
    return [state?.items, state?.undo?.items].some((items) =>
        items?.some((item) => item.id === ROBOT_ID));
}

export function guardRobotPlanUpdate(current, candidate) {
    if ((hasRobotPlan(current) || hasRobotPlan(candidate)) &&
        candidate?.robotFeatureVersion !== ROBOT_FEATURE_VERSION) {
        throw new TypeError(
            "此存檔含掃拖機條件規劃（含復原）；請重新載入支援此功能的版本，舊版不能寫入。"
        );
    }
}

export function robotSymbol(width = ROBOT_SYMBOL_SIZE, height = ROBOT_SYMBOL_SIZE) {
    return `<g class="object-icon robot-symbol">
        <title>掃拖機與上下水基座僅暫位；尺寸及淨空待核，符號非實際占地</title>
        <rect x="${-width * .4}" y="${-height * .45}"
            width="${width * .8}" height="${height * .4}" rx="2"/>
        <circle cy="${height * .15}" r="${Math.min(width, height) * .3}"/>
        <path d="M${-width * .14} ${height * .15} H${width * .14}"/>
        <text x="${width * .35}" y="${height * .45}"
            text-anchor="middle">?</text>
    </g>`;
}

export function robotMarkerLabel() {
    return '<text class="robot-plan-label" x="-18" y="-2" text-anchor="end">掃拖機器人' +
        '<tspan x="-18" dy="12">自動上下水（暫位）</tspan></text>';
}

export function renderRobotCaution(items) {
    if (!items.some(isPlannedRobot)) return "";
    return `<aside class="robot-caution" role="note">
        <div class="robot-legend" data-robot-legend>
            <svg width="48" height="48" viewBox="-18 -18 36 36"
                role="img" aria-label="掃拖機器人與上下水需求符號，非實機占地">
                ${robotSymbol()}</svg>
            <strong>${ROBOT_LABEL}</strong>
            <span>型號／尺寸／價格未知；沒有已核定的水電接點。</span>
        </div>
        <p class="plan-overlap-alert" data-robot-warning>
            掃拖機僅暫位、非施工：主浴入口門扇／逃生淨空、給排水、
            合格供電與實價均未核；未知費用不能視為零元。</p>
        <details><summary>掃拖機水電與現勘條件（展開）</summary>
            <p>${ROBOT_CAUTION}</p></details>
    </aside>`;
}
