"""Bundle the planner and its generated schematics into one offline HTML."""

import json
import posixpath
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extensions" / "renovation-equipment"
ASSETS = EXTENSION / "assets"
OUTPUT = ROOT / "portable" / "裝修設備規劃.html"
IMPORT = re.compile(r"""\bfrom\s+["'](\.[^"']+)["']""")
MEDIA = re.compile(
    r"""<\s*(?:img|image)\b|data:image/|(?:^|[/"'(\s])[\w./-]+\.(?:png|jpe?g|pdf)\b""",
    re.IGNORECASE,
)


def reject_media(name, source):
    if MEDIA.search(source):
        raise ValueError(f"Offline source references an image or document: {name}")


def build_modules():
    modules = {
        f"assets/{path.name}": path.read_text(encoding="utf-8")
        for path in ASSETS.glob("*.js")
    }
    state = (EXTENSION / "state.mjs").read_text(encoding="utf-8")
    node_imports = (
        'import { randomUUID } from "node:crypto";',
        'import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";',
        'import { dirname } from "node:path";',
    )
    lines = state.splitlines()
    if tuple(lines[:3]) != node_imports or "export function createStore(" not in state:
        raise ValueError("The state validator changed; review its browser-safe extraction.")
    modules["state-browser.mjs"] = "\n".join(lines[3:]).split(
        "export function createStore(", 1
    )[0]
    for name, source in modules.items():
        reject_media(name, source)
    ordered = []
    visiting = set()
    visited = set()

    def include(name):
        if name in visiting:
            raise ValueError(f"Cyclic ES module dependency: {name}")
        if name in visited:
            return
        if name not in modules:
            raise FileNotFoundError(f"Missing offline module: {name}")
        visiting.add(name)
        for specifier in IMPORT.findall(modules[name]):
            dependency = posixpath.normpath(
                posixpath.join(posixpath.dirname(name), specifier)
            )
            include(dependency)
        if re.search(r"\bimport\s*\(", modules[name]):
            raise ValueError(f"Dynamic import needs explicit offline handling: {name}")
        visiting.remove(name)
        visited.add(name)
        ordered.append({"path": name, "source": modules[name]})

    include("state-browser.mjs")
    include("assets/app.js")
    return ordered


def build():
    bundle = json.dumps(
        {"modules": build_modules()},
        ensure_ascii=False, separators=(",", ":"),
    ).replace("<", "\\u003c")
    html = (ASSETS / "index.html").read_text(encoding="utf-8")
    reject_media("index.html", html)
    css = (ASSETS / "style.css").read_text(encoding="utf-8")
    reject_media("style.css", css)
    bootstrap = (ROOT / "tools" / "portable-bootstrap.js").read_text(encoding="utf-8")
    reject_media("portable-bootstrap.js", bootstrap)
    stylesheet = '<link rel="stylesheet" href="/style.css">'
    script = '<script type="module" src="/app.js"></script>'
    if html.count(stylesheet) != 1 or html.count(script) != 1:
        raise ValueError("Planner HTML asset tags changed; review the portable bundle.")
    html = html.replace(
        stylesheet,
        f"<style>\n{css}\n</style>",
    )
    html = html.replace(
        script,
        '<script id="portable-bundle" type="application/json">' +
        bundle + '</script>\n<script type="module">\n' + bootstrap + "\n</script>",
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(html.encode("utf-8"))
    print(f"Built {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    build()
