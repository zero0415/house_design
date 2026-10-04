"""Exercise view-only mobile navigation, zoom, scrolling and form usability."""

import argparse
import hashlib
import json
import os
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

from test_mobile_layout_browser import PagesHandler, PORTABLE, ROOT, SAMPLE


WIDTHS = (320, 360, 390, 430)
SAMPLE_SHA256 = (
    "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4"
)


def selected(page):
    return page.locator('.tabs [aria-selected="true"]').get_attribute(
        "data-view")


def mobile_context(browser, width, reduced_motion=False):
    return browser.new_context(
        viewport={"width": width, "height": 844}, has_touch=True,
        reduced_motion="reduce" if reduced_motion else "no-preference",
    )


def set_physical_width(context, page, width):
    cdp = context.new_cdp_session(page)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": 844,
        "deviceScaleFactor": 1, "mobile": True,
    })
    page.wait_for_function(
        "width => innerWidth === width && "
        "visualViewport.width === width",
        arg=width,
    )
    return cdp


def touch(cdp, x, y, dx, dy=4):
    cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart",
        "touchPoints": [{"x": x, "y": y, "id": 19}],
    })
    for part in (.22, .48, .75, 1):
        cdp.send("Input.dispatchTouchEvent", {
            "type": "touchMove",
            "touchPoints": [{
                "x": x + dx * part,
                "y": y + dy * part, "id": 19,
            }],
        })
    cdp.send("Input.dispatchTouchEvent", {
        "type": "touchEnd", "touchPoints": [],
    })


def synthetic_swipe(page, selector, dx=130, dy=4, x=40, multitouch=False):
    return page.evaluate("""({selector, dx, dy, x, multitouch}) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error("Missing swipe target " + selector);
        const point = (id, px, py) => new Touch({
            identifier: id, target, clientX: px, clientY: py,
        });
        const dispatch = (name, touches, changed) =>
            target.dispatchEvent(new TouchEvent(name, {
                bubbles: true, cancelable: true, touches,
                targetTouches: touches, changedTouches: changed,
            }));
        let first = point(19, x, 340);
        if (multitouch) {
            const other = point(20, x + 15, 340);
            dispatch("touchstart", [first, other], [first, other]);
            first = point(19, x + dx, 340 + dy);
            dispatch("touchmove", [first, other], [first]);
            dispatch("touchend", [other], [first]);
        } else {
            dispatch("touchstart", [first], [first]);
            first = point(19, x + dx, 340 + dy);
            dispatch("touchmove", [first], [first]);
            dispatch("touchend", [], [first]);
        }
        return document.querySelector('.tabs [aria-selected="true"]')
            .dataset.view;
    }""", {
        "selector": selector, "dx": dx, "dy": dy,
        "x": x, "multitouch": multitouch,
    })


def mobile_controls(page, width):
    metrics = page.evaluate("""() => {
        const visible = node => {
            const rect = node.getBoundingClientRect();
            return rect.width && rect.height &&
                node.checkVisibility({checkVisibilityCSS: true});
        };
        const controls = [...document.querySelectorAll(
            '#content button,#content summary,#content a,' +
            '.toolbar button,.toolbar a,.tabs button,#previous-tab'
        )].filter(visible).map(node => ({
            label: (node.getAttribute('aria-label') ||
                node.textContent || '').trim().replace(/\\s+/g, ' ')
                .slice(0, 45),
            height: node.getBoundingClientRect().height,
            right: node.getBoundingClientRect().right,
            nestedScroll: Boolean(node.closest(
                '.tabs,.room-nav,.calendar-scroll,.sheet-scroll,' +
                '.survey-scroll,.overview-pan,.reference-scroll'
            )),
        }));
        const inputs = [...document.querySelectorAll(
            '#content input:not([type=hidden]):not([type=checkbox]),' +
            '#content select,#content textarea'
        )].filter(visible).map(node => ({
            font: parseFloat(getComputedStyle(node).fontSize),
            height: node.getBoundingClientRect().height,
            right: node.getBoundingClientRect().right,
        }));
        const tabs = document.querySelector('.tabs');
        return {
            doc: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            inner: innerWidth, visual: visualViewport.width,
            tabRows: new Set([...tabs.querySelectorAll('button')]
                .map(node => Math.round(
                    node.getBoundingClientRect().top))).size,
            tabScroll: tabs.scrollWidth,
            tabClient: tabs.clientWidth,
            smallControls: controls.filter(node => node.height < 44),
            offscreenControls: controls.filter(node =>
                !node.nestedScroll && node.right > innerWidth + 1),
            smallInputs: inputs.filter(node => node.font < 16 ||
                node.height < 44),
            offscreenInputs: inputs.filter(node => node.right >
                innerWidth + 1),
        };
    }""")
    assert metrics["inner"] == metrics["visual"] == width
    assert metrics["doc"] == metrics["body"] == width, metrics
    assert metrics["tabRows"] == 1
    assert metrics["tabScroll"] > metrics["tabClient"]
    assert not metrics["smallControls"], metrics
    assert not metrics["smallInputs"], metrics
    assert not metrics["offscreenInputs"], metrics
    assert not metrics["offscreenControls"], metrics
    return metrics


