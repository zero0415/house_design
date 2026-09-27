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

INCLUDED_BATHROOM_IDS = {
    *(f"{room}-{fixture}" for room in ("bath-main", "bath-guest")
      for fixture in ("toilet", "vanity", "basin-tap", "shower")),
    "bath-main-urinal-u0211-a624", "bath-guest-tub",
}


def legacy_bathroom_save():
    state = json.loads(SAMPLE.read_text(encoding="utf-8"))
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
        "bath-guest-tub": (
            "排水改管與超出原安裝額度的補差待核；本件安裝另加 NT$0（原報已含）。",
            "排水與安裝費均待確認。",
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
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,345,496.2")
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
            self.assertEqual((len(state["items"]), len(state["products"])), (179, 28))
            self.assertEqual(len([url for url in requests if "/files/" in url]), 1)
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
            self.assertEqual(report["plan"], 2_345_496.2)
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
                    ...changed,expectedRevision:original.revision,undo:null});
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
                             (1_959_530, 2_345_496.2, 2_346_296.2))
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
                             "NT$2,345,496.2")
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
            self.assertIn("重疊", guest.inner_text())
            self.assertIn("9.15cm", guest.inner_text())
            guest.locator("details.warning-details > summary").click()
            for text in ("9.15cm", "75.03cm", "7.52cm", "不自動套用"):
                self.assertIn(text, guest.inner_text())
            switcher = page.locator("nav.plan-room-navigation select[data-plan-room-select]")
            switcher.select_option("bedroom-2")
            bedroom = page.locator('[data-ac-room-cue="ac-bedroom-2"]').first
            self.assertTrue(bedroom.is_visible())
            self.assertIn("無已確認對外窗", bedroom.inner_text())
            self.assertNotIn("嚴重過大容量", bedroom.inner_text())
            self.assertEqual(page.locator(
                '[data-item-id="ac-bedroom-2"][data-outdoor-ac-window]').count(), 0)
            switcher.select_option("ac-platform")
            self.assertIn("瓦斯烘衣機", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
            self.assertIn("5.9cm", page.locator(
                '[data-laundry-warning="balcony-dryer"]').first.inner_text())
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
                    vanity:{overlap:assessment.tubOverlapCm,gap:assessment.gapCm,
                        clearance:assessment.sideClearanceCm,conflict:assessment.conflict},
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
                    roundTrip:exported.items.length === 179 &&
                        exported.products.length === 28 &&
                        exported.items.find(item => item.id === 'kitchen-plan-dishwasher')
                            .installationUnitPrice === null,
                    storageUntouched:localStorage.length === 0,
                };
            }""")
            self.assertEqual((report["quote"], report["total"],
                              report["railAmount"], report["acAmount"]),
                             (1_959_530, 2_345_496.2, 4_684, 140_088))
            self.assertEqual((report["addedProducts"], report["linked"],
                              report["railLength"], report["railHeads"],
                              report["originalLength"]), (10, 0, 300, 4, 150))
            self.assertEqual(report["productTypes"],
                             ["track", "track", "split-ac", "window-ac", "split-ac", "ceiling",
                              "equipment", "equipment", "equipment", "equipment"])
            self.assertTrue(report["corridorSVG"])
            self.assertTrue(report["vanity"]["conflict"])
            for key, expected in (("overlap", 9.15), ("gap", 75.03),
                                  ("clearance", 7.52)):
                self.assertAlmostEqual(report["vanity"][key], expected, places=1)
            self.assertIn("瓦斯", report["gasWarning"])
            self.assertIn("5.9cm", report["gasWarning"])
            self.assertIn("不得依此圖自行施工", report["gasWarning"])
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
            for fixture_id, price in (("bath-main-urinal-u0211-a624", "3,960"),
                                      ("bath-guest-tub", "26,936")):
                summary = page.locator(
                    f'details.equipment[data-id="{fixture_id}"] summary'
                ).inner_text()
                self.assertIn(f"商品 NT${price}", summary)
                self.assertIn("安裝 NT$0（原報已含）", summary)
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
                });
                const budgetAfter = calculatePlanTotal(calculateBudget(changed.items,
                    {wholePlan:true})).TWD;
                const invalid = structuredClone(changed);
                invalid.items.find(item => item.id === 'bath-main-toilet')
                    .installationUnitPrice = 2500;
                let extraRejected = false;
                try {
                    await globalThis.__RENOVATION_OFFLINE_STORE__.update({
                        ...invalid,expectedRevision:changed.revision,undo:null});
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
                        ...invalid,expectedRevision:changed.revision,undo:null});
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
                        'renovation-equipment-offline-v1:' + location.pathname))
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
            self.assertEqual(report["before"], 2_345_496.2)
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
                "document.querySelector('#overall-total').textContent.includes('2,345,496')",
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
                             ["14994", "14994", "26936", "3960"])
            self.assertTrue(any(row["商品單價"] == "待補" for row in included))
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
                              state["undo"]), (179, 28, None))
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
                "document.querySelector('#overall-total').textContent.includes('2,345,496')",
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
            self.assertEqual(next(room for room in state["rooms"] if room["id"] ==
                                  "kitchen")["ceilingHeightCm"], 275)
            self.assertEqual({item["id"] for item in state["items"]
                              if item["installationUnitPrice"] == 0},
                             INCLUDED_BATHROOM_IDS)
            self.assertEqual(page.locator("#overall-total").inner_text(),
                             "NT$2,345,496.2")
            stored = json.loads(page.evaluate(
                "localStorage.getItem('renovation-equipment-offline-v1:' + location.pathname)"
            ))
            self.assertNotIn("installationUnitPrice", next(item for item in
                             stored["items"] if item["id"] == "bath-main-toilet"))
            self.assertEqual(stored["revision"], 7)
        finally:
            context.close()

    def test_saved_unselected_laundry_stays_generic_not_a_fake_gas_selection(self):
        old = json.loads(SAMPLE.read_text(encoding="utf-8"))
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
                "document.querySelector('#overall-total').textContent.includes('2,345,496')",
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
                             (5, 179, 28, None))
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
                    null && state.items.length === 179;
            }""", timeout=15000)
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,345,496.2")
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
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,345,496.2")
            page.locator("#undo-last").click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.items.find(item => item.id === 'kitchen-plan-gas')
                    .orientation === 0 && state.items.length === 179;
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
                    'renovation-equipment-offline-v1:' + location.pathname);
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
            self.assertEqual(page.locator("#overall-total").inner_text(), "NT$2,345,496.2")
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
