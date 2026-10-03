"""Exercise explicit controls with an isolated HTTP store and offline Edge."""

import json
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from threading import Thread
from queue import Queue

from playwright.sync_api import sync_playwright, expect


if len(sys.argv) != 3:
    raise SystemExit(
        "Usage: python tools\\test_control_relations_browser.py <node.exe> <artifact-directory>"
    )
root = Path(__file__).resolve().parents[1]
node = sys.argv[1]
artifacts = Path(sys.argv[2]).resolve()
artifacts.mkdir(parents=True, exist_ok=True)
source_path = root / "files" / "設備規劃.json"
raw = source_path.read_bytes()
source = json.loads(raw)
normalized_source = deepcopy(source)
next(product for product in normalized_source["products"] if
     product["id"] == "sample-product-08")["trackLengthCm"] = 150
portable = (root / "portable" / "裝修設備規劃.html").as_uri()
switch_id = "quoted-switch-01"
other_switch = "quoted-switch-02"
track_id = "corridor-track-lighting"
light_id = "living-ceiling-light-01"
assert (len(source["items"]), len(source["products"]), source["revision"],
        source["undo"]) == (182, 28, 0, None)

server_script = r"""
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
const extensionDirectory = resolve('extensions', 'renovation-equipment');
const filesDirectory = resolve('files');
const { createStore, StoreError } =
    await import(pathToFileURL(join(extensionDirectory, 'state.mjs')));
const store = createStore(process.argv[1]);
const source = await readFile(join(extensionDirectory, 'extension.mjs'), 'utf8');
const start = runInNewContext(
    source.slice(source.indexOf('const assets = new Map('),
        source.indexOf('await joinSession(')) + '\nstartServer',
    { createServer, readFile, join, resolve, URL, Buffer, process,
        StoreError, store, extensionDirectory, filesDirectory });
const { url } = await start('isolated-public-test');
console.log(url);
"""


def snapshot(state):
    return {key: state[key] for key in ("rooms", "items", "products")}


def read(page, mode):
    return page.evaluate(
        "() => globalThis.__RENOVATION_OFFLINE_STORE__.read()"
        if mode == "offline" else
        "() => fetch('/api/state').then(response => response.json())"
    )