def zoom_and_pan(page, context, cdp, width, screenshots):
    pane = page.locator(".overview-pan")
    svg = pane.locator(".overview-svg")
    before = svg.evaluate(
        "node => ({box:node.getAttribute('viewBox'),"
        " markup:node.outerHTML})")
    button = page.get_by_role("button", name="放大閱讀")
    assert button.is_visible()
    assert button.get_attribute("aria-pressed") == "false"
    button.click()
    expect(page.get_by_role(
        "button", name="縮回全圖")).to_have_attribute("aria-pressed", "true")
    scale = svg.evaluate("""node => {
        const lengths = [...node.querySelectorAll('text')]
            .map(text => Math.round(
                text.getBoundingClientRect().height))
            .filter(height => height > 0).sort((a, b) => a - b);
        const container = node.closest('.overview-pan');
        return {
            median: lengths[Math.floor(lengths.length / 2)],
            width: node.getBoundingClientRect().width,
            viewportWidth: container.clientWidth,
            scrollWidth: container.scrollWidth,
            scrollHeight: container.scrollHeight,
            viewBox: node.getAttribute('viewBox'),
        };
    }""")
    assert scale["median"] >= 12, (width, scale)
    assert 950 <= scale["width"] <= 1050, scale
    assert scale["scrollWidth"] > scale["viewportWidth"], scale
    assert scale["viewBox"] == before["box"]
    assert svg.evaluate("node => node.outerHTML") == before["markup"]
    initial = pane.evaluate("""node => {
        const bounds = node.getBoundingClientRect();
        const left = bounds.left + node.clientLeft;
        const top = bounds.top + node.clientTop;
        const right = left + node.clientWidth;
        const bottom = top + node.clientHeight;
        const candidates = [...node.querySelectorAll('.plan-zone')]
            .map(zone => {
                const label = zone.querySelector('.plan-zone-label');
                const floor = zone.querySelector('.zone-floor');
                if (!label || !floor) return null;
                const area = floor.getBBox();
                return {label, floor, room: zone.dataset.selectRoom,
                    size: area.width * area.height};
            }).filter(Boolean).sort((a, b) => b.size - a.size);
        const anchor = candidates[0];
        if (!anchor) throw new Error('Reading mode has no room labels');
        const text = anchor.label.getBoundingClientRect();
        const floor = anchor.floor.getBoundingClientRect();
        return {
            room: anchor.room, label: anchor.label.textContent.trim(),
            fullyVisibleLabel: text.width >= 32 && text.height >= 12 &&
                text.left >= left - 1 && text.right <= right + 1 &&
                text.top >= top - 1 && text.bottom <= bottom + 1,
            visibleFloorWidth: Math.max(0,
                Math.min(floor.right, right) - Math.max(floor.left, left)),
            visibleFloorHeight: Math.max(0,
                Math.min(floor.bottom, bottom) - Math.max(floor.top, top)),
            scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
            maxScrollLeft: node.scrollWidth - node.clientWidth,
            maxScrollTop: node.scrollHeight - node.clientHeight,
        };
    }""")
    assert initial["fullyVisibleLabel"], (width, initial)
    assert initial["visibleFloorWidth"] > 100, (width, initial)
    assert initial["visibleFloorHeight"] > 180, (width, initial)
    assert 0 < initial["scrollLeft"] < initial["maxScrollLeft"], initial
    assert 0 < initial["scrollTop"] < initial["maxScrollTop"], initial
    if screenshots and width in (320, 390):
        pane.screenshot(path=str(
            screenshots / f"{width}-reading-mode-viewport.png"))
    page.locator('.tabs [data-view="room"]').click()
    page.locator("#previous-tab").click()
    assert selected(page) == "plan"
    assert page.get_by_role(
        "button", name="縮回全圖").get_attribute("aria-pressed") == "true"
    assert pane.evaluate("node => ({left:node.scrollLeft, top:node.scrollTop})") == {
        "left": initial["scrollLeft"], "top": initial["scrollTop"],
    }
    pane.scroll_into_view_if_needed()
    pane.evaluate("""node => {
        node.scrollIntoView({block: 'center', behavior: 'instant'});
        node.scrollLeft = 0;
        node.scrollTop = 290;
    }""")
    box = pane.bounding_box()
    px = round(box["x"] + box["width"] / 2)
    py = round(box["y"] + box["height"] / 2)
    assert page.evaluate("""({x, y}) =>
        document.elementFromPoint(x, y)?.closest('.overview-pan') ===
        document.querySelector('.overview-pan')""",
                         {"x": px, "y": py}), (width, box, px, py)
    page.mouse.move(px, py)
    page.mouse.wheel(0, 240)
    page.wait_for_function("""() =>
        document.querySelector('.overview-pan').scrollTop > 310""",
        timeout=8_000)
    pane.evaluate(
        "node => {node.scrollLeft = 300; node.scrollTop = 280}")
    box = pane.bounding_box()
    x = max(85, round(box["x"] + 64))
    y = round(box["y"] + min(160, box["height"] / 3))
    touch(cdp, x, y, 118, 8)
    page.wait_for_function("""() =>
        document.querySelector('.overview-pan').scrollLeft < 290""",
        timeout=8_000)
    assert selected(page) == "plan"
    assert page.evaluate(
        "document.documentElement.scrollWidth") == width
    page.get_by_role("button", name="縮回全圖").click()
    fit = pane.evaluate("""node => ({
        left: node.scrollLeft, top: node.scrollTop,
        svgWidth: node.querySelector('svg').getBoundingClientRect().width,
        viewport: node.clientWidth,
    })""")
    assert fit["left"] == fit["top"] == 0
    assert fit["svgWidth"] <= fit["viewport"] + 1
    assert svg.evaluate("node => node.outerHTML") == before["markup"]
    return scale["median"], initial


