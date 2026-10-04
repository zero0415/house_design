"""Capture read-only, physical-width layout metrics on every planner tab."""

import argparse
import hashlib
import json
import os
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from threading import Thread
from urllib.parse import quote, unquote, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "files" / "設備規劃.json"
PORTABLE = ROOT / "portable" / "裝修設備規劃.html"
SAMPLE_SHA256 = (
    "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4"
)
TABS = (
    "plan", "outlet-sheet", "lighting-sheet", "survey",
    "room", "database", "device", "calendar",
)
WIDTHS = (320, 360, 390, 430)

METRICS = """() => {
    const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {x: Math.round(box.x), y: Math.round(box.y + scrollY),
            width: Math.round(box.width), height: Math.round(box.height)};
    };
    const visible = (node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 &&
            node.checkVisibility({checkVisibilityCSS: true});
    };
    const tabs = document.querySelector(".tabs");
    const buttons = [...tabs.querySelectorAll("button")];
    const svg = document.querySelector("#content svg.overview-svg");
    const glyphs = svg ? [...svg.querySelectorAll("text")]
        .filter(visible).map(node =>
            Math.round(node.getBoundingClientRect().height))
        .filter(height => height > 0).sort((a, b) => a - b) : [];
    const controls = [...document.querySelectorAll(
        "#content button,#content summary,#content a,#content [role=button]," +
        ".toolbar button,.toolbar a,.tabs button"
    )].filter(visible).map(node => ({
        height: Math.round(node.getBoundingClientRect().height),
        width: Math.round(node.getBoundingClientRect().width),
        label: (node.getAttribute("aria-label") ||
            node.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 42),
        svg: Boolean(node.closest("svg")),
    }));
    const inputs = [...document.querySelectorAll(
        "#content input:not([type=hidden]),#content select,#content textarea"
    )].filter(visible).map(node => ({
        font: parseFloat(getComputedStyle(node).fontSize),
        height: Math.round(node.getBoundingClientRect().height),
        name: node.name || node.dataset.field || node.id || "",
    }));
    const budget = [...document.querySelectorAll(".budget > div")]
        .filter(visible).map(node => ({
            label: node.querySelector("span")?.textContent.trim(),
            amount: node.querySelector("strong")?.textContent.trim(),
            height: Math.round(node.getBoundingClientRect().height),
        }));
    const overview = document.querySelector(".plan-overview");
    const diagram = overview?.querySelector(".overview-pan") || svg;
    const beforeSvg = overview ? [...overview.children]
        .slice(0, [...overview.children].indexOf(diagram))
        .map(node => ({
            tag: node.tagName.toLowerCase(),
            className: String(node.className || "").slice(0, 80),
            height: Math.round(node.getBoundingClientRect().height),
            visible: visible(node),
            label: (node.textContent || "").trim().replace(/\\s+/g, " ")
                .slice(0, 52),
        })) : [];
    const root = document.documentElement;
    return {
        viewport: innerWidth, visual: visualViewport.width,
        docWidth: root.scrollWidth, bodyWidth: document.body.scrollWidth,
        masthead: rect(document.querySelector(".masthead")),
        budget: rect(document.querySelector(".budget")),
        tabs: rect(tabs), toolbar: rect(document.querySelector(".toolbar")),
        content: rect(document.querySelector("#content")),
        overview: rect(svg),
        overviewGlyphCount: glyphs.length,
        overviewGlyphMedian: glyphs.length
            ? glyphs[Math.floor(glyphs.length / 2)] : null,
        tabsRows: new Set(buttons.map(node =>
            Math.round(node.getBoundingClientRect().top))).size,
        tabsScrollWidth: tabs.scrollWidth,
        tabsClientWidth: tabs.clientWidth,
        targets: {count: controls.length,
            under44: controls.filter(control => control.height < 44).length,
            htmlUnder44: controls.filter(control =>
                !control.svg && control.height < 44).length,
            svgUnder44: controls.filter(control =>
                control.svg && control.height < 44).length,
            smallSamples: controls.filter(control =>
                control.height < 44).slice(0, 8)},
        inputs: {count: inputs.length,
            under16: inputs.filter(input => input.font < 16).length,
            under44: inputs.filter(input => input.height < 44).length,
            smallSamples: inputs.filter(input =>
                input.font < 16).slice(0, 8)},
        budgetValues: budget, beforeSvg,
    };
}"""


