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
            self.assertIn("不會修改公開儲存庫",
                          page.locator("#portable-note").inner_text())
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
            self.assertTrue(all(url.startswith(self.base) for url in requests))
            self.assertIsNone(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            page.locator('.overview-svg .plan-zone[data-select-room="bedroom-1"]').click()
            height = page.locator(
                'input[data-room-dimension="ceilingHeightCm"][data-room-id="bedroom-1"]'
            )
            height.fill("270")
            height.press("Tab")
            page.wait_for_function("""() => {
                const saved = localStorage.getItem(
                    'renovation-equipment-offline-v1:' + location.pathname);
                return saved && JSON.parse(saved).rooms.find(
                    room => room.id === 'bedroom-1').ceilingHeightCm === 270;
            }""", timeout=15000)
            page.reload()
            page.wait_for_function(
                "document.querySelector('#quote-baseline').textContent.includes('1,959,530')",
                timeout=15000,
            )
            state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
            self.assertEqual(state["rooms"][3]["ceilingHeightCm"], 270)
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
            self.assertEqual(errors, [])
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
                    'renovation-equipment-offline-v1:' + location.pathname,
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
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
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
