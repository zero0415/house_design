import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "files" / "設備規劃.json"
QUOTE = ROOT / "files" / "裝修工程報價-去識別化.md"
PORTABLE = ROOT / "portable" / "裝修設備規劃.html"
ADDRESS = re.compile(r"[\u4e00-\u9fff]{2,10}(?:路|街)\d+(?:之\d+)?號(?:\d+樓)?")
EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)09\d{8}(?!\d)|(?<!\d)0[2-8][- ]?\d{7,8}(?!\d)")


class PublicSnapshotTests(unittest.TestCase):
    def test_quote_baseline(self):
        text = QUOTE.read_text(encoding="utf-8")
        summary = text.split("## 金額總覽", 1)[1].split("**原報價明示不含**", 1)[0]
        amounts = []
        for line in summary.splitlines():
            match = re.fullmatch(r"\|\s*[^|]+\|\s*\*{0,2}([\d,]+)\*{0,2}\s*\|", line)
            if match:
                amounts.append(int(match.group(1).replace(",", "")))
        self.assertEqual(sum(amounts[:11]), 1_744_130)
        self.assertEqual(amounts[11:], [1_744_130, 122_089, 93_311, 1_959_530])
        self.assertIn("ORIGINAL_QUOTE_TWD = 1_959_530", (
            ROOT / "extensions" / "renovation-equipment" / "assets" / "budget.js"
        ).read_text(encoding="utf-8"))

    def test_sample_is_deidentified_without_losing_the_plan(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(set(state), {
            "version", "revision", "updatedAt", "rooms", "items", "products", "undo",
        })
        self.assertEqual((state["version"], state["revision"], state["undo"]), (5, 0, None))
        self.assertEqual(state["updatedAt"], "2026-01-01T00:00:00.000Z")
        self.assertEqual((len(state["rooms"]), len(state["items"]), len(state["products"])),
                         (13, 144, 13))
        rooms = {room["id"] for room in state["rooms"]}
        products = {product["id"] for product in state["products"]}
        self.assertEqual(len(products), 13)
        self.assertEqual(len({item["id"] for item in state["items"]}), 144)
        self.assertEqual({room["name"] for room in state["rooms"] if room["id"].startswith(
            "bedroom-")}, {"臥室1", "臥室2", "臥室3"})
        self.assertTrue(all(item["roomId"] in rooms and
                            (item["productId"] is None or item["productId"] in products)
                            for item in state["items"]))
        self.assertTrue(all(re.fullmatch(r"sample-product-\d{2}", key) for key in products))
        self.assertFalse(any(re.fullmatch(
            r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", item["id"], re.I
        ) for item in state["items"]))

    def test_offline_bundle_has_only_source_modules(self):
        html = PORTABLE.read_text(encoding="utf-8")
        match = re.search(
            r'<script id="portable-bundle" type="application/json">(.*?)</script>',
            html, re.S,
        )
        self.assertIsNotNone(match)
        bundle = json.loads(match.group(1))
        self.assertEqual(set(bundle), {"modules"})
        self.assertIn("assets/app.js", {entry["path"] for entry in bundle["modules"]})
        self.assertIn("assets/floorplan.js", {entry["path"] for entry in bundle["modules"]})
        self.assertIn("assets/survey.js", {entry["path"] for entry in bundle["modules"]})
        self.assertIn("state-browser.mjs", {entry["path"] for entry in bundle["modules"]})
        self.assertNotRegex(html, r"(?i)<\s*(?:img|image)\b|data:image/|base64,")
        self.assertNotRegex(html, r'(?i)<script[^>]+src=|<link[^>]+rel="stylesheet"')
        self.assertNotIn(SAMPLE.read_text(encoding="utf-8")[:100], html)
        self.assertLess(PORTABLE.stat().st_size, 2_000_000)

    def test_published_files_are_text_without_direct_contacts(self):
        prohibited = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"}
        for file in ROOT.rglob("*"):
            if not file.is_file() or any(part in {".git", "__pycache__", "node_modules",
                                                ".pytest_cache"} for part in
                                             file.relative_to(ROOT).parts):
                continue
            with self.subTest(file=str(file.relative_to(ROOT))):
                self.assertNotIn(file.suffix.lower(), prohibited)
                content = file.read_bytes()
                self.assertNotIn(bytes((37, 80, 68, 70, 45)), content)
                self.assertNotIn(b"\x89PNG\r\n\x1a\n", content)
                self.assertNotIn(b"\xff\xd8\xff", content)
                text = content.decode("utf-8")
                self.assertNotRegex(text, ADDRESS)
                self.assertNotRegex(text, EMAIL)
                self.assertNotRegex(text, PHONE)


if __name__ == "__main__":
    unittest.main()