def inspect_pristine_calendar(page, mode, initial):
    writes = []
    page.on("request", lambda request: writes.append(
        (request.method, request.url)) if request.method != "GET" else None)
    page.get_by_role("tab", name="開工行事曆", exact=True).click()
    cache_before = page.evaluate("JSON.stringify(localStorage)")
    page.evaluate("""() => {
        window.__calendarViewWrites = [];
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(...args) {
            window.__calendarViewWrites.push(args[0]);
            return setItem.apply(this, args);
        };
        const store = globalThis.__RENOVATION_OFFLINE_STORE__;
        if (store) {
            const update = store.update;
            store.update = function(...args) {
                window.__calendarViewWrites.push('store.update');
                return update.apply(this, args);
            };
        }
    }""")
    assert page.locator("[data-calendar-month-view]").count() == 1
    page.locator("[data-calendar-expand]").click()
    assert page.locator("[data-calendar-month-view]").evaluate_all(
        "nodes => nodes.map(node => node.dataset.calendarMonthView)") == [
            "2026-10", "2026-11", "2026-12", "2027-01",
        ]
    october = page.locator('[data-calendar-month-view="2026-10"]')
    kickoff = october.locator(
        '.calendar-event[data-calendar-event="construction-start"]')
    layout = october.locator(
        '.calendar-event[data-calendar-event="construction-layout"]')
    assert kickoff.locator(
        ".calendar-event-roles .calendar-role").all_inner_texts() == [
            "屋主", "輕隔間廠商代表",
        ]
    assert layout.locator(
        ".calendar-event-roles .calendar-role").all_inner_texts() == [
            "屋主", "廚房工人", "系統櫃工人",
        ]
    assert kickoff.locator(
        ".calendar-owner .calendar-person-icon").count() == 1
    assert layout.locator(
        ".calendar-owner .calendar-person-icon").count() == 1
    for rest, next_day in (
        ("2026-10-25", "2026-10-26"),
        ("2026-11-01", "2026-11-02"),
        ("2026-11-08", "2026-11-09"),
    ):
        month = rest[:7]
        week = page.locator(
            f'[data-calendar-month-view="{month}"] '
            f'.calendar-week:has([data-calendar-date="{rest}"])')
        assert "師傅固定休假" in week.locator(
            ".calendar-sunday-rest").first.inner_text()
        assert week.locator(
            '[data-calendar-event="construction-utilities"]'
        ).get_attribute("data-segment-start") == next_day
    page.locator("#calendar-month-views").screenshot(
        path=str(artifacts / f"pristine-{mode}-edge-four-months-1280.png"))
    for width in (320, 390):
        page.set_viewport_size({"width": width, "height": 844})
        assert page.evaluate(
            "document.documentElement.scrollWidth - innerWidth") <= 1
        assert page.locator(".calendar-scroll").count() == 4
        for bar, name in ((kickoff, "oct09"), (layout, "oct17")):
            bar.scroll_into_view_if_needed()
            assert bar.locator(
                ".calendar-event-roles .calendar-role").evaluate_all(
                    "nodes => nodes.every(node => parseFloat("
                    "getComputedStyle(node).fontSize) >= 12)") is True
            bar.screenshot(path=str(artifacts /
                                    f"pristine-{mode}-edge-{name}-{width}-bar.png"))
            page.screenshot(path=str(artifacts /
                                     f"pristine-{mode}-edge-{name}-{width}-viewport.png"))
        if width == 390:
            page.locator(".calendar-scroll").evaluate_all(
                "nodes => nodes.forEach(node => node.scrollLeft = 0)")
            page.locator("#calendar-month-views").screenshot(
                path=str(artifacts /
                         f"pristine-{mode}-edge-four-months-390.png"))
    assert read(page, mode) == initial
    assert page.evaluate("JSON.stringify(localStorage)") == cache_before
    assert page.evaluate("window.__calendarViewWrites") == []
    assert not writes, writes
    page.locator("[data-calendar-expand]").click()
    assert page.locator("[data-calendar-month-view]").count() == 1
    assert read(page, mode) == initial
    page.get_by_role("tab", name="格局圖", exact=True).click()
    page.set_viewport_size({"width": 1280, "height": 1050})


def wait_for_assignment(page, mode, item_id, expected):
    page.wait_for_function("""async ({mode,id,expected}) => {
        const state = mode === 'offline'
            ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
            : await fetch('/api/state').then(response => response.json());
        return JSON.stringify(state.items.find(item => item.id === id)
            .controlledLightIds) === JSON.stringify(expected);
    }""", arg={"mode": mode, "id": item_id, "expected": expected})
    expect(page.locator("#save-status")).to_have_attribute("data-kind", "saved")


