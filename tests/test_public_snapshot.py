import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "files" / "設備規劃.json"
QUOTE = ROOT / "files" / "裝修工程報價-去識別化.md"
PORTABLE = ROOT / "portable" / "裝修設備規劃.html"
PAGES_ENTRY = ROOT / "index.html"
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

    def test_public_docs_match_derived_sample(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        quote = QUOTE.read_text(encoding="utf-8")
        for value in ("51", "9", "7", "27,000", "51,500", "2,115,134"):
            with self.subTest(value=value):
                self.assertIn(value, readme)
                self.assertIn(value, quote)
        self.assertIn("179 個物件與 17 款商品", readme)
        self.assertIn("沒有發布原始工程／電源配置 PDF", readme)
        self.assertIn("廚房附件", readme)
        self.assertIn("不自動移入屋內", readme)
        self.assertIn("不自動移入屋內", quote)

    def test_sample_is_deidentified_without_losing_the_plan(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(set(state), {
            "version", "revision", "updatedAt", "rooms", "items", "products", "undo",
        })
        self.assertEqual((state["version"], state["revision"], state["undo"]), (5, 0, None))
        self.assertEqual(state["updatedAt"], "2026-01-01T00:00:00.000Z")
        self.assertEqual((len(state["rooms"]), len(state["items"]), len(state["products"])),
                         (13, 179, 17))
        rooms = {room["id"] for room in state["rooms"]}
        products = {product["id"] for product in state["products"]}
        self.assertEqual(len(products), 17)
        self.assertEqual(len({item["id"] for item in state["items"]}), 179)
        self.assertEqual({room["name"] for room in state["rooms"] if room["id"].startswith(
            "bedroom-")}, {"臥室1", "臥室2", "臥室3"})
        self.assertTrue(all(item["roomId"] in rooms and
                            (item["productId"] is None or item["productId"] in products)
                            for item in state["items"]))
        self.assertTrue({f"sample-product-{index:02d}" for index in range(1, 14)}
                        <= products)
        self.assertTrue({f"product-kitchen-plan-{key}" for key in
                         ("sink", "faucet", "hood", "hot-water")} <= products)
        self.assertEqual(next(item for item in state["items"] if item["id"] ==
                              "sample-balcony-outlet-01")["outletPlanPointId"], "R48")
        self.assertFalse(any(re.fullmatch(
            r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", item["id"], re.I
        ) for item in state["items"]))

    def test_derived_electrical_endpoints_and_safety_warnings(self):
        items = json.loads(SAMPLE.read_text(encoding="utf-8"))["items"]
        points = [item for item in items if item.get("outletPlanPointId")]
        self.assertEqual(len(points), 67)
        self.assertEqual(len({item["outletPlanPointId"] for item in points}), 67)
        for prefix, total in (("R", 51), ("B", 9), ("C", 7)):
            self.assertEqual(sum(item["outletPlanPointId"].startswith(prefix)
                                 for item in points), total)
        sockets = {item["id"]: item for item in items if item.get("outletCircuit")
                   in {"general", "additional-general"}}
        circuits = [item for item in items if item.get("equipmentType") ==
                    "dedicated-circuit"]
        weak = [item for item in items if item.get("equipmentType") == "weak-current"]
        self.assertEqual((len(sockets), len(circuits), len(weak)), (60, 9, 7))
        self.assertEqual({item["outletPlanPointId"] for item in weak},
                         {f"C{index:02d}" for index in range(1, 8)})
        self.assertTrue(all(item["outletCircuit"] is None and
                            item["quotedUnitPrice"] == 3000 and
                            item["quotedQuantity"] == 1 for item in weak))
        self.assertEqual(len({circuit["circuitOutletId"] for circuit in circuits}), 9)
        for circuit in circuits:
            endpoint = sockets[circuit["circuitOutletId"]]
            self.assertTrue(endpoint["outletPlanPointId"].startswith("B"))
            self.assertEqual(circuit["roomId"], endpoint["roomId"])
        self.assertEqual(10 * 1800 + 2 * 4500, 27_000)
        by_source = {item["outletPlanPointId"]: item for item in points}
        for source_id in ("R08", "R33", "R42"):
            self.assertIn("保留來源位置，不自動移入", by_source[source_id]["note"])
        self.assertEqual(by_source["B05"]["roomId"], "kitchen")
        self.assertIn("施工路徑", by_source["B05"]["note"])
        self.assertTrue(all(by_source[source_id]["roomId"] == "bedroom-3" and
                            "供應機組待電工指定" in by_source[source_id]["note"]
                            for source_id in ("B02", "B03", "B04")))

    def test_kitchen_prices_and_unquoted_items(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        kitchen = {item["id"]: item for item in state["items"]
                   if item["id"].startswith("kitchen-plan-")}
        self.assertEqual((len(kitchen), sum(item["placement"] is not None
                                           for item in kitchen.values())), (13, 12))
        self.assertEqual(kitchen["kitchen-plan-undermount-labor"]["unitPrice"], 1500)
        self.assertIsNone(kitchen["kitchen-plan-undermount-labor"]["placement"])
        prices = {"sink": 4700, "faucet": 3000, "hood": 6400, "hot-water": 35900}
        self.assertEqual(sum(prices.values()) + 1500, 51_500)
        products = {product["id"]: product for product in state["products"]}
        for key, price in prices.items():
            item = kitchen[f"kitchen-plan-{key}"]
            self.assertEqual(item["unitPrice"], price)
            self.assertEqual(item["productId"], f"product-kitchen-plan-{key}")
            self.assertEqual(products[item["productId"]]["unitPrice"], price)
        for key in ("prep", "sink-base", "cooktop-base", "tower", "return",
                    "dishwasher", "ih", "gas"):
            self.assertIsNone(kitchen[f"kitchen-plan-{key}"]["unitPrice"])
        self.assertEqual((kitchen["kitchen-plan-prep"]["widthCm"],
                          kitchen["kitchen-plan-sink-base"]["widthCm"],
                          kitchen["kitchen-plan-cooktop-base"]["widthCm"]), (60, 76, 80))
        self.assertLess(kitchen["kitchen-plan-ih"]["placement"]["x"],
                        kitchen["kitchen-plan-gas"]["placement"]["x"])
        self.assertLess(
            next(item for item in state["items"] if item.get("outletPlanPointId") ==
                 "B05")["placement"]["x"],
            kitchen["kitchen-plan-tower"]["placement"]["x"],
        )

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
        for name in ("kitchen-plan.js", "kitchen-icons.js", "outlet-diagram.js"):
            self.assertIn(f"assets/{name}", {entry["path"] for entry in bundle["modules"]})
        self.assertIn("state-browser.mjs", {entry["path"] for entry in bundle["modules"]})
        self.assertNotRegex(html, r"(?i)<\s*(?:img|image)\b|data:image/|base64,")
        self.assertNotRegex(html, r'(?i)<script[^>]+src=|<link[^>]+rel="stylesheet"')
        self.assertNotIn(SAMPLE.read_text(encoding="utf-8")[:100], html)
        self.assertLess(PORTABLE.stat().st_size, 2_000_000)

    def test_pages_entry_is_opt_in_and_same_origin(self):
        entry = PAGES_ENTRY.read_text(encoding="utf-8")
        destination = "portable/裝修設備規劃.html?demo=pages"
        self.assertIn(f'content="0; url={destination}"', entry)
        self.assertIn(f'href="{destination}"', entry)
        bootstrap = (ROOT / "tools" / "portable-bootstrap.js").read_text(encoding="utf-8")
        self.assertIn('searchParams.get("demo") === "pages"', bootstrap)
        self.assertIn('location.protocol === "https:" || location.protocol === "http:"',
                      bootstrap)
        self.assertIn('new URL("../files/設備規劃.json", location.href)', bootstrap)
        self.assertIn('sampleURL.origin !== location.origin', bootstrap)
        self.assertIn('credentials: "omit", redirect: "error", mode: "same-origin"', bootstrap)
        self.assertNotIn("179", bootstrap)
        self.assertNotIn(SAMPLE.read_text(encoding="utf-8")[:100],
                         PORTABLE.read_text(encoding="utf-8"))

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
