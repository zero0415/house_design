import {
    APPROVED_MANAGEMENT_FEE, editManagementFee, managementFeeCsv,
    MANAGEMENT_FEE_LABEL, MANAGEMENT_FEE_RECIPIENT, managementFeeSummary,
    undoManagementFee, validateFeePeriod,
} from "./management-fee.js";
import { MAX_DATE, MIN_DATE } from "./construction-calendar.js";
import { downloadFile } from "./file-actions.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;",
    })[char]);
const money = (value) =>
    `NT$${new Intl.NumberFormat("zh-TW", {
        maximumFractionDigits: 2,
    }).format(value)}`;

export const managementFeeUI = () => ({
    draft: null, changed: false, busy: false, error: "",
});

export function managementFeeDescription(value) {
    const { fee, days, sundays, totalTWD } = managementFeeSummary(value);
    return fee
        ? `${MANAGEMENT_FEE_RECIPIENT}｜${fee.start}～${fee.end}（含首尾）｜` +
            `${days} 個日曆日（含 ${sundays} 個週日）×` +
            `${money(fee.dailyRate)}／日＝${money(totalTWD)}`
        : "未設定／未計入；須明確儲存或載入已審閱的示例才計費。";
}

function fromDraft(draft) {
    if (String(draft.dailyRate).trim() === "") {
        throw new TypeError("每日費率不可留白；0 元也須明確填寫。");
    }
    return validateFeePeriod({
        start: draft.start, end: draft.end,
        dailyRate: Number(draft.dailyRate),
    });
}

export function renderManagementFee(value, ui) {
    const { fee } = managementFeeSummary(value);
    const draft = ui.draft;
    return `<section class="management-fee" aria-labelledby="management-fee-heading">
        <h2 id="management-fee-heading">${MANAGEMENT_FEE_LABEL}</h2>
        <p class="management-fee-summary">
            ${managementFeeDescription(value)}</p>
        <p>收款對象：${MANAGEMENT_FEE_RECIPIENT}。原報價外另計，不取代原承包商
            「工程清潔」NT$35,000；原工程基準 NT$1,959,530 不變。</p>
        <p>按日曆日含首尾計費，所有週日及假日照計；師傅週日休假不扣款。
            起迄及費率獨立，不隨工項新增、刪除或改期調整；
            不推定稅金、監工費或施工核可。</p>
        <div class="management-fee-actions">
            <button type="button" data-fee-edit
                ${ui.busy ? "disabled" : ""}>
                ${fee ? "編輯清潔費" : "設定清潔費"}</button>
            <button type="button" data-fee-undo
                ${ui.busy || !value?.undo ? "disabled" : ""}>
                還原清潔費上一步</button>
            <button type="button" data-fee-csv
                ${ui.busy ? "disabled" : ""}>匯出清潔費 CSV</button>
        </div>
        <p class="management-fee-error" role="alert">${escape(ui.error)}</p>
        ${draft ? `<form data-fee-form><fieldset ${ui.busy ? "disabled" : ""}>
            <legend>管委會清潔費（按儲存才計入）</legend>
            <label>開始日期（含）
                <input type="date" name="start" required
                    min="${MIN_DATE}" max="${MAX_DATE}"
                    value="${escape(draft.start)}"></label>
            <label>結束日期（含）
                <input type="date" name="end" required
                    min="${MIN_DATE}" max="${MAX_DATE}"
                    value="${escape(draft.end)}"></label>
            <label>每日費率（NT$）
                <input type="number" name="dailyRate" min="0"
                    max="1000000000" step="0.01" required
                    value="${escape(draft.dailyRate)}"></label>
            <p class="fee-live-preview" role="status">
                尚未儲存；獨立計費，不改施工日期。</p>
            <div class="management-fee-actions">
                <button type="submit">儲存清潔費</button>
                <button type="button" data-fee-cancel>取消</button>
                ${fee ? `<button type="button" data-fee-remove>
                    移除清潔費</button>` : ""}
            </div>
        </fieldset></form>` : ""}
        <p>清潔費只保留自己的一步復原，不使用設備或日曆上一步。
            物件清單 CSV 不含此獨立費用；請另匯出清潔費 CSV。
            完整 JSON 包含費用與三份獨立復原。</p>
    </section>`;
}

export function bindManagementFee(section, value, ui, actions) {
    const discard = () => !ui.changed ||
        window.confirm("捨棄尚未儲存的清潔費表單？");
    const save = async (next) => {
        ui.busy = true;
        ui.error = "";
        actions.render();
        try {
            await actions.save(next);
            Object.assign(ui, managementFeeUI());
        } catch (error) {
            ui.error = error.message;
            actions.report(error.message, "error");
        } finally {
            ui.busy = false;
            actions.render();
        }
    };
    const form = section.querySelector("[data-fee-form]");
    if (form) {
        const preview = () => {
            try {
                section.querySelector(".fee-live-preview").textContent =
                    `尚未儲存：${managementFeeDescription({
                        version: 1, fee: fromDraft(ui.draft), undo: null,
                    })}`;
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                section.querySelector(".fee-live-preview").textContent =
                    error.message;
            }
        };
        preview();
        form.addEventListener("input", (event) => {
            if (!["start", "end", "dailyRate"].includes(event.target.name)) {
                return;
            }
            ui.draft[event.target.name] = event.target.value;
            ui.changed = true;
            preview();
        });
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (ui.busy) return;
            try {
                const fee = fromDraft(ui.draft);
                if (form.reportValidity()) {
                    void save(editManagementFee(value, fee));
                }
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                ui.error = error.message;
                actions.report(error.message, "error");
                actions.render();
                const name = /日期/.test(error.message)
                    ? "end" : "dailyRate";
                document.querySelector(
                    `[data-fee-form] [name="${name}"]`)?.focus();
            }
        });
    }
    section.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || ui.busy) return;
        if (button.hasAttribute("data-fee-edit")) {
            ui.draft ??= {
                ...(managementFeeSummary(value).fee ??
                    APPROVED_MANAGEMENT_FEE),
            };
            actions.render();
            document.querySelector(
                '[data-fee-form] [name="start"]')?.focus();
        } else if (button.hasAttribute("data-fee-cancel")) {
            if (!discard()) return;
            Object.assign(ui, managementFeeUI());
            actions.render();
        } else if (button.hasAttribute("data-fee-remove")) {
            if (window.confirm("移除管委會清潔費的計費設定？" +
                "可用清潔費上一步還原，不改工程清潔或施工日期。")) {
                void save(editManagementFee(value, null));
            }
        } else if (button.hasAttribute("data-fee-undo")) {
            if (discard()) void save(undoManagementFee(value));
        } else if (button.hasAttribute("data-fee-csv")) {
            downloadFile("管委會清潔費.csv",
                managementFeeCsv(value), "text/csv;charset=utf-8");
        }
    });
}