def verify_navigation(page, cdp, width):
    previous = page.locator("#previous-tab")
    assert previous.is_visible() and previous.is_disabled()
    history_before = page.evaluate("history.length")
    page.evaluate("""() => {
        window.__browserBackCalls = 0;
        window.__popstates = 0;
        const back = history.back.bind(history);
        history.back = (...args) => {
            window.__browserBackCalls++;
            return back(...args);
        };
        window.addEventListener('popstate', () => window.__popstates++);
    }""")
    for target in ("room", "calendar"):
        page.locator(f'.tabs [data-view="{target}"]').click()
    assert selected(page) == "calendar"
    assert previous.get_attribute("title").startswith("返回依房間")
    summary = page.locator(".management-fee-summary")
    summary.scroll_into_view_if_needed()
    box = summary.bounding_box()
    x, y = 40, round(box["y"] + min(17, box["height"] / 3))
    assert box["x"] < x < box["x"] + box["width"]
    touch(cdp, x, y, 130, 5)
    page.wait_for_function("""() =>
        document.querySelector('.tabs [aria-selected="true"]')
            .dataset.view === 'room'""")
    assert previous.get_attribute("title").startswith("返回格局圖")
    previous.focus()
    previous.press("Space")
    assert selected(page) == "plan" and previous.is_disabled()

    for target in ("device", "calendar"):
        page.locator(f'.tabs [data-view="{target}"]').click()
    assert selected(page) == "calendar"
    for selector, options in (
        (".tabs", {}),
        (".calendar-scroll", {}),
        (".management-fee-summary", {"dx": 12, "dy": 140}),
        (".management-fee-summary", {"x": 3}),
        (".management-fee-summary", {"multitouch": True}),
    ):
        assert synthetic_swipe(page, selector, **options) == "calendar"
    summary = page.locator(".management-fee-summary")
    summary.scroll_into_view_if_needed()
    box = summary.bounding_box()
    start_y = round(box["y"] + min(17, box["height"] / 3))
    before_vertical = page.evaluate("scrollY")
    touch(cdp, 40, start_y, 10, -135)
    assert selected(page) == "calendar"
    page.wait_for_function(
        "start => scrollY > start", arg=before_vertical,
        timeout=8_000,
    )
    page.locator("[data-fee-edit]").click()
    assert synthetic_swipe(
        page, '[data-fee-form] [name="dailyRate"]') == "calendar"
    page.locator("[data-fee-cancel]").click()
    scroll = page.locator(".calendar-scroll").first
    scroll.scroll_into_view_if_needed()
    scroll.evaluate("node => node.scrollLeft = 160")
    box = scroll.bounding_box()
    x = 40
    y = max(135, min(680, round(box["y"] + box["height"] / 2)))
    assert page.evaluate("""({x, y}) =>
        document.elementFromPoint(x, y)?.closest('.calendar-scroll') ===
            document.querySelector('.calendar-scroll')""",
                         {"x": x, "y": y}), (width, box, x, y)
    touch(cdp, x, y, 110)
    assert selected(page) == "calendar"
    assert scroll.evaluate("node => node.scrollLeft") < 160
    assert previous.get_attribute("title").startswith("返回已放置物件清單")
    previous.click()
    assert selected(page) == "device"
    previous.click()
    assert selected(page) == "plan" and previous.is_disabled()

    page.locator('[data-view="room"]').click()
    page.locator('[data-view="plan"]').click()
    page.locator('[data-action="toggle-overview-reading"]').click()
    pane = page.locator(".overview-pan")
    pane.scroll_into_view_if_needed()
    pane.evaluate("node => node.scrollLeft = 200")
    assert synthetic_swipe(page, ".overview-pan") == "plan"
    box = pane.bounding_box()
    x, y = 40, max(135, min(680, round(
        box["y"] + box["height"] / 2)))
    assert page.evaluate("""({x, y}) =>
        document.elementFromPoint(x, y)?.closest('.overview-pan') ===
            document.querySelector('.overview-pan')""",
                         {"x": x, "y": y}), (width, box, x, y)
    touch(cdp, x, y, 110)
    assert selected(page) == "plan"
    assert pane.evaluate("node => node.scrollLeft") < 200
    page.locator('[data-action="toggle-overview-reading"]').click()
    page.locator(
        '.overview-svg .plan-zone[data-select-room="bath-main"]'
    ).click()
    marker = page.locator('.room-svg .room-marker').first
    assert marker.count()
    assert synthetic_swipe(page, ".room-svg .room-marker") == "plan"
    page.locator('[data-view="survey"]').click()
    assert synthetic_swipe(page, ".survey-scroll") == "survey"
    page.locator('[data-view="outlet-sheet"]').click()
    assert synthetic_swipe(page, ".sheet-scroll") == "outlet-sheet"
    assert page.evaluate("window.__browserBackCalls") == 0
    assert page.evaluate("window.__popstates") == 0
    assert page.evaluate("history.length") == history_before
    return {"positivePhysicalSwipes": 1,
            "physicalScrollExclusions": 3, "syntheticExclusions": 10}


