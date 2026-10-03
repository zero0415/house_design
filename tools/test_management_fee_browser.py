"""Exercise the public fee candidate in isolated HTTP and file:// Edge sessions."""

import csv
import hashlib
import json
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from queue import Queue
from threading import Thread

from playwright.sync_api import expect, sync_playwright


if len(sys.argv) != 3:
    raise SystemExit(
        "Usage: python tools\\test_management_fee_browser.py "
        "<node.exe> <artifact-directory>"
    )
root = Path(__file__).resolve().parents[1]
node = sys.argv[1]
artifacts = Path(sys.argv[2]).resolve()
artifacts.mkdir(parents=True, exist_ok=True)
sample_path = root / "files" / "設備規劃.json"
sample_bytes = sample_path.read_bytes()
assert hashlib.sha256(sample_bytes).hexdigest() == (
    "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4"
)
sample = json.loads(sample_bytes)
assert (sample["revision"], sample["undo"],
        len(sample["constructionCalendar"]["events"]),
        sample["managementCleaningFee"]["fee"]) == (
            0, None, 13,
            {"start": "2026-10-13", "end": "2027-01-30",
             "dailyRate": 100},
        )

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
const code = await readFile(join(extensionDirectory, 'extension.mjs'), 'utf8');
const start = runInNewContext(
    code.slice(code.indexOf('const assets = new Map('),
        code.indexOf('await joinSession(')) + '\nstartServer',
    { createServer, readFile, join, resolve, URL, Buffer, process,
        StoreError, store, extensionDirectory, filesDirectory });
