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
PUBLIC_PRODUCT_SKU = "02603" + "6388"
SKU_CONTEXTS = ("trplus.com.tw/p/", "catalog-ceiling-trplus-")


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
        for value in ("51", "9", "7", "27,000", "51,500", "2,322,060.20",
                      "16,000", "10 筆", "NT$0", "14,994", "3,960",
                      "26,936", "NT$6,600", "NT$13,200", "1,215",
                      "140,088", "21,032", "GPR-23HI", "4 坪內",
                      "4,684", "967.20", "42,500", "214,112.20",
                      "59.8", "55", "B06", "81cm", "82×48cm"):
            with self.subTest(value=value):
                self.assertIn(value, readme)
                self.assertIn(value, quote)
        self.assertIn("181 個物件與 28 款商品", readme)
        for value in ("原兩組各 **NT$19,000 木纖滑門**", "原報軌道額度",
                      "臥室3↔工作室", "未計算", "不自動新增費用",
                      "不自動新增費用、扣款或退還主浴軌道額度",
                      "門片重歸屬", "容器 **7**",
                      "renovation-equipment-offline-doors-v1"):
            with self.subTest(doors=value):
                self.assertIn(value, readme)
        self.assertIn("三個主浴門位", readme)
        self.assertIn("兩筆各 **0.8 米", quote)
        self.assertIn("門片工程原報價 **164,500 元**", quote)
        self.assertIn("沒有發布原始工程／電源配置 PDF", readme)
        self.assertIn("廚房／客浴／陽台附件", readme)
        self.assertIn("不自動移入屋內", readme)
        self.assertIn("不自動移入屋內", quote)
        self.assertIn("免治便座、新風機、電熱毛巾架、防滑扶手", readme)
        self.assertIn("安裝費來源", quote)
        self.assertIn("返回全屋格局", readme)
        self.assertIn("切換房間", quote)
        self.assertIn("預設收合", readme)
        self.assertIn("預設收合", quote)
        for value in ("www.trplus.com.tw/p/016095417",
                      "www.trplus.com.tw/p/026036388", "www.ovotoilet.com",
                      "三叉管是否內含未獲確認", "¥79,200", "¥8,600",
                      "不換算台幣", "不虛構 lux"):
            with self.subTest(value=value):
                self.assertIn(value, readme)
        self.assertIn("八盞室內**既有燈位", quote)
        self.assertIn("臥室2室外位置／區域 ID 為 `null`", quote)
        self.assertIn("60cm 檯面**模組外幅不是淨開口", quote)
        self.assertIn("鏡櫃另待選", quote)
        self.assertIn("7,186", quote)
        for value in ("單片 L 形檯面", "短翼末端", "60×深47cm",
                      "80cm 坐式浴缸", "未選候選", "不能把未知價當零元"):
            with self.subTest(new=value):
                self.assertIn(value, quote)
        self.assertIn("私人客浴參考 PNG 未發布", readme)
        self.assertIn("私人陽台參考 PNG", readme)
        self.assertIn("非可施工", readme)
        self.assertIn("不內嵌任何影像", readme)
        self.assertIn("泥作水槽", quote)
        for value in ("插座配置圖", "燈具配置圖", "19 個已知發光點",
                      "14 筆", "9 條專用迴路", "不依參考圖臆造",
                      "沒有複製或轉繪其頁面"):
            with self.subTest(utility=value):
                self.assertIn(value, readme)
        for value in ("所有開關面板一開始均未指定任何燈具",
                      "整個開關面板", "未指定面板", "單步 Undo",
                      "controlRelationsVersion: 1", "容器版號為 **6**",
                      "renovation-equipment-offline-controls-v1"):
            with self.subTest(controls=value):
                self.assertIn(value, readme)
        self.assertIn("只切換在燈具配置圖明確儲存", quote)
        self.assertIn("模擬操作不改存檔或報價", quote)
        self.assertNotIn("目前照明模擬只沿用房間分組", quote)
        for value in ("原水槽擬拆", "刪線幽靈框", "179 筆",
                      "不會憑空新增掛盆", "右側洗衣機"):
            with self.subTest(balcony_sheet=value):
                self.assertIn(value, readme)

    def test_sample_is_deidentified_without_losing_the_plan(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(set(state), {
            "version", "revision", "updatedAt", "rooms", "items", "products", "undo",
        })
        self.assertEqual((state["version"], state["revision"], state["undo"]), (5, 0, None))
        self.assertEqual(state["updatedAt"], "2026-01-01T00:00:00.000Z")
        self.assertEqual((len(state["rooms"]), len(state["items"]), len(state["products"])),
                         (13, 181, 28))
        rooms = {room["id"] for room in state["rooms"]}
        products = {product["id"] for product in state["products"]}
        self.assertEqual(len(products), 28)
        self.assertEqual(len({item["id"] for item in state["items"]}), 181)
        self.assertEqual({room["name"] for room in state["rooms"] if room["id"].startswith(
            "bedroom-")}, {"臥室1", "臥室2", "臥室3"})
        self.assertTrue(all(item["roomId"] in rooms and
                            (item["productId"] is None or item["productId"] in products)
                            for item in state["items"]))
        self.assertTrue(all("controlledLightIds" not in item
                            for item in state["items"]))
        self.assertTrue({f"sample-product-{index:02d}" for index in range(1, 14)}
                        <= products)
        self.assertTrue({f"product-kitchen-plan-{key}" for key in
                         ("sink", "faucet", "hood", "hot-water")} <= products)
        self.assertIn("catalog-ceiling-trplus-026036388", products)
        self.assertTrue({f"sample-product-{index}" for index in range(19, 29)}
                        <= products)
        self.assertEqual(next(item for item in state["items"] if item["id"] ==
                              "sample-balcony-outlet-01")["outletPlanPointId"], "R48")
        self.assertFalse(any(re.fullmatch(
            r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", item["id"], re.I
        ) for item in state["items"]))

    def test_bathroom_included_installation_is_exactly_ten_zeroes(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in state["items"]}
        fixture_ids = {
            *(f"{room}-{fixture}" for room in ("bath-main", "bath-guest")
              for fixture in ("toilet", "vanity", "basin-tap", "shower")),
            "bath-main-urinal-u0211-a624", "bath-guest-tub",
        }
        self.assertEqual(len(fixture_ids), 10)
        self.assertEqual({item["id"] for item in state["items"]
                          if item.get("installationUnitPrice") == 0}, fixture_ids)
        self.assertTrue(all(by_id[fixture]["kind"] == "equipment" and
                            by_id[fixture]["roomId"] in {"bath-main", "bath-guest"} and
                            by_id[fixture]["quotedUnitPrice"] is None
                            for fixture in fixture_ids))
        self.assertEqual((by_id["bath-main-toilet"]["unitPrice"],
                          by_id["bath-guest-toilet"]["unitPrice"],
                          by_id["bath-guest-tub"]["unitPrice"],
                          by_id["bath-main-urinal-u0211-a624"]["unitPrice"]),
                         (14994, 14994, None, 3960))
        self.assertTrue(all(by_id[fixture]["unitPrice"] is None
                            for fixture in fixture_ids -
                            {"bath-main-toilet", "bath-guest-toilet",
                             "bath-main-urinal-u0211-a624"}))
        for room in ("bath-main", "bath-guest"):
            with self.subTest(room=room):
                self.assertEqual(sum(by_id[fixture]["roomId"] == room
                                     for fixture in fixture_ids), 5)
                for excluded in ("heater", "bidet-tcf8cm76",
                                 "heated-towel-rail", "rinse-kit"):
                    self.assertIsNone(by_id[f"{room}-{excluded}"]["installationUnitPrice"])
        self.assertIsNone(by_id["bath-guest-tub-grab-bar"]["installationUnitPrice"])
        self.assertEqual(by_id["quoted-downlight-06"]["installationUnitPrice"], 750)
        self.assertIn("原報兩套衛浴一般安裝已含",
                      by_id["bath-main-toilet"]["note"])
        self.assertIn("超出原安裝額度的補差", by_id["bath-main-urinal-u0211-a624"]["note"])
        self.assertIn("浴缸改管", by_id["bath-guest-tub"]["note"])

    def test_dealer_catalog_links_and_currency_cautions(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        items = {item["id"]: item for item in state["items"]}
        products = {product["id"]: product for product in state["products"]}
        cases = (
            ("sample-product-01", ("bath-main-toilet", "bath-guest-toilet"),
             "TOTO CW288SGUR", 14994, "TWD", "NT$23,800 × 0.63＝NT$14,994"),
            ("sample-product-02", ("bath-main-urinal-u0211-a624",),
             "凱薩 U0211-A624", 3960, "TWD", "NT$13,200 × 0.3＝NT$3,960"),
            ("sample-product-03", (),
             "OVO BK106A", 26936, "TWD", "NT$51,800 × 0.52＝NT$26,936"),
            ("sample-product-04", ("bath-main-bidet-tcf8cm76",
                                   "bath-guest-bidet-tcf8cm76"),
             "TOTO TCF8CM76", 79200, "JPY", "¥79,200"),
            ("sample-product-05", ("bath-main-flush-tca320",
                                   "bath-guest-flush-tca320"),
             "TOTO TCA320", 8600, "JPY", "¥8,600"),
            ("sample-product-09", ("bath-main-rinse-kit",
                                   "bath-guest-rinse-kit"),
             "特力屋三叉管與沖洗器組（商品型號待核）", 769, "TWD", "NT$769"),
        )
        self.assertEqual(23800 * .63, 14994)
        self.assertEqual(13200 * .3, 3960)
        self.assertEqual(51800 * .52, 26936)
        self.assertEqual(2 * (14994 - 19035) + 3960 + (26936 - 30000), -7186)
        for product_id, item_ids, model, price, currency, formula in cases:
            with self.subTest(product_id=product_id):
                product = products[product_id]
                self.assertEqual((product["brandModel"], product["unitPrice"],
                                  product["priceCurrency"]), (model, price, currency))
                self.assertEqual({item["id"] for item in state["items"]
                                  if item["productId"] == product_id}, set(item_ids))
                for field in ("note", "priceSource"):
                    self.assertIn(formula, product[field])
                for item_id in item_ids:
                    item = items[item_id]
                    self.assertEqual((item["brandModel"], item["unitPrice"],
                                      item["priceCurrency"], item["productId"]),
                                     (model, price, currency, product_id))
                    for field in ("note", "priceSource"):
                        self.assertIn(formula, item[field])
        for field in ("note", "priceSource"):
            self.assertIn("建議售價 NT$6,600", products["sample-product-02"][field])
            self.assertIn("折扣基準 NT$13,200", products["sample-product-02"][field])
            self.assertIn("三叉管是否內含未獲確認",
                          products["sample-product-09"][field])
            self.assertIn("業務可能無法取得海外庫存",
                          products["sample-product-04"][field])
            self.assertIn("業務可能無法取得海外庫存",
                          products["sample-product-05"][field])
        self.assertIn("ovotoilet.com/zh-TW/Products/Product",
                      products["sample-product-03"]["priceSource"])
        self.assertIn("trplus.com.tw/p/016095417",
                      products["sample-product-09"]["priceSource"])
        for item_id in ("bath-main-rinse-kit", "bath-guest-rinse-kit"):
            self.assertIsNone(items[item_id]["installationUnitPrice"])
        for item_id in ("bath-main-bidet-tcf8cm76", "bath-guest-bidet-tcf8cm76",
                        "bath-main-flush-tca320", "bath-guest-flush-tca320"):
            self.assertEqual(items[item_id]["priceCurrency"], "JPY")
            self.assertIn("不換算台幣", items[item_id]["note"])
            self.assertIn("業務可能無法取得海外庫存", items[item_id]["note"])

    def test_ceiling_catalog_links_eight_indoor_and_one_balcony_light(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        catalog = next(product for product in state["products"] if product["id"] ==
                       "catalog-ceiling-trplus-026036388")
        self.assertEqual((catalog["type"], catalog["environment"], catalog["unit"],
                          catalog["priceCurrency"]), ("ceiling", "indoor", "盞", "TWD"))
        self.assertEqual((catalog["unitPrice"], catalog["installationUnitPrice"],
                          catalog["lightWatts"], catalog["lightLumens"],
                          catalog["beamAngleDeg"], catalog["lightSpecSource"]),
                         (1215, 1200, 50, None, None, ""))
        self.assertIn("trplus.com.tw/p/026036388", catalog["priceSource"])
        self.assertIn("非商家安裝報價", catalog["priceSource"])
        for term in ("3–5 坪", "直徑 50cm", "8cm", "金屬", "壓克力",
                     "陽台防潮等級未核", "50W", "流明", "光束角", "IES",
                     "不得虛構 lux"):
            self.assertIn(term, catalog["note"])
        ceilings = [item for item in state["items"] if item["lightType"] == "ceiling"]
        self.assertEqual(len(ceilings), 9)
        indoor = [item for item in ceilings if item["roomId"] != "balcony"]
        self.assertEqual(len(indoor), 8)
        self.assertTrue(all(item["unitPrice"] == 1215 and
                            item["productId"] == catalog["id"] and
                            item["installationUnitPrice"] == 1200 and
                            item["lightSelection"] == "custom" and
                            item["lightWatts"] == 50 and
                            item["lightSpecSource"] == "" and
                            item["lightLumens"] is None and
                            item["beamAngleDeg"] is None for item in indoor))
        balcony = next(item for item in ceilings if item["roomId"] == "balcony")
        self.assertEqual((balcony["productId"], balcony["unitPrice"],
                          balcony["installationUnitPrice"], balcony["lightWatts"],
                          balcony["lightSelection"], balcony["lightSpecSource"]),
                         ("sample-product-23", 286, 1200, 16, "outdoor-custom", ""))
        self.assertEqual(next(product for product in state["products"] if
                              product["id"] == "sample-product-23")["environment"], "balcony")
        self.assertIn("防護等級", balcony["note"])

    def test_conditional_catalog_and_preserved_public_geometry(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        items = {item["id"]: item for item in state["items"]}
        products = {product["id"]: product for product in state["products"]}
        rail = items["corridor-track-lighting"]
        rail_product = products["sample-product-19"]
        self.assertEqual((rail["trackLengthCm"], rail["spotlightQuantity"],
                          rail["unitPrice"], rail["spotlightUnitPrice"],
                          rail["installationUnitPrice"], rail["productId"],
                          rail["placement"]["y"]),
                         (300, 4, 340, 786, 1200, "sample-product-19", .5))
        self.assertEqual((rail_product["trackLengthCm"],
                          rail_product["lightWatts"],
                          products["sample-product-20"]["lightWatts"],
                          products["sample-product-20"]["spotlightUnitPrice"]),
                         (300, 30, 40, 979))
        self.assertFalse(any(item["productId"] == "sample-product-20"
                             for item in items.values()))
        acs = [item for item in items.values() if item["id"].startswith("ac-")]
        self.assertEqual((len(acs), sum(item["productId"] == "sample-product-21"
                                       for item in acs), sum(item["productId"] ==
                                       "sample-product-28" for item in acs)), (6, 2, 4))
        self.assertTrue(all(item["acPlanStatus"] == "active" for item in acs))
        for room_id, product_id, price, size in (
                ("master", "sample-product-21", 27980, (95.5, 34.5)),
                ("living-dining", "sample-product-21", 27980, (95.5, 34.5)),
                *((room, "sample-product-28", 21032, (73.2, 33))
                  for room in ("bedroom-1", "bedroom-2", "bedroom-3", "studio"))):
            item = items[f"ac-{room_id}"]
            self.assertEqual((item["productId"], item["unitPrice"],
                              (item["outdoorWidthCm"], item["outdoorDepthCm"])),
                             (product_id, price, size))
            if product_id == "sample-product-28":
                self.assertIn("29.6", item["note"])
                self.assertNotIn("嚴重過大容量", item["note"])
        self.assertEqual((items["ac-bedroom-2"]["outdoorPlacement"],
                          items["ac-bedroom-2"]["outdoorZoneId"]), (None, None))
        self.assertEqual(products["sample-product-22"]["unitPrice"], 16999)
        self.assertEqual((products["sample-product-28"]["unitPrice"],
                          products["sample-product-28"]["widthCm"],
                          products["sample-product-28"]["heightCm"],
                          products["sample-product-28"]["depthCm"],
                          products["sample-product-28"]["outdoorWidthCm"],
                          products["sample-product-28"]["outdoorHeightCm"],
                          products["sample-product-28"]["outdoorDepthCm"]),
                         (21032, 82.5, None, 19.6, 73.2, 55.5, 33))
        self.assertFalse(any(item["productId"] == "sample-product-22"
                             for item in items.values()))
        self.assertEqual((items["bath-guest-vanity"]["widthCm"],
                          items["bath-guest-vanity"]["depthCm"],
                          items["bath-main-vanity"]["widthCm"],
                          items["bath-main-vanity"]["depthCm"]), (60, 47, 60, 47))
        self.assertTrue(all(items[f"{room}-vanity"]["installationUnitPrice"] == 0
                            for room in ("bath-main", "bath-guest")))
        self.assertEqual((items["bath-guest-tub-grab-bar"]["unitPrice"],
                          items["bath-guest-tub-grab-bar"]["installationUnitPrice"],
                          items["bath-guest-tub-grab-bar"]["productId"]),
                         (967.2, None, "sample-product-24"))
        for item_id, product_id, price, width, depth in (
                ("balcony-washer", "sample-product-25", 21150, 70.5, 68.6),
                ("balcony-dryer", "sample-product-26", 20599, 73.7, 72.1),
                ("kitchen-plan-dishwasher", "sample-product-27", 42500, 59.8, 55)):
            with self.subTest(item=item_id):
                item = items[item_id]
                self.assertEqual((item["productId"], item["unitPrice"], item["widthCm"],
                                  item["depthCm"], item["installationUnitPrice"]),
                                 (product_id, price, width, depth, None))
                self.assertEqual(products[product_id]["unitPrice"], price)
        self.assertIn("瓦斯", items["balcony-dryer"]["note"])
        self.assertIn("非可施工配置", items["balcony-dryer"]["note"])
        self.assertIn("不得據圖施工", items["balcony-dryer"]["note"])
        self.assertIn("淨開口", items["kitchen-plan-dishwasher"]["note"])
        self.assertIn("基本運送", items["kitchen-plan-dishwasher"]["note"])
        b06 = next(item for item in items.values()
                   if item.get("outletPlanPointId") == "B06")
        circuit = items["circuit-pdf-outlet-B06"]
        self.assertEqual(circuit["circuitOutletId"], b06["id"])
        for item in (b06, circuit):
            self.assertIn("110V／15A／1100W", item["note"])
            self.assertIn("不代表現場插孔", item["note"])
        self.assertEqual(sum(item["productId"] == "sample-product-27"
                             for item in items.values()), 1)

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
        self.assertEqual(sum(prices.values()) + 1500 +
                         kitchen["kitchen-plan-dishwasher"]["unitPrice"], 94_000)
        products = {product["id"]: product for product in state["products"]}
        for key, price in prices.items():
            item = kitchen[f"kitchen-plan-{key}"]
            self.assertEqual(item["unitPrice"], price)
            self.assertEqual(item["productId"], f"product-kitchen-plan-{key}")
            self.assertEqual(products[item["productId"]]["unitPrice"], price)
        for key in ("prep", "sink-base", "cooktop-base", "tower", "return",
                    "ih", "gas"):
            self.assertIsNone(kitchen[f"kitchen-plan-{key}"]["unitPrice"])
        self.assertEqual((kitchen["kitchen-plan-dishwasher"]["unitPrice"],
                          kitchen["kitchen-plan-dishwasher"]["productId"]),
                         (42500, "sample-product-27"))
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

    def test_v_kitchen_and_unpriced_guest_bath_are_precisely_conditional(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        items = {item["id"]: item for item in state["items"]}
        products = {product["id"]: product for product in state["products"]}
        tower = items["kitchen-plan-tower"]
        platform = items["kitchen-plan-return"]
        self.assertEqual((tower["placement"], platform["placement"]),
                         ({"x": .826, "y": .675}, {"x": .824, "y": .262}))
        self.assertEqual((tower["widthCm"], tower["depthCm"],
                          platform["widthCm"], platform["depthCm"]),
                         (40, 60, 40, 75))
        for cabinet in (tower, platform):
            self.assertIsNone(cabinet["unitPrice"])
            self.assertIsNone(cabinet["productId"])
            self.assertIn("[kitchen-v-layout:2]", cabinet["note"])
            self.assertIn("非訂製尺寸", cabinet["note"])
        tub = items["bath-guest-tub"]
        self.assertEqual((tub["name"], tub["brandModel"], tub["unitPrice"],
                          tub["productId"], tub["widthCm"], tub["depthCm"],
                          tub["heightCm"], tub["orientation"],
                          tub["installationUnitPrice"]),
                         ("坐式浴缸（80cm條件目標）", "", None, None,
                          80, None, None, 0, 0))
        self.assertEqual(tub["placement"], {"x": .202, "y": .382})
        self.assertIn("[guest-bath-80:1]", tub["note"])
        self.assertIn("深度", tub["note"])
        self.assertTrue(all(items[key]["depthCm"] == 47 for key in
                            ("bath-guest-vanity", "bath-main-vanity")))
        self.assertEqual(items["bath-guest-vanity"]["placement"],
                         {"x": 111.41 / 205, "y": .157})
        self.assertEqual(items["bath-main-vanity"]["placement"],
                         {"x": .478, "y": .808})
        self.assertEqual(products["sample-product-03"]["unitPrice"], 26936)
        self.assertFalse(any(item["productId"] == "sample-product-03"
                             for item in state["items"]))
        self.assertEqual((len(state["rooms"]), len(state["items"]),
                          len(state["products"]), state["revision"], state["undo"]),
                         (13, 181, 28, 0, None))

    def test_quoted_door_and_rail_allowances_are_reassigned_not_repriced(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        items = {item["id"]: item for item in state["items"]}
        doors = [item for item in state["items"] if item["kind"] == "door"]
        self.assertEqual(len(doors), 12)
        self.assertEqual(sum(door["quotedQuantity"] * door["quotedUnitPrice"]
                             for door in doors), 114_500)
        rails = [item for item in state["items"] if item["trackDoorId"]]
        self.assertEqual({item["id"] for item in rails},
                         {"track-main-bath-hall", "track-bedroom-3-studio"})
        self.assertEqual(sum(item["quotedQuantity"] * item["quotedUnitPrice"]
                             for item in rails), 2_880)
        self.assertEqual({item["trackDoorId"]: item["quantity"] for item in rails},
                         {"bedroom-2": .8, "bedroom-3-studio": .8})
        self.assertEqual({item["id"] for item in state["items"]
                          if item.get("doorQuoteAllocation") == 1}, {
                              "door-balcony", "door-bedroom-3-studio",
                              "track-main-bath-hall", "track-bedroom-3-studio",
                          })
        self.assertEqual((items["door-balcony"]["doorMaterial"],
                          items["door-balcony"]["unitPrice"],
                          items["door-balcony"]["quotedUnitPrice"]),
                         ("custom", None, 0))
        self.assertEqual((items["door-bedroom-3-studio"]["doorMaterial"],
                          items["door-bedroom-3-studio"]["unitPrice"],
                          items["door-bedroom-3-studio"]["quotedUnitPrice"]),
                         ("wood-slide", 19_000, 19_000))
        self.assertEqual((items["door-main-bath-hall"]["doorOpeningKind"],
                          items["door-main-bath-hall"]["unitPrice"],
                          items["door-main-bath-master"]["doorMaterial"],
                          items["door-main-bath-master"]["unitPrice"]),
                         ("swing", 8_500, "solid-wood", 14_000))
        self.assertEqual(len({item["id"] for item in
                              state["items"] if item.get("lightType") in
                              {"ceiling", "track", "recessed"} and
                              item.get("placement")}), 16)
        self.assertFalse(any("controlledLightIds" in item
                             for item in state["items"]))
        self.assertIsNone(state["undo"])

    def test_balcony_swap_keeps_old_floor_geometry_and_unpriced_new_basin(self):
        state = json.loads(SAMPLE.read_text(encoding="utf-8"))
        items = {item["id"]: item for item in state["items"]}
        products = {product["id"]: product for product in state["products"]}
        dryer = items["balcony-dryer"]
        washer = items["balcony-washer"]
        heater = items["balcony-water-heater"]
        sink = items["balcony-outboard-sink"]
        self.assertEqual((dryer["roomId"], dryer["orientation"],
                          dryer["productId"], dryer["unitPrice"]),
                         ("balcony", 270, "sample-product-26", 20599))
        self.assertAlmostEqual(dryer["placement"]["x"], 35 / 274)
        self.assertAlmostEqual(dryer["placement"]["y"], 39 / 76)
        self.assertEqual((washer["placement"], heater["placement"]),
                         ({"x": .856, "y": .503}, {"x": .979, "y": .518}))
        self.assertEqual((sink["roomId"], sink["kind"], sink["widthCm"],
                          sink["depthCm"], sink["heightCm"], sink["unitPrice"],
                          sink["installationUnitPrice"], sink["productId"],
                          sink["markerStyle"], sink["equipmentCategory"]),
                         ("ac-platform", "equipment", 82, 48, None, None,
                          None, None, None, None))
        self.assertAlmostEqual(sink["placement"]["x"], 457.32 / 557.04)
        self.assertEqual(sink["placement"]["y"], .5)
        self.assertIn("可靠混凝土結構", sink["note"])
        self.assertIn("不得據圖施工", dryer["note"])
        self.assertEqual(products["sample-product-26"]["name"],
                         "Whirlpool 8TWGD5050PW 瓦斯烘衣機（條件式）")
        self.assertEqual(products["sample-product-26"]["unitPrice"], 20599)
        self.assertTrue(all(item["note"].count("[balcony-swap:1]") == 1
                            for item in (dryer, washer, heater, sink)))
        self.assertIsNone(state["undo"])

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
        for name in ("kitchen-plan.js", "kitchen-icons.js", "outlet-diagram.js",
                     "bathroom-installation.js", "laundry-notes.js",
                     "quote-provenance.js", "guest-bath-plan.js",
                     "balcony-plan.js", "electrical-sheets.js",
                     "door-allocation.js",
                     "circuit-preview.js", "file-actions.js"):
            self.assertIn(f"assets/{name}", {entry["path"] for entry in bundle["modules"]})
        for name in ("corridor-plan.js", "air-conditioning-plan.js"):
            self.assertTrue((ROOT / "extensions" / "renovation-equipment" / "assets" /
                             name).is_file())
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
        self.assertIn('renovation-equipment-offline-controls-v1:', bootstrap)
        self.assertIn('renovation-equipment-offline-v1:', bootstrap)
        self.assertIn("guardControlRelationsUpdate(current, candidate)", bootstrap)
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
                phones = [match.group() for match in PHONE.finditer(text)
                          if not (match.group() == PUBLIC_PRODUCT_SKU and
                                  any(text[:match.start()].endswith(prefix)
                                      for prefix in SKU_CONTEXTS))]
                self.assertEqual(phones, [])


if __name__ == "__main__":
    unittest.main()