def verify_top_button(page, width, reduced_motion, screenshots):
    page.locator('[data-view="calendar"]').click()
    scroll = page.locator(".calendar-scroll").first
    scroll.evaluate("node => node.scrollLeft = 145")
    original_horizontal = scroll.evaluate("node => node.scrollLeft")
    page.evaluate("window.scrollTo({top: 1700, behavior: 'instant'})")
    page.wait_for_function("scrollY > 1200")
    page.wait_for_function(
        "document.querySelector('#back-to-top')"
        "?.getBoundingClientRect().height >= 48")
    button = page.locator("#back-to-top")
    assert button.is_visible()
    rect = button.bounding_box()
    assert rect["width"] >= 44 and rect["height"] >= 44
    assert rect["x"] >= 0 and rect["x"] + rect["width"] <= width
    assert rect["y"] + rect["height"] <= 844
    if screenshots and width in (320, 390):
        page.screenshot(path=str(
            screenshots / f"{width}-back-to-top.png"))
    page.evaluate("""() => {
        const scrollTo = window.scrollTo.bind(window);
        window.__topBehaviors = [];
        window.scrollTo = (...args) => {
            window.__topBehaviors.push(args[0]?.behavior ?? "legacy");
            return scrollTo(...args);
        };
    }""")
    button.focus()
    button.press("Enter")
    page.wait_for_function("scrollY <= 2", timeout=8_000)
    assert page.evaluate(
        "document.activeElement.id") == "planner-title"
    if reduced_motion:
        assert page.evaluate("window.__topBehaviors.at(-1)") == "instant"
    assert scroll.evaluate("node => node.scrollLeft") == \
        original_horizontal
    assert button.is_hidden()
    return rect