class PagesHandler(SimpleHTTPRequestHandler):
    def translate_path(self, raw):
        route = urlsplit(raw).path
        if not route.startswith("/house_design/"):
            return str(ROOT / "__not_found__")
        parts = PurePosixPath(unquote(route[len("/house_design/"):])).parts
        if any(part in {"..", ".git"} for part in parts):
            return str(ROOT / "__not_found__")
        return str(ROOT.joinpath(*parts))

    def log_message(self, _format, *_args):
        pass


def audit(page, context, url, source, phase, directory, width):
    errors, blocked, external = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def get_only(route):
        request = route.request
        if request.method != "GET":
            blocked.append(f"{request.method} {request.url}")
            route.abort()
        elif source == "live" and request.url.startswith(("http:", "https:")) and \
                not request.url.startswith(url):
            external.append(request.url)
            route.abort()
        else:
            route.continue_()

    page.route("**/*", get_only)
    page.goto(url if source != "offline" else PORTABLE.as_uri(),
              wait_until="domcontentloaded", timeout=30_000)
    if source != "offline":
        page.wait_for_url("**/portable/*demo=pages*", timeout=30_000)
    else:
        page.wait_for_function(
            "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)",
            timeout=30_000,
        )
        page.locator("#load-file-input").set_input_files(str(SAMPLE))
    page.wait_for_function(
        "document.querySelector('#quote-baseline')?.textContent"
        "?.includes('1,959,530')",
        timeout=30_000,
    )
    cdp = context.new_cdp_session(page)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": 844, "mobile": True,
        "deviceScaleFactor": 1,
    })
    page.wait_for_function(
        "width => innerWidth === width && visualViewport.width === width",
        arg=width,
    )
    state = page.evaluate("globalThis.__RENOVATION_OFFLINE_STORE__.read()")
    assert (state["version"], state["revision"], state["undo"],
            len(state["items"]), len(state["constructionCalendar"]["events"])
            ) == (5, 0, None, 182, 13)
    page.evaluate("""() => {
        window.__auditWrites = [];
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (...args) {
            window.__auditWrites.push('storage:' + args[0]);
            return set.apply(this, args);
        };
        const store = globalThis.__RENOVATION_OFFLINE_STORE__;
        const update = store.update;
        store.update = function (...args) {
            window.__auditWrites.push('store.update');
            return update.apply(this, args);
        };
    }""")
    result = {"firstFold": page.evaluate(METRICS), "tabs": {}}
    page.evaluate("scrollTo({top: 0, behavior: 'instant'})")
    page.screenshot(path=str(directory / f"{phase}-{source}-{width}-first-fold.png"))
    for view in TABS:
        page.locator(f'.tabs [data-view="{view}"]').click()
        if view == "room":
            entry = page.locator("details.equipment").first
            if entry.count() and entry.get_attribute("open") is None:
                entry.locator("summary.item-summary").first.click(
                    position={"x": 36, "y": 16})
        if view == "device":
            group = page.locator(
                "details.grouped-device-group > summary.group-head").first
            if group.count() and group.evaluate(
                    "node => !node.parentElement.open"):
                group.click()
        page.evaluate(
            "document.querySelector('.tabs').scrollIntoView("
            "{block: 'start', behavior: 'instant'})")
        result["tabs"][view] = page.evaluate(METRICS)
        page.screenshot(
            path=str(directory / f"{phase}-{source}-{width}-{view}.png"))
        if view == "plan":
            svg = page.locator(".plan-overview svg.overview-svg")
            if svg.count():
                svg.scroll_into_view_if_needed()
                page.screenshot(path=str(
                    directory / f"{phase}-{source}-{width}-plan-svg.png"))
    page.locator('.tabs [data-view="plan"]').click()
    result["focusedRooms"] = {}
    for room in ("bath-main", "living-dining", "kitchen"):
        zone = page.locator(
            f'.overview-svg .plan-zone[data-select-room="{room}"]')
        if zone.count():
            zone.click()
        else:
            page.locator("[data-plan-room-select]").select_option(room)
        result["focusedRooms"][room] = page.locator(
            ".plan-detail .room-svg").evaluate("""node => {
            const detail = node.closest('.plan-detail');
            const region = node.closest(
                '.room-plan-scroll,.platform-scroll');
            const labels = [...node.querySelectorAll('text')]
                .map(text => Math.round(
                    text.getBoundingClientRect().height))
                .filter(height => height > 0).sort((a, b) => a - b);
            return {
                diagramFromRoomTop: Math.round(
                    node.getBoundingClientRect().top -
                    detail.getBoundingClientRect().top),
                diagramWidth: Math.round(
                    node.getBoundingClientRect().width),
                glyphMedian: labels[Math.floor(labels.length / 2)],
                contained: Boolean(region),
                regionScrollWidth: region?.scrollWidth ?? null,
                regionClientWidth: region?.clientWidth ?? null,
                pageWidth: document.documentElement.scrollWidth,
            };
        }""")
        page.evaluate(
            "document.querySelector('.plan-detail').scrollIntoView("
            "{block: 'start', behavior: 'instant'})")
        page.screenshot(path=str(
            directory / f"{phase}-{source}-{width}-focused-{room}.png"))
    assert not errors and not blocked and not external, \
        (width, errors, blocked, external)
    assert page.evaluate("window.__auditWrites") == []
    assert page.evaluate(
        "globalThis.__RENOVATION_OFFLINE_STORE__.read()") == state
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("live", "pages", "offline"),
                        required=True)
    parser.add_argument("--phase", choices=("before", "after"),
                        required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    raw = SAMPLE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SAMPLE_SHA256
    assert args.source != "live" or args.phase == "before"
    args.artifacts.mkdir(parents=True, exist_ok=True)
    chrome = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / \
        "Google" / "Chrome" / "Application" / "chrome.exe"
    assert chrome.is_file(), "Chrome not installed"
    server = None
    thread = None
    if args.source == "pages":
        server = ThreadingHTTPServer(("127.0.0.1", 0), PagesHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/house_design/"
    elif args.source == "live":
        url = "https://zero0415.github.io/house_design/"
        sample_url = url + "files/" + quote("設備規劃.json")
        request = urllib.request.Request(sample_url, headers={
            "Cache-Control": "no-cache",
            "Accept-Encoding": "identity",
        })
        with urllib.request.urlopen(request, timeout=25) as response:
            assert hashlib.sha256(response.read()).hexdigest() == \
                SAMPLE_SHA256, "Live Pages sample no longer matches f2ec"
    else:
        url = PORTABLE.as_uri()
    report = {
        "source": args.source, "phase": args.phase,
        "sampleSha256": hashlib.sha256(raw).hexdigest(),
        "widths": {},
    }
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=str(chrome), headless=True)
            try:
                for width in WIDTHS:
                    context = browser.new_context(
                        viewport={"width": width, "height": 844},
                        has_touch=True,
                    )
                    try:
                        report["widths"][str(width)] = audit(
                            context.new_page(), context, url, args.source,
                            args.phase, args.artifacts, width,
                        )
                    finally:
                        context.close()
                    row = report["widths"][str(width)]
                    print(json.dumps({
                        "width": width,
                        "budgetHeight": row["firstFold"]["budget"]["height"],
                        "tabsY": row["firstFold"]["tabs"]["y"],
                        "tabRows": row["firstFold"]["tabsRows"],
                        "planSvgY": row["firstFold"]["overview"]["y"],
                        "fitGlyphMedianPx": row["firstFold"]
                        ["overviewGlyphMedian"],
                        "overflowPxByTab": {
                            name: tab["docWidth"] - width
                            for name, tab in row["tabs"].items()
                        },
                        "targetsUnder44ByTab": {
                            name: {
                                "html": tab["targets"]["htmlUnder44"],
                                "fitSvg": tab["targets"]["svgUnder44"],
                            }
                            for name, tab in row["tabs"].items()
                        },
                        "inputsUnder16ByTab": {
                            name: tab["inputs"]["under16"]
                            for name, tab in row["tabs"].items()
                        },
                        "focusedRooms": row["focusedRooms"],
                    }, ensure_ascii=False))
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    path = args.artifacts / f"{args.phase}-{args.source}-metrics.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    print(json.dumps({
        "artifact": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "screenshots": len(list(args.artifacts.glob(
            f"{args.phase}-{args.source}-*.png"))),
        "stateWrites": 0,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