with tempfile.TemporaryDirectory(prefix="public-control-relations-") as directory:
    store_path = Path(directory) / "state.json"
    store_path.write_bytes(raw)
    server = subprocess.Popen(
        [node, "--input-type=module", "-e", server_script, str(store_path)],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        lines = Queue()
        reader = Thread(target=lambda: lines.put(server.stdout.readline()), daemon=True)
        reader.start()
        reader.join(timeout=20)
        if reader.is_alive():
            raise TimeoutError("Isolated HTTP store did not announce a URL")
        url = lines.get().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError(f"Isolated HTTP store could not start: {url}")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            export_path = artifacts / "explicit-controls-export.json"
            for mode in ("http", "offline"):
                context = browser.new_context(
                    viewport={"width": 1280, "height": 1050},
                    accept_downloads=True,
                )
                page = context.new_page()
                errors = []
                remote = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: remote.append(request.url)
                        if request.url.startswith(("http:", "https:")) and
                        not request.url.startswith(url) else None)
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(url if mode == "http" else portable)
                if mode == "offline":
                    page.wait_for_function(
                        "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
                    page.locator("#load-file-input").set_input_files(str(source_path))
                expect(page.locator(".overview-svg")).to_be_visible()
                original = read(page, mode)
                assert snapshot(original) == snapshot(normalized_source)
                assert original["undo"] is None
                budget = page.locator(".budget").inner_text()
                inspect_pristine_calendar(page, mode, original)

                page.locator('[data-action="toggle-light-preview"]').click()
                expect(page.locator("[data-preview-light-id]")).to_have_count(0)
                expect(page.locator(".lighting-legend")).to_contain_text(
                    "已亮 16 組")
                page.locator(
                    f'[data-preview-item-id="{switch_id}"]').click()
                expect(page.locator("#save-status")).to_contain_text(
                    "尚未設定對應")
                expect(page.locator(".lighting-legend")).to_contain_text(
                    "已亮 16 組")
                assert read(page, mode) == original

                page.get_by_role("tab", name="燈具配置圖", exact=True).click()
                expect(page.locator("[data-control-light-id]")).to_have_count(0)
                expect(page.locator("[data-control-summary]")).to_contain_text(
                    "尚未設定對應 14")
                expect(page.locator("[data-sheet-context]")).to_have_count(4)
                expect(page.locator(
                    '[data-sheet-context="living-auto-water-robot"]'
                )).to_have_count(1)
                page.locator("#control-switch").select_option(switch_id)
                page.locator(
                    f'input[name="controlledLightIds"][value="{track_id}"]'
                ).check()
                page.locator(
                    f'input[name="controlledLightIds"][value="{light_id}"]'
                ).check()
                assert read(page, mode) == original, (
                    "Checkbox selection alone must not write a control relation"
                )
                page.locator("#control-relations-form button").click()
                # Current public item order places the living ceiling before the track.
                wait_for_assignment(
                    page, mode, switch_id, [light_id, track_id])
                first = read(page, mode)
                assert first["undo"] == snapshot(original)
                expect(page.locator("[data-control-light-id]")).to_have_count(2)
                for line in page.locator(".sheet-control-relation").all():
                    assert "非實際配管走線" in line.get_attribute("aria-label")

                if mode == "http":
                    outdated = json.loads(json.dumps(first, ensure_ascii=False))
                    for entry in outdated["items"]:
                        entry.pop("controlledLightIds", None)
                    outdated["expectedRevision"] = first["revision"]
                    response = page.request.put(
                        f"{url}api/state", data=outdated,
                    )
                    assert response.status == 400
                    assert "舊版" in response.json()["error"]
                    assert read(page, mode) == first

                page.locator("#control-switch").select_option(other_switch)
                page.locator(
                    f'input[name="controlledLightIds"][value="{light_id}"]'
                ).check()
                page.locator("#control-relations-form button").click()
                wait_for_assignment(page, mode, other_switch, [light_id])
                second = read(page, mode)
                assert second["undo"] == snapshot(first)
                expect(page.locator("[data-control-light-id]")).to_have_count(3)
                assert page.locator(".budget").inner_text() == budget
                assert second["rooms"] == normalized_source["rooms"]
                assert [entry for entry in second["items"]
                        if entry["id"] not in (switch_id, other_switch)] == [
                            entry for entry in normalized_source["items"]
                            if entry["id"] not in (switch_id, other_switch)]
                page.locator(".sheet-scroll").screenshot(
                    path=str(artifacts / f"{mode}-explicit-lines.png"))
                page.set_viewport_size({"width": 390, "height": 844})
                editor = page.locator(".control-editor")
                assert editor.evaluate(
                    "element => element.scrollWidth <= element.clientWidth")
                assert editor.bounding_box()["width"] <= 390
                editor.screenshot(
                    path=str(artifacts / f"{mode}-editor-mobile.png"))
                page.set_viewport_size({"width": 1280, "height": 1050})

                with page.expect_download() as download:
                    page.locator("#save-file").click()
                download.value.save_as(str(export_path))
                exported = json.loads(export_path.read_text(encoding="utf-8"))
                assert exported["formatVersion"] == 10
                assert snapshot(exported["state"]) == snapshot(second)
                page.reload()
                expect(page.locator(".overview-svg")).to_be_visible()
                assert read(page, mode) == second
                page.get_by_role("tab", name="燈具配置圖", exact=True).click()
                expect(page.locator("[data-control-light-id]")).to_have_count(3)
                page.locator("#undo-last").click()
                page.wait_for_function("""async mode => {
                    const state = mode === 'offline'
                        ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
                        : await fetch('/api/state').then(response => response.json());
                    return state.undo === null;
                }""", arg=mode)
                restored = read(page, mode)
                assert snapshot(restored) == snapshot(first)
                expect(page.locator("[data-control-light-id]")).to_have_count(2)

                page.get_by_role("tab", name="格局圖", exact=True).click()
                page.locator('[data-action="toggle-light-preview"]').click()
                expect(page.locator("[data-preview-light-id]")).to_have_count(2)
                page.locator(
                    f'[data-preview-item-id="{other_switch}"]').click()
                expect(page.locator("#save-status")).to_contain_text(
                    "尚未設定對應")
                expect(page.locator(".lighting-legend")).to_contain_text(
                    "已亮 16 組")
                before_preview = read(page, mode)
                page.locator(f'[data-preview-item-id="{switch_id}"]').click()
                expect(page.locator(".lighting-legend")).to_contain_text(
                    "已亮 14 組")
                assert read(page, mode) == before_preview
                page.locator(f'[data-preview-item-id="{light_id}"]').click()
                expect(page.locator(".lighting-legend")).to_contain_text(
                    "已亮 15 組")
                assert read(page, mode) == before_preview

                page.get_by_role("tab", name="開工行事曆", exact=True).click()
                expect(page.locator(".calendar-agenda li")).to_have_count(13)
                expect(page.locator(
                    '.calendar-agenda li:has('
                    '[data-calendar-event="construction-start"]) '
                    '.calendar-role'
                )).to_have_count(2)
                expect(page.locator(
                    '.calendar-agenda li:has('
                    '[data-calendar-event="construction-elevator-protection"]) '
                    '.calendar-roles-empty'
                )).to_have_count(1)
                layout = page.locator(
                    '.calendar-agenda li:has('
                    '[data-calendar-event="construction-layout"])'
                )
                expect(layout.locator(".calendar-role")).to_have_count(3)
                expect(layout.locator(".calendar-owner")).to_contain_text("屋主")
                assert "屋主、廚房工人、系統櫃工人" in page.locator(
                    '[data-calendar-event="construction-layout"].calendar-event'
                ).first.get_attribute("aria-label")
                assert len(read(page, mode)["constructionCalendar"]["events"]) == 13
                before_roles = read(page, mode)
                layout.locator(
                    '[data-calendar-event="construction-layout"]'
                ).click()
                form = page.locator("[data-calendar-form]")
                field = form.locator('[name="attendees"]')
                expect(field).to_have_value("屋主\n廚房工人\n系統櫃工人")
                field.fill(f"屋主{chr(51)}人")
                form.get_by_role("button", name="儲存工項").click()
                expect(page.locator(".calendar-error")).to_contain_text(
                    "不填人數")
                assert read(page, mode) == before_roles
                field.fill("屋主\n廚房工人")
                expect(form.locator(
                    ".calendar-role-preview .calendar-role")).to_have_count(2)
                assert read(page, mode) == before_roles
                form.get_by_role("button", name="儲存工項").click()
                page.wait_for_function("""async ({mode,revision}) => {
                    const state = mode === 'offline'
                        ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
                        : await fetch('/api/state').then(response => response.json());
                    return state.revision === revision &&
                        state.constructionCalendar.events.find(entry =>
                            entry.id === 'construction-layout')
                            .attendees.length === 2;
                }""", arg={"mode": mode,
                            "revision": before_roles["revision"] + 1})
                two_roles = read(page, mode)
                assert snapshot(two_roles) == snapshot(before_roles)
                assert two_roles["undo"] == before_roles["undo"]
                assert len(two_roles["constructionCalendar"]["undo"]) == 13
                assert next(entry for entry in two_roles[
                    "constructionCalendar"]["undo"] if entry["id"] ==
                    "construction-layout")["attendees"] == [
                        "屋主", "廚房工人", "系統櫃工人",
                    ]
                assert page.locator(".budget").inner_text() == budget

                if mode == "http":
                    old_writer = {**two_roles,
                        "expectedRevision": two_roles["revision"],
                        "controlRelationsVersion": 1,
                        "doorAllocationVersion": 1,
                        "robotFeatureVersion": 1,
                        "calendarFeatureVersion": 1}
                    response = page.request.put(
                        f"{url}api/state", data=old_writer,
                    )
                    assert response.status == 400
                    assert "出席角色" in response.json()["error"]
                    assert read(page, mode) == two_roles

                with page.expect_download() as download:
                    page.locator("[data-calendar-csv]").click()
                csv = Path(download.value.path()).read_text(
                    encoding="utf-8-sig")
                assert "誰要出席（預計角色）" in csv
                assert "屋主、廚房工人" in csv
                assert f"屋主{chr(51)}人" not in csv
                with page.expect_download() as download:
                    page.locator("#save-file").click()
                role_export = json.loads(Path(
                    download.value.path()).read_text(encoding="utf-8"))
                assert role_export["formatVersion"] == 10
                assert role_export["state"]["constructionCalendar"] == (
                    two_roles["constructionCalendar"])
                page.set_viewport_size({"width": 390, "height": 844})
                page.locator(".calendar-agenda").screenshot(
                    path=str(artifacts / f"{mode}-attendee-agenda-mobile.png")
                )
                page.set_viewport_size({"width": 1280, "height": 1050})
                page.reload()
                expect(page.locator(".overview-svg")).to_be_visible()
                assert read(page, mode) == two_roles
                page.get_by_role("tab", name="開工行事曆", exact=True).click()
                page.locator("[data-calendar-undo]").click()
                page.wait_for_function("""async ({mode,revision}) => {
                    const state = mode === 'offline'
                        ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
                        : await fetch('/api/state').then(response => response.json());
                    return state.revision === revision &&
                        state.constructionCalendar.undo === null;
                }""", arg={"mode": mode,
                            "revision": two_roles["revision"] + 1})
                restored_roles = read(page, mode)
                assert snapshot(restored_roles) == snapshot(before_roles)
                assert restored_roles["undo"] == before_roles["undo"]
                assert next(entry for entry in restored_roles[
                    "constructionCalendar"]["events"] if entry["id"] ==
                    "construction-layout")["attendees"] == [
                        "屋主", "廚房工人", "系統櫃工人",
                    ]

                older_calendar = deepcopy(restored_roles)
                older_calendar["constructionCalendar"]["version"] = 1
                older_calendar["constructionCalendar"]["events"] = [
                    {key: value for key, value in entry.items()
                     if key != "attendees"}
                    for entry in older_calendar["constructionCalendar"]["events"]
                ]
                older_calendar["constructionCalendar"]["undo"] = []
                page.locator("#load-file-input").set_input_files({
                    "name": "older-public-calendar-v1.json",
                    "mimeType": "application/json",
                    "buffer": json.dumps({
                        "format": "renovation-equipment-planner",
                        "formatVersion": 9, "state": older_calendar,
                    }, ensure_ascii=False).encode("utf-8"),
                })
                page.wait_for_function("""async ({mode,revision}) => {
                    const state = mode === 'offline'
                        ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
                        : await fetch('/api/state').then(response => response.json());
                    return state.revision === revision;
                }""", arg={"mode": mode,
                            "revision": restored_roles["revision"] + 1})
                preserved = read(page, mode)
                assert preserved["constructionCalendar"]["version"] == 2
                assert next(entry for entry in preserved[
                    "constructionCalendar"]["events"] if entry["id"] ==
                    "construction-layout")["attendees"] == [
                        "屋主", "廚房工人", "系統櫃工人",
                    ]
                assert snapshot(preserved) == snapshot(restored_roles)
                assert preserved["undo"] == restored_roles["undo"]
                assert errors == [], errors
                assert remote == [], remote
                context.close()

            context = browser.new_context()
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(portable)
            page.wait_for_function("Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
            page.locator("#load-file-input").set_input_files(str(export_path))
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(exported["state"])
            assert read(page, "offline")["undo"] == exported["state"]["undo"]
            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            expect(page.locator("[data-control-light-id]")).to_have_count(3)
            context.close()

            context = browser.new_context()
            previous = deepcopy(normalized_source)
            del previous["constructionCalendar"]
            previous["revision"] = 700
            next(entry for entry in previous["items"] if entry["id"] ==
                 "balcony-water-heater")["note"] += " 本機未匯出修改。"
            context.add_init_script(script=f"""
                if (location.protocol === 'file:' &&
                    !localStorage.getItem('test-seeded')) {{
                    localStorage.setItem(
                        'renovation-equipment-offline-v1:' + location.pathname,
                        JSON.stringify({json.dumps(previous, ensure_ascii=False)}));
                    localStorage.setItem('test-seeded', '1');
                }}
            """)
            page = context.new_page()
            page.goto(portable)
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(previous)
            keys = page.evaluate("""() => ({
                old:'renovation-equipment-offline-v1:' + location.pathname,
                controls:'renovation-equipment-offline-controls-v1:' + location.pathname,
                doors:'renovation-equipment-offline-doors-v1:' + location.pathname,
                robot:'renovation-equipment-offline-robot-v1:' + location.pathname,
                calendar:'renovation-equipment-offline-calendar-v1:' + location.pathname,
                next:'renovation-equipment-offline-calendar-attendees-v1:' + location.pathname,
            })""")
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                keys["old"]) == previous
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["controls"]) is None
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["doors"]) is None
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["robot"]) is None
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["calendar"]) is None
            copied = page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))", keys["next"])
            assert snapshot(copied) == snapshot(previous)
            assert "constructionCalendar" not in read(page, "offline")
            page.evaluate(
                "({key,state}) => localStorage.setItem(key,JSON.stringify(state))",
                {"key": keys["old"], "state": source},
            )
            page.reload()
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(previous), (
                "Old rollback key must never overwrite the isolated new cache"
            )
            page.on("dialog", lambda dialog: dialog.accept())
            page.locator("#load-file-input").set_input_files(str(source_path))
            page.wait_for_function("""async () =>
                (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                    .revision === 701""")
            imported = read(page, "offline")
            assert imported["undo"] == snapshot(previous)
            assert imported["constructionCalendar"]["version"] == 2
            assert next(entry for entry in imported["constructionCalendar"]
                        ["events"] if entry["id"] == "construction-layout")[
                            "attendees"] == ["屋主", "廚房工人", "系統櫃工人"]
            page.locator("#undo-last").click()
            page.wait_for_function("""async () =>
                (await globalThis.__RENOVATION_OFFLINE_STORE__.read())
                    .revision === 702""")
            assert snapshot(read(page, "offline")) == snapshot(previous)
            for bad_value in ("broken-json", ""):
                page.evaluate(
                    "({key,value}) => localStorage.setItem(key,value)",
                    {"key": keys["next"], "value": bad_value},
                )
                page.reload()
                expect(page.locator("#save-status")).to_contain_text(
                    "暫存資料無法驗證")
            context.close()

            context = browser.new_context()
            old_rollback = deepcopy(normalized_source)
            del old_rollback["constructionCalendar"]
            old_rollback["revision"] = 710
            controls_save = deepcopy(normalized_source)
            del controls_save["constructionCalendar"]
            controls_save["revision"] = 711
            next(entry for entry in controls_save["items"] if
                 entry["id"] == switch_id)["controlledLightIds"] = [track_id]
            context.add_init_script(script=f"""
                if (location.protocol === 'file:' &&
                    !localStorage.getItem('test-priority-seeded')) {{
                    localStorage.setItem(
                        'renovation-equipment-offline-v1:' + location.pathname,
                        JSON.stringify({json.dumps(old_rollback, ensure_ascii=False)}));
                    localStorage.setItem(
                        'renovation-equipment-offline-controls-v1:' + location.pathname,
                        JSON.stringify({json.dumps(controls_save, ensure_ascii=False)}));
                    localStorage.setItem('test-priority-seeded', '1');
                }}
            """)
            page = context.new_page()
            page.goto(portable)
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(controls_save)
            assert read(page, "offline")["revision"] == 711
            page.get_by_role("tab", name="燈具配置圖", exact=True).click()
            expect(page.locator("[data-control-light-id]")).to_have_count(1)
            control_key = page.evaluate(
                "'renovation-equipment-offline-controls-v1:' + location.pathname")
            attendees_key = page.evaluate(
                "'renovation-equipment-offline-calendar-attendees-v1:' + location.pathname")
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                control_key) == controls_save
            assert snapshot(page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                attendees_key)) == snapshot(controls_save)
            page.evaluate(
                "({key,state}) => localStorage.setItem(key,JSON.stringify(state))",
                {"key": control_key, "state": old_rollback},
            )
            page.reload()
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(controls_save), (
                "Existing attendee cache must outrank the older controls cache"
            )
            context.close()

            context = browser.new_context(accept_downloads=True)
            doors_save = deepcopy(normalized_source)
            del doors_save["constructionCalendar"]
            doors_save["items"] = [entry for entry in doors_save["items"]
                                   if entry["id"] != "living-auto-water-robot"]
            doors_save["revision"] = 712
            older_controls = deepcopy(doors_save)
            older_controls["revision"] = 713
            next(entry for entry in older_controls["items"] if entry["id"] ==
                 switch_id)["controlledLightIds"] = [light_id]
            older_legacy = deepcopy(doors_save)
            older_legacy["revision"] = 714
            context.add_init_script(script=f"""
                if (location.protocol === 'file:' &&
                    !localStorage.getItem('test-door-priority-seeded')) {{
                    localStorage.setItem(
                        'renovation-equipment-offline-doors-v1:' + location.pathname,
                        JSON.stringify({json.dumps(doors_save, ensure_ascii=False)}));
                    localStorage.setItem(
                        'renovation-equipment-offline-controls-v1:' + location.pathname,
                        JSON.stringify({json.dumps(older_controls, ensure_ascii=False)}));
                    localStorage.setItem(
                        'renovation-equipment-offline-v1:' + location.pathname,
                        JSON.stringify({json.dumps(older_legacy, ensure_ascii=False)}));
                    localStorage.setItem('test-door-priority-seeded', '1');
                }}
            """)
            page = context.new_page()
            page.goto(portable)
            expect(page.locator(".overview-svg")).to_be_visible()
            saved_door_plan = read(page, "offline")
            assert saved_door_plan["revision"] == 712
            assert len(saved_door_plan["items"]) == 181
            assert not any(entry["id"] == "living-auto-water-robot"
                           for entry in saved_door_plan["items"])
            expect(page.locator("[data-robot-legend]")).to_have_count(0)
            copied = page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                page.evaluate(
                    "'renovation-equipment-offline-calendar-attendees-v1:' + location.pathname"))
            assert snapshot(copied) == snapshot(saved_door_plan)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            assert json.loads(Path(download.value.path()).read_text(
                encoding="utf-8"))["formatVersion"] == 7
            page.evaluate("""() => {
                const key = 'renovation-equipment-offline-doors-v1:' +
                    location.pathname;
                const edited = JSON.parse(localStorage.getItem(key));
                edited.revision = 888;
                localStorage.setItem(key, JSON.stringify(edited));
            }""")
            page.reload()
            expect(page.locator(".overview-svg")).to_be_visible()
            assert read(page, "offline")["revision"] == 712
            context.close()

            context = browser.new_context(accept_downloads=True)
            old_calendar = deepcopy(normalized_source)
            old_calendar["revision"] = 715
            old_calendar["constructionCalendar"]["version"] = 1
            old_calendar["constructionCalendar"]["events"] = [
                {key: value for key, value in entry.items()
                 if key != "attendees"}
                for entry in old_calendar["constructionCalendar"]["events"]
                if entry["id"] != "construction-elevator-protection"
            ]
            old_calendar["constructionCalendar"]["undo"] = []
            old_robot = deepcopy(old_calendar)
            old_robot["revision"] = 716
            del old_robot["constructionCalendar"]
            context.add_init_script(script=f"""
                if (location.protocol === 'file:' &&
                    !localStorage.getItem('calendar-attendee-test-seeded')) {{
                    localStorage.setItem(
                        'renovation-equipment-offline-calendar-v1:' +
                        location.pathname,
                        JSON.stringify({json.dumps(old_calendar, ensure_ascii=False)}));
                    localStorage.setItem(
                        'renovation-equipment-offline-robot-v1:' +
                        location.pathname,
                        JSON.stringify({json.dumps(old_robot, ensure_ascii=False)}));
                    localStorage.setItem('calendar-attendee-test-seeded', '1');
                }}
            """)
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(portable)
            expect(page.locator(".overview-svg")).to_be_visible()
            saved_calendar = read(page, "offline")
            assert saved_calendar["revision"] == 715
            assert saved_calendar["constructionCalendar"]["version"] == 1
            assert all("attendees" not in entry for entry in
                       saved_calendar["constructionCalendar"]["events"])
            attendee_key = page.evaluate(
                "'renovation-equipment-offline-calendar-attendees-v1:' + location.pathname")
            prior_key = page.evaluate(
                "'renovation-equipment-offline-calendar-v1:' + location.pathname")
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                prior_key) == old_calendar
            copied = page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                attendee_key)
            assert copied["constructionCalendar"]["version"] == 1
            assert snapshot(copied) == snapshot(saved_calendar)
            page.get_by_role("tab", name="開工行事曆", exact=True).click()
            expect(page.locator(".calendar-owner")).to_have_count(0)
            expect(page.locator(".calendar-roles-empty")).to_have_count(12)
            with page.expect_download() as download:
                page.locator("#save-file").click()
            assert json.loads(Path(
                download.value.path()).read_text(
                encoding="utf-8"))["formatVersion"] == 9
            page.locator(
                '.calendar-agenda [data-calendar-event="construction-layout"]'
            ).click()
            page.locator('[data-calendar-form] [name="attendees"]').fill("屋主")
            page.locator(
                '[data-calendar-form] button[type="submit"]').click()
            page.wait_for_function("""async () => {
                const state = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
                return state.revision === 716 &&
                    state.constructionCalendar.version === 2 &&
                    state.constructionCalendar.events.find(entry =>
                        entry.id === 'construction-layout')
                        .attendees[0] === '屋主';
            }""")
            promoted = read(page, "offline")
            assert snapshot(promoted) == snapshot(saved_calendar)
            assert promoted["undo"] == saved_calendar["undo"]
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                prior_key) == old_calendar
            with page.expect_download() as download:
                page.locator("#save-file").click()
            assert json.loads(Path(
                download.value.path()).read_text(
                encoding="utf-8"))["formatVersion"] == 10
            page.evaluate(
                """({key,state}) => localStorage.setItem(key,JSON.stringify(state))""",
                {"key": prior_key, "state": old_robot},
            )
            page.reload()
            expect(page.locator(".overview-svg")).to_be_visible()
            assert read(page, "offline")["revision"] == 716
            page.evaluate(
                "key => localStorage.setItem(key,'{broken')",
                attendee_key,
            )
            page.reload()
            expect(page.locator("#save-status")).to_contain_text(
                "暫存資料無法驗證")
            assert page.evaluate(
                "key => localStorage.getItem(key)",
                attendee_key) == "{broken"
            context.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)

assert source_path.read_bytes() == raw
print("PASS: isolated HTTP and offline Edge explicit controls, "
      "role edits/Undo/JSON9→10, no remote requests, attendee/older cache priority")