def focused_room_readability(page, cdp, width, screenshots):
    page.locator('[data-view="plan"]').click()
    if page.locator("[data-plan-room-select]").count():
        page.locator("[data-plan-room-select]").select_option("kitchen")
    else:
        page.locator(
            '.overview-svg .plan-zone[data-select-room="kitchen"]'
        ).click()
    pane = page.locator(".room-plan-scroll")
    svg = pane.locator(".room-svg")
    result = svg.evaluate("""node => {
        const room = node.closest('.plan-detail');
        const region = node.closest('.room-plan-scroll');
        const labels = [...node.querySelectorAll('text')].map(entry =>
            Math.round(entry.getBoundingClientRect().height))
            .filter(height => height > 0).sort((a, b) => a - b);
        return {
            median: labels[Math.floor(labels.length / 2)],
            width: node.getBoundingClientRect().width,
            diagramFromRoomTop: node.getBoundingClientRect().top -
                room.getBoundingClientRect().top,
            clientWidth: region.clientWidth,
            scrollWidth: region.scrollWidth,
            viewBox: node.getAttribute('viewBox'),
        };
    }""")
    assert result["median"] >= 12, (width, result)
    assert result["width"] >= 720, (width, result)
    assert result["diagramFromRoomTop"] < 500, (width, result)
    assert result["scrollWidth"] > result["clientWidth"]
    assert page.evaluate("document.documentElement.scrollWidth") == width
    if screenshots and width in (320, 390):
        pane.screenshot(path=str(
            screenshots / f"{width}-kitchen-focused-readable.png"))
    pane.scroll_into_view_if_needed()
    pane.evaluate("node => node.scrollLeft = 180")
    point = page.evaluate("""() => {
        const region = document.querySelector('.room-plan-scroll');
        const box = region.getBoundingClientRect();
        for (const y of [box.top + 200, box.top + 270, box.top + 120]) {
            if (y < 130 || y > innerHeight - 110) continue;
            for (const x of [box.left + 40, box.left + 80,
                box.left + 130]) {
                const node = document.elementFromPoint(x, y);
                if (node?.closest('.room-plan-scroll') === region &&
                    !node.closest('.room-marker,[data-action],' +
                        '.detail-outdoor-ac')) return {x, y};
            }
        }
        return null;
    }""")
    assert point is not None, (width, pane.bounding_box())
    x, y = round(point["x"]), round(point["y"])
    touch(cdp, x, y, 92)
    page.wait_for_function("""() =>
        document.querySelector('.room-plan-scroll').scrollLeft < 170""",
        timeout=8_000)
    assert selected(page) == "plan"
    return result