const { server, url } = await start('isolated-public-fee');
console.log(url);
process.stdin.once('data', () => server.close(() => process.exit(0)));
"""


def read(page, mode):
    return page.evaluate(
        "() => globalThis.__RENOVATION_OFFLINE_STORE__.read()"
        if mode == "offline" else
        "() => fetch('/api/state').then(response => response.json())"
    )


def wait_revision(page, mode, revision):
    page.wait_for_function("""async ({mode, revision}) => {
        const state = mode === 'offline'
            ? await globalThis.__RENOVATION_OFFLINE_STORE__.read()
            : await fetch('/api/state').then(response => response.json());
        return state.revision === revision;
    }""", arg={"mode": mode, "revision": revision}, timeout=15000)


def protected(state):
    return {key: state[key] for key in (
        "rooms", "items", "products", "undo", "constructionCalendar"
    )}


def write(page, mode, state):
    return page.evaluate("""async ({mode, state}) => {
        if (mode === 'offline') {
            try {
                await globalThis.__RENOVATION_OFFLINE_STORE__.update(state);
                return 200;
            } catch (error) {
                return error.conflict ? 409 : 400;
            }
        }
        const response = await fetch('/api/state', {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(state),
        });
        return response.status;
    }""", {"mode": mode, "state": state})


with tempfile.TemporaryDirectory(prefix="public-fee-", dir=artifacts) as directory:
    temp = Path(directory)
    isolated_state = temp / "state.json"
    isolated_state.write_bytes(sample_bytes)
    server = subprocess.Popen(
        [node, "--input-type=module", "-e", server_script,
         str(isolated_state)],
        cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    try:
        announcements = Queue()
        reader = Thread(target=lambda: announcements.put(
            server.stdout.readline()), daemon=True)
        reader.start()
        reader.join(timeout=20)
        if reader.is_alive():
            raise TimeoutError("Isolated public fee server did not start")
        url = announcements.get().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError(f"Unexpected isolated server URL: {url}")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            try:
                for mode in ("http", "offline"):
                    context = browser.new_context(
                        viewport={"width": 1280, "height": 960},
                        has_touch=True, accept_downloads=True,
                    )
                    try:
                        page = context.new_page()
                        errors, remote, puts = [], [], []
                        page.on("pageerror", lambda error:
                                errors.append(str(error)))
                        page.on("request", lambda request:
                                puts.append(request.url)
                                if request.method == "PUT" else None)
                        page.on("request", lambda request:
                                remote.append(request.url)
                                if request.url.startswith(("http:", "https:")) and
                                not request.url.startswith(url) else None)
                        page.on("dialog", lambda dialog: dialog.accept())
                        page.goto(url if mode == "http" else
                                  (root / "portable" /
                                   "裝修設備規劃.html").as_uri())
                        if mode == "offline":
                            page.wait_for_function(
                                "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
                            page.locator("#load-file-input").set_input_files(
                                str(sample_path))
                        expect(page.locator(".overview-svg")).to_be_visible()
                        original = read(page, mode)
                        self_fee = original["managementCleaningFee"]
                        assert len(original["items"]) == 182
                        assert len(original["constructionCalendar"]["events"]) == 13
                        expect(page.locator("#overall-total")).to_have_text(
                            "NT$2,333,060.2")
                        assert page.locator(
                            "#management-fee-budget").is_visible()
                        assert "NT$11,000" in page.locator(
                            "#management-fee-total").inner_text()
                        page.get_by_role(
                            "tab", name="開工行事曆", exact=True).click()
                        expect(page.locator(
                            ".management-fee-summary")).to_contain_text(
                                "110 個日曆日（含 15 個週日）")
                        cache_before = page.evaluate(
                            "JSON.stringify(localStorage)")
                        page.evaluate("""() => {
                            window.__feeViewWrites = [];
                            const setItem = Storage.prototype.setItem;
                            Storage.prototype.setItem = function(...args) {
                                window.__feeViewWrites.push(args[0]);
                                return setItem.apply(this, args);
                            };
                            const store = globalThis.__RENOVATION_OFFLINE_STORE__;
                            if (store) {
                                const update = store.update;
                                store.update = function(...args) {
                                    window.__feeViewWrites.push('store.update');
                                    return update.apply(this, args);
                                };
                            }
                        }""")
                        page.locator("[data-calendar-expand]").click()
                        expect(page.locator(
                            "[data-calendar-month-view]")).to_have_count(4)
                        page.locator("[data-fee-edit]").click()
                        form = page.locator("[data-fee-form]")
                        cdp = context.new_cdp_session(page)
                        for width in (1280, 320, 360, 390, 430):
                            page.set_viewport_size({
                                "width": width, "height": 960})
                            cdp.send("Emulation.setDeviceMetricsOverride", {
                                "width": width, "height": 960,
                                "deviceScaleFactor": 1,
                                "mobile": width < 600,
                            })
                            page.wait_for_function(
                                "w => innerWidth === w && "
                                "visualViewport.width === w", arg=width)
                            result = page.evaluate("""() => ({
                                document: document.documentElement.scrollWidth,
                                body: document.body.scrollWidth,
                                inputs: [...document.querySelectorAll(
                                    '[data-fee-form] input')].map(node => ({
                                        font: parseFloat(getComputedStyle(node).fontSize),
                                        height: node.getBoundingClientRect().height,
                                    })),
                                buttons: [...document.querySelectorAll(
                                    '.management-fee button')].map(node =>
                                    node.getBoundingClientRect().height),
                            })""")
                            assert result["document"] == result["body"] == width
                            assert all(row["font"] >= 16 and
                                       row["height"] >= 44
                                       for row in result["inputs"])
                            assert all(height >= 44 for height in result["buttons"])
                            if width in (1280, 320, 390):
                                page.locator(".management-fee").screenshot(
                                    path=str(artifacts /
                                             f"pristine-{mode}-edge-fee-{width}.png"))
                                page.locator(".budget").screenshot(
                                    path=str(artifacts /
                                             f"pristine-{mode}-edge-budget-{width}.png"))
                        cdp.send("Emulation.clearDeviceMetricsOverride")
                        page.set_viewport_size({"width": 1280, "height": 960})
                        assert read(page, mode) == original
                        assert page.evaluate(
                            "JSON.stringify(localStorage)") == cache_before
                        assert page.evaluate("window.__feeViewWrites") == []
                        assert not puts
                        if mode == "http":
                            assert isolated_state.read_bytes() == sample_bytes
                        form.locator("[data-fee-cancel]").click()
                        with page.expect_download() as download:
                            page.locator("[data-fee-csv]").click()
                        rows = list(csv.reader(Path(download.value.path())
                                               .read_text(encoding="utf-8-sig")
                                               .splitlines()))
                        assert len(rows) == 2
                        assert rows[1][1:8] == [
                            "管委會", "2026-10-13", "2027-01-30",
                            "110", "15", "100", "11000",
                        ]
                        page.locator("[data-fee-edit]").click()
                        form = page.locator("[data-fee-form]")
                        form.locator('[name="start"]').fill("2026-10-25")
                        form.locator('[name="end"]').fill("2026-10-26")
                        form.locator('[name="dailyRate"]').fill("100.25")
                        expect(form.locator(
                            ".fee-live-preview")).to_contain_text(
                                "2 個日曆日（含 1 個週日）")
                        assert read(page, mode) == original
                        form.get_by_role(
                            "button", name="儲存清潔費").click()
                        wait_revision(page, mode, original["revision"] + 1)
                        changed = read(page, mode)
                        assert protected(changed) == protected(original)
                        assert changed["managementCleaningFee"]["undo"]["fee"] == (
                            self_fee["fee"])
                        expect(page.locator("#overall-total")).to_have_text(
                            "NT$2,322,260.7")
                        expect(page.locator(
                            "#management-fee-total")).to_have_text(
                                "NT$200.5")
                        page.locator("[data-fee-undo]").click()
                        wait_revision(page, mode, changed["revision"] + 1)
                        restored = read(page, mode)
                        assert restored["managementCleaningFee"]["fee"] == (
                            self_fee["fee"])
                        assert restored["managementCleaningFee"]["undo"] is None
                        assert protected(restored) == protected(original)
                        expect(page.locator("#overall-total")).to_have_text(
                            "NT$2,333,060.2")
                        with page.expect_download() as download:
                            page.locator("#save-file").click()
                        saved = json.loads(Path(download.value.path())
                                           .read_text(encoding="utf-8"))
                        assert saved["formatVersion"] == 11
                        assert saved["state"]["managementCleaningFee"] == (
                            restored["managementCleaningFee"])

                        old10 = {
                            "format": "renovation-equipment-planner",
                            "formatVersion": 10,
                            "state": {key: value for key, value in original.items()
                                      if key != "managementCleaningFee"},
                        }
                        page.locator("#load-file-input").set_input_files({
                            "name": "prior-public-calendar-v10.json",
                            "mimeType": "application/json",
                            "buffer": json.dumps(old10,
                                                 ensure_ascii=False).encode(),
                        })
                        wait_revision(page, mode, restored["revision"] + 1)
                        imported = read(page, mode)
                        assert imported["managementCleaningFee"] == (
                            restored["managementCleaningFee"])
                        assert imported["constructionCalendar"] == (
                            original["constructionCalendar"])
                        assert imported["undo"] == original["undo"]
                        caps = dict(controlRelationsVersion=1,
                                    doorAllocationVersion=1,
                                    robotFeatureVersion=1,
                                    calendarFeatureVersion=1,
                                    calendarAttendeesVersion=1,
                                    managementFeeVersion=1)
                        state = {**imported, **caps,
                                 "expectedRevision": imported["revision"]}
                        assert write(page, mode, {
                            **state,
                            "expectedRevision": imported["revision"] - 1,
                            "managementFeeVersion": None,
                        }) == 409
                        assert write(page, mode, {
                            **state, "managementFeeVersion": None,
                        }) == 400
                        absent = deepcopy(state)
                        del absent["managementCleaningFee"]
                        assert write(page, mode, absent) == 400
                        assert read(page, mode) == imported
                        page.get_by_role(
                            "tab", name="開工行事曆", exact=True).click()
                        page.locator("[data-fee-edit]").click()
                        draft = page.locator("[data-fee-form]")
                        draft.locator('[name="dailyRate"]').fill("150")
                        external = deepcopy(imported)
                        external["managementCleaningFee"] = {
                            "version": 1,
                            "fee": {
                                **imported["managementCleaningFee"]["fee"],
                                "dailyRate": 125,
                            },
                            "undo": {
                                "fee": imported["managementCleaningFee"]["fee"],
                            },
                        }
                        assert write(page, mode, {
                            **external, **caps,
                            "expectedRevision": imported["revision"],
                        }) == 200
                        draft.get_by_role(
                            "button", name="儲存清潔費").click()
                        expect(page.locator(
                            ".management-fee-error")).not_to_be_empty()
                        expect(page.locator(
                            '[data-fee-form] [name="dailyRate"]'
                        )).to_have_value("150")
                        conflicting = read(page, mode)
                        assert conflicting["managementCleaningFee"] == (
                            external["managementCleaningFee"])
                        assert protected(conflicting) == protected(imported)
                        page.locator("#reload").click()
                        expect(page.locator(
                            "[data-fee-form]")).to_have_count(0)
                        expect(page.locator(
                            "#management-fee-total")).to_have_text(
                                "NT$13,750")
                        page.locator("[data-fee-undo]").click()
                        wait_revision(page, mode, conflicting["revision"] + 1)
                        assert read(page, mode)["managementCleaningFee"]["fee"] == (
                            self_fee["fee"])
                        assert not errors and not remote, (errors, remote)
                        print(
                            f"PASS {mode}: 110 days/15 Sundays/11,000; "
                            "read-only views, fee Undo/CSV/JSON11, stale draft, "
                            "old10 preservation, stale409-before-400, "
                            "1280/320/360/390/430; no external requests",
                            flush=True,
                        )
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        if server.poll() is None:
            server.stdin.write("stop\n")
            server.stdin.flush()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                subprocess.run([
                    "powershell", "-NoProfile", "-Command",
                    f"Stop-Process -Id {server.pid} -Force",
                ], check=False)
        assert sample_path.read_bytes() == sample_bytes
