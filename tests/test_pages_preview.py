import csv
from copy import deepcopy
from io import StringIO
import json
import os
import shutil
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from threading import Thread
from urllib.parse import unquote, urlsplit

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "files" / "設備規劃.json"
PORTABLE = ROOT / "portable" / "裝修設備規劃.html"
CHROME = shutil.which("chrome") or shutil.which("google-chrome")
if not CHROME and os.environ.get("ProgramFiles"):
    candidate = Path(os.environ["ProgramFiles"], "Google", "Chrome", "Application",
                     "chrome.exe")
    if candidate.is_file():
        CHROME = str(candidate)
EDGE = next((str(path) for path in (
    Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft" / "Edge" /
    "Application" / "msedge.exe",
    Path(os.environ.get("ProgramFiles", "")) / "Microsoft" / "Edge" /
    "Application" / "msedge.exe",
) if path.is_file()), None)

INCLUDED_BATHROOM_IDS = {
    *(f"{room}-{fixture}" for room in ("bath-main", "bath-guest")
      for fixture in ("toilet", "vanity", "basin-tap", "shower")),
    "bath-main-urinal-u0211-a624", "bath-guest-tub",
}


def previous_public_robot_save():
    state = json.loads(SAMPLE.read_text(encoding="utf-8"))
    assert "constructionCalendar" in state
    del state["constructionCalendar"]
    del state["managementCleaningFee"]
    state["items"] = [item for item in state["items"]
                      if item["id"] != "living-auto-water-robot"]
    assert len(state["items"]) == 181
    return state


def previous_public_calendar_save():
    state = json.loads(SAMPLE.read_text(encoding="utf-8"))
    del state["managementCleaningFee"]
    calendar = state["constructionCalendar"]
    assert calendar["version"] == 2 and len(calendar["events"]) == 13
    calendar["version"] = 1
    calendar["events"] = [
        {key: value for key, value in event.items()
         if key != "attendees"} for event in calendar["events"]
        if event["id"] != "construction-elevator-protection"
    ]
    calendar["undo"] = []
    assert len(calendar["events"]) == 12
    assert len(state["items"]) == 182
    return state


def previous_public_door_save():
    state = previous_public_robot_save()
    state["items"] = [item for item in state["items"]
                      if item["id"] != "door-bedroom-3-studio"]
    by_id = {item["id"]: item for item in state["items"]}
    previous_note = (
        "已含在原報價；切換材質後的價差僅供規劃，實際價格須廠商確認。"
    )
    previous_track_note = (
        "原報價「滑門軌道－主浴.工作室」合計 1.6 米 × 1,800 元＝2,880 元；\n"
        "            依屋主指示暫分這道拉門 0.8 米、1,440 元。軌道長度為暫估，\n"
        "            未含於此筆的門片本體仍須另議；取消或轉用已含軌道門片的減項須廠商確認。"
    )
    by_id["door-balcony"].update(
        brandModel="木纖滑門", doorMaterial="wood-slide", unitPrice=19000,
        quotedUnitPrice=19000, priceSource="原報價｜門片工程",
        note=previous_note,
    )
    del by_id["door-balcony"]["doorQuoteAllocation"]
    by_id["door-bedroom-2"]["note"] = previous_note
    by_id["door-main-bath-master"].update(
        brandModel="木纖門", doorMaterial="wood-fiber", unitPrice=10500,
        priceSource="原報價門片單價（跨材質試算，待廠商確認）",
        note=previous_note,
    )
    by_id["door-main-bath-hall"].update(
        doorOpeningKind="slide",
        note=previous_note +
             " 新配置確認通客餐廳為拉門；目前單價仍沿用原塑鋼廁所門報價基準，"
             "拉門滑軌與施工價差須請廠商重報，未自動計入追加。",
    )
    by_id["track-main-bath-hall"].update(
        roomId="bath-main", trackDoorId="main-bath-hall",
        name="滑門軌道－主浴門", priceSource="原報價｜輕隔間工程",
        note=previous_track_note,
    )
    del by_id["track-main-bath-hall"]["doorQuoteAllocation"]
    by_id["track-bedroom-3-studio"].update(
        priceSource="原報價｜輕隔間工程",
        note=previous_track_note,
    )
    del by_id["track-bedroom-3-studio"]["doorQuoteAllocation"]
    assert len(state["items"]) == 180
    return state


def previous_public_balcony_save():
    state = previous_public_door_save()
    state["items"] = [item for item in state["items"]
                      if item["id"] != "balcony-outboard-sink"]
    by_id = {item["id"]: item for item in state["items"]}
    dryer = by_id["balcony-dryer"]
    dryer.update(
        roomId="ac-platform", orientation=180,
        placement={"x": .857, "y": .5},
        note="Whirlpool 8TWGD5050PW 瓦斯烘衣機本體 NT$20,599；機身寬73.7×深72.1×高102.9cm，原外推鐵窗暫位不移。約78cm毛深與機身深度只差約5.9cm，尚未扣框架、排氣或維修；供氣、排煙、防雨、承重振動、防火與合法許可全未核，須合格人員現勘，嚴禁據圖施工。",
    )
    by_id["balcony-washer"]["note"] = (
        "Whirlpool 8TWTW5010PW 洗衣機本體參考 NT$21,150；機身寬 70.5×深 68.6cm，"
        "保留陽台原標位。圖上未含安裝與維修淨空；給排水、供電、門淨寬及實際施工另核。"
    )
    by_id["balcony-water-heater"]["note"] = (
        "暫標在陽台右側牆面（烘衣機已移至外推鐵窗）；窄條僅表示牆面位置，"
        "與烘衣機可能在不同高度，非實際機身尺寸。熱水器型式、型號、尺寸、安裝高度、"
        "與烘衣機安全間距、電源或瓦斯、給排水及排氣須現場由合格廠商確認。"
        "原報價熱水器安裝單價2,500元／組但數量未填（本次0元）；本體及安裝費待報。"
    )
    product = next(row for row in state["products"] if row["id"] == "sample-product-26")
    product["name"] = "Whirlpool 8TWGD5050PW 瓦斯烘衣機（鐵窗暫位）"
    product["note"] = (
        "機身寬73.7×深72.1×高102.9cm。外推鐵窗約78cm毛深僅剩約5.9cm，"
        "未扣框架、排氣、維修；瓦斯供應、排煙防雨、荷重振動、防火、固定防墜"
        "與合法許可全未核。條件式暫位，不得據圖施工。"
    )
    assert len(state["items"]) == 179
    return state


def legacy_bathroom_save():
    state = previous_public_balcony_save()
    previous_notes = {
        "bath-main-toilet": (
            "原報兩套衛浴一般安裝已含，另加 NT$0；改管另待核。",
            "PChome商品標示不含安裝；價格可能變動。",
        ),
        "bath-guest-toilet": (
            "原報兩套衛浴一般安裝已含，另加 NT$0；改管另待核。",
            "PChome商品標示不含安裝；價格可能變動。",
        ),
        "bath-main-urinal-u0211-a624": (
            "固定方式與超出原安裝額度的補差待確認；本件安裝另加 NT$0（原報已含）。",
            "固定方式與安裝費待確認。",
        ),
    }
    for item in state["items"]:
        if item["id"] in INCLUDED_BATHROOM_IDS:
            del item["installationUnitPrice"]
        if item["id"] in previous_notes:
            normalized, old = previous_notes[item["id"]]
            if normalized not in item["note"]:
                raise AssertionError(f"Unexpected fixture note: {item['id']}")
            item["note"] = item["note"].replace(normalized, old)
    return state


class PagesHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        route = urlsplit(path).path
        if not route.startswith("/house_design/"):
            return str(ROOT / "__not_found__")
        parts = PurePosixPath(unquote(route[len("/house_design/"):])).parts
        if any(part in {"..", ".git"} for part in parts):
            return str(ROOT / "__not_found__")
        return str(ROOT.joinpath(*parts))

    def log_message(self, format, *args):
        pass


@unittest.skipUnless(os.environ.get("RUN_PAGES_BROWSER_TESTS") == "1" and
                     sync_playwright is not None and CHROME,
                     "set RUN_PAGES_BROWSER_TESTS=1 with Chrome and Playwright")
class PagesPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), PagesHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}/house_design/"
        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch(
                executable_path=CHROME, headless=True
            )
        except Exception:
            cls.playwright.stop()
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join(timeout=5)
            raise

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def open_demo(self, page):
        page.goto(self.base)
        page.wait_for_url("**/portable/*demo=pages*", timeout=15000)
        page.wait_for_function(
            "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
            timeout=15000,
        )

    def test_calendar_tab_is_rightmost_with_keyboard_navigation(self):
        context = self.browser.new_context(viewport={"width": 390, "height": 844})
        try:
            page = context.new_page()
            requests = []
            errors = []
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            self.open_demo(page)
            tabs = page.get_by_role("tab")
            self.assertEqual(tabs.evaluate_all(
                "nodes => nodes.map(node => node.dataset.view)"), [
                "plan", "outlet-sheet", "lighting-sheet", "survey",
                "room", "database", "device", "calendar",
            ])
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            plan = page.locator('[data-view="plan"]')
            device = page.locator('[data-view="device"]')
            calendar = page.locator('[data-view="calendar"]')
            plan.focus()
            plan.press("End")
            self.assertEqual(calendar.get_attribute("aria-selected"), "true")
            self.assertTrue(calendar.evaluate(
                "element => document.activeElement === element"))
            self.assertEqual(page.locator("#content").get_attribute(
                "aria-labelledby"), "view-calendar")
            calendar.press("Home")
            self.assertEqual(plan.get_attribute("aria-selected"), "true")
            device.focus()
            device.press("ArrowRight")
            self.assertEqual(calendar.get_attribute("aria-selected"), "true")
            calendar.press("ArrowRight")
            self.assertEqual(plan.get_attribute("aria-selected"), "true")
            calendar.focus()
            calendar.press("Space")
            self.assertEqual(calendar.get_attribute("aria-selected"), "true")
            self.assertEqual(page.locator(".calendar-agenda li").count(), 13)
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertEqual(page.evaluate(
                "document.documentElement.scrollWidth <= 391"), True)
            self.assertTrue(all(method == "GET" and url.startswith(self.base)
                                for method, url in requests), requests)
            self.assertEqual(len([url for _, url in requests
                                  if "/files/" in url]), 1)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_public_management_fee_is_editable_independent_and_mobile_readable(self):
        context = self.browser.new_context(
            viewport={"width": 1280, "height": 960},
            accept_downloads=True,
        )
        artifacts = os.environ.get("PUBLIC_FEE_ARTIFACTS")
        if artifacts:
            Path(artifacts).mkdir(parents=True, exist_ok=True)
        try:
            page = context.new_page()
            requests, errors = [], []
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            self.open_demo(page)
            initial = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            fee = initial["managementCleaningFee"]
            self.assertEqual((initial["revision"], initial["undo"],
                              len(initial["items"]),
                              len(initial["constructionCalendar"]["events"])),
                             (0, None, 182, 13))
            self.assertEqual(fee, {
                "version": 1,
                "fee": {
                    "start": "2026-10-13", "end": "2027-01-30",
                    "dailyRate": 100,
                },
                "undo": {"fee": None},
            })
            self.assertEqual(page.locator("#quote-baseline").inner_text(),
                             "NT$1,959,530")
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            self.assertEqual(page.locator("#management-fee-total").inner_text(),
                             "NT$11,000")
            self.assertTrue(page.locator("#management-fee-budget").is_visible())
            item_additions = page.locator("#additional-total").inner_text()
            page.get_by_role("tab", name="開工行事曆", exact=True).click()
            self.assertIn("非日曆／清潔費",
                          page.locator("#undo-last").inner_text())
            self.assertIn("110 個日曆日（含 15 個週日）",
                          page.locator(".management-fee-summary").inner_text())
            self.assertIn("不取代原承包商",
                          page.locator(".management-fee").inner_text())
            self.assertEqual(page.locator(".calendar-agenda li").count(), 13)

            cache_before = page.evaluate("JSON.stringify(localStorage)")
            page.evaluate("""() => {
                window.__feeViewWrites = [];
                const setItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function(...args) {
                    window.__feeViewWrites.push(args[0]);
                    return setItem.apply(this, args);
                };
                const store = globalThis.__RENOVATION_OFFLINE_STORE__;
                const update = store.update;
                store.update = function(...args) {
                    window.__feeViewWrites.push("store.update");
                    return update.apply(this, args);
                };
            }""")
            page.locator("[data-calendar-expand]").click()
            self.assertEqual(page.locator(
                "[data-calendar-month-view]").count(), 4)
            page.locator("[data-fee-edit]").click()
            form = page.locator("[data-fee-form]")
            self.assertEqual(form.locator(
                '[name="dailyRate"]').input_value(), "100")
            cdp = context.new_cdp_session(page)
            mobile = {}
            for width in (1280, 320, 360, 390, 430):
                page.set_viewport_size({"width": width, "height": 960})
                cdp.send("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 960,
                    "deviceScaleFactor": 1, "mobile": width < 600,
                })
                page.wait_for_function(
                    "w => innerWidth === w && visualViewport.width === w",
                    arg=width,
                )
                metrics = page.evaluate("""() => ({
                    viewport: innerWidth,
                    document: document.documentElement.scrollWidth,
                    body: document.body.scrollWidth,
                    inputs: [...document.querySelectorAll(
                        '[data-fee-form] input')].map(node => ({
                            font: parseFloat(getComputedStyle(node).fontSize),
                            height: node.getBoundingClientRect().height,
                        })),
                    targets: [...document.querySelectorAll(
                        '.management-fee button')].map(node =>
                            node.getBoundingClientRect().height),
                })""")
                self.assertEqual(
                    (metrics["document"], metrics["body"]),
                    (width, width), (width, metrics))
                self.assertTrue(all(row["font"] >= 16 and
                                    row["height"] >= 44
                                    for row in metrics["inputs"]),
                                (width, metrics))
                self.assertTrue(all(height >= 44
                                    for height in metrics["targets"]),
                                (width, metrics))
                mobile[width] = metrics
                if artifacts and width in (1280, 320, 390):
                    page.locator(".management-fee").screenshot(
                        path=str(Path(artifacts) /
                                 f"pristine-chrome-fee-editor-{width}.png"))
                    page.locator(".budget").screenshot(
                        path=str(Path(artifacts) /
                                 f"pristine-chrome-budget-{width}.png"))
            cdp.send("Emulation.clearDeviceMetricsOverride")
            page.set_viewport_size({"width": 1280, "height": 960})
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)
            self.assertEqual(page.evaluate("JSON.stringify(localStorage)"),
                             cache_before)
            self.assertEqual(page.evaluate("window.__feeViewWrites"), [])
            form.locator("[data-fee-cancel]").click()
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)
            self.assertEqual(page.evaluate("window.__feeViewWrites"), [])

            with page.expect_download() as download:
                page.locator("[data-fee-csv]").click()
            rows = list(csv.reader(Path(download.value.path()).read_text(
                encoding="utf-8-sig").splitlines()))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[1][1:8], [
                "管委會", "2026-10-13", "2027-01-30",
                "110", "15", "100", "11000",
            ])
            page.locator("[data-fee-edit]").click()
            form = page.locator("[data-fee-form]")
            form.locator('[name="start"]').fill("2026-10-25")
            form.locator('[name="end"]').fill("2026-10-26")
            form.locator('[name="dailyRate"]').fill("100.25")
            self.assertIn("2 個日曆日（含 1 個週日）",
                          form.locator(".fee-live-preview").inner_text())
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)
            form.get_by_role("button", name="儲存清潔費").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 1 &&
                    state.managementCleaningFee.fee.dailyRate === 100.25;
            }""", timeout=15000)
            edited = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            for key in ("rooms", "items", "products", "undo",
                        "constructionCalendar"):
                self.assertEqual(edited[key], initial[key])
            self.assertEqual(edited["managementCleaningFee"]["undo"]["fee"],
                             fee["fee"])
            self.assertEqual(page.locator("#management-fee-total").inner_text(),
                             "NT$200.5")
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,322,260.7")
            self.assertEqual(page.locator("#additional-total").inner_text(),
                             item_additions)
            page.locator("[data-fee-undo]").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 2 &&
                    state.managementCleaningFee.undo === null;
            }""", timeout=15000)
            restored = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(restored["managementCleaningFee"]["fee"],
                             fee["fee"])
            self.assertEqual(restored["constructionCalendar"],
                             initial["constructionCalendar"])
            self.assertIsNone(restored["undo"])
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")

            prior = {key: value for key, value in initial.items()
                     if key != "managementCleaningFee"}
            page.locator("#load-file-input").set_input_files({
                "name": "public-calendar-v10.json",
                "mimeType": "application/json",
                "buffer": json.dumps({
                    "format": "renovation-equipment-planner",
                    "formatVersion": 10, "state": prior,
                }, ensure_ascii=False).encode("utf-8"),
            })
            page.wait_for_function("""async () =>
                (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                    .revision === 3
            """, timeout=15000)
            imported = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(imported["managementCleaningFee"],
                             restored["managementCleaningFee"])
            self.assertEqual(imported["constructionCalendar"],
                             initial["constructionCalendar"])
            self.assertEqual(imported["items"], initial["items"])
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            self.assertTrue(all(method == "GET" and
                                url.startswith(self.base)
                                for method, url in requests), requests)
            self.assertEqual(errors, [])
            if artifacts:
                (Path(artifacts) / "chrome-fee-metrics.json").write_text(
                    json.dumps(mobile, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
        finally:
            context.close()

    def test_management_fee_cache_prefers_latest_without_seeding_old_edits(self):
        current = json.loads(SAMPLE.read_text(encoding="utf-8"))
        previous = deepcopy(current)
        del previous["managementCleaningFee"]
        previous["revision"] = 7
        previous["constructionCalendar"]["events"][0]["title"] = (
            "舊離線自訂工項")
        edited = deepcopy(current)
        edited["revision"] = 9
        edited["managementCleaningFee"]["fee"]["dailyRate"] = 125
        for case, latest in (
            ("older-only", None),
            ("newer-wins", json.dumps(edited, ensure_ascii=False)),
            ("newer-corrupt", "{broken"),
        ):
            with self.subTest(case=case):
                context = self.browser.new_context()
                try:
                    context.add_init_script("""if (
                        location.pathname.includes('/portable/') &&
                        !localStorage.getItem('fee-cache-test-seeded')) {
                        localStorage.setItem(
                            'renovation-equipment-offline-calendar-attendees-v1:' +
                                location.pathname, %s);
                        if (%s !== null) localStorage.setItem(
                            'renovation-equipment-offline-management-fee-v1:' +
                                location.pathname, %s);
                        localStorage.setItem('fee-cache-test-seeded', '1');
                    }""" % (
                        json.dumps(json.dumps(previous, ensure_ascii=False)),
                        json.dumps(latest), json.dumps(latest),
                    ))
                    page = context.new_page()
                    requests = []
                    page.on("request", lambda request:
                            requests.append(request.url)
                            if "/files/" in request.url else None)
                    if case == "newer-corrupt":
                        page.goto(self.base)
                        page.wait_for_url("**/portable/*demo=pages*")
                        page.wait_for_function(
                            "document.querySelector('#save-status')?.dataset.kind === 'error'")
                        self.assertIn("暫存資料無法驗證",
                                      page.locator("#save-status").inner_text())
                        self.assertEqual(page.evaluate(
                            "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                        ), "{broken")
                    else:
                        self.open_demo(page)
                        state = page.evaluate(
                            "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
                        if case == "older-only":
                            self.assertEqual(state["revision"], 7)
                            self.assertNotIn("managementCleaningFee", state)
                            self.assertTrue(page.locator(
                                "#management-fee-budget").is_hidden())
                            page.get_by_role(
                                "tab", name="開工行事曆",
                                exact=True).click()
                            self.assertIn("未設定／未計入", page.locator(
                                ".management-fee-summary").inner_text())
                            self.assertEqual(json.loads(page.evaluate(
                                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                            )), state)
                        else:
                            self.assertEqual(state["revision"], 9)
                            self.assertEqual(state["managementCleaningFee"]
                                             ["fee"]["dailyRate"], 125)
                            self.assertEqual(page.locator(
                                "#management-fee-total").inner_text(),
                                "NT$13,750")
                            self.assertEqual(page.locator(
                                "#overall-total").inner_text(),
                                "NT$2,335,810.2")
                    self.assertEqual(json.loads(page.evaluate(
                        "localStorage.getItem('renovation-equipment-offline-calendar-attendees-v1:' + location.pathname)"
                    )), previous)
                    self.assertEqual(requests, [])
                finally:
                    context.close()

    def test_calendar_expanded_sundays_and_role_bars_keep_pristine_state(self):
        context = self.browser.new_context(
            viewport={"width": 1280, "height": 960},
            accept_downloads=True,
        )
        artifacts = os.environ.get("PUBLIC_CALENDAR_ARTIFACTS")
        if artifacts:
            Path(artifacts).mkdir(parents=True, exist_ok=True)
        try:
            page = context.new_page()
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            self.open_demo(page)
            page.get_by_role("tab", name="開工行事曆", exact=True).click()
            pristine = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((pristine["revision"],
                              len(pristine["constructionCalendar"]["events"])),
                             (0, 13))
            cache_before = page.evaluate("JSON.stringify(localStorage)")
            page.evaluate("""() => {
                window.__calendarViewWrites = [];
                const setItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function(...args) {
                    window.__calendarViewWrites.push(args[0]);
                    return setItem.apply(this, args);
                };
                const store = globalThis.__RENOVATION_OFFLINE_STORE__;
                const update = store.update;
                store.update = function(...args) {
                    window.__calendarViewWrites.push('store.update');
                    return update.apply(this, args);
                };
            }""")
            self.assertEqual(page.locator(
                "[data-calendar-month-view]").count(), 1)
            page.locator("[data-calendar-expand]").click()
            sections = page.locator("[data-calendar-month-view]")
            self.assertEqual(sections.evaluate_all(
                "nodes => nodes.map(node => node.dataset.calendarMonthView)"),
                ["2026-10", "2026-11", "2026-12", "2027-01"])
            self.assertEqual(sections.count(), 4)
            self.assertEqual(page.locator(".calendar-scroll").count(), 4)
            self.assertTrue(page.locator(".calendar-range").is_visible())
            self.assertIn("2026-10～2027-01",
                          page.locator(".calendar-range").inner_text())
            positions = sections.evaluate_all(
                "nodes => nodes.map(node => node.getBoundingClientRect().top)")
            self.assertEqual(positions, sorted(positions))
            self.assertEqual(len(set(positions)), 4)
            october = page.locator('[data-calendar-month-view="2026-10"]')
            november = page.locator('[data-calendar-month-view="2026-11"]')
            for sunday, monday, month in (
                ("2026-10-25", "2026-10-26", october),
                ("2026-11-01", "2026-11-02", november),
                ("2026-11-08", "2026-11-09", november),
            ):
                week = month.locator(
                    f'.calendar-week:has([data-calendar-date="{sunday}"])')
                self.assertIn("師傅固定休假", week.locator(
                    ".calendar-sunday-rest").first.inner_text())
                segment = week.locator(
                    '[data-calendar-event="construction-utilities"]')
                self.assertEqual(segment.count(), 1)
                self.assertEqual(segment.get_attribute("data-segment-start"),
                                 monday)
                self.assertEqual(segment.evaluate(
                    "node => getComputedStyle(node).gridColumnStart"), "2")
            self.assertIn("師傅固定休假", october.locator(
                '.calendar-week:has([data-calendar-date="2026-09-27"])'
                ' .calendar-sunday-rest').first.inner_text())
            kickoff = october.locator(
                '.calendar-event[data-calendar-event="construction-start"]')
            layout = october.locator(
                '.calendar-event[data-calendar-event="construction-layout"]')
            wall = october.locator(
                '.calendar-event[data-calendar-event="construction-wall"]')
            self.assertEqual(kickoff.locator(
                ".calendar-event-roles .calendar-role").all_inner_texts(),
                ["屋主", "輕隔間廠商代表"])
            self.assertEqual(layout.locator(
                ".calendar-event-roles .calendar-role").all_inner_texts(),
                ["屋主", "廚房工人", "系統櫃工人"])
            for bar in (kickoff, layout):
                self.assertEqual(bar.locator(
                    ".calendar-owner .calendar-person-icon"
                    '[aria-hidden="true"]').count(), 1)
            oct13 = october.locator(
                '.calendar-week:has([data-calendar-date="2026-10-13"])')
            self.assertNotEqual(oct13.locator(
                '[data-calendar-event="construction-demolition"]').evaluate(
                    "node => getComputedStyle(node).gridRowStart"),
                oct13.locator(
                    '[data-calendar-event="construction-elevator-protection"]'
                ).evaluate("node => getComputedStyle(node).gridRowStart"))
            october.locator('[data-calendar-date="2026-10-31"]').focus()
            october.locator('[data-calendar-date="2026-10-31"]').press(
                "ArrowRight")
            self.assertTrue(november.locator(
                '[data-calendar-date="2026-11-01"]').first.evaluate(
                    "node => document.activeElement === node"))
            last = page.locator(
                '[data-calendar-month-view="2027-01"] '
                '[data-calendar-date="2027-02-06"]')
            last.focus()
            last.press("ArrowRight")
            self.assertTrue(last.evaluate(
                "node => document.activeElement === node"))
            if artifacts:
                page.locator("#calendar-month-views").screenshot(
                    path=str(Path(artifacts) /
                             "pristine-chrome-four-months-1280.png"))
            for width in (320, 360, 390, 430):
                page.set_viewport_size({"width": width, "height": 900})
                self.assertLessEqual(page.evaluate(
                    "document.documentElement.scrollWidth - innerWidth"), 1,
                    f"body overflow at {width}px")
                grids = page.locator(".calendar-scroll").evaluate_all(
                    """nodes => nodes.map(node => ({
                        width: node.clientWidth, scroll: node.scrollWidth
                    }))""")
                self.assertEqual(len(grids), 4)
                self.assertTrue(all(grid["width"] <= width and
                                    grid["scroll"] > grid["width"]
                                    for grid in grids), (width, grids))
                page.locator(".calendar-scroll").evaluate_all(
                    "nodes => nodes.forEach(node => node.scrollLeft = 0)")
                october.locator(".calendar-scroll").evaluate(
                    "node => node.scrollLeft = 140")
                self.assertGreater(october.locator(
                    ".calendar-scroll").evaluate("node => node.scrollLeft"), 0)
                self.assertEqual(november.locator(
                    ".calendar-scroll").evaluate("node => node.scrollLeft"), 0)
                for bar, expected in (
                    (kickoff, ["屋主", "輕隔間廠商代表"]),
                    (layout, ["屋主", "廚房工人", "系統櫃工人"]),
                ):
                    bar.scroll_into_view_if_needed()
                    geometry = bar.evaluate("""node => {
                        const rect = element => {
                            const box = element.getBoundingClientRect();
                            return {left: box.left, right: box.right,
                                top: box.top, bottom: box.bottom,
                                width: box.width, height: box.height};
                        };
                        return {
                            bar: rect(node),
                            scroll: rect(node.closest('.calendar-scroll')),
                            labels: [...node.querySelectorAll(
                                '.calendar-event-roles .calendar-role'
                            )].map(role => {
                                const text = [...role.childNodes].find(child =>
                                    child.nodeType === Node.TEXT_NODE &&
                                    child.textContent.trim());
                                const range = document.createRange();
                                range.selectNodeContents(text);
                                return {name: role.textContent.trim(),
                                    font: parseFloat(
                                        getComputedStyle(role).fontSize),
                                    pill: rect(role),
                                    ink: [...range.getClientRects()].map(box =>
                                        ({left: box.left, right: box.right,
                                            top: box.top,
                                            bottom: box.bottom}))};
                            })
                        };
                    }""")
                    self.assertEqual(
                        [role["name"] for role in geometry["labels"]],
                        expected)
                    self.assertGreater(geometry["bar"]["height"], 30)
                    for role in geometry["labels"]:
                        self.assertGreaterEqual(role["font"], 12)
                        self.assertTrue(role["ink"])
                        for ink in role["ink"]:
                            for outer in (role["pill"], geometry["bar"]):
                                self.assertGreaterEqual(
                                    ink["left"], outer["left"] - 2,
                                    (width, role, geometry))
                                self.assertLessEqual(
                                    ink["right"], outer["right"] + 2,
                                    (width, role, geometry))
                                self.assertGreaterEqual(
                                    ink["top"], outer["top"] - 2,
                                    (width, role, geometry))
                                self.assertLessEqual(
                                    ink["bottom"], outer["bottom"] + 2,
                                    (width, role, geometry))
                    self.assertGreaterEqual(
                        geometry["bar"]["left"],
                        geometry["scroll"]["left"] - 1)
                    self.assertLessEqual(
                        geometry["bar"]["right"],
                        geometry["scroll"]["right"] + 1)
                    if artifacts and width in (320, 390):
                        name = "oct09" if bar == kickoff else "oct17"
                        bar.screenshot(path=str(Path(artifacts) /
                                                f"pristine-chrome-{name}-{width}-bar.png"))
                        page.screenshot(path=str(Path(artifacts) /
                                                 f"pristine-chrome-{name}-{width}-viewport.png"))
                first, second = layout.bounding_box(), wall.bounding_box()
                self.assertTrue(
                    first["y"] + first["height"] <= second["y"] + 1 or
                    second["y"] + second["height"] <= first["y"] + 1,
                    (width, first, second))
                if artifacts and width == 390:
                    page.locator(".calendar-scroll").evaluate_all(
                        "nodes => nodes.forEach(node => node.scrollLeft = 0)")
                    page.locator("#calendar-month-views").screenshot(
                        path=str(Path(artifacts) /
                                 "pristine-chrome-four-months-390.png"))
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), pristine)
            self.assertEqual(page.evaluate("JSON.stringify(localStorage)"),
                             cache_before)
            self.assertEqual(page.evaluate("window.__calendarViewWrites"), [])
            self.assertTrue(all(method == "GET" for method, _ in requests),
                            requests)
            self.assertEqual(errors, [])
            page.locator("[data-calendar-expand]").click()
            self.assertEqual(page.locator(
                "[data-calendar-month-view]").count(), 1)
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), pristine)

            page.locator("[data-calendar-month-input]").fill("2026-10")
            page.locator('[data-calendar-date="2026-10-25"]').click()
            editor = page.locator("[data-calendar-form]")
            editor.locator('[name="title"]').fill("臨時週日作業")
            editor.get_by_role("button", name="儲存工項").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.constructionCalendar.events.some(event =>
                    event.title === '臨時週日作業');
            }""")
            exception = page.locator(
                '.calendar-event:has(.calendar-sunday-exception)')
            self.assertEqual(exception.count(), 1)
            self.assertIn("週日例外安排", exception.inner_text())
            self.assertEqual(exception.get_attribute("data-segment-start"),
                             "2026-10-25")
            after = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((after["rooms"], after["items"],
                              after["products"], after["undo"]),
                             (pristine["rooms"], pristine["items"],
                              pristine["products"], pristine["undo"]))
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_calendar_attendees_are_role_only_editable_and_keep_equipment_undo(self):
        context = self.browser.new_context(
            viewport={"width": 390, "height": 844},
            accept_downloads=True,
        )
        try:
            page = context.new_page()
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url))
                if request.url.startswith(("http:", "https:")) else None)
            page.on("dialog", lambda dialog: dialog.accept())
            self.open_demo(page)
            initial = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((initial["version"], initial["revision"],
                              initial["undo"]), (5, 0, None))
            self.assertEqual((len(initial["items"]),
                              initial["constructionCalendar"]["version"],
                              len(initial["constructionCalendar"]["events"])),
                             (182, 2, 13))
            calendar = initial["constructionCalendar"]
            start = next(event for event in calendar["events"]
                         if event["id"] == "construction-start")
            self.assertEqual(start["attendees"],
                             ["屋主", "輕隔間廠商代表"])
            layout = next(event for event in calendar["events"] if event["id"] ==
                          "construction-layout")
            self.assertEqual(layout["attendees"],
                             ["屋主", "廚房工人", "系統櫃工人"])
            self.assertEqual(sum(not entry["attendees"] for entry in
                                 calendar["events"]), 11)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            budget = page.locator(".budget").inner_text()
            page.get_by_role("tab", name="開工行事曆", exact=True).click()
            self.assertEqual(page.locator(".calendar-agenda li").count(), 13)
            self.assertEqual(page.locator(
                ".calendar-roles-empty").count(), 11)
            start_agenda = page.locator(
                '.calendar-agenda li:has([data-calendar-event="construction-start"])'
            )
            self.assertEqual(start_agenda.locator(".calendar-role").count(), 2)
            self.assertIn("輕隔間廠商代表", start_agenda.inner_text())
            self.assertEqual(page.locator(
                '.calendar-agenda li:has([data-calendar-event="construction-elevator-protection"]) '
                '.calendar-roles-empty').count(), 1)
            week = page.locator(
                '.calendar-week:has([data-calendar-date="2026-10-13"])'
            )
            demolition_bar = week.locator(
                '[data-calendar-event="construction-demolition"]'
            )
            elevator_bar = week.locator(
                '[data-calendar-event="construction-elevator-protection"]'
            )
            self.assertEqual((demolition_bar.count(), elevator_bar.count()),
                             (1, 1))
            self.assertNotEqual(demolition_bar.evaluate(
                "element => getComputedStyle(element).gridRowStart"),
                elevator_bar.evaluate(
                    "element => getComputedStyle(element).gridRowStart"))
            agenda = page.locator(
                '.calendar-agenda li:has([data-calendar-event="construction-layout"])'
            )
            self.assertEqual(agenda.locator(".calendar-role").count(), 3)
            owner = agenda.locator(".calendar-owner")
            self.assertEqual(owner.inner_text(), "屋主")
            self.assertEqual(owner.locator('svg[aria-hidden="true"]').count(), 1)
            self.assertIn("廚房工人", agenda.inner_text())
            self.assertIn("系統櫃工人", agenda.inner_text())
            self.assertIn("預計出席：", page.locator(
                '[data-calendar-event="construction-layout"].calendar-event'
            ).first.get_attribute("aria-label"))
            self.assertIn("屋主、廚房工人、系統櫃工人", page.locator(
                '[data-calendar-event="construction-layout"].calendar-event'
            ).first.get_attribute("aria-label"))
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)

            agenda.locator('[data-calendar-event="construction-layout"]').click()
            form = page.locator("[data-calendar-form]")
            roles = form.locator('[name="attendees"]')
            self.assertEqual(roles.input_value(), "屋主\n廚房工人\n系統櫃工人")
            self.assertIn("非回覆或到場承諾",
                          page.locator("#calendar-roles-help").inner_text())
            roles.fill(f"屋主{chr(51)}人\n廚房工人")
            form.get_by_role("button", name="儲存工項").click()
            self.assertIn("不填人數", page.locator(".calendar-error").inner_text())
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)
            roles.fill("屋主\n廚房工人")
            self.assertEqual(form.locator(
                ".calendar-role-preview .calendar-role").count(), 2)
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), initial)
            form.get_by_role("button", name="儲存工項").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const event = state.constructionCalendar.events.find(entry =>
                    entry.id === 'construction-layout');
                return state.revision === 1 &&
                    event.attendees.length === 2 &&
                    state.constructionCalendar.undo?.length === 13;
            }""", timeout=15000)
            edited = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            self.assertIsNone(edited["undo"])
            self.assertEqual(edited["items"], initial["items"])
            self.assertEqual(edited["rooms"], initial["rooms"])
            self.assertEqual(edited["products"], initial["products"])
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertEqual(next(entry for entry in
                                  edited["constructionCalendar"]["undo"]
                                  if entry["id"] ==
                                  "construction-layout")["attendees"],
                             ["屋主", "廚房工人", "系統櫃工人"])
            with page.expect_download() as download:
                page.locator("[data-calendar-csv]").click()
            csv = Path(download.value.path()).read_text(encoding="utf-8-sig")
            self.assertIn("誰要出席（預計角色）", csv)
            self.assertIn("屋主、廚房工人", csv)
            self.assertNotRegex(csv, r"屋主[0-9]+人")
            with page.expect_download() as download:
                page.locator("#save-file").click()
            exported = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(exported["formatVersion"], 11)
            self.assertEqual(exported["state"]["constructionCalendar"],
                             edited["constructionCalendar"])
            page.reload()
            page.wait_for_function(
                "Boolean(document.querySelector('.overview-svg'))",
                timeout=15000,
            )
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )["constructionCalendar"], edited["constructionCalendar"])
            page.get_by_role("tab", name="開工行事曆", exact=True).click()

            prior = deepcopy(edited)
            prior_calendar = prior["constructionCalendar"]
            prior_calendar["version"] = 1
            prior_calendar["events"] = [
                {key: value for key, value in entry.items()
                 if key != "attendees"} for entry in prior_calendar["events"]
            ]
            prior_calendar["undo"] = []
            page.locator("#load-file-input").set_input_files({
                "name": "older-public-calendar-v1.json",
                "mimeType": "application/json",
                "buffer": json.dumps({
                    "format": "renovation-equipment-planner",
                    "formatVersion": 9, "state": prior,
                }, ensure_ascii=False).encode("utf-8"),
            })
            page.wait_for_function("""async () =>
                (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                    .revision === 2
            """, timeout=15000)
            imported = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            self.assertEqual(imported["constructionCalendar"]["version"], 2)
            self.assertEqual(next(entry for entry in
                                  imported["constructionCalendar"]["events"]
                                  if entry["id"] ==
                                  "construction-layout")["attendees"],
                             ["屋主", "廚房工人"])
            self.assertEqual(next(entry for entry in
                                  imported["constructionCalendar"]["events"]
                                  if entry["id"] ==
                                  "construction-start")["attendees"],
                             ["屋主", "輕隔間廠商代表"])
            self.assertIsNone(imported["undo"])
            self.assertEqual(imported["items"], initial["items"])
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertTrue(all(method == "GET" and
                                url.startswith(self.base) for method, url in
                                requests), requests)
            self.assertEqual(len([url for _, url in requests
                                  if "/files/" in url]), 1)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_old_local_saves_never_auto_seed_calendar(self):
        controls = previous_public_door_save()
        next(item for item in controls["items"] if item["id"] ==
             "quoted-switch-01")["controlledLightIds"] = [
                 "living-ceiling-light-01"
             ]
        robot = json.loads(SAMPLE.read_text(encoding="utf-8"))
        del robot["constructionCalendar"]
        del robot["managementCleaningFee"]
        cases = (
            ("renovation-equipment-offline-v1", previous_public_balcony_save(),
             179),
            ("renovation-equipment-offline-controls-v1", controls, 180),
            ("renovation-equipment-offline-doors-v1",
             previous_public_robot_save(), 181),
            ("renovation-equipment-offline-robot-v1", robot, 182),
        )
        for storage_key, saved, count in cases:
            with self.subTest(storage_key=storage_key):
                saved["revision"] = 7
                context = self.browser.new_context(
                    viewport={"width": 390, "height": 844}
                )
                try:
                    context.add_init_script("""if (location.pathname.includes('/portable/')) {
                        localStorage.setItem(%s + ':' + location.pathname, %s);
                    }""" % (
                        json.dumps(storage_key),
                        json.dumps(json.dumps(saved, ensure_ascii=False)),
                    ))
                    page = context.new_page()
                    requests, errors = [], []
                    page.on("request", lambda request: requests.append(
                        (request.method, request.url))
                        if request.url.startswith(("http:", "https:")) else None)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    self.open_demo(page)
                    restored = page.evaluate(
                        "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                    )
                    self.assertEqual((restored["revision"],
                                      len(restored["items"])), (7, count))
                    self.assertNotIn("constructionCalendar", restored)
                    self.assertEqual(restored["rooms"], saved["rooms"])
                    self.assertEqual({item["id"] for item in restored["items"]},
                                     {item["id"] for item in saved["items"]})
                    page.get_by_role("tab", name="開工行事曆", exact=True).click()
                    self.assertEqual(page.locator("[data-calendar-empty]").count(), 1)
                    self.assertEqual(page.locator(".calendar-agenda li").count(), 0)
                    self.assertTrue(page.locator("[data-calendar-undo]").is_disabled())
                    self.assertEqual(page.evaluate(
                        "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                    ), restored)
                    self.assertEqual([url for _, url in requests
                                      if "/files/" in url], [])
                    self.assertTrue(all(method == "GET" and
                                        url.startswith(self.base)
                                        for method, url in requests), requests)
                    self.assertEqual(errors, [])
                finally:
                    context.close()

    def test_old_calendar_v1_cache_keeps_roles_empty_until_explicit_edit(self):
        older = previous_public_calendar_save()
        older["revision"] = 7
        robot = previous_public_robot_save()
        robot["revision"] = 8
        context = self.browser.new_context(accept_downloads=True)
        try:
            context.add_init_script("""if (location.pathname.includes('/portable/') &&
                !localStorage.getItem('calendar-legacy-seeded')) {
                localStorage.setItem(
                    'renovation-equipment-offline-calendar-v1:' + location.pathname,
                    %s);
                localStorage.setItem(
                    'renovation-equipment-offline-robot-v1:' + location.pathname,
                    %s);
                localStorage.setItem('calendar-legacy-seeded', '1');
            }""" % (
                json.dumps(json.dumps(older, ensure_ascii=False)),
                json.dumps(json.dumps(robot, ensure_ascii=False)),
            ))
            page = context.new_page()
            requests, errors = [], []
            page.on("request", lambda request: requests.append(
                (request.method, request.url))
                if request.url.startswith(("http:", "https:")) else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            self.open_demo(page)
            loaded = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            self.assertEqual((loaded["revision"], len(loaded["items"]),
                              loaded["constructionCalendar"]["version"]),
                             (7, 182, 1))
            self.assertEqual(len(loaded["constructionCalendar"]["events"]), 12)
            self.assertTrue(all("attendees" not in event for event in
                                loaded["constructionCalendar"]["events"]))
            copied = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            self.assertEqual(copied["constructionCalendar"]["version"], 1)
            self.assertNotIn("managementCleaningFee", copied)
            self.assertIsNotNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-calendar-v1:' + location.pathname)"
            ))
            page.get_by_role("tab", name="開工行事曆", exact=True).click()
            self.assertEqual(page.locator(".calendar-agenda li").count(), 12)
            self.assertEqual(page.locator(".calendar-owner").count(), 0)
            self.assertEqual(page.locator(".calendar-roles-empty").count(), 12)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            exported = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(exported["formatVersion"], 9)

            page.locator(
                '.calendar-agenda [data-calendar-event="construction-layout"]'
            ).click()
            form = page.locator("[data-calendar-form]")
            self.assertEqual(form.locator(
                '[name="attendees"]').input_value(), "")
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            ), loaded)
            form.locator('[name="attendees"]').fill("屋主")
            form.get_by_role("button", name="儲存工項").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 8 &&
                    state.constructionCalendar.version === 2 &&
                    state.constructionCalendar.events.find(entry =>
                        entry.id === 'construction-layout').attendees[0] === '屋主';
            }""", timeout=15000)
            updated = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            self.assertEqual(updated["items"], loaded["items"])
            self.assertEqual(updated["undo"], loaded["undo"])
            self.assertEqual(sum(not event["attendees"] for event in
                                 updated["constructionCalendar"]["events"]), 11)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            upgraded = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(upgraded["formatVersion"], 10)
            page.reload()
            page.wait_for_function(
                "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
                timeout=15000,
            )
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )["constructionCalendar"], updated["constructionCalendar"])
            self.assertEqual([url for _, url in requests
                              if "/files/" in url], [])
            self.assertTrue(all(method == "GET" and
                                url.startswith(self.base) for method, url in
                                requests), requests)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def assert_balcony_sheet_context(self, page, current):
        contexts = page.locator("[data-sheet-context]")
        state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
        robot = any(item["id"] == "living-auto-water-robot" and item["placement"]
                    for item in state["items"])
        self.assertEqual(contexts.count(), (3 if current else 2) + int(robot))
        self.assertEqual(contexts.evaluate_all("""nodes =>
            Object.fromEntries(nodes.map(node =>
                [node.dataset.sheetContext, node.dataset.contextRoom]))
        """), {
            "balcony-dryer": "balcony" if current else "ac-platform",
            "balcony-washer": "balcony",
            **({"balcony-outboard-sink": "ac-platform"} if current else {}),
            **({"living-auto-water-robot": "living-dining"} if robot else {}),
        })
        self.assertEqual(page.locator(
            ".sheet-scroll .fixed-balcony-sink").count(), 1)
        self.assertEqual(page.locator(
            ".sheet-scroll .historical-proposed-sink").count(), int(current))
        self.assertEqual(page.locator(
            ".sheet-scroll .sink-bowl").count(), int(not current))
        self.assertEqual(page.locator(
            '.sheet-scroll [data-demolition-status="proposed"]').count(),
            int(current))
        self.assertIn("存檔暫估占地", contexts.first.get_attribute("aria-label"))
        self.assertIn("原水槽擬拆" if current else "原水槽仍為現況",
                      page.locator('[data-sheet-laundry-warning]').inner_text())
        self.assertEqual(page.locator(
            ".sheet-scroll img, .sheet-scroll image, "
            ".sheet-scroll foreignObject, .sheet-control-relation").count(), 0)
        sheet = page.locator("article.electrical-sheet").get_attribute("data-sheet")
        self.assertEqual(page.locator(".control-editor").count(),
                         int(sheet == "lighting-sheet"))
        if current:
            self.assertIn("獨立支撐", page.locator(
                '[data-sheet-context="balcony-outboard-sink"]')
                .get_attribute("aria-label"))
        else:
            self.assertEqual(page.locator(
                '[data-sheet-context="balcony-outboard-sink"]').count(), 0)

    def test_demo_import_is_transient_and_edits_survive_reload(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            requests = []
            errors = []
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            self.open_demo(page)
            self.assertEqual(page.locator(".overview-svg .plan-zone").count(), 13)
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,333,060.2")
            self.assertEqual(page.locator(".overview-svg [data-outlet-point-id]").count(), 67)
            for prefix, count in (("R", 51), ("B", 9), ("C", 7)):
                self.assertEqual(page.locator(
                    f'.overview-svg [data-outlet-point-id^="{prefix}"]').count(), count)
            for source_id in ("R08", "R33", "R42", "B05"):
                self.assertEqual(page.locator(
                    f'[data-point-warning="{source_id}"]').count(), 1)
            self.assertIn("不會修改公開儲存庫",
                          page.locator("#portable-note").inner_text())
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
            self.assertTrue(all(url.startswith(self.base) for url in requests))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-controls-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-calendar-attendees-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            page.locator('.overview-svg .plan-zone[data-select-room="bedroom-1"]').click()
            height = page.locator(
                'input[data-room-dimension="ceilingHeightCm"][data-room-id="bedroom-1"]'
            )
            height.fill("270")
            height.press("Tab")
            page.wait_for_function("""() => {
                const saved = localStorage.getItem(
                    'renovation-equipment-offline-management-fee-v1:' + location.pathname);
                return saved && JSON.parse(saved).rooms.find(
                    room => room.id === 'bedroom-1').ceilingHeightCm === 270;
            }""", timeout=15000)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-controls-v1:' + location.pathname)"
            ))
            page.reload()
            page.wait_for_function(
                "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
                timeout=15000,
            )
            state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(state["rooms"][3]["ceilingHeightCm"], 270)
            self.assertEqual((len(state["items"]), len(state["products"])), (182, 28))
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_fresh_balcony_is_vector_only_and_keeps_visible_safety_cues(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 950})
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            self.open_demo(page)
            state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((len(state["items"]), len(state["products"]),
                              state["revision"], state["undo"]), (182, 28, 0, None))
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            overview = page.locator(".overview-svg")
            self.assertEqual(overview.locator(".fixed-balcony-sink").count(), 1)
            self.assertEqual(overview.locator(
                '[data-demolition-status="proposed"]').count(), 1)
            self.assertEqual(overview.locator(
                '[data-marker-id="balcony-dryer"].out-of-bounds').count(), 0)
            self.assertIn("非可施工", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
            dryer_warning = page.locator(
                '[data-laundry-warning="balcony-dryer"]').first
            self.assertIsNone(dryer_warning.locator(
                ".warning-details").get_attribute("open"))
            dryer_warning.locator("summary").click()
            self.assertIn("R33", dryer_warning.inner_text())
            dryer_warning.locator("summary").click()
            self.assertIn("獨立混凝土支撐", page.locator(
                '[data-laundry-warning="balcony-outboard-sink"]').first.inner_text())

            overview.locator('.plan-zone[data-select-room="balcony"]').click()
            self.assertEqual(page.locator(
                'svg[data-room-canvas="balcony"] .fixed-balcony-sink').count(), 1)
            self.assertEqual(page.locator(
                'svg[data-room-canvas="balcony"] .conditional-floor-dryer').count(), 1)
            self.assertEqual(page.locator(
                'svg[data-room-canvas="balcony"] '
                '[data-demolition-status="proposed"]').count(), 1)
            reference = page.locator(".balcony-reference")
            self.assertEqual(reference.locator("svg[data-balcony-reference='vector']").count(), 1)
            self.assertTrue(reference.locator("svg").is_visible())
            self.assertEqual(reference.locator("img, image, foreignObject").count(), 0)
            self.assertIn("非施工配置", reference.locator(
                ".balcony-safety-cue").inner_text())
            details = reference.locator(".balcony-safety-details")
            self.assertIsNone(details.get_attribute("open"))
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            budget = page.locator(".budget").inner_text()
            details.locator("summary").focus()
            page.keyboard.press("Enter")
            self.assertIsNotNone(details.get_attribute("open"))
            self.assertIn("不可用軟管跨門", details.inner_text())
            self.assertIn("可靠混凝土結構", details.inner_text())
            details.locator("summary").focus()
            page.keyboard.press("Space")
            self.assertIsNone(details.get_attribute("open"))
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertEqual(page.locator(".budget").inner_text(), budget)

            page.set_viewport_size({"width": 390, "height": 844})
            reference.locator(".balcony-reference-scroll").scroll_into_view_if_needed()
            self.assertTrue(reference.locator(".balcony-reference-scroll").evaluate(
                "node => node.scrollWidth > node.clientWidth"))
            self.assertGreaterEqual(reference.locator("svg").evaluate(
                "node => node.getBoundingClientRect().width"), 650)
            balcony_scroll = page.evaluate("document.documentElement.scrollWidth")
            page.locator('[data-action="all-rooms"]').click()
            self.assertLessEqual(balcony_scroll, page.evaluate(
                "document.documentElement.scrollWidth"))
            page.locator('.overview-svg .plan-zone[data-select-room="balcony"]').click()
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            page.locator("[data-plan-room-select]").select_option("ac-platform")
            self.assertEqual(page.locator(
                'svg[data-room-canvas="ac-platform"] '
                '[data-marker-id="balcony-outboard-sink"] .object-icon').count(), 1)
            self.assertEqual(page.locator(
                'svg[data-room-canvas="ac-platform"] '
                '[data-marker-id="balcony-outboard-sink"] .conditional-outboard-basin').count(), 1)
            self.assertGreaterEqual(page.locator(
                'svg[data-room-canvas="ac-platform"] '
                '[data-marker-id="balcony-outboard-sink"] .icon-basin').count(), 1)
            self.assertEqual(page.locator(
                'svg[data-room-canvas="ac-platform"] '
                '[data-marker-id="balcony-outboard-sink"].square-label').count(), 0)
            self.assertEqual(errors, [])
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
            self.assertTrue(all(url.startswith(self.base) for url in requests))
        finally:
            context.close()

    def test_offline_edge_balcony_drag_and_basin_undo_stay_vector_only(self):
        if not EDGE:
            self.skipTest("Microsoft Edge is not installed")
        browser = self.playwright.chromium.launch(
            executable_path=EDGE, headless=True
        )
        try:
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, accept_downloads=True
            )
            try:
                page = context.new_page()
                errors = []
                requests = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: requests.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(PORTABLE.as_uri())
                page.wait_for_function("Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
                page.locator("#load-file-input").set_input_files(str(SAMPLE))
                page.wait_for_function(
                    "document.querySelector('#overall-total').textContent.includes('2,333,060')",
                    timeout=15000,
                )
                for tab_name in ("插座配置圖", "燈具配置圖"):
                    page.get_by_role("tab", name=tab_name, exact=True).click()
                    self.assert_balcony_sheet_context(page, True)
                page.get_by_role("tab", name="格局圖", exact=True).click()
                page.locator('.overview-svg .plan-zone[data-select-room="balcony"]').click()
                reference = page.locator(".balcony-reference")
                self.assertTrue(reference.locator(
                    'svg[data-balcony-reference="vector"]').is_visible())
                self.assertEqual(reference.locator("img, image").count(), 0)
                self.assertIsNone(reference.locator(
                    ".balcony-safety-details").get_attribute("open"))
                self.assertTrue(reference.locator(
                    ".balcony-reference-scroll").evaluate(
                        "node => node.scrollWidth > node.clientWidth"))
                budget = page.locator(".budget").inner_text()

                page.locator("[data-plan-item-select]").select_option("balcony-dryer")
                svg = page.locator('svg[data-room-canvas="balcony"]')
                svg.scroll_into_view_if_needed()
                point = svg.evaluate("""node => {
                    const p = node.createSVGPoint(); p.x = 615; p.y = 1788;
                    const from = p.matrixTransform(node.getScreenCTM());
                    p.x += 8;
                    const to = p.matrixTransform(node.getScreenCTM());
                    return {x:from.x,y:from.y,toX:to.x,toY:to.y};
                }""")
                page.mouse.move(point["x"], point["y"])
                page.mouse.down()
                page.mouse.move(point["toX"], point["toY"], steps=6)
                page.mouse.up()
                page.locator("#save-now").click()
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read()).items
                        .find(item => item.id === 'balcony-dryer').placement.x > .14
                """, timeout=15000)
                self.assertEqual(svg.locator(
                    '[data-marker-id="balcony-dryer"].out-of-bounds').count(), 0)
                self.assertEqual(page.locator(".budget").inner_text(), budget)
                page.locator("#undo-last").click()
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read()).items
                        .find(item => item.id === 'balcony-dryer').placement.x < .13
                """, timeout=15000)
                self.assertEqual(svg.locator(
                    '[data-demolition-status="proposed"]').count(), 1)

                page.locator("[data-plan-room-select]").select_option("ac-platform")
                page.locator("[data-plan-item-select]").select_option(
                    "balcony-outboard-sink")
                self.assertEqual(page.locator(
                    'svg[data-room-canvas="ac-platform"] '
                    '[data-marker-id="balcony-outboard-sink"] .object-icon').count(), 1)
                self.assertGreaterEqual(page.locator(
                    'svg[data-room-canvas="ac-platform"] '
                    '[data-marker-id="balcony-outboard-sink"] .icon-basin').count(), 1)
                page.locator('[data-action="remove-plan-item"]').click()
                page.locator('[data-action="confirm-remove-item"]').click()
                page.locator("#save-now").click()
                page.wait_for_function("""async () =>
                    !(await globalThis.__RENOVATION_OFFLINE_STORE__.read()).items
                        .some(item => item.id === 'balcony-outboard-sink')
                """, timeout=15000)
                page.get_by_role("tab", name="燈具配置圖", exact=True).click()
                self.assertEqual(page.locator("[data-sheet-context]").count(), 3)
                self.assertEqual(page.locator(
                    ".sheet-scroll .historical-proposed-sink").count(), 1)
                page.locator("#undo-last").click()
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read()).items
                        .some(item => item.id === 'balcony-outboard-sink')
                """, timeout=15000)
                self.assert_balcony_sheet_context(page, True)
                with page.expect_download() as download:
                    page.locator("#export-items").click()
                rows = list(csv.DictReader(StringIO(
                    Path(download.value.path()).read_text(encoding="utf-8-sig")
                )))
                basin = next(row for row in rows if row["名稱"] ==
                             "外推區掛牆洗衣盆（條件式）")
                self.assertEqual(basin["商品單價"], "待補")
                self.assertNotIn("烘衣機已移至外推鐵窗",
                                 "\n".join(row["備註"] for row in rows))
                self.assertEqual(page.locator(".budget").inner_text(), budget)
                self.assertEqual(requests, [])
                self.assertEqual(errors, [])
            finally:
                context.close()
        finally:
            browser.close()

    def test_electrical_tabs_use_public_saved_points_and_never_write(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 950})
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            self.open_demo(page)
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            budget = page.locator(".budget").inner_text()
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertEqual(page.get_by_role("tab").count(), 8)
            plan = page.get_by_role("tab", name="格局圖", exact=True)
            outlet = page.get_by_role("tab", name="插座配置圖", exact=True)
            lighting = page.get_by_role("tab", name="燈具配置圖", exact=True)
            plan.focus()
            page.keyboard.press("ArrowRight")
            self.assertTrue(outlet.evaluate("node => node === document.activeElement"))
            self.assertEqual(outlet.get_attribute("aria-selected"), "true")
            self.assertEqual(outlet.get_attribute("tabindex"), "0")
            self.assertEqual(page.locator("#content").get_attribute("role"),
                             "tabpanel")
            self.assertEqual(page.locator("#content").get_attribute("aria-labelledby"),
                             "view-outlet-sheet")
            self.assertTrue(page.locator("#add-item").is_hidden())
            points = page.locator("[data-sheet-point]").evaluate_all(
                "nodes => nodes.map(node => node.dataset.sheetPoint)"
            )
            self.assertEqual(len(points), 67)
            self.assertEqual(len(set(points)), 67)
            for prefix, amount in (("R", 51), ("B", 9), ("C", 7)):
                self.assertEqual(
                    sorted(point for point in points if point.startswith(prefix)),
                    [f"{prefix}{number:02d}" for number in range(1, amount + 1)],
                )
            self.assertIn("專用迴路資料 9 筆", page.locator(
                ".sheet-legend").inner_text())
            self.assertEqual(page.locator(
                ".electrical-sheet .plan-zone").count(), 13)
            self.assertEqual(page.locator(
                ".electrical-sheet [data-circuit-link-id], "
                ".electrical-sheet [data-select-room], "
                ".electrical-sheet [data-select-partition], "
                ".electrical-sheet [data-action]").count(), 0)
            self.assertEqual(page.locator(
                ".electrical-sheet .fixed-balcony-sink").count(), 1)
            self.assertEqual(page.locator(
                '.electrical-sheet [data-demolition-status="proposed"]').count(), 1)
            self.assert_balcony_sheet_context(page, True)
            self.assertIn("衝突", page.locator(
                '[data-sheet-point="R33"]').get_attribute("aria-label"))
            warnings = page.locator(".sheet-warnings")
            self.assertIn("R08／R33／R42／B05",
                          warnings.locator("summary").inner_text())
            self.assertIsNone(warnings.get_attribute("open"))
            warnings.locator("summary").click()
            self.assertIn("保留來源位置", warnings.inner_text())
            warnings.locator("summary").click()
            label_collisions = page.locator(
                "[data-sheet-point] .sheet-marker-label").evaluate_all("""nodes => {
                const boxes = nodes.map(node => node.getBoundingClientRect());
                return boxes.flatMap((a, i) => boxes.slice(i + 1).flatMap((b, j) =>
                    a.right <= b.left || b.right <= a.left ||
                    a.bottom <= b.top || b.bottom <= a.top ? [] :
                    [[nodes[i].textContent, nodes[i + j + 1].textContent]]));
            }""")
            self.assertEqual(label_collisions, [])
            outlet.focus()
            page.keyboard.press("ArrowRight")
            self.assertTrue(lighting.evaluate(
                "node => node === document.activeElement"))
            self.assertEqual(page.locator(
                "#content").get_attribute("aria-labelledby"), "view-lighting-sheet")
            self.assertEqual(page.locator("[data-sheet-light]").count(), 16)
            self.assertEqual(page.locator("[data-light-head]").count(), 19)
            self.assertEqual(page.locator("[data-sheet-switch]").count(), 14)
            self.assert_balcony_sheet_context(page, True)
            self.assertIn("移除開關 2", page.locator(
                ".electrical-sheet").inner_text())
            self.assertIn("控制對象未核", page.locator(
                ".sheet-caution").first.inner_text())
            self.assertIn("W 不能推算照度", page.locator(
                ".sheet-caution").first.inner_text())
            self.assertEqual(page.locator(
                ".electrical-sheet [data-preview-switch-id], "
                ".electrical-sheet [data-preview-light-id], "
                ".electrical-sheet .lighting-preview").count(), 0)
            schedule = page.locator(".sheet-schedule")
            self.assertIsNone(schedule.get_attribute("open"))
            schedule.locator("summary").focus()
            page.keyboard.press("Enter")
            self.assertIsNotNone(schedule.get_attribute("open"))
            self.assertIn("lm待核／°待核", schedule.inner_text())
            page.keyboard.press("Space")
            self.assertIsNone(schedule.get_attribute("open"))
            dynamic = page.evaluate("""async () => {
                const root = new URL(
                    '../extensions/renovation-equipment/assets/electrical-sheets.js',
                    location.href);
                const {electricalSheetData,renderElectricalSheet} = await import(root);
                const original = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const noProduct = structuredClone(original);
                noProduct.products = [];
                const changed = structuredClone(original);
                changed.items.find(item => item.switchType &&
                    item.switchPlanStatus === 'active').switchPlanStatus = 'removed';
                changed.items.find(item => item.lightType === 'track')
                    .spotlightQuantity = 2;
                const counts = electricalSheetData(changed);
                return {
                    missing:renderElectricalSheet(noProduct,'lighting-sheet')
                        .includes('已連結商品不存在，規格待核'),
                    active:counts.activeSwitches.length,
                    removed:counts.removedSwitches.length,
                    heads:counts.heads,
                };
            }""")
            self.assertEqual(dynamic, {
                "missing": True, "active": 13, "removed": 3, "heads": 17,
            })
            page.set_viewport_size({"width": 390, "height": 844})
            self.assertGreaterEqual(page.locator(".sheet-legend").evaluate(
                "node => parseFloat(getComputedStyle(node).fontSize)"), 14)
            scroll = page.locator(".sheet-scroll")
            self.assertTrue(scroll.evaluate(
                "node => node.scrollWidth > node.clientWidth && "
                "node.scrollHeight > node.clientHeight"))
            scroll.evaluate("node => {node.scrollLeft = 400; node.scrollTop = 1500}")
            self.assertTrue(scroll.evaluate(
                "node => node.scrollLeft > 0 && node.scrollTop > 0"))
            scroll.evaluate(
                "node => { node.scrollLeft = 580; node.scrollTop = 1446; }")
            ghost_label = page.locator(
                ".sheet-scroll .historical-proposed-sink text"
            )
            self.assertEqual(ghost_label.text_content(),
                             "原水槽擬拆")
            self.assertGreaterEqual(ghost_label.evaluate(
                "node => parseFloat(getComputedStyle(node).fontSize)"), 13)
            ghost_rect = ghost_label.bounding_box()
            scroll_rect = scroll.bounding_box()
            self.assertGreaterEqual(ghost_rect["x"], scroll_rect["x"])
            self.assertLessEqual(
                ghost_rect["x"] + ghost_rect["width"],
                scroll_rect["x"] + scroll_rect["width"],
            )
            sheet_width = page.evaluate("document.documentElement.scrollWidth")
            lighting.focus()
            page.keyboard.press("Home")
            self.assertTrue(plan.evaluate("node => node === document.activeElement"))
            self.assertLessEqual(sheet_width, page.evaluate(
                "document.documentElement.scrollWidth"))
            page.keyboard.press("End")
            self.assertTrue(page.get_by_role("tab", name="開工行事曆",
                                             exact=True).evaluate(
                "node => node === document.activeElement"))
            outlet.focus()
            page.keyboard.press("Space")
            self.assertEqual(outlet.get_attribute("aria-selected"), "true")
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertEqual([method for method, _ in requests if method != "GET"],
                             [])
            self.assertTrue(all(url.startswith(self.base) for _, url in requests))
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_electrical_tabs_offline_edge_import_and_undo_are_read_only(self):
        if not EDGE:
            self.skipTest("Microsoft Edge is not installed")
        browser = self.playwright.chromium.launch(
            executable_path=EDGE, headless=True
        )
        try:
            context = browser.new_context(accept_downloads=True)
            try:
                previous = previous_public_balcony_save()
                previous["undo"] = {
                    key: deepcopy(previous[key]) for key in
                    ("rooms", "items", "products")
                }
                previous["revision"] = 7
                next(room for room in previous["rooms"] if room["id"] ==
                     "kitchen")["ceilingHeightCm"] = 275
                page = context.new_page()
                errors = []
                requests = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: requests.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(PORTABLE.as_uri())
                page.wait_for_function("Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
                page.locator("#load-file-input").set_input_files({
                    "name": "previous-public-v5.json",
                    "mimeType": "application/json",
                    "buffer": json.dumps(previous, ensure_ascii=False).encode("utf-8"),
                })
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                        .items.length === 179
                """, timeout=15000)
                imported = page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                )
                self.assertEqual(imported["revision"], 1)
                self.assertIsNotNone(imported["undo"])
                budget = page.locator(".budget").inner_text()
                storage_before = page.evaluate(
                    "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                )
                page.get_by_role("tab", name="插座配置圖", exact=True).click()
                self.assertEqual(page.locator("[data-sheet-point]").count(), 67)
                self.assertEqual(page.locator(
                    '.electrical-sheet [data-demolition-status="proposed"]').count(), 0)
                self.assert_balcony_sheet_context(page, False)
                page.get_by_role("tab", name="燈具配置圖", exact=True).click()
                self.assertEqual(page.locator("[data-sheet-light]").count(), 16)
                self.assertEqual(page.locator("[data-light-head]").count(), 19)
                self.assertEqual(page.locator("[data-sheet-switch]").count(), 14)
                self.assert_balcony_sheet_context(page, False)
                self.assertEqual(page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), imported)
                self.assertEqual(page.locator(".budget").inner_text(), budget)
                self.assertEqual(page.evaluate(
                    "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                ), storage_before)
                with page.expect_download() as download:
                    page.locator("#save-file").click()
                exported = json.loads(Path(
                    download.value.path()).read_text(encoding="utf-8"))["state"]
                self.assertEqual(
                    {key: exported[key] for key in ("rooms", "items", "products", "undo")},
                    {key: imported[key] for key in ("rooms", "items", "products", "undo")},
                )
                page.locator("#undo-last").click()
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                        .rooms.find(room => room.id === 'kitchen')
                            .ceilingHeightCm === null
                """, timeout=15000)
                restored = page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                )
                self.assertEqual(
                    {key: restored[key] for key in ("rooms", "items", "products")},
                    imported["undo"],
                )
                self.assertEqual(page.locator("[data-sheet-light]").count(), 16)
                self.assertEqual(page.locator(".budget").inner_text(), budget)
                self.assert_balcony_sheet_context(page, False)
                self.assertEqual(requests, [])
                self.assertEqual(errors, [])
            finally:
                context.close()
        finally:
            browser.close()

    def test_explicit_panel_controls_require_save_and_keep_unassigned_preview_inert(self):
        context = self.browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            self.open_demo(page)
            baseline = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            budget = page.locator(".budget").inner_text()
            self.assertEqual((len(baseline["items"]), baseline["revision"],
                              baseline["undo"]), (182, 0, None))
            self.assertFalse(any("controlledLightIds" in item
                                 for item in baseline["items"]))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-calendar-attendees-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            page.locator('[data-action="toggle-light-preview"]').click()
            self.assertEqual(page.locator("[data-preview-light-id]").count(), 0)
            page.locator('[data-preview-item-id="quoted-switch-01"]').click()
            self.assertIn("尚未設定對應",
                          page.locator("#save-status").inner_text())
            self.assertIn("已亮 16 組",
                          page.locator(".lighting-legend").inner_text())
            page.locator(
                '[data-preview-item-id="living-ceiling-light-01"]').click()
            self.assertIn("已亮 15 組",
                          page.locator(".lighting-legend").inner_text())
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), baseline)

            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            self.assertEqual(page.locator("[data-control-light-id]").count(), 0)
            self.assertIn("尚未設定對應 14",
                          page.locator("[data-control-summary]").inner_text())
            page.locator("#control-switch").select_option("quoted-switch-01")
            page.locator(
                'input[name="controlledLightIds"][value="corridor-track-lighting"]'
            ).check()
            page.locator(
                'input[name="controlledLightIds"][value="living-ceiling-light-01"]'
            ).check()
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), baseline)
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-calendar-attendees-v1:' + location.pathname)"
            ))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            page.locator("#control-relations-form button").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 1 &&
                    state.items.find(item => item.id === 'quoted-switch-01')
                        .controlledLightIds?.length === 2;
            }""", timeout=15000)
            updated = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            assigned = next(item for item in updated["items"] if item["id"] ==
                            "quoted-switch-01")["controlledLightIds"]
            self.assertEqual(set(assigned), {
                "living-ceiling-light-01", "corridor-track-lighting",
            })
            self.assertEqual(updated["undo"]["items"], baseline["items"])
            self.assertEqual(updated["undo"]["rooms"], baseline["rooms"])
            self.assertEqual(page.locator("[data-control-light-id]").count(), 2)
            self.assertTrue(all("非實際配管走線" in value for value in page.locator(
                "[data-control-light-id]").evaluate_all(
                "nodes => nodes.map(node => node.getAttribute('aria-label'))"
            )))
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            stored = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            self.assertEqual(stored["revision"], 1)

            with page.expect_download() as download:
                page.locator("#save-file").click()
            exported = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(exported["formatVersion"], 11)
            self.assertEqual(exported["state"]["items"], updated["items"])
            self.assertEqual(exported["state"]["undo"], updated["undo"])
            page.reload()
            page.wait_for_function(
                "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
                timeout=15000,
            )
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), updated)
            self.assertEqual(len([url for _, url in requests
                                  if "/files/" in url]), 1)
            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            self.assertEqual(page.locator("[data-control-light-id]").count(), 2)
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 2 && state.undo === null;
            }""", timeout=15000)
            restored = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(restored["items"], baseline["items"])
            self.assertEqual(page.locator("[data-control-light-id]").count(), 0)
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            self.assertTrue(all(method == "GET" and url.startswith(self.base)
                                for method, url in requests))
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_public_helpers_keep_derived_data_and_reject_partial_layouts(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            report = page.evaluate("""async () => {
                const directory = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{migrateKitchenPlan},{migrateOutletDiagram,OUTLET_POINT_WARNINGS,
                    OUTLET_DIAGRAM_POINTS},{electricalPointCounts,isWeakCurrent},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD},
                    {renderOverviewPlan,renderRoomPlan},{itemListCsv},
                    {HOUSE_ZONE_BY_ID,BALCONY_SINK,pointInZone,footprintFits}] =
                    await Promise.all(['kitchen-plan.js','outlet-diagram.js','socket-plan.js',
                        'budget.js','floorplan.js','file-actions.js','house-geometry.js'].map(name =>
                        import(new URL(name,directory))));
                const original = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const kitchen = migrateKitchenPlan(original);
                const diagram = migrateOutletDiagram(original);
                const withoutC01 = structuredClone(original);
                withoutC01.items = withoutC01.items.filter(item =>
                    item.outletPlanPointId !== 'C01');
                let partialRejected = false;
                try { migrateOutletDiagram(withoutC01); }
                catch (error) { partialRejected = /部分/.test(error.message); }
                const malformed = structuredClone(original);
                malformed.items.find(isWeakCurrent).outletCircuit = 'additional-general';
                let weakRejected = false;
                try {
                    await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                        ...malformed, expectedRevision: original.revision, undo: null,
                        controlRelationsVersion: 1, doorAllocationVersion: 1, robotFeatureVersion: 1, calendarFeatureVersion: 1, calendarAttendeesVersion: 1, managementFeeVersion: 1,
                    });
                } catch (error) { weakRejected = /弱電|來源標位/.test(error.message); }
                const overview = renderOverviewPlan(original.rooms,original.items);
                const room = original.rooms.find(entry => entry.id === 'kitchen');
                const kitchenSvg = renderRoomPlan(room,original.items.filter(entry =>
                    entry.roomId === room.id),null,original.items);
                const kitchenItems = original.items.filter(entry =>
                    entry.id.startsWith('kitchen-plan-'));
                const weak = original.items.filter(isWeakCurrent);
                const csv = itemListCsv(original);
                const positioned = id => {
                    const item = original.items.find(entry =>
                        entry.outletPlanPointId === id);
                    const zone = HOUSE_ZONE_BY_ID.get(item.roomId);
                    return {zone,x:zone.x + zone.width * item.placement.x,
                        y:zone.y + zone.height * item.placement.y};
                };
                const balcony = positioned('R33');
                return {
                    quote:ORIGINAL_QUOTE_TWD,
                    plan:calculatePlanTotal(calculateBudget(original.items,{
                        wholePlan:true})).TWD,
                    kitchenAdditions:calculateBudget(kitchenItems).additionalTotals.TWD,
                    weakAdditions:calculateBudget(weak).additionalTotals.TWD,
                    weakQuoted:calculateBudget(weak).quotedBaselineTotal,
                    counts:electricalPointCounts(original.items),
                    anchorCount:OUTLET_DIAGRAM_POINTS.length,
                    originalAnchors:OUTLET_DIAGRAM_POINTS.every(point => {
                        const item = original.items.find(entry =>
                            entry.outletPlanPointId === point.sourceId);
                        return item?.roomId === point.roomId &&
                            JSON.stringify(item.placement) ===
                                JSON.stringify(point.placement);
                    }),
                    conflictFootprints:['R08','R33','R42'].every(id => {
                        const {zone,x,y} = positioned(id);
                        return !footprintFits(zone,x,y,12,12);
                    }),
                    balconySinkConflict:pointInZone(balcony.zone,balcony.x,balcony.y) &&
                        balcony.x >= BALCONY_SINK.x &&
                        balcony.x <= BALCONY_SINK.x + BALCONY_SINK.width &&
                        balcony.y >= BALCONY_SINK.y &&
                        balcony.y <= BALCONY_SINK.y + BALCONY_SINK.height,
                    warnings:Object.keys(OUTLET_POINT_WARNINGS).every(id =>
                        overview.includes(OUTLET_POINT_WARNINGS[id])),
                    overviewAnchors:(overview.match(/data-outlet-point-id=/g) || []).length,
                    kitchenObjects:(kitchenSvg.match(/data-marker-id="kitchen-plan-/g) || []).length,
                    kitchenSVG:kitchenSvg.includes('共用檯 80cm') &&
                        !/<image|\\.jpg|\\.png/.test(kitchenSvg),
                    unchangedKitchen:kitchen.addedItems === 0 &&
                        JSON.stringify(kitchen.state) === JSON.stringify(original),
                    unchangedOutlets:diagram.changed === false &&
                        JSON.stringify(diagram.state) === JSON.stringify(original),
                    partialRejected,weakRejected,
                    csvAnchors:OUTLET_DIAGRAM_POINTS.every(point =>
                        csv.split('\\r\\n').filter(line =>
                            line.includes(',"'+point.sourceId+'",')).length === 1),
                    oldSampleIgnored:localStorage.length === 0,
                };
            }""")
            self.assertEqual(report["quote"], 1_959_530)
            self.assertEqual(report["plan"], 2_322_060.2)
            self.assertEqual(report["kitchenAdditions"], 94_000)
            self.assertEqual((report["weakAdditions"], report["weakQuoted"]), (0, 21_000))
            self.assertEqual(report["counts"], {
                "power": 60, "general": 51, "dedicated": 9, "circuits": 9, "weak": 7,
            })
            self.assertEqual((report["anchorCount"], report["overviewAnchors"],
                              report["kitchenObjects"]), (67, 67, 12))
            for property_name in ("warnings", "originalAnchors", "conflictFootprints",
                                  "balconySinkConflict", "kitchenSVG", "unchangedKitchen",
                                  "unchangedOutlets", "partialRejected", "weakRejected",
                                  "csvAnchors", "oldSampleIgnored"):
                self.assertTrue(report[property_name], property_name)
        finally:
            context.close()

    def test_kitchen_reference_three_fixed_svg_views_in_pages(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            self.open_demo(page)
            page.locator('.overview-svg .plan-zone[data-select-room="kitchen"]').click()
            reference = page.locator(".kitchen-reference")
            self.assertIsNone(reference.get_attribute("open"))
            self.assertEqual(reference.locator("figure").count(), 3)
            self.assertEqual(reference.locator("svg").count(), 3)
            self.assertTrue(all(svg.is_hidden() for svg in reference.locator("svg").all()))
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            total = page.locator(".budget").inner_text()
            reference.locator("summary").focus()
            page.keyboard.press("Enter")
            self.assertIsNotNone(reference.get_attribute("open"))
            self.assertEqual([caption.inner_text() for caption in reference.locator(
                "figcaption").all()],
                ["① 立體圖（約45°）", "② 正立面／直立圖（長牆＋短牆）",
                 "③ 俯視圖"])
            for kind in ("isometric", "elevations", "top"):
                svg = reference.locator(f'svg[data-kitchen-view="{kind}"]')
                self.assertTrue(svg.is_visible(), kind)
                self.assertEqual(svg.get_attribute("role"), "img")
                self.assertEqual(svg.locator("title[id]").get_attribute("id"),
                                 svg.get_attribute("aria-labelledby"))
                self.assertEqual(svg.locator("[data-kitchen-bay]").count(), 5)
                self.assertEqual(svg.locator("[data-kitchen-object]").count(), 7)
                for selector in (
                    '[data-kitchen-object="dishwasher"][data-bay="prep"][data-layer="under"]',
                    '[data-kitchen-object="hot-water"][data-bay="sink"][data-layer="under"]',
                    '[data-kitchen-object="ih"][data-bay="hob"]',
                    '[data-kitchen-object="gas"][data-bay="hob"]',
                    '[data-kitchen-object="hood"][data-bay="hob"][data-layer="above"]',
                    '[data-kitchen-bay="short-return"]',
                    '[data-kitchen-bay="tower-short-end"]',
                ):
                    self.assertEqual(svg.locator(selector).count(), 1, (kind, selector))
                self.assertEqual(svg.locator(
                    '[data-kitchen-bay="tower-main-right"]').count(), 0)
                self.assertEqual(svg.locator(
                    '[data-kitchen-fill="adjustable"]').count(), 1)
            iso = reference.locator('svg[data-kitchen-view="isometric"]')
            self.assertEqual(iso.locator(
                '[data-countertop-outline="single-L"]').count(), 1)
            self.assertEqual(len(iso.locator(
                '[data-countertop-outline="single-L"]').get_attribute(
                    "points").split()), 6)
            self.assertEqual(iso.locator(
                '[data-kitchen-countertop="continuous-open-corner"]').count(), 1)
            for bay in ("prep", "sink", "hob", "short-return"):
                self.assertEqual(iso.locator(
                    f'[data-kitchen-bay="{bay}"] polygon.kitchen-reference-top'
                ).count(), 0)
            joined = reference.evaluate("""element => {
                const bounds = (selector) => {
                    const {x,y,width,height} =
                        element.querySelector(selector).getBBox();
                    return {x,y,width,height};
                };
                return {
                    topFill:bounds('svg[data-kitchen-view="top"] [data-kitchen-fill] rect'),
                    topPrep:bounds('svg[data-kitchen-view="top"] [data-kitchen-bay="short-return"] rect'),
                    topTower:bounds('svg[data-kitchen-view="top"] [data-kitchen-bay="tower-short-end"] rect'),
                    frontPrep:bounds('svg[data-kitchen-view="elevations"] [data-kitchen-bay="short-return"] rect'),
                    frontTower:bounds('svg[data-kitchen-view="elevations"] [data-kitchen-bay="tower-short-end"] rect'),
                };
            }""")
            self.assertLess(joined["topPrep"]["y"] + joined["topPrep"]["height"],
                            joined["topTower"]["y"])
            self.assertLessEqual(joined["topFill"]["y"], joined["topPrep"]["y"])
            self.assertGreaterEqual(joined["topFill"]["y"] + joined["topFill"]["height"],
                                    joined["topTower"]["y"] + joined["topTower"]["height"])
            self.assertEqual((joined["topPrep"]["x"], joined["topPrep"]["width"]),
                             (joined["topTower"]["x"], joined["topTower"]["width"]))
            self.assertEqual(joined["frontPrep"]["x"] + joined["frontPrep"]["width"],
                             joined["frontTower"]["x"])
            self.assertIn("尚未證明有足夠內部淨寬", reference.inner_text())
            self.assertIn("價格以存檔為準", reference.inner_text())
            self.assertIn("不隨拖曳", reference.inner_text())
            self.assertEqual(reference.locator("img, image, iframe, foreignObject").count(), 0)
            self.assertEqual(page.locator(
                'svg[data-room-canvas="kitchen"] [data-marker-id^="kitchen-plan-"]'
            ).count(), 12)
            reference.locator("summary").click()
            self.assertIsNone(reference.get_attribute("open"))
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertEqual(page.locator(".budget").inner_text(), total)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertEqual(errors, [])
            self.assertTrue(all(url.startswith(self.base) for url in requests))
        finally:
            context.close()

    def test_kitchen_reference_offline_mobile_in_edge(self):
        if not EDGE:
            self.skipTest("Microsoft Edge is not installed")
        browser = self.playwright.chromium.launch(
            executable_path=EDGE, headless=True
        )
        try:
            context = browser.new_context(viewport={"width": 390, "height": 844})
            try:
                page = context.new_page()
                requests = []
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: requests.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(PORTABLE.as_uri())
                page.wait_for_function("Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
                page.locator("#load-file-input").set_input_files(str(SAMPLE))
                page.wait_for_function(
                    "document.querySelector('#overall-total').textContent.includes('2,333,060')",
                    timeout=15000,
                )
                page.locator('.plan-zone[data-select-room="kitchen"]').click()
                reference = page.locator(".kitchen-reference")
                self.assertIsNone(reference.get_attribute("open"))
                self.assertTrue(all(svg.is_hidden() for svg in
                                    reference.locator("svg").all()))
                before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
                total = page.locator(".budget").inner_text()
                reference.locator("summary").focus()
                page.keyboard.press("Enter")
                for kind in ("isometric", "elevations", "top"):
                    self.assertTrue(reference.locator(
                        f'[data-kitchen-view="{kind}"]').is_visible())
                for index, panel in enumerate(reference.locator(
                    ".kitchen-projection-scroll").all()):
                    panel.focus()
                    self.assertTrue(panel.evaluate(
                        "element => element.scrollWidth > element.clientWidth"))
                    self.assertGreaterEqual(panel.locator("svg").evaluate(
                        "element => element.getBoundingClientRect().width"),
                        860 if index == 1 else 760)
                    page.keyboard.press("ArrowRight")
                    page.wait_for_function("document.activeElement.scrollLeft > 0")
                reference.locator("summary").click()
                self.assertIsNone(reference.get_attribute("open"))
                self.assertEqual(page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
                self.assertEqual(page.locator(".budget").inner_text(), total)
                page.locator(
                    "nav.plan-room-navigation select[data-plan-room-select]"
                ).select_option("bath-guest")
                self.assertEqual(page.locator(
                    'svg[data-room-canvas="bath-guest"] '
                    '[data-tub-depth="unknown"]').count(), 1)
                self.assertIn("深度／淨距未定，非可施工",
                              page.locator(
                                  '[data-vanity-warning="bath-guest-vanity"]'
                              ).first.inner_text())
                self.assertEqual(page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
                self.assertEqual(requests, [])
                self.assertEqual(errors, [])
            finally:
                context.close()
        finally:
            browser.close()

    def test_public_v_migration_preserves_anonymous_data_and_visual_fill(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            self.open_demo(page)
            report = page.evaluate("""async () => {
                const root = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{migrateKitchenVLayout,renderKitchenReference},
                    {kitchenShortWingFill,renderOverviewPlan,renderRoomPlan,roomGeometry},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD}] =
                    await Promise.all(['kitchen-plan.js','floorplan.js','budget.js']
                        .map(name => import(new URL(name,root))));
                const original = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const before = structuredClone(original);
                const migrated = migrateKitchenVLayout(original);
                const next = migrated.state;
                const changedIds = original.items.filter((item,index) =>
                    JSON.stringify(item) !== JSON.stringify(next.items[index]))
                    .map(item => item.id);
                const room = next.rooms.find(item => item.id === 'kitchen');
                const geometry = roomGeometry(room);
                const fill = kitchenShortWingFill(next.items,geometry);
                const overview = renderOverviewPlan(next.rooms,next.items);
                const detailed = renderRoomPlan(room,next.items.filter(item =>
                    item.roomId === 'kitchen'),null,next.items);
                const moved = structuredClone(next);
                moved.items.find(item => item.id === 'kitchen-plan-return')
                    .placement.x = .2;
                const invalid = kitchenShortWingFill(moved.items,geometry);
                const reference = renderKitchenReference();
                return {
                    changed:migrated.changed,changedIds,
                    itemCount:next.items.length,productCount:next.products.length,
                    roomsUntouched:JSON.stringify(original.rooms) ===
                        JSON.stringify(next.rooms),
                    productsUntouched:JSON.stringify(original.products) ===
                        JSON.stringify(next.products),
                    sourceUntouched:JSON.stringify(original) ===
                        JSON.stringify(before),
                    baseline:ORIGINAL_QUOTE_TWD,
                    total:calculatePlanTotal(calculateBudget(next.items,{
                        wholePlan:true})).TWD,
                    revision:next.revision,
                    anchorsUntouched:next.items.filter(item => item.outletPlanPointId)
                        .every(item => JSON.stringify(item.placement) ===
                            JSON.stringify(original.items.find(entry => entry.id ===
                                item.id).placement)),
                    tower:next.items.find(item => item.id === 'kitchen-plan-tower'),
                    platform:next.items.find(item => item.id === 'kitchen-plan-return'),
                    fillValid:fill?.valid === true,
                    fillExtends:fill && Math.abs(fill.y+fill.height-
                        (geometry.y+geometry.height)) < .000001,
                    overviewFill:overview.includes('data-fill-band="short-wing"'),
                    roomFill:detailed.includes('data-fill-band="short-wing"'),
                    invalidFill:invalid?.valid === false,
                    referenceL:reference.includes('data-countertop-outline="single-L"'),
                    oldEditsUnchanged:localStorage.length === 0,
                };
            }""")
            self.assertEqual(report["changedIds"],
                             ["kitchen-plan-tower", "kitchen-plan-return"]
                             if report["changed"] else [])
            self.assertEqual((report["itemCount"], report["productCount"],
                              report["revision"]), (182, 28, 0))
            self.assertEqual((report["baseline"], report["total"]),
                             (1_959_530, 2_322_060.2))
            for key in ("roomsUntouched", "productsUntouched", "sourceUntouched",
                        "anchorsUntouched", "fillValid", "fillExtends",
                        "overviewFill", "roomFill", "invalidFill", "referenceL",
                        "oldEditsUnchanged"):
                self.assertTrue(report[key], key)
            self.assertEqual(report["tower"]["placement"], {"x": .826, "y": .675})
            self.assertEqual(report["platform"]["placement"], {"x": .824, "y": .262})
            self.assertIsNone(report["tower"]["unitPrice"])
            self.assertIsNone(report["platform"]["unitPrice"])
            self.assertIn("非訂製尺寸", report["tower"]["note"])
            self.assertEqual(errors, [])
            self.assertTrue(all(url.startswith(self.base) for url in requests))
        finally:
            context.close()

    def test_selected_50w_light_stays_relative_and_catalog_reprices_all_eight(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            requests = []
            errors = []
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            self.open_demo(page)
            page.locator('button[data-view="database"]').click()
            card = page.locator(
                '.product-card[data-product-id="catalog-ceiling-trplus-026036388"]'
            )
            self.assertTrue(card.is_visible())
            for label in ("50W", "流明待查", "光束角待查", "光學來源待查",
                          "NT$1,215", "已連動 8 個"):
                self.assertIn(label, card.inner_text())
            report = page.evaluate("""async () => {
                const root = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{applyProductToItem,productAllowedInRoom,linkedProductMismatch},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD},
                    {lightDataStatus,lightSourcesForRoom,estimateRoomIlluminance},
                    {roomGeometry},{encodeSave,decodeSave}] =
                    await Promise.all(['product-database.js','budget.js',
                        'lighting-preview.js','floorplan.js','file-actions.js']
                        .map(name => import(new URL(name,root))));
                const original = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const product = original.products.find(entry =>
                    entry.id === 'catalog-ceiling-trplus-026036388');
                const ceilings = original.items.filter(item =>
                    item.lightType === 'ceiling');
                const linked = ceilings.filter(item => item.productId === product.id);
                const before = calculatePlanTotal(calculateBudget(original.items,
                    {wholePlan:true})).TWD;
                const light = original.items.find(item =>
                    item.id === 'living-ceiling-light-01');
                const repriced = {...product,unitPrice:product.unitPrice+100};
                const selected = applyProductToItem(repriced,light);
                const room = roomGeometry(original.rooms.find(entry =>
                    entry.id === light.roomId));
                const lampStatus = lightDataStatus(selected,room);
                const source = lightSourcesForRoom(room,[selected],
                    new Set([selected.id]))[0];
                const illuminance = estimateRoomIlluminance(room,[selected],
                    new Set([selected.id]));
                const changed = structuredClone(original);
                changed.products = changed.products.map(entry => entry.id === product.id ?
                    repriced : entry);
                changed.items = changed.items.map(item =>
                    item.productId === product.id ?
                        applyProductToItem(repriced,item) : item);
                const saved = await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                    ...changed,expectedRevision:original.revision,undo:null,
                    controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1});
                const after = calculatePlanTotal(calculateBudget(saved.items,
                    {wholePlan:true})).TWD;
                const exported = decodeSave(encodeSave(saved));
                return {
                    quote:ORIGINAL_QUOTE_TWD,before,after,
                    products:original.products.length,
                    originalCeilings:ceilings.length,
                    selectedCount:linked.length,
                    balconyId:ceilings.find(item => item.roomId === 'balcony').productId,
                    repricedCount:saved.items.filter(item =>
                        item.productId === product.id && item.unitPrice === 1315).length,
                    indoor:productAllowedInRoom(product,'living-dining'),
                    balcony:productAllowedInRoom(product,'balcony'),
                    fixturePrice:selected.unitPrice,install:selected.installationUnitPrice,
                    watts:selected.lightWatts,lumens:selected.lightLumens,
                    angle:selected.beamAngleDeg,specSource:selected.lightSpecSource,
                    mismatch:linkedProductMismatch(repriced,selected),
                    mode:lampStatus.mode,missing:lampStatus.missing,
                    centerLux:source.centerLux ?? null,
                    completeCount:illuminance.completeCount,
                    minLux:illuminance.minLux,
                    roundTrip:exported.items.find(item =>
                        item.id === selected.id).unitPrice === 1315 &&
                        exported.products.length === 28,
                };
            }""")
            self.assertEqual((report["quote"], report["before"], report["after"]),
                             (1_959_530, 2_322_060.2, 2_322_860.2))
            self.assertEqual((report["products"], report["originalCeilings"]),
                             (28, 9))
            self.assertEqual((report["selectedCount"], report["repricedCount"],
                              report["balconyId"]), (8, 8, "sample-product-23"))
            self.assertTrue(report["indoor"])
            self.assertFalse(report["balcony"])
            self.assertEqual((report["fixturePrice"], report["install"],
                              report["watts"], report["lumens"],
                              report["angle"], report["specSource"], report["mismatch"]),
                             (1315, 1200, 50, None, None, "", None))
            self.assertEqual(report["mode"], "watt-relative")
            for missing in ("流明", "光束角", "光學資料來源"):
                self.assertIn(missing, report["missing"])
            self.assertEqual((report["centerLux"], report["completeCount"],
                              report["minLux"]), (None, 0, None))
            self.assertTrue(report["roundTrip"])
            self.assertEqual(errors, [])
            self.assertTrue(all(url.startswith(self.base) for url in requests))
        finally:
            context.close()

    def test_conditional_layout_uses_real_dimensions_without_approving_construction(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            errors = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            self.open_demo(page)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            note = page.locator("details.quote-intro")
            self.assertEqual(note.count(), 1)
            self.assertIsNone(note.get_attribute("open"))
            note.locator("summary").click()
            self.assertTrue(note.locator(".quote-note").is_visible())
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            ac_group = page.locator(".ac-warning-group").first
            self.assertEqual(ac_group.locator(":scope > h3").inner_text(), "冷氣室外機")
            self.assertTrue(ac_group.locator(":scope > h3").is_visible())
            self.assertEqual(ac_group.locator(":scope > h3").evaluate(
                "heading => heading.nextElementSibling.tagName"), "UL")
            self.assertEqual(ac_group.locator(".urgent-cues li").evaluate_all(
                "items => items.map(item => item.dataset.acRoomCue)"),
                ["ac-master", "ac-bedroom-2", "ac-bedroom-3"])
            ac_notes = ac_group.locator(
                'details.warning-details[data-explanation="ac"]')
            self.assertIsNone(ac_notes.get_attribute("open"))
            for room_id in ("bedroom-2", "bedroom-3"):
                self.assertTrue(page.locator(
                    f'.ac-warning-group [data-ac-room-cue="ac-{room_id}"]').first.is_visible())
            ac_notes.locator("summary").first.focus()
            page.keyboard.press("Enter")
            self.assertIsNotNone(ac_notes.get_attribute("open"))
            self.assertEqual(ac_notes.inner_text().count("室內高度 29.3／29.6cm"), 1)
            self.assertIn("主臥、客餐廳", ac_notes.inner_text())
            self.assertNotIn("臥室1選 CHIMEI", ac_notes.inner_text())
            page.locator(
                '.overview-svg .plan-zone[data-select-room="bath-guest"]'
            ).click()
            guest = page.locator('[data-vanity-warning="bath-guest-vanity"]').first
            self.assertIn("深度／淨距未定，非可施工", guest.inner_text())
            guest.locator("details.warning-details > summary").click()
            for text in ("80cm僅水平區段", "浴缸深度／高度未定",
                         "無法判定浴缸完整占地", "不以未見重疊認定能安裝"):
                self.assertIn(text, guest.inner_text())
            self.assertEqual(page.locator(
                'svg[data-room-canvas="bath-guest"] [data-tub-depth="unknown"]'
            ).count(), 1)
            switcher = page.locator("nav.plan-room-navigation select[data-plan-room-select]")
            switcher.select_option("bedroom-2")
            bedroom = page.locator('[data-ac-room-cue="ac-bedroom-2"]').first
            self.assertTrue(bedroom.is_visible())
            self.assertIn("無已確認對外窗", bedroom.inner_text())
            self.assertNotIn("嚴重過大容量", bedroom.inner_text())
            self.assertEqual(page.locator(
                '[data-item-id="ac-bedroom-2"][data-outdoor-ac-window]').count(), 0)
            switcher.select_option("balcony")
            self.assertIn("瓦斯烘衣機", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
            self.assertIn("約81cm", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
            self.assertEqual(page.locator(
                'svg[data-room-canvas="balcony"] '
                '[data-demolition-status="proposed"]').count(), 1)
            switcher.select_option("corridor")
            rail = page.locator('.corridor-light-choices input[data-field="trackLengthCm"]')
            self.assertEqual(rail.input_value(), "300")
            self.assertIsNotNone(rail.get_attribute("readonly"))
            self.assertIn("4,684", page.locator(".corridor-light-cost").inner_text())
            self.assertIn("4 盞", page.locator(".corridor-light-choices").inner_text())
            page.locator('button[data-view="room"]').click()
            badge = page.locator(
                'details.equipment[data-id="quoted-downlight-01"] '
                '.quote-provenance').first
            self.assertIn("崁燈安裝", badge.get_attribute("title"))
            badge.focus()
            self.assertTrue(page.locator(".quote-tooltip").is_visible())
            self.assertIn("NT$5,700", page.locator(".quote-tooltip").inner_text())
            page.keyboard.press("Escape")
            self.assertTrue(page.locator(".quote-tooltip").is_hidden())
            page.locator('button[data-view="database"]').click()
            small = page.locator('.product-card[data-product-id="sample-product-28"]')
            large = page.locator('.product-card[data-product-id="sample-product-21"]')
            self.assertIn("已連動 4 個", small.inner_text())
            self.assertIn("已連動 2 個", large.inner_text())
            for term in ("73.2×55.5×33", "29.3", "29.6", "21,032"):
                self.assertIn(term, small.inner_text())
            self.assertEqual(errors, [])
            self.assertTrue(all(url.startswith(self.base) for url in requests))
        finally:
            context.close()

    def test_public_migration_guards_prices_product_links_and_geometry(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            report = page.evaluate("""async () => {
                const root = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{migrateCorridorPlan},{migrateAirConditioningPlan},
                    {trackLengthCm},{productFromDraft,productAllowedInRoom,
                        equipmentFromProduct,linkedProductMismatch},
                    {guestVanityAssessment,roomGeometry,renderRoomPlan},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD},
                    {itemListCsv,encodeSave,decodeSave},
                    {conditionalGasDryerWarning}] =
                    await Promise.all(['corridor-plan.js','air-conditioning-plan.js',
                        'track-lighting.js','product-database.js','floorplan.js',
                        'budget.js','file-actions.js','laundry-notes.js']
                        .map(name => import(new URL(name,root))));
                const source = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const byId = id => source.items.find(item => item.id === id);
                const byProduct = id => source.products.find(item => item.id === id);
                const rail = byId('corridor-track-lighting');
                const corridorSVG = renderRoomPlan(
                    source.rooms.find(room => room.id === 'corridor'),
                    source.items.filter(item => item.roomId === 'corridor'),
                    rail.id, source.items);
                const assessment = guestVanityAssessment(source.items,roomGeometry(
                    source.rooms.find(room => room.id === 'bath-guest')));
                const acs = source.items.filter(item =>
                    ['sample-product-21','sample-product-28'].includes(item.productId));
                const window = byProduct('sample-product-22');
                let windowGuard = false, lengthGuard = false;
                try { equipmentFromProduct(window,'bedroom-2','test-window'); }
                catch (error) { windowGuard = /候選|分離式/.test(error.message); }
                try { trackLengthCm(3001); }
                catch (error) { lengthGuard = /1–3000cm/.test(error.message); }
                const invalid = structuredClone(source);
                invalid.items.find(item => item.id === 'ac-bedroom-2')
                    .outdoorZoneId = 'invented-outdoor-position';
                let invalidStateRejected = false;
                try {
                    await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                        ...invalid,expectedRevision:source.revision,undo:null,
                        controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1,
                    });
                } catch (error) {
                    invalidStateRejected = /室外|窗位|產品/.test(error.message);
                }
                const sourceProducts = source.products.filter(product =>
                    ['sample-product-19','sample-product-20','sample-product-21',
                     'sample-product-22','sample-product-23','sample-product-24',
                     'sample-product-25','sample-product-26','sample-product-27',
                     'sample-product-28']
                    .includes(product.id));
                const csv = itemListCsv(source);
                const exported = decodeSave(encodeSave(source));
                return {
                    quote:ORIGINAL_QUOTE_TWD,
                    total:calculatePlanTotal(calculateBudget(source.items,{
                        wholePlan:true})).TWD,
                    railAmount:calculateBudget([rail]).additionalTotals.TWD,
                    acAmount:calculateBudget(acs).additionalTotals.TWD,
                    addedProducts:sourceProducts.length,
                    linked:source.items.filter(item => item.productId &&
                        linkedProductMismatch(byProduct(item.productId),item)).length,
                    productTypes:sourceProducts.map(product => product.type),
                    railLength:rail.trackLengthCm,railHeads:rail.spotlightQuantity,
                    corridorSVG:corridorSVG.includes('data-marker-id="corridor-track-lighting"') &&
                        !/<image|\\.png|\\.jpg/.test(corridorSVG),
                    vanity:{incomplete:assessment.incomplete,
                        tubDepthUnknown:assessment.tubDepthUnknown,
                        conflict:assessment.conflict,warning:assessment.warning},
                    gasWarning:conditionalGasDryerWarning(byId('balcony-dryer')),
                    bedroom2:byId('ac-bedroom-2'),
                    dishwasher:byId('kitchen-plan-dishwasher'),
                    b06:byId('pdf-outlet-B06'),
                    circuit:byId('circuit-pdf-outlet-B06'),
                    windowAllowed:productAllowedInRoom(window,'bedroom-2'),
                    originalLength:trackLengthCm(undefined),
                    unchangedRail:migrateCorridorPlan(source).changed === false,
                    unchangedAC:migrateAirConditioningPlan(source).changed === false,
                    windowGuard,lengthGuard,invalidStateRejected,
                    csvColumns:['冷氣規劃狀態','冷氣施工費（未核）',
                        '單條燈軌長度（cm）'].every(text => csv.includes(text)),
                    roundTrip:exported.items.length === 182 &&
                        exported.products.length === 28 &&
                        exported.items.find(item => item.id === 'kitchen-plan-dishwasher')
                            .installationUnitPrice === null,
                    storageUntouched:localStorage.length === 0,
                };
            }""")
            self.assertEqual((report["quote"], report["total"],
                              report["railAmount"], report["acAmount"]),
                             (1_959_530, 2_322_060.2, 4_684, 140_088))
            self.assertEqual((report["addedProducts"], report["linked"],
                              report["railLength"], report["railHeads"],
                              report["originalLength"]), (10, 0, 300, 4, 150))
            self.assertEqual(report["productTypes"],
                             ["track", "track", "split-ac", "window-ac", "split-ac", "ceiling",
                              "equipment", "equipment", "equipment", "equipment"])
            self.assertTrue(report["corridorSVG"])
            self.assertTrue(report["vanity"]["incomplete"])
            self.assertTrue(report["vanity"]["tubDepthUnknown"])
            self.assertFalse(report["vanity"]["conflict"])
            self.assertIn("深度／高度未定", report["vanity"]["warning"])
            self.assertIn("無法判定浴缸完整占地",
                          report["vanity"]["warning"])
            self.assertIn("瓦斯", report["gasWarning"])
            self.assertIn("約81cm", report["gasWarning"])
            self.assertIn("不可用軟管跨門", report["gasWarning"])
            self.assertIn("不得據圖施工", report["gasWarning"])
            self.assertEqual((report["bedroom2"]["outdoorPlacement"],
                              report["bedroom2"]["outdoorZoneId"]), (None, None))
            self.assertEqual((report["dishwasher"]["widthCm"],
                              report["dishwasher"]["depthCm"],
                              report["dishwasher"]["unitPrice"],
                              report["dishwasher"]["installationUnitPrice"]),
                             (59.8, 55, 42500, None))
            self.assertEqual((report["b06"]["id"],
                              report["circuit"]["circuitOutletId"]),
                             ("pdf-outlet-B06", "pdf-outlet-B06"))
            self.assertIn("不代表現場插孔", report["b06"]["note"])
            for key in ("unchangedRail", "unchangedAC", "windowGuard", "lengthGuard",
                        "invalidStateRejected", "csvColumns", "roundTrip",
                        "storageUntouched"):
                self.assertTrue(report[key], key)
            self.assertFalse(report["windowAllowed"])
        finally:
            context.close()

    def test_rail_reselection_and_length_edit_clear_incompatible_quote(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            page.locator('.overview-svg .plan-zone[data-select-room="corridor"]').click()
            page.locator(
                'select[data-item-product-id="corridor-track-lighting"]'
            ).select_option("")
            page.locator(
                '.corridor-light-choices select[data-field="trackSelection"]'
            ).select_option("tr-plus-150")
            length = page.locator(
                '.corridor-light-choices input[data-field="trackLengthCm"]')
            self.assertEqual(length.input_value(), "150")
            page.locator("#save-now").click()
            rail = next(item for item in page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")["items"]
                        if item["id"] == "corridor-track-lighting")
            self.assertEqual((rail["trackLengthCm"], rail["unitPrice"],
                              rail["trackSelection"], rail["productId"]),
                             (150, 349, "tr-plus-150", None))
            length.fill("175")
            length.press("Tab")
            page.locator("#save-now").click()
            rail = next(item for item in page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")["items"]
                        if item["id"] == "corridor-track-lighting")
            self.assertEqual((rail["trackLengthCm"], rail["unitPrice"],
                              rail["trackSelection"]), (175, None, "custom"))
            self.assertIn("重新報價", rail["priceSource"])
            self.assertIn("175cm", rail["brandModel"])
            self.assertIn("待補", page.locator(
                ".corridor-light-cost").inner_text())
        finally:
            context.close()

    def test_unknown_guest_tub_price_and_depth_do_not_fake_bathroom_clearance(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            report = page.evaluate("""async () => {
                const source = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const changed = structuredClone(source);
                const tub = changed.items.find(item => item.id === 'bath-guest-tub');
                Object.assign(tub, {
                    productId:null,brandModel:'80cm坐式浴缸（型號待選）',
                    unitPrice:null,priceSource:'',widthCm:80,depthCm:null,
                    note:'坐式浴缸本體價與深度待選；原標準衛浴安裝仍已含，'
                        +'新改管與淨空另核。',
                });
                for (const room of ['bath-main','bath-guest']) {
                    const vanity = changed.items.find(item =>
                        item.id === room+'-vanity');
                    vanity.widthCm = 60;
                    vanity.depthCm = 47;
                }
                const saved = await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                    ...changed,expectedRevision:source.revision,undo:null,
                    controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1,
                });
                const root = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{guestVanityAssessment,roomGeometry},
                    {isBathroomInstallationIncluded},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD}] =
                    await Promise.all(['floorplan.js','bathroom-installation.js','budget.js']
                        .map(name => import(new URL(name,root))));
                const guest = saved.rooms.find(room => room.id === 'bath-guest');
                const assessment = guestVanityAssessment(saved.items,roomGeometry(guest));
                const selected = saved.items.find(item => item.id === 'bath-guest-tub');
                const vanities = saved.items.filter(item =>
                    ['bath-main-vanity','bath-guest-vanity'].includes(item.id));
                return {
                    tub:{price:selected.unitPrice,productId:selected.productId,
                        width:selected.widthCm,depth:selected.depthCm,
                        installation:selected.installationUnitPrice,
                        included:isBathroomInstallationIncluded(selected)},
                    vanities:vanities.map(item => [item.widthCm,item.depthCm]),
                    assessment,counts:[saved.items.length,saved.products.length],
                    delta:calculatePlanTotal(calculateBudget(saved.items,{
                        wholePlan:true})).TWD -
                        calculatePlanTotal(calculateBudget(source.items,{
                            wholePlan:true})).TWD,
                    candidateOnly:saved.products.find(product =>
                        product.id === 'sample-product-03').unitPrice === 26936 &&
                        saved.items.every(item => item.productId !== 'sample-product-03'),
                    originalQuoteTWD:ORIGINAL_QUOTE_TWD,
                    anchorsUntouched:saved.items.filter(item =>
                        item.outletPlanPointId).every(item => {
                        const previous = source.items.find(entry => entry.id === item.id);
                        return JSON.stringify(item.placement) ===
                            JSON.stringify(previous.placement);
                    }),
                    originalQuote:document.querySelector('#quote-baseline').textContent,
                };
            }""")
            self.assertEqual(report["tub"], {
                "price": None, "productId": None, "width": 80, "depth": None,
                "installation": 0, "included": True,
            })
            self.assertEqual(report["vanities"], [[60, 47], [60, 47]])
            self.assertEqual(report["counts"], [182, 28])
            self.assertEqual(report["delta"], 0)
            self.assertTrue(report["candidateOnly"])
            self.assertEqual(report["originalQuoteTWD"], 1_959_530)
            self.assertFalse(report["assessment"]["conflict"])
            self.assertTrue(report["assessment"]["incomplete"])
            self.assertIn("無法判定浴缸完整占地",
                          report["assessment"]["warning"])
            self.assertTrue(report["anchorsUntouched"])
            self.assertIn("1,959,530", report["originalQuote"])
        finally:
            context.close()

    def test_bathroom_navigation_is_distinct_and_does_not_save(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            page.locator('.overview-svg .plan-zone[data-select-room="bath-main"]').click()
            nav = page.locator("nav.plan-room-navigation")
            self.assertTrue(nav.is_visible())
            back = nav.locator('button[data-action="all-rooms"]')
            switcher = nav.locator("select[data-plan-room-select]")
            self.assertEqual(back.inner_text(), "← 返回全屋格局")
            self.assertEqual(back.get_attribute("aria-label"), "返回全屋格局總覽")
            self.assertEqual(switcher.get_attribute("aria-label"), "選擇要查看的房間")
            self.assertEqual(switcher.input_value(), "bath-main")
            self.assertIn("衛浴1", nav.locator(".room-switcher strong").inner_text())
            button_background = back.evaluate("el => getComputedStyle(el).backgroundColor")
            select_background = switcher.evaluate(
                "el => getComputedStyle(el).backgroundColor")
            self.assertNotEqual(button_background, select_background)
            self.assertTrue(page.locator(
                'svg[data-room-canvas="bath-main"]').is_visible())
            switcher.select_option("bath-guest")
            page.wait_for_selector('svg[data-room-canvas="bath-guest"]')
            self.assertIn("衛浴2", nav.locator(".room-switcher strong").inner_text())
            back.click()
            self.assertTrue(page.locator(".overview-svg").is_visible())
            self.assertEqual(page.locator("nav.plan-room-navigation").count(), 0)
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))

            page.locator('button[data-view="room"]').click()
            toilet = page.locator('details.equipment[data-id="bath-main-toilet"]')
            self.assertIn("商品 NT$14,994", toilet.locator("summary").inner_text())
            self.assertIn("安裝 NT$0（原報已含）",
                          toilet.locator("summary").inner_text())
            toilet.locator("summary").click()
            install = toilet.locator(
                'input[data-field="installationUnitPrice"]')
            self.assertEqual(install.input_value(), "0")
            self.assertIsNotNone(install.get_attribute("readonly"))
            self.assertIn("NT$16,000", toilet.inner_text())
            vanity = page.locator('details.equipment[data-id="bath-main-vanity"]')
            self.assertIn("商品本體待補 · 安裝 NT$0",
                          vanity.locator("summary").inner_text())
            for fixture_id, price in (("bath-main-urinal-u0211-a624", "3,960"),):
                summary = page.locator(
                    f'details.equipment[data-id="{fixture_id}"] summary'
                ).inner_text()
                self.assertIn(f"商品 NT${price}", summary)
                self.assertIn("安裝 NT$0（原報已含）", summary)
            self.assertIn("商品本體待補 · 安裝 NT$0（原報已含）",
                          page.locator('details.equipment[data-id="bath-guest-tub"] '
                                       'summary').inner_text())
            special = page.locator('details.equipment[data-id="bath-main-heater"]')
            self.assertEqual(special.locator(
                'input[data-field="installationUnitPrice"]').count(), 0)
        finally:
            context.close()

    def test_bathroom_product_link_and_validation_boundaries(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            report = page.evaluate("""async () => {
                const root = new URL('../extensions/renovation-equipment/assets/',
                    location.href);
                const [{BATHROOM_INSTALLATION_QUOTE,isBathroomInstallationIncluded},
                    {applyProductToItem,linkedProductMismatch},
                    {calculateBudget,calculatePlanTotal,ORIGINAL_QUOTE_TWD}] =
                    await Promise.all(['bathroom-installation.js','product-database.js',
                        'budget.js'].map(name => import(new URL(name,root))));
                const source = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const included = source.items.filter(isBathroomInstallationIncluded);
                const previousTotal = calculatePlanTotal(calculateBudget(source.items,
                    {wholePlan:true})).TWD;
                const toilet = source.items.find(item => item.id === 'bath-main-toilet');
                const product = source.products.find(entry => entry.id === toilet.productId);
                const repriced = {...product,unitPrice:product.unitPrice+100};
                const updated = structuredClone(source);
                updated.products = updated.products.map(entry =>
                    entry.id === product.id ? repriced : entry);
                updated.items = updated.items.map(item => item.productId === product.id ?
                    applyProductToItem(repriced,item) : item);
                const mismatch = updated.items.some(item => item.productId ===
                    product.id && linkedProductMismatch(repriced,item));
                const changed = await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                    ...updated,expectedRevision:source.revision,undo:null,
                    controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1,
                });
                const budgetAfter = calculatePlanTotal(calculateBudget(changed.items,
                    {wholePlan:true})).TWD;
                const invalid = structuredClone(changed);
                invalid.items.find(item => item.id === 'bath-main-toilet')
                    .installationUnitPrice = 2500;
                let extraRejected = false;
                try {
                    await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                        ...invalid,expectedRevision:changed.revision,undo:null,
                        controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1});
                } catch (error) {
                    extraRejected = /衛浴器具安裝費須為 0/.test(error.message);
                }
                invalid.items.find(item => item.id === 'bath-main-toilet')
                    .installationUnitPrice = 0;
                invalid.items.find(item => item.id === 'bath-main-heated-towel-rail')
                    .installationUnitPrice = 0;
                let specialRejected = false;
                try {
                    await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                        ...invalid,expectedRevision:changed.revision,undo:null,
                        controlRelationsVersion:1,doorAllocationVersion:1,robotFeatureVersion:1,calendarFeatureVersion:1,calendarAttendeesVersion:1,managementFeeVersion:1});
                } catch (error) {
                    specialRejected = /只有燈具或原報已含/.test(error.message);
                }
                return {
                    quote:BATHROOM_INSTALLATION_QUOTE,
                    originalQuote:ORIGINAL_QUOTE_TWD,
                    covered:included.map(item => ({id:item.id,price:item.unitPrice,
                        install:item.installationUnitPrice})),
                    linkedToilets:updated.items.filter(item => item.productId ===
                        product.id).length,
                    mismatch:!!mismatch,
                    before:previousTotal,after:budgetAfter,
                    repricedToilet:changed.items.find(item => item.id ===
                        'bath-main-toilet'),
                    extraRejected,specialRejected,
                    stillSaved:JSON.parse(localStorage.getItem(
                        'renovation-equipment-offline-management-fee-v1:' + location.pathname))
                        .items.find(item => item.id ===
                            'bath-main-heated-towel-rail').installationUnitPrice,
                };
            }""")
            self.assertEqual(report["quote"], {
                "suites": 2, "unitPriceTWD": 8000, "totalTWD": 16000,
            })
            self.assertEqual(report["originalQuote"], 1_959_530)
            self.assertEqual({item["id"] for item in report["covered"]},
                             INCLUDED_BATHROOM_IDS)
            self.assertTrue(all(item["install"] == 0 for item in report["covered"]))
            self.assertFalse(report["mismatch"])
            self.assertGreaterEqual(report["linkedToilets"], 1)
            self.assertEqual(report["before"], 2_322_060.2)
            self.assertEqual(report["after"] - report["before"],
                             100 * report["linkedToilets"])
            self.assertEqual(report["repricedToilet"]["installationUnitPrice"], 0)
            self.assertTrue(report["extraRejected"])
            self.assertTrue(report["specialRejected"])
            self.assertIsNone(report["stillSaved"])
        finally:
            context.close()

    def test_bathroom_csv_and_json_export_keep_goods_and_numeric_zero(self):
        context = self.browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            requests = []
            page.on("request", lambda request: requests.append(request.url)
                    if request.url.startswith(("http:", "https:")) else None)
            page.goto(PORTABLE.as_uri())
            page.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('JSON')",
                timeout=15000,
            )
            page.locator("#load-file-input").set_input_files(str(SAMPLE))
            page.wait_for_function(
                "document.querySelector('#overall-total').textContent.includes('2,333,060')",
                timeout=15000,
            )
            with page.expect_download() as downloaded:
                page.locator("#export-items").click()
            rows = list(csv.DictReader(StringIO(
                Path(downloaded.value.path()).read_text(encoding="utf-8-sig")
            )))
            self.assertIn("安裝費來源", rows[0])
            for column in ("單條燈軌長度（cm）", "冷氣規劃狀態", "冷氣施工費（未核）"):
                self.assertIn(column, rows[0])
            ac_rows = [row for row in rows if row["冷氣規劃狀態"] == "active"]
            self.assertEqual(len(ac_rows), 6)
            self.assertEqual(sum("GPR-23HI" in row["品牌／型號／規格"]
                                 for row in ac_rows), 4)
            self.assertEqual(sum("RB-S51HG1" in row["品牌／型號／規格"]
                                 for row in ac_rows), 2)
            self.assertEqual(next(row for row in rows if row["名稱"] ==
                                  "走廊軌道與軌道燈")["單條燈軌長度（cm）"], "300")
            dishwasher = next(row for row in rows if "SMV4HAX00X" in row["名稱"])
            self.assertEqual(dishwasher["商品單價"], "42500")
            self.assertNotEqual(dishwasher["安裝小計（新台幣）"], "0")
            self.assertIn("淨開口", dishwasher["備註"])
            dryer = next(row for row in rows if row["名稱"] == "烘衣機")
            self.assertEqual(dryer["商品單價"], "20599")
            self.assertIn("瓦斯", dryer["備註"])
            b06 = next(row for row in rows if row["來源標位 ID"] == "B06")
            self.assertIn("不代表現場插孔", b06["備註"])
            included = [row for row in rows
                        if row["安裝費來源"].startswith("原報價衛浴設備安裝")]
            self.assertEqual(len(included), 10)
            self.assertTrue(all(row["安裝小計（新台幣）"] == "0" and
                                "2 套 × NT$8000 已含" in row["安裝費來源"]
                                for row in included))
            self.assertEqual(sorted(row["商品單價"] for row in included
                                    if row["商品單價"] != "待補"),
                             ["14994", "14994", "3960"])
            self.assertTrue(any(row["商品單價"] == "待補" for row in included))
            guest_tub = next(row for row in included if "坐式浴缸" in row["名稱"])
            self.assertEqual(guest_tub["商品單價"], "待補")
            self.assertIn("80cm", guest_tub["備註"])
            self.assertNotIn("26936", guest_tub["商品小計"])
            self.assertIn("trplus.com.tw/p/016095417",
                          "\n".join(row["價格來源"] for row in rows))
            self.assertIn("三叉管是否內含未獲確認",
                          "\n".join(row["備註"] for row in rows))
            for row in rows:
                if "電熱毛巾架" in row["名稱"] or "防滑扶手" in row["名稱"]:
                    self.assertEqual(row["安裝費來源"], "")
                    self.assertEqual(row["安裝小計（新台幣）"], "")
            with page.expect_download() as downloaded:
                page.locator("#save-file").click()
            state = json.loads(
                Path(downloaded.value.path()).read_text(encoding="utf-8")
            )["state"]
            self.assertEqual((len(state["items"]), len(state["products"]),
                              state["undo"]), (182, 28, None))
            lamp = next(product for product in state["products"] if product["id"] ==
                        "catalog-ceiling-trplus-026036388")
            self.assertEqual((lamp["unitPrice"], lamp["lightWatts"],
                              lamp["lightLumens"], lamp["beamAngleDeg"]),
                             (1215, 50, None, None))
            self.assertEqual(sum(item["productId"] == lamp["id"] for item in
                                 state["items"]), 8)
            self.assertEqual({item["id"] for item in state["items"]
                              if item["installationUnitPrice"] == 0},
                             INCLUDED_BATHROOM_IDS)
            self.assertEqual(page.locator("#quote-baseline").inner_text(),
                             "NT$1,959,530")
            self.assertEqual(requests, [])
        finally:
            context.close()

    def test_old_v5_import_normalizes_fixture_notes_and_undo(self):
        context = self.browser.new_context()
        try:
            old = legacy_bathroom_save()
            old["undo"] = {"rooms": deepcopy(old["rooms"]),
                           "items": deepcopy(old["items"]),
                           "products": deepcopy(old["products"])}
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(PORTABLE.as_uri())
            page.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('JSON')",
                timeout=15000,
            )
            page.locator("#load-file-input").set_input_files({
                "name": "older-v5.json", "mimeType": "application/json",
                "buffer": json.dumps(old, ensure_ascii=False).encode("utf-8"),
            })
            page.wait_for_function(
                "document.querySelector('#overall-total').textContent.includes('2,318,560')",
                timeout=15000,
            )
            normalized = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            original_items = {item["id"]: item for item in old["items"]}
            expected_items = deepcopy(old["items"])
            for item in expected_items:
                if item["id"] in INCLUDED_BATHROOM_IDS:
                    item["installationUnitPrice"] = 0
                if item["id"] in {"bath-main-toilet", "bath-guest-toilet"}:
                    item["note"] = item["note"].replace(
                        "PChome商品標示不含安裝；價格可能變動。",
                        "PChome商品售價不含安裝；原報兩套衛浴安裝已含，"
                        "本件另加 NT$0；價格可能變動。",
                    )
                elif item["id"] == "bath-main-urinal-u0211-a624":
                    item["note"] = item["note"].replace(
                        "固定方式與安裝費待確認。",
                        "固定方式與超出原安裝額度的補差待確認；"
                        "本件安裝另加 NT$0（原報已含）。",
                    )
                elif item["id"] == "bath-guest-tub":
                    item["note"] = item["note"].replace(
                        "排水與安裝費均待確認。",
                        "排水改管與超出原安裝額度的補差待核；"
                        "本件安裝另加 NT$0（原報已含）。",
                    )
            self.assertEqual(normalized["items"], expected_items)
            self.assertEqual(normalized["undo"]["items"], expected_items)
            expected_products = deepcopy(old["products"])
            next(product for product in expected_products if product["id"] ==
                 "sample-product-08")["trackLengthCm"] = 150
            self.assertEqual(normalized["products"], expected_products)
            self.assertEqual(len(normalized["items"]), 179)
            self.assertEqual({item["id"] for item in normalized["items"]
                              if item["installationUnitPrice"] == 0},
                             INCLUDED_BATHROOM_IDS)
            self.assertTrue(all(original_items[item["id"]]["unitPrice"] ==
                                item["unitPrice"] for item in normalized["items"]))
            self.assertEqual(page.locator("#quote-baseline").inner_text(),
                             "NT$1,959,530")
        finally:
            context.close()

    def test_old_saved_pages_edits_win_without_refetching_new_sample(self):
        context = self.browser.new_context()
        try:
            old = legacy_bathroom_save()
            items = {item["id"]: item for item in old["items"]}
            previous_tub = next(product for product in old["products"]
                                if product["id"] == "sample-product-03")
            items["bath-guest-tub"].update({
                "name": "浴缸", "brandModel": previous_tub["brandModel"],
                "productId": previous_tub["id"],
                "unitPrice": previous_tub["unitPrice"],
                "priceSource": "物件資料庫（規劃價連動）；" +
                               previous_tub["priceSource"],
                "widthCm": 110, "depthCm": 70, "orientation": 270,
                "note": "舊公開示例浴缸；尺寸與排水需現勘。",
            })
            for room in ("bath-main", "bath-guest"):
                items[f"{room}-vanity"]["depthCm"] = 35
                items[f"{room}-vanity"]["note"] = "舊公開示例浴櫃暫位；管線待核。"
            items["bath-guest-vanity"]["placement"]["x"] = .474
            for key, y in (("tower", 32), ("return", 99.5)):
                item = items[f"kitchen-plan-{key}"]
                item["placement"] = {"x": 238 / 289, "y": y / 165}
                item["name"] = ("右端電器高櫃（暫估）" if key == "tower"
                                else "L 型短邊訂製櫃（暫估）")
                item["note"] = "舊公開示例的訂製櫃暫位，未報價。"
            old["revision"] = 7
            next(room for room in old["rooms"] if room["id"] ==
                 "kitchen")["ceilingHeightCm"] = 275
            saved = json.dumps(old, ensure_ascii=False)
            context.add_init_script("""if (location.pathname.includes('/portable/')) {
                localStorage.setItem(
                    'renovation-equipment-offline-v1:' + location.pathname,
                    %s);
            }""" % json.dumps(saved))
            page = context.new_page()
            requests = []
            page.on("request", lambda request: requests.append(request.url)
                    if "/files/" in request.url else None)
            self.open_demo(page)
            self.assertEqual(requests, [])
            state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(state["revision"], 7)
            self.assertEqual((len(state["items"]), len(state["products"])),
                             (179, 28))
            self.assertFalse(any(item["id"] == "balcony-outboard-sink"
                                 for item in state["items"]))
            self.assertEqual(next(item for item in state["items"]
                                  if item["id"] == "balcony-dryer")["roomId"],
                             "ac-platform")
            self.assertEqual(page.locator(
                '.overview-svg [data-demolition-status="proposed"]').count(), 0)
            self.assertEqual(next(room for room in state["rooms"] if room["id"] ==
                                  "kitchen")["ceilingHeightCm"], 275)
            self.assertEqual({item["id"] for item in state["items"]
                              if item["installationUnitPrice"] == 0},
                             INCLUDED_BATHROOM_IDS)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,345,496.2")
            self.assertEqual(next(item for item in state["items"]
                                  if item["id"] == "bath-guest-tub")["unitPrice"],
                             26936)
            self.assertEqual(next(item for item in state["items"]
                                  if item["id"] == "kitchen-plan-tower")["placement"],
                             {"x": 238 / 289, "y": 32 / 165})
            page.locator('.overview-svg .plan-zone[data-select-room="ac-platform"]').click()
            self.assertIn("5.9cm", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
            stored = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertNotIn("installationUnitPrice", next(item for item in
                             stored["items"] if item["id"] == "bath-main-toilet"))
            self.assertEqual(stored["revision"], 7)
            copied = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            self.assertEqual(copied["revision"], 7)
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-controls-v1:' + location.pathname)"
            ))
            self.assertEqual(copied["items"], state["items"])
            self.assertEqual(copied["rooms"], state["rooms"])
        finally:
            context.close()

    def test_public_door_allocation_keeps_three_bath_doors_and_quoted_rails(self):
        context = self.browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            self.open_demo(page)
            original = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((len(original["items"]), original["revision"],
                              original["undo"]), (182, 0, None))
            self.assertEqual(page.locator("#quote-baseline").inner_text(),
                             "NT$1,959,530")
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            for door_id, kind in (
                ("main-bath-master", "swing"),
                ("main-bath-hall", "swing"),
                ("main-shower", "swing"),
                ("bedroom-2", "slide"),
                ("bedroom-3-studio", "slide"),
            ):
                self.assertIn(kind, page.locator(
                    f'.overview-svg [data-plan-door-id="{door_id}"]'
                ).get_attribute("class").split())
            self.assertEqual(page.locator(
                '.overview-svg [data-plan-door-id="balcony"] .door-pending-label'
            ).text_content(), "未計算")
            self.assertIn("未計算", page.locator(
                '.overview-svg [data-plan-door-id="balcony"]'
            ).get_attribute("aria-label"))

            page.locator(
                '.overview-svg .plan-zone[data-select-room="bath-main"]'
            ).click()
            bath = page.locator('.door-choices[data-room-id="bath-main"]')
            bath.locator("summary").click()
            self.assertEqual(bath.locator(".door-choice").count(), 3)
            self.assertEqual(bath.locator(".track-controls").count(), 0)
            for door_id, material, price in (
                ("door-main-bath-master", "solid-wood", "14000"),
                ("door-main-bath-hall", "bathroom", "8500"),
                ("door-main-shower", "shower-glass", "0"),
            ):
                self.assertEqual(bath.locator(
                    f'[data-item-id="{door_id}"][data-field="doorMaterial"]'
                ).input_value(), material)
                self.assertEqual(bath.locator(
                    f'[data-item-id="{door_id}"][data-field="unitPrice"]'
                ).input_value(), price)
            self.assertEqual(bath.locator(
                '[data-item-id="door-main-bath-hall"][data-field="doorOpeningKind"]'
            ).input_value(), "swing")
            self.assertIn("已各在設備明細列入原報價", bath.inner_text())

            page.locator('[data-plan-room-select]').select_option("bedroom-2")
            bedroom = page.locator('.door-choices[data-room-id="bedroom-2"]')
            bedroom.locator("summary").click()
            self.assertEqual(bedroom.locator(
                '[data-item-id="track-main-bath-hall"][data-field="quantity"]'
            ).input_value(), "0.8")
            self.assertIn("原主浴額度暫移", bedroom.inner_text())
            self.assertIn("可能重複", bedroom.inner_text())
            page.locator('[data-plan-room-select]').select_option("studio")
            studio = page.locator('.door-choices[data-room-id="studio"]')
            studio.locator("summary").click()
            self.assertEqual(studio.locator(
                '[data-item-id="track-bedroom-3-studio"][data-field="quantity"]'
            ).input_value(), "0.8")
            self.assertIn("臥室3－工作室木纖滑門", studio.inner_text())
            self.assertIn("未計算，非免費", studio.inner_text())
            page.set_viewport_size({"width": 390, "height": 844})
            self.assertLessEqual(studio.bounding_box()["width"], 390)

            with page.expect_download() as download:
                page.locator("#export-items").click()
            rows = list(csv.DictReader(StringIO(
                Path(download.value.path()).read_text(encoding="utf-8-sig")
            )))
            doors = {row["門位ID"]: row for row in rows if row["門位ID"]}
            tracks = {row["軌道對應門位"]: row for row in rows
                      if row["軌道對應門位"]}
            self.assertEqual(doors["balcony"]["商品單價"], "未計算")
            self.assertEqual(doors["balcony"]["原報價已含"], "否")
            self.assertIn("已轉至臥室3", doors["balcony"]["歷史報價與歸屬說明"])
            self.assertEqual(doors["bedroom-3-studio"]["商品單價"], "19000")
            self.assertEqual(doors["bedroom-3-studio"]["原報價已含"], "是")
            self.assertEqual(set(tracks), {"bedroom-2", "bedroom-3-studio"})
            for row in tracks.values():
                self.assertEqual(row["數量"], "0.8")
                self.assertEqual(row["原報價基準（新台幣）"], "1440")
                self.assertIn("主浴.工作室", row["歷史報價與歸屬說明"])

            with page.expect_download() as download:
                page.locator("#save-file").click()
            exported = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(exported["formatVersion"], 11)
            self.assertEqual(exported["state"]["items"], original["items"])
            self.assertIsNone(exported["state"]["undo"])
            page.locator('[data-plan-room-select]').select_option("bath-main")
            bath = page.locator('.door-choices[data-room-id="bath-main"]')
            if bath.get_attribute("open") is None:
                bath.locator("summary").click()
            bath.locator(
                '[data-item-id="door-main-bath-master"][data-field="doorMaterial"]'
            ).select_option("wood-fiber")
            page.locator("#save-now").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 1 && state.items.find(item =>
                    item.id === 'door-main-bath-master').unitPrice === 10500;
            }""", timeout=15000)
            changed = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(changed["undo"]["items"], original["items"])
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,329,560.2")
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.undo === null && state.items.find(item =>
                    item.id === 'door-main-bath-master').unitPrice === 14000;
            }""", timeout=15000)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_robot_is_visible_but_unpriced_and_unlinked_on_pages(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            page = context.new_page()
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            self.open_demo(page)
            before = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            robot = next(item for item in before["items"] if item["id"] ==
                         "living-auto-water-robot")
            self.assertEqual((len(before["items"]), before["revision"],
                              before["undo"]), (182, 0, None))
            self.assertEqual(robot["roomId"], "living-dining")
            self.assertTrue(all(robot[key] is None for key in
                                ("brandModel", "productId", "unitPrice",
                                 "widthCm", "depthCm", "heightCm",
                                 "outletCircuit", "circuitOutletId")))
            self.assertNotIn("outletPlanPointId", robot)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,333,060.2")
            marker = page.locator(
                '.overview-svg [data-robot-id="living-auto-water-robot"]'
            )
            self.assertEqual(marker.count(), 1)
            self.assertEqual(marker.get_attribute("role"), "img")
            self.assertIn("符號非占地", marker.get_attribute("aria-label"))
            self.assertEqual(marker.locator(".robot-symbol").count(), 1)
            self.assertIn("自動上下水（暫位）",
                          marker.locator(".robot-plan-label").text_content())
            self.assertEqual(page.locator("[data-robot-legend]").count(), 1)
            self.assertIn("非施工", page.locator(
                "[data-robot-warning]").inner_text())
            budget = page.locator(".budget").inner_text()

            page.locator(
                '.overview-svg .plan-zone[data-select-room="living-dining"]'
            ).click()
            room_marker = page.locator(
                'svg[data-room-canvas="living-dining"] '
                '[data-marker-id="living-auto-water-robot"]'
            )
            self.assertEqual(room_marker.locator(".robot-symbol").count(), 1)
            self.assertIn("門扇、逃生",
                          room_marker.locator("title").first.text_content())
            self.assertEqual(page.locator("[data-robot-legend]").count(), 1)
            page.get_by_role("tab", name="已放置物件清單", exact=True).click()
            for field in ("brandModel", "unitPrice", "widthCm",
                          "depthCm", "heightCm"):
                with self.subTest(field=field):
                    self.assertEqual(page.locator(
                        f'[data-item-id="living-auto-water-robot"]'
                        f'[data-field="{field}"]').input_value(), "")
            page.get_by_role("tab", name="插座配置圖", exact=True).click()
            self.assertEqual(page.locator(
                '[data-sheet-context="living-auto-water-robot"]').count(), 1)
            self.assertIn("尺寸未定，符號非占地", page.locator(
                '[data-sheet-context="living-auto-water-robot"]')
                .get_attribute("aria-label"))
            self.assertEqual(page.locator("[data-sheet-point]").count(), 67)
            self.assert_balcony_sheet_context(page, True)
            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            self.assert_balcony_sheet_context(page, True)
            self.assertEqual(page.locator("[data-sheet-light]").count(), 16)
            self.assertEqual(page.locator("[data-light-head]").count(), 19)
            self.assertEqual(page.locator("[data-sheet-switch]").count(), 14)
            self.assertEqual(page.locator("[data-control-light-id]").count(), 0)
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"), before)
            self.assertEqual(page.locator(".budget").inner_text(), budget)
            page.set_viewport_size({"width": 390, "height": 844})
            self.assertLessEqual(page.locator(
                "[data-robot-legend]").bounding_box()["width"], 390)
            self.assertEqual(errors, [])
            self.assertTrue(all(method == "GET" and url.startswith(self.base)
                                for method, url in requests), requests)
            self.assertEqual(len([url for _, url in requests
                                  if "/files/" in url]), 1)
        finally:
            context.close()

    def test_robot_offline_edge_edit_and_undo_keep_unknown_price(self):
        if not EDGE:
            self.skipTest("Microsoft Edge is not installed")
        browser = self.playwright.chromium.launch(
            executable_path=EDGE, headless=True
        )
        try:
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                accept_downloads=True,
            )
            try:
                page = context.new_page()
                errors, remote = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: remote.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(PORTABLE.as_uri())
                page.wait_for_function(
                    "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
                    timeout=15000,
                )
                page.locator("#load-file-input").set_input_files(str(SAMPLE))
                page.wait_for_function("""async () =>
                    (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                        .items.length === 182
                """, timeout=15000)
                original = page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                )
                self.assertEqual(page.locator(
                    '.overview-svg [data-robot-id="living-auto-water-robot"]'
                ).count(), 1)
                self.assertEqual(page.locator("#overall-total").inner_text(),
                                 "NT$2,333,060.2")
                page.locator(
                    '.overview-svg .plan-zone[data-select-room="living-dining"]'
                ).click()
                self.assertEqual(page.locator(
                    'svg[data-room-canvas="living-dining"] '
                    '[data-marker-id="living-auto-water-robot"] .robot-symbol'
                ).count(), 1)
                page.get_by_role("tab", name="已放置物件清單", exact=True).click()
                card = page.locator(
                    'details.equipment[data-id="living-auto-water-robot"]'
                )
                self.assertEqual(card.count(), 1)
                page.locator(
                    'details.device-group:has('
                    'details.equipment[data-id="living-auto-water-robot"]) '
                    '> summary.group-head'
                ).click()
                card.locator("summary.item-summary").click()
                model = card.locator(
                    '[data-item-id="living-auto-water-robot"]'
                    '[data-field="brandModel"]'
                )
                self.assertEqual(model.input_value(), "")
                model.fill("型號待核")
                page.locator("#save-now").click()
                page.wait_for_function("""async () => {
                    const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                    const item = state.items.find(entry =>
                        entry.id === 'living-auto-water-robot');
                    return state.undo !== null &&
                        item.brandModel === '型號待核';
                }""", timeout=15000)
                edited = page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                )
                self.assertIsNone(next(item for item in edited["items"] if item["id"] ==
                                       "living-auto-water-robot")["unitPrice"])
                self.assertEqual(edited["undo"]["items"], original["items"])
                self.assertEqual(page.locator("#overall-total").inner_text(),
                                 "NT$2,333,060.2")
                self.assertIsNotNone(page.evaluate(
                    "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                ))
                with page.expect_download() as download:
                    page.locator("#save-file").click()
                exported = json.loads(Path(
                    download.value.path()).read_text(encoding="utf-8"))
                self.assertEqual(exported["formatVersion"], 11)
                self.assertEqual(exported["state"]["items"], edited["items"])
                page.locator("#undo-last").click()
                page.wait_for_function("""async () => {
                    const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                    return state.undo === null && state.items.find(entry =>
                        entry.id === 'living-auto-water-robot').brandModel === null;
                }""", timeout=15000)
                self.assertEqual(page.locator("#overall-total").inner_text(),
                                 "NT$2,333,060.2")
                self.assertEqual(remote, [])
                self.assertEqual(errors, [])
            finally:
                context.close()
        finally:
            browser.close()

    def test_saved_door_cache_outranks_older_keys_without_inventing_robot(self):
        door_save = previous_public_robot_save()
        door_save["revision"] = 7
        next(room for room in door_save["rooms"] if room["id"] ==
             "kitchen")["ceilingHeightCm"] = 275
        controls_save = previous_public_door_save()
        controls_save["revision"] = 8
        next(item for item in controls_save["items"] if item["id"] ==
             "quoted-switch-01")["controlledLightIds"] = [
                 "living-ceiling-light-01"
             ]
        legacy_save = previous_public_balcony_save()
        legacy_save["revision"] = 9
        context = self.browser.new_context(accept_downloads=True)
        try:
            context.add_init_script("""if (location.pathname.includes('/portable/') &&
                !localStorage.getItem('robot-cache-test-seeded')) {
                localStorage.setItem(
                    'renovation-equipment-offline-doors-v1:' + location.pathname,
                    %s);
                localStorage.setItem(
                    'renovation-equipment-offline-controls-v1:' + location.pathname,
                    %s);
                localStorage.setItem(
                    'renovation-equipment-offline-v1:' + location.pathname,
                    %s);
                localStorage.setItem('robot-cache-test-seeded', '1');
            }""" % tuple(json.dumps(json.dumps(state, ensure_ascii=False))
                          for state in (door_save, controls_save, legacy_save)))
            page = context.new_page()
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(
                (request.method, request.url)) if request.url.startswith(
                    ("http:", "https:")) else None)
            self.open_demo(page)
            loaded = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual((loaded["revision"], len(loaded["items"])), (7, 181))
            self.assertFalse(any(item["id"] == "living-auto-water-robot"
                                 for item in loaded["items"]))
            self.assertFalse(any("controlledLightIds" in item
                                 for item in loaded["items"]))
            self.assertEqual(page.locator(
                '.overview-svg [data-robot-id="living-auto-water-robot"]'
            ).count(), 0)
            self.assertEqual(page.locator("[data-robot-legend]").count(), 0)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,322,060.2")
            self.assertEqual(next(room for room in loaded["rooms"] if room["id"] ==
                                  "kitchen")["ceilingHeightCm"], 275)
            copied = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            self.assertEqual(copied["items"], loaded["items"])
            self.assertIsNotNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-doors-v1:' + location.pathname)"
            ))
            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            self.assert_balcony_sheet_context(page, True)
            self.assertEqual(page.locator("[data-control-light-id]").count(), 0)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            exported = json.loads(Path(
                download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual(exported["formatVersion"], 7)
            page.evaluate("""() => {
                const key = 'renovation-equipment-offline-doors-v1:' +
                    location.pathname;
                const prior = JSON.parse(localStorage.getItem(key));
                prior.revision = 77;
                localStorage.setItem(key, JSON.stringify(prior));
            }""")
            page.reload()
            page.wait_for_function(
                "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
                timeout=15000,
            )
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )["revision"], 7)
            self.assertEqual([url for _, url in requests if "/files/" in url], [])
            self.assertTrue(all(method == "GET" and url.startswith(self.base)
                                for method, url in requests), requests)
            self.assertEqual(errors, [])
        finally:
            context.close()

    def test_offline_edge_old_control_save_keeps_original_doors(self):
        if not EDGE:
            self.skipTest("Microsoft Edge is not installed")
        browser = self.playwright.chromium.launch(
            executable_path=EDGE, headless=True
        )
        try:
            current_context = browser.new_context(
                viewport={"width": 390, "height": 844}
            )
            try:
                current_page = current_context.new_page()
                current_page.on("dialog", lambda dialog: dialog.accept())
                remote = []
                current_page.on("request", lambda request: remote.append(request.url)
                                if request.url.startswith(("http:", "https:")) else None)
                current_page.goto(PORTABLE.as_uri())
                current_page.wait_for_function(
                    "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
                    timeout=15000,
                )
                current_page.locator("#load-file-input").set_input_files(str(SAMPLE))
                current_page.wait_for_function(
                    "document.querySelector('#overall-total').textContent.includes('2,333,060')",
                    timeout=15000,
                )
                self.assertEqual(current_page.locator(
                    '.overview-svg [data-plan-door-id="balcony"] .door-pending-label'
                ).text_content(), "未計算")
                current_page.locator(
                    '.overview-svg .plan-zone[data-select-room="bath-main"]'
                ).click()
                self.assertEqual(current_page.locator(
                    '.door-choices[data-room-id="bath-main"] .door-choice'
                ).count(), 3)
                self.assertLessEqual(current_page.locator(
                    '.door-choices[data-room-id="bath-main"]'
                ).bounding_box()["width"], 390)
                self.assertEqual(remote, [])
            finally:
                current_context.close()

            previous = previous_public_door_save()
            previous["revision"] = 7
            next(item for item in previous["items"] if item["id"] ==
                 "quoted-switch-01")["controlledLightIds"] = [
                     "living-ceiling-light-01"
                 ]
            older = previous_public_balcony_save()
            older["revision"] = 9
            context = browser.new_context(accept_downloads=True)
            try:
                context.add_init_script("""if (location.pathname.includes('/portable/')) {
                    localStorage.setItem(
                        'renovation-equipment-offline-controls-v1:' + location.pathname,
                        %s);
                    localStorage.setItem(
                        'renovation-equipment-offline-v1:' + location.pathname,
                        %s);
                }""" % (
                    json.dumps(json.dumps(previous, ensure_ascii=False)),
                    json.dumps(json.dumps(older, ensure_ascii=False)),
                ))
                page = context.new_page()
                requests = []
                errors = []
                page.on("request", lambda request: requests.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(PORTABLE.as_uri())
                page.wait_for_function(
                    "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
                    timeout=15000,
                )
                page.wait_for_function("""async () => {
                    const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                    return state?.revision === 7 && state.items.length === 180;
                }""", timeout=15000)
                saved = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
                by_id = {item["id"]: item for item in saved["items"]}
                self.assertEqual(by_id["door-balcony"]["unitPrice"], 19000)
                self.assertEqual(by_id["door-main-bath-master"]["unitPrice"], 10500)
                self.assertEqual(by_id["door-main-bath-hall"]["doorOpeningKind"],
                                 "slide")
                self.assertNotIn("door-bedroom-3-studio", by_id)
                self.assertEqual(by_id["track-main-bath-hall"]["roomId"],
                                 "bath-main")
                self.assertEqual(by_id["quoted-switch-01"]["controlledLightIds"],
                                 ["living-ceiling-light-01"])
                self.assertEqual(page.locator("#overall-total").inner_text(),
                                 "NT$2,318,560.2")
                self.assertEqual(page.locator(
                    '.overview-svg [data-plan-door-id="balcony"] .door-pending-label'
                ).count(), 0)
                self.assertIn("slide", page.locator(
                    '.overview-svg [data-plan-door-id="main-bath-hall"]'
                ).get_attribute("class").split())
                copied = json.loads(page.evaluate(
                    "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
                ))
                self.assertEqual(copied["items"], saved["items"])
                page.get_by_role("tab", name="燈具配置圖", exact=True).click()
                self.assertEqual(page.locator("[data-control-light-id]").count(), 1)
                self.assertEqual(page.evaluate(
                    "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
                ), saved)
                with page.expect_download() as download:
                    page.locator("#save-file").click()
                exported = json.loads(Path(
                    download.value.path()).read_text(encoding="utf-8"))
                self.assertEqual(exported["formatVersion"], 6)
                self.assertEqual(exported["state"]["items"], saved["items"])
                self.assertEqual(requests, [])
                self.assertEqual(errors, [])
            finally:
                context.close()
        finally:
            browser.close()

    def test_saved_unselected_laundry_stays_generic_not_a_fake_gas_selection(self):
        old = previous_public_balcony_save()
        for item in old["items"]:
            if item["id"] in {"balcony-washer", "balcony-dryer"}:
                item.update(productId=None, brandModel="", unitPrice=None,
                            widthCm=60, depthCm=60, priceSource="",
                            note="尚未選型，室外安裝條件待現勘。")
        old["revision"] = 9
        context = self.browser.new_context()
        try:
            context.add_init_script("""if (location.pathname.includes('/portable/')) {
                localStorage.setItem(
                    'renovation-equipment-offline-v1:' + location.pathname,
                    %s);
            }""" % json.dumps(json.dumps(old, ensure_ascii=False)))
            page = context.new_page()
            sample_requests = []
            page.on("request", lambda request: sample_requests.append(request.url)
                    if "/files/" in request.url else None)
            self.open_demo(page)
            self.assertEqual(sample_requests, [])
            page.locator('.overview-svg .plan-zone[data-select-room="ac-platform"]').click()
            self.assertEqual(page.locator(
                '[data-laundry-warning="balcony-dryer"]').count(), 0)
            self.assertIn("60×60cm占地暫估", page.locator(
                ".plan-detail").inner_text())
            self.assertNotIn("瓦斯安全", page.locator(
                ".plan-detail").inner_text())
            self.assertEqual(page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")["revision"], 9)
        finally:
            context.close()

    def test_offline_import_exports_csv_json_and_undo(self):
        context = self.browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(PORTABLE.as_uri())
            page.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('JSON')",
                timeout=15000,
            )
            page.locator("#load-file-input").set_input_files(str(SAMPLE))
            page.wait_for_function(
                "document.querySelector('#overall-total').textContent.includes('2,333,060')",
                timeout=15000,
            )
            with page.expect_download() as download:
                page.locator("#export-items").click()
            csv = Path(download.value.path()).read_text(encoding="utf-8-sig")
            self.assertIn("來源標位 ID", csv)
            self.assertIn("弱電 C 埠（非電源）", csv)
            self.assertNotIn("水槽下嵌工資", csv)
            for prefix, limit in (("R", 51), ("B", 9), ("C", 7)):
                for index in range(1, limit + 1):
                    self.assertEqual(csv.count(f',"{prefix}{index:02d}",'), 1)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            saved = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
            self.assertEqual((saved["formatVersion"], len(saved["state"]["items"]),
                              len(saved["state"]["products"]), saved["state"]["undo"]),
                             (11, 182, 28, None))
            page.locator('.overview-svg .plan-zone[data-select-room="kitchen"]').click()
            self.assertEqual(page.locator(
                '.room-svg [data-marker-id^="kitchen-plan-"]').count(), 12)
            self.assertEqual(page.locator(
                '[data-point-warning="B05"]').count(), 1)
            height = page.locator(
                'input[data-room-dimension="ceilingHeightCm"][data-room-id="kitchen"]'
            )
            height.fill("280")
            height.press("Tab")
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.rooms.find(room => room.id === 'kitchen').ceilingHeightCm ===
                    280 && state.undo !== null;
            }""", timeout=15000)
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.rooms.find(room => room.id === 'kitchen').ceilingHeightCm ===
                    null && state.items.length === 182;
            }""", timeout=15000)
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,333,060.2")
        finally:
            context.close()

    def test_kitchen_symbol_rotates_and_undo_restores_position(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            page.locator('.overview-svg .plan-zone[data-select-room="kitchen"]').click()
            marker = page.locator('.room-svg [data-marker-id="kitchen-plan-gas"]')
            marker.focus()
            marker.press("Enter")
            handle = page.locator(
                '.room-svg [data-action="rotate-marker"][data-item-id="kitchen-plan-gas"]'
            )
            handle.focus()
            handle.press("Enter")
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.items.find(item => item.id === 'kitchen-plan-gas')
                    .orientation === 90 && state.undo !== null;
            }""", timeout=15000)
            rotated = page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()"
            )
            gas = next(item for item in rotated["items"] if item["id"] ==
                       "kitchen-plan-gas")
            self.assertIsNone(gas["unitPrice"])
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,333,060.2")
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.items.find(item => item.id === 'kitchen-plan-gas')
                    .orientation === 0 && state.items.length === 182;
            }""", timeout=15000)

            select = page.locator("[data-plan-item-select]")
            select.select_option("kitchen-plan-return")
            page.locator('[data-action="remove-plan-item"]').click()
            page.locator('[data-action="confirm-remove-item"]').click()
            page.locator("#save-now").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return !state.items.some(item => item.id === 'kitchen-plan-return');
            }""", timeout=15000)
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.items.some(item => item.id === 'kitchen-plan-return');
            }""", timeout=15000)

            original = next(item for item in page.evaluate(
                "globalThis.__RENOVATION_OFFLINE_STORE__.read()")["items"]
                            if item["id"] == "kitchen-plan-ih")["placement"]
            select.select_option("kitchen-plan-ih")
            svg = page.locator('svg[data-room-canvas="kitchen"]')
            svg.scroll_into_view_if_needed()
            point = svg.evaluate("""svg => {
                const point = svg.createSVGPoint();
                point.x = 700; point.y = 1340;
                const screen = point.matrixTransform(svg.getScreenCTM());
                return {x: screen.x, y: screen.y};
            }""")
            page.mouse.click(point["x"], point["y"])
            page.locator("#save-now").click()
            page.wait_for_function("""original => {
                const saved = localStorage.getItem(
                    'renovation-equipment-offline-management-fee-v1:' + location.pathname);
                if (!saved) return false;
                const moved = JSON.parse(saved).items.find(item =>
                    item.id === 'kitchen-plan-ih').placement;
                return Math.abs(moved.x-original.x) + Math.abs(moved.y-original.y) > .01;
            }""", arg=original, timeout=15000)
            page.locator("#undo-last").click()
            page.wait_for_function("""async original => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                const restored = state.items.find(item =>
                    item.id === 'kitchen-plan-ih').placement;
                return Math.abs(restored.x-original.x) +
                    Math.abs(restored.y-original.y) < .000001;
            }""", arg=original, timeout=15000)
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,333,060.2")
        finally:
            context.close()

    def test_bad_sample_keeps_manual_import_available(self):
        for response in (
            {"status": 503, "body": "unavailable"},
            {"status": 200, "content_type": "application/json",
             "body": '{"version":5,"revision":0,"rooms":[]}'},
        ):
            with self.subTest(response=response["status"]):
                context = self.browser.new_context()
                try:
                    page = context.new_page()
                    page.route("**/files/*", lambda route: route.fulfill(**response))
                    page.on("dialog", lambda dialog: dialog.accept())
                    page.goto(self.base)
                    page.wait_for_function(
                        "document.querySelector('#save-status').dataset.kind === 'error'",
                        timeout=15000,
                    )
                    self.assertIn("公開示例自動載入失敗",
                                  page.locator("#save-status").inner_text())
                    self.assertTrue(page.locator("#load-file").is_enabled())
                    page.locator("#load-file-input").set_input_files(str(SAMPLE))
                    page.wait_for_function(
                        "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
                        timeout=15000,
                    )
                finally:
                    context.close()

    def test_corrupt_browser_storage_is_not_overwritten(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            page.add_init_script("""if (location.pathname.includes('/portable/')) {
                localStorage.setItem(
                    'renovation-equipment-offline-v1:' + location.pathname, '{broken');
            }""")
            requests = []
            page.on("request", lambda request: requests.append(request.url)
                    if "/files/" in request.url else None)
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(self.base)
            page.wait_for_function(
                "document.querySelector('#save-status').dataset.kind === 'error'",
                timeout=15000,
            )
            self.assertIn("暫存資料無法驗證", page.locator("#save-status").inner_text())
            self.assertEqual(requests, [])
            self.assertEqual(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ), "{broken")
            page.locator("#load-file-input").set_input_files(str(SAMPLE))
            page.wait_for_function(
                "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
                timeout=15000,
            )
        finally:
            context.close()

    def test_another_tabs_same_revision_state_wins(self):
        context = self.browser.new_context()
        try:
            page = context.new_page()
            self.open_demo(page)
            page.evaluate("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                state.rooms.find(room => room.id === 'bedroom-1').ceilingHeightCm = 240;
                localStorage.setItem(
                    'renovation-equipment-offline-management-fee-v1:' + location.pathname,
                    JSON.stringify(state));
            }""")
            page.locator('.overview-svg .plan-zone[data-select-room="bedroom-1"]').click()
            height = page.locator(
                'input[data-room-dimension="ceilingHeightCm"][data-room-id="bedroom-1"]'
            )
            height.fill("270")
            height.press("Tab")
            page.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('另一個離線分頁')",
                timeout=15000,
            )
            saved = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-management-fee-v1:' + location.pathname)"
            ))
            self.assertEqual(saved["rooms"][3]["ceilingHeightCm"], 240)
        finally:
            context.close()

    def test_direct_http_and_file_urls_remain_manual(self):
        context = self.browser.new_context()
        try:
            direct = context.new_page()
            requests = []
            direct.on("request", lambda request: requests.append(request.url)
                      if "/files/" in request.url else None)
            direct.goto(self.base + "portable/裝修設備規劃.html")
            direct.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('JSON')",
                timeout=15000,
            )
            self.assertEqual(direct.locator("#quote-baseline").inner_text(), "—")
            self.assertEqual(requests, [])

            offline = context.new_page()
            outbound = []
            offline.on("request", lambda request: outbound.append(request.url)
                       if request.url.startswith(("http:", "https:")) else None)
            offline.goto(PORTABLE.as_uri() + "?demo=pages")
            offline.wait_for_function(
                "document.querySelector('#save-status').textContent.includes('JSON')",
                timeout=15000,
            )
            self.assertEqual(offline.locator("#quote-baseline").inner_text(), "—")
            self.assertEqual(outbound, [])
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()