def test_case(browser, channel, mode, width, base, screenshots):
    reduced_motion = width == 320
    context = mobile_context(browser, width, reduced_motion)
    try:
        page = context.new_page()
        errors, external, forbidden = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())

        def guard(route):
            request = route.request
            if request.method != "GET":
                forbidden.append(f"{request.method} {request.url}")
                route.abort()
            elif request.url.startswith(("http:", "https:")) and \
                    not request.url.startswith(base):
                external.append(request.url)
                route.abort()
            else:
                route.continue_()

        page.route("**/*", guard)
        page.goto(base if mode == "http" else PORTABLE.as_uri(),
                  wait_until="domcontentloaded", timeout=30_000)
        if mode == "http":
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
        cdp = set_physical_width(context, page, width)
        state = page.evaluate(
            "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
        cache = page.evaluate("JSON.stringify(localStorage)")
        assert (state["version"], state["revision"], state["undo"],
                len(state["rooms"]), len(state["items"]),
                len(state["products"])) == (
                    5, 1 if mode == "offline" else 0, None, 13, 182, 28)
        assert len(state["constructionCalendar"]["events"]) == 13
        assert state["managementCleaningFee"]["fee"]["dailyRate"] == 100
        page.evaluate("""() => {
            window.__viewWrites = [];
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function (...args) {
                window.__viewWrites.push(args[0]);
                return set.apply(this, args);
            };
            const store = globalThis.__RENOVATION_OFFLINE_STORE__;
            const update = store.update;
            store.update = function (...args) {
                window.__viewWrites.push('store.update');
                return update.apply(this, args);
            };
        }""")
        median, initial = zoom_and_pan(page, context, cdp, width, screenshots)
        navigation = verify_navigation(page, cdp, width)
        top = verify_top_button(page, width, reduced_motion, screenshots)
        kitchen = focused_room_readability(
            page, cdp, width, screenshots)
        tabs = {}
        for view in ("plan", "outlet-sheet", "lighting-sheet",
                     "survey", "room", "database", "device", "calendar"):
            page.locator(f'.tabs [data-view="{view}"]').click()
            if view == "room":
                page.locator(
                    "details.equipment > summary.item-summary").first.click()
                form = page.locator(".equipment[open] .item-editor").first
                expect(form).to_be_visible()
            if view == "database":
                page.locator('[data-action="edit-product"]').first.click()
                expect(page.locator("#product-form")).to_be_visible()
                tabs["database:editing"] = mobile_controls(page, width)
                page.locator('[data-action="cancel-product-form"]').click()
            if view == "device":
                group = page.locator(
                    ".grouped-device-group > summary.group-head").first
                group.click()
                page.locator(
                    ".grouped-device-group[open] " +
                    "details.equipment > summary.item-summary").first.click()
                tabs["device:editing"] = mobile_controls(page, width)
            if view == "calendar":
                page.locator("[data-fee-edit]").click()
                expect(page.locator("[data-fee-form]")).to_be_visible()
                tabs["calendar:fee"] = mobile_controls(page, width)
                page.locator("[data-fee-cancel]").click()
                page.locator(
                    '.calendar-agenda [data-calendar-event="construction-layout"]'
                ).click()
                expect(page.locator("[data-calendar-form]")).to_be_visible()
                tabs["calendar:event"] = mobile_controls(page, width)
                page.locator("[data-calendar-cancel]").click()
                tabs[view] = mobile_controls(page, width)
            else:
                tabs[view] = mobile_controls(page, width)
        assert page.evaluate(
            "globalThis.__RENOVATION_OFFLINE_STORE__.read()") == state
        assert page.evaluate("JSON.stringify(localStorage)") == cache
        assert page.evaluate("window.__viewWrites") == []
        assert not forbidden and not external and not errors, \
            (mode, width, forbidden, external, errors)
        result = {
            "browser": channel, "mode": mode,
            "width": width, "planReadingGlyphMedian": median,
            "initialReadingViewport": initial,
            "focusedKitchenGlyphMedian": kitchen["median"],
            "focusedRoomDiagramWithinPx": round(
                kitchen["diagramFromRoomTop"]),
            "tabRows": tabs["plan"]["tabRows"],
            "targetUnder44": sum(len(row["smallControls"])
                                 for row in tabs.values()),
            "inputsUnder16": sum(len(row["smallInputs"])
                                 for row in tabs.values()),
            "positiveAndNegativeGestures": navigation,
            "topButton": {key: round(value, 1)
                          for key, value in top.items()},
            "writeCount": 0,
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result
    finally:
        context.close()


def test_desktop_and_resize(browser, channel, mode, base):
    context = browser.new_context(viewport={"width": 1280, "height": 960})
    try:
        page = context.new_page()
        errors, blocked = [], []
        page.on("dialog", lambda dialog: dialog.accept())
        page.on("pageerror", lambda error: errors.append(str(error)))

        def get_only(route):
            if route.request.method != "GET":
                blocked.append(route.request.method)
                route.abort()
            else:
                route.continue_()

        page.route("**/*", get_only)
        page.goto(base if mode == "http" else PORTABLE.as_uri(),
                  wait_until="domcontentloaded")
        if mode == "http":
            page.wait_for_url("**/portable/*demo=pages*")
        else:
            page.wait_for_function(
                "Boolean(globalThis.__RENOVATION_OFFLINE_STORE__)")
            page.locator("#load-file-input").set_input_files(str(SAMPLE))
        page.wait_for_function(
            "document.querySelector('#quote-baseline')?.textContent"
            "?.includes('1,959,530')")
        state = page.evaluate(
            "globalThis.__RENOVATION_OFFLINE_STORE__.read()")
        stored = page.evaluate("JSON.stringify(localStorage)")
        page.evaluate("""() => {
            window.__resizeWrites = [];
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function(...args) {
                window.__resizeWrites.push(args[0]);
                return set.apply(this, args);
            };
            const store = globalThis.__RENOVATION_OFFLINE_STORE__;
            const update = store.update;
            store.update = function(...args) {
                window.__resizeWrites.push("store.update");
                return update.apply(this, args);
            };
        }""")
        assert page.locator("#previous-tab").is_hidden()
        assert page.locator("#back-to-top").is_hidden()
        assert page.locator(
            '[data-action="toggle-overview-reading"]').is_hidden()
        assert page.locator(".overview-svg").evaluate(
            "node => node.getBoundingClientRect().width") == 600
        assert page.locator(
            '.plan-display-actions [data-action="toggle-plan-layer"]'
        ).count() == 4
        assert page.locator(
            '.plan-display-actions [data-action="toggle-plan-source"]'
        ).is_visible()
        assert page.locator(
            ".masthead-background").get_attribute("open") is not None
        assert page.locator("#overall-note").evaluate(
            "node => Boolean(node.closest('.budget .overall-total'))")
        assert page.locator("#management-fee-note").evaluate(
            "node => Boolean(node.closest('.budget #management-fee-budget'))")
        assert page.locator("#overall-note").is_visible()

        cdp = context.new_cdp_session(page)
        page.set_viewport_size({"width": 390, "height": 844})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844,
            "deviceScaleFactor": 1, "mobile": True,
        })
        page.wait_for_function(
            "innerWidth === 390 && visualViewport.width === 390")
        page.wait_for_function("""() =>
            document.querySelector('.masthead-background').open === false &&
            document.querySelector('#overall-note').closest(
                '.mobile-budget-details') !== null""")
        assert page.locator("#previous-tab").is_visible()
        assert page.locator(
            '[data-action="toggle-overview-reading"]').is_visible()
        assert page.evaluate(
            "document.documentElement.scrollWidth") == 390
        page.set_viewport_size({"width": 1280, "height": 960})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 960,
            "deviceScaleFactor": 1, "mobile": False,
        })
        page.wait_for_function(
            "innerWidth === 1280 && visualViewport.width === 1280")
        page.wait_for_function("""() =>
            document.querySelector('.masthead-background').open === true &&
            document.querySelector('#overall-note').closest(
                '.budget .overall-total') !== null""")
        assert page.locator("#overall-note").is_visible()
        assert page.locator("#previous-tab").is_hidden()
        assert page.locator("#back-to-top").is_hidden()
        page.set_viewport_size({"width": 390, "height": 844})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844,
            "deviceScaleFactor": 1, "mobile": True,
        })
        page.wait_for_function(
            "innerWidth === 390 && visualViewport.width === 390")
        page.locator('[data-view="calendar"]').click()
        page.locator("[data-fee-edit]").click()
        field = page.locator('[data-fee-form] [name="dailyRate"]')
        field.fill("150")
        page.set_viewport_size({"width": 1280, "height": 960})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 960,
            "deviceScaleFactor": 1, "mobile": False,
        })
        page.wait_for_function(
            "innerWidth === 1280 && visualViewport.width === 1280")
        expect(field).to_have_value("150")
        page.set_viewport_size({"width": 390, "height": 844})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844,
            "deviceScaleFactor": 1, "mobile": True,
        })
        page.wait_for_function(
            "innerWidth === 390 && visualViewport.width === 390")
        expect(field).to_have_value("150")
        page.locator("[data-fee-cancel]").click()
        page.set_viewport_size({"width": 1280, "height": 960})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 1280, "height": 960,
            "deviceScaleFactor": 1, "mobile": False,
        })
        page.wait_for_function(
            "innerWidth === 1280 && visualViewport.width === 1280")
        assert page.evaluate(
            "globalThis.__RENOVATION_OFFLINE_STORE__.read()") == state
        assert page.evaluate("JSON.stringify(localStorage)") == stored
        assert page.evaluate("window.__resizeWrites") == []
        assert not errors and not blocked, (channel, mode, errors, blocked)
        result = {
            "browser": channel, "mode": mode,
            "desktopRestoredAt1280": True, "mobileCollapsedAt390": True,
            "unsavedFeeDraftSurvivedBreakpoint": True,
            "sampleWrites": 0,
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    assert hashlib.sha256(SAMPLE.read_bytes()).hexdigest() == SAMPLE_SHA256
    args.artifacts.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), PagesHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}/house_design/"
    report = {"publicSampleSha256": SAMPLE_SHA256,
              "physicalMobileRuns": [], "breakpointRuns": []}
    try:
        with sync_playwright() as playwright:
            for channel in ("chrome", "msedge"):
                browser = playwright.chromium.launch(
                    channel=channel, headless=True)
                try:
                    for mode in ("http", "offline"):
                        for width in WIDTHS:
                            screenshots = args.artifacts / "interactions" / \
                                f"{channel}-{mode}"
                            if width in (320, 390):
                                screenshots.mkdir(parents=True, exist_ok=True)
                            report["physicalMobileRuns"].append(test_case(
                                browser, channel, mode, width, base,
                                screenshots if width in (320, 390) else None,
                            ))
                        report["breakpointRuns"].append(
                            test_desktop_and_resize(
                                browser, channel, mode, base))
                finally:
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert hashlib.sha256(SAMPLE.read_bytes()).hexdigest() == SAMPLE_SHA256
    path = args.artifacts / "interaction-metrics.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    print(json.dumps({
        "interactionMetrics": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "mobileCases": len(report["physicalMobileRuns"]),
        "desktopBreakpointCases": len(report["breakpointRuns"]),
    }, ensure_ascii=False))
    print("PASS: Chrome/Edge isolated HTTP/file physical 320/360/390/430, "
          "contained pan, visited tab gestures and exclusions, back to top, "
          "forms, safety and zero view writes")


if __name__ == "__main__":
    main()
