from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
extension = root / "extension"
version = json.loads((extension / "manifest.json").read_text())["version"]
out = root / "dist" / f"yeyu-v{version}.zip"
out.parent.mkdir(exist_ok=True)
allowed = {"app.js", "core.js", "background.js", "offscreen.js", "offscreen.html", "newtab.html", "style.css", "manifest.json"}
icons = {f"icons/icon-{size}.png" for size in (16, 32, 48, 128)}
icons.add("icons/logo.svg")
with ZipFile(out, "w", ZIP_DEFLATED) as bundle:
    for name in sorted(allowed | icons):
        bundle.write(extension / name, "extension/" + name)
print(out)
