import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");
const manifest = JSON.parse(
  await fs.readFile(path.join(extension, "manifest.json"), "utf8"),
);
assert.equal(manifest.manifest_version, 3);
const allowed = new Set([
  "app.js",
  "background.js",
  "core.js",
  "offscreen.js",
  "offscreen.html",
  "newtab.html",
  "style.css",
  "manifest.json",
  "icons",
]);
for (const name of await fs.readdir(extension))
  assert.ok(allowed.has(name), "Unexpected extension file: " + name);
for (const name of [
  "app.js",
  "background.js",
  "core.js",
  "newtab.html",
  "style.css",
]) {
  const text = await fs.readFile(path.join(extension, name), "utf8");
  assert.ok(
    !/fvd-default-|fvdMigration|fvd-migration\.json|\/Users\/|\.intra\.|(?:http[s]?:\/\/)(?:10\.|192\.168\.)/.test(
      text,
    ),
    "Private migration or local data in " + name,
  );
}
for (const name of Object.values(manifest.icons))
  assert.ok((await fs.stat(path.join(extension, name))).isFile());
for (const name of [
  manifest.background.service_worker,
  manifest.chrome_url_overrides.newtab,
  "offscreen.html",
])
  assert.ok((await fs.stat(path.join(extension, name))).isFile());
console.log(
  "Manifest, icon paths, packaging allowlist and private-data scan passed",
);

const html = await fs.readFile(path.join(extension, "newtab.html"), "utf8");
assert.ok(html.includes('src="icons/logo.svg"'), "Header logo missing");
assert.ok(html.includes('href="icons/icon-32.png"'), "Tab favicon missing");
assert.ok((await fs.stat(path.join(extension, "icons/logo.svg"))).isFile());
for (const [size, icon] of Object.entries(manifest.icons)) {
  const bytes = await fs.readFile(path.join(extension, icon));
  assert.equal(bytes.readUInt32BE(16), Number(size));
  assert.equal(bytes.readUInt32BE(20), Number(size));
}
console.log("Header mark, favicon and PNG icon dimensions verified");
