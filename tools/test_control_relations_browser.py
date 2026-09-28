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
                assert exported["formatVersion"] == 8
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
                next:'renovation-equipment-offline-robot-v1:' + location.pathname,
            })""")
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                keys["old"]) == previous
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["controls"]) is None
            assert page.evaluate(
                "key => localStorage.getItem(key)", keys["doors"]) is None
            copied = page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))", keys["next"])
            assert snapshot(copied) == snapshot(previous)
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
            old_rollback["revision"] = 710
            controls_save = deepcopy(normalized_source)
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
            robot_key = page.evaluate(
                "'renovation-equipment-offline-robot-v1:' + location.pathname")
            assert page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                control_key) == controls_save
            assert snapshot(page.evaluate(
                "key => JSON.parse(localStorage.getItem(key))",
                robot_key)) == snapshot(controls_save)
            page.evaluate(
                "({key,state}) => localStorage.setItem(key,JSON.stringify(state))",
                {"key": control_key, "state": old_rollback},
            )
            page.reload()
            expect(page.locator(".overview-svg")).to_be_visible()
            assert snapshot(read(page, "offline")) == snapshot(controls_save), (
                "Existing robot cache must outrank the older controls cache"
            )
            context.close()

            context = browser.new_context(accept_downloads=True)
            doors_save = deepcopy(normalized_source)
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
                    "'renovation-equipment-offline-robot-v1:' + location.pathname"))
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
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)

assert source_path.read_bytes() == raw
print("PASS: isolated HTTP and offline Edge explicit controls, "
      "Undo, export, no remote requests, robot/doors/controls cache priority")
