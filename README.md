# 裝修設備規劃｜去識別化公開示例

這是一份可閱讀、可編輯的室內裝修規劃示例：保留圖面量繪的房間輪廓、門窗、物件標位、商品與歷史工程報價，移除私人住址、客戶身分與可辨識的廠商名稱。**原工程報價基準為 NT$1,959,530**；後續選款、增減項與待報價設備另行試算。金額是特定情境的歷史估價，**不是現行有效報價**；圖面和照明模擬僅供討論，**不得作為丈量圖、施工圖或電氣設計**。

## 離線開啟

1. 下載 [`portable/裝修設備規劃.html`](portable/裝修設備規劃.html) 與 [`files/設備規劃.json`](files/設備規劃.json)，放在自己的電腦上。
2. 用最新版 Chrome 或 Edge 雙擊 HTML，按「**讀檔 JSON**」選擇示例存檔。可瀏覽房間與門窗示意、拖放設備、修改商品、試算價格，並輸出清單 CSV。
3. 修改後按「**存檔 JSON**」取得新版存檔；瀏覽器的本機暫存不能代替存檔。離線 HTML **不內嵌**設備 JSON，首次開啟須自行讀入；不需要伺服器或網路。

示例 JSON 是 **v5**，保留 13 個空間、144 個物件與 13 款商品的資料和價格；修訂版次重設為 0、`undo` 為 `null`，未附先前編輯紀錄。日後自己匯出的 JSON 可能包含新輸入的私人資料與單步復原點，分享前請另行檢查。

## GitHub Pages 線上預覽

網站管理者在 GitHub Pages 選擇從 `main` 分支的 `/(root)` 部署後，開啟 <https://zero0415.github.io/house_design/> 會進入同一份互動規劃器。這個首頁帶有明確的示例參數：**僅在 HTTP(S) 網頁且此瀏覽器沒有已儲存資料時**，規劃器才會從本站 `files/設備規劃.json` 載入去識別化示例；已有編輯紀錄時絕不以示例覆蓋。示例無法載入時會提示錯誤，仍可按「讀檔 JSON」手動匯入。直接開啟離線 HTML（包括 `file://`）仍須自己讀入 JSON，程式不會對外下載示例。

**Pages 上的修改只存於你自己的瀏覽器，不會更改 GitHub 儲存庫，也不會同步到其他裝置。**請定期按「存檔 JSON」下載備份；清除瀏覽器暫存後，沒有匯出的修改無法復原。網頁只向本站讀取示例資料，不會自動向第三方網站請求商品資訊。啟用 Pages 需要儲存庫管理者自行操作；本庫不修改網站設定。

## 報價與參考圖

[`files/裝修工程報價-去識別化.md`](files/裝修工程報價-去識別化.md) 保留原報價的分類、數量、單價、合計及施工說明；個人地址、廠商身分與可辨識門片品牌已省略。標示「未計入」的品項不是免費，仍須請合格人員重新估價與現勘。商品型號與商店連結是參考資料，程式不會自動向外部網站請求資料。

**沒有發布原始 PDF、設計掃描、相片或其像素／中繼資料。**「門窗尺寸示意」、兩張對照圖及「規劃幾何底圖」都由 [`house-geometry.js`](extensions/renovation-equipment/assets/house-geometry.js) 的座標與規劃器的 SVG 繪製邏輯重新產生；不是在原始圖片上覆蓋遮蔽層。示意圖含規劃新增隔間，W／DH 尺寸由原始標註轉寫，實際牆厚、門窗淨空、外推承重與設備安裝條件都尚待核實。房間幾何與價格仍具情境獨特性；請先審閱再轉發。

## 原始碼與重建

`extensions/renovation-equipment/assets/` 是共用的規劃器介面及幾何／預算邏輯，`extensions/renovation-equipment/state.mjs` 負責驗證存檔；`tools/portable-bootstrap.js` 將相同模組接入瀏覽器本機儲存。`extensions/renovation-equipment/extension.mjs` 是在提供 `@github/copilot-sdk/extension` 的 Copilot App 環境中使用的可選畫布入口，不是離線使用的必要條件。

在此目錄執行 `python tools\build_portable.py` 即可用 Python 標準函式庫重建 [`portable/裝修設備規劃.html`](portable/裝修設備規劃.html)；建置會拒絕靜態圖片或 PDF 參照，不讀取原始文件。執行 `python -m unittest discover -s tests -v` 可檢查公開存檔、報價基準與單檔產物。若已安裝 Chrome 和 Python Playwright，可先在 PowerShell 設定 `$env:RUN_PAGES_BROWSER_TESTS = "1"`，再執行同一測試指令；測試會用本機 HTTP 伺服器模擬 Pages 子路徑、存檔衝突及離線行為。公開版不附原始文件、個人檔案或任何私人儲存庫的 Git 歷史。
