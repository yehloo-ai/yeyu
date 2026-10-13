import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let feedVersion = 1,
  pageVersion = 1;
const labels = [
  "设计资源",
  "产品研究",
  "AI 简报",
  "技术文档",
  "灵感收藏",
  "阅读书架",
];
const palette = [
  "#476681",
  "#7b6d8f",
  "#528375",
  "#9a7a54",
  "#56709d",
  "#796f62",
];
const html = (i) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>示例内容</title><style>*{box-sizing:border-box}body{margin:0;font:18px system-ui;color:#26374a;background:#f6f8fa}header{padding:20px 35px;border-bottom:1px solid #e3e8ee;background:white;font-weight:700}main{padding:30px 35px}.tag{font-size:12px;color:${palette[i]};letter-spacing:3px}h1{font-size:34px;margin:15px 0}.hero{border-radius:14px;background:${palette[i]};padding:24px;color:white;display:flex;justify-content:space-between;align-items:center}.hero p{font-size:14px;opacity:.8}.visual{font-size:72px;opacity:.65}.row{display:flex;gap:15px;margin-top:22px}.tile{flex:1;border:1px solid #e0e5ec;background:white;border-radius:10px;padding:18px;font-size:14px}.tile small{display:block;color:#8c99a7;margin-top:8px}</style><header>◫ &nbsp; 示例${labels[i]} <span style="float:right;font-size:12px;color:#8996a4">首页 · 专题 · 收藏</span></header><main><div class="tag">YEYU DEMO / ${String(i + 1).padStart(2, "0")}</div><h1>${labels[i]}，从这里开始</h1><div class="hero"><div><b>每一页，都有新的发现。</b><p>用于扩展界面展示的本地示例内容</p></div><div class="visual">${["◉", "▥", "✦", "⌘", "▧", "◫"][i]}</div></div><div class="row"><div class="tile">最新内容<small>精选文章与资源</small></div><div class="tile">值得收藏<small>整理常用网页入口</small></div><div class="tile">持续关注<small>查看新内容提醒</small></div></div><p>这是公开测试用的演示页面，版本 ${pageVersion}。内容保留足够长度，以验证稳定正文的哈希变化检测。</p></main></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/feed")) {
    res.setHeader("Content-Type", "application/rss+xml");
    res.end(
      `<rss><channel><title>Test feed</title><item><guid>old</guid><title>Original item</title></item>${feedVersion === 2 ? "<item><guid>new</guid><title>New item</title></item>" : ""}</channel></rss>`,
    );
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      html(
        Number(new URL(req.url, "http://local").searchParams.get("demo") || 0) %
          6,
      ),
    );
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "yeyu-test-"));
const fixture = path.join(temp, "extension");
await fs.cp(path.join(root, "extension"), fixture, { recursive: true });
const manifest = JSON.parse(
  await fs.readFile(path.join(fixture, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["http://127.0.0.1/*"];
await fs.writeFile(
  path.join(fixture, "manifest.json"),
  JSON.stringify(manifest),
);
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temp, "profile"), {
    channel: "chromium",
    headless: true,
    executablePath: process.env.YEYU_CHROMIUM_EXECUTABLE || undefined,
    args: [
      "--disable-extensions-except=" + fixture,
      "--load-extension=" + fixture,
    ],
    viewport: { width: 1440, height: 900 },
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const extensionUrl =
    "chrome-extension://" + new URL(worker.url()).host + "/newtab.html";
  await page.goto(extensionUrl);
  await page.locator(".card-link").nth(8).waitFor();
  await page.click("#add");
  await page.locator("[name=title]").fill("Test entry");
  await page.locator("[name=url]").fill("https://example.com/");
  await page.locator("button[type=submit]").click();
  await page
    .getByRole("heading", { name: "Test entry", exact: true })
    .waitFor();
  await page.locator("#search").fill("Test entry");
  assert.equal(await page.locator(".card-link").count(), 1);
  await page.locator("#search").fill("");
  const preview = await context.newPage();
  const screenshots = [];
  await preview.setViewportSize({ width: 800, height: 450 });
  for (let i = 0; i < 6; i++) {
    await preview.goto(base + "/page?demo=" + i);
    screenshots.push(
      "data:image/jpeg;base64," +
        (await preview.screenshot({ type: "jpeg", quality: 75 })).toString(
          "base64",
        ),
    );
  }
  await preview.close();
  const sites = Array.from({ length: 30 }, (_, i) => ({
    id: "sample-" + i,
    title: labels[i % 6] + (i < 6 ? "" : " " + (Math.floor(i / 6) + 1)),
    url: base + "/page?demo=" + i,
    group: "示例",
    mode: "off",
    feed: "",
    selector: "",
    thumbnail: screenshots[i % 6],
  }));
  sites[0].mode = "rss";
  sites[0].feed = base + "/feed";
  sites[1].mode = "page";
  await page.evaluate((sites) => chrome.storage.local.set({ sites }), sites);
  await page.locator('.card[data-id="sample-29"]').waitFor();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "check" }));
  let records = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(records["state:sample-0"].unread.length, 0);
  assert.equal(records["state:sample-1"].changed, false);
  feedVersion = 2;
  pageVersion = 2;
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "check" }));
  records = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(records["state:sample-0"].unread.length, 1);
  assert.equal(records["state:sample-1"].changed, true);
  await page.locator('.card[data-id="sample-0"] .badge').click();
  await page.getByText("New item", { exact: true }).waitFor();
  await page.click("#read");
  assert.equal(
    (await worker.evaluate(() => chrome.storage.local.get("state:sample-0")))[
      "state:sample-0"
    ].unread.length,
    0,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(150);
  const source = await page.locator('.card[data-id="sample-0"]').boundingBox();
  const target = await page.locator('.card[data-id="sample-8"]').boundingBox();
  const x = target.x + target.width * 0.26 - source.width / 2 + 18,
    y = target.y + target.height * 0.3 - source.height / 2 + 18;
  await page.mouse.move(source.x + 18, source.y + 18);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 18 });
  await page.waitForTimeout(220);
  const index = () =>
    page.evaluate(() =>
      [...document.querySelector("#grid").children]
        .filter(
          (n) =>
            n.matches(".drag-placeholder") ||
            n.matches(".card[data-id]:not(.dragging)"),
        )
        .findIndex((n) => n.matches(".drag-placeholder")),
    );
  assert.equal(await index(), 8);
  await page.waitForTimeout(300);
  assert.equal(await index(), 8);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector(".card[data-id]").dataset.id !== "sample-0",
  );
  await page.reload();
  await page.locator(".card[data-id]").first().waitFor();
  assert.equal(
    await page.locator(".card[data-id]").nth(8).getAttribute("data-id"),
    "sample-0",
  );
  const before = await worker.evaluate(async () =>
    (await chrome.storage.local.get("sites")).sites.map((s) => s.id),
  );
  await page.evaluate(() => scrollTo(0, 0));
  const edge = await page.locator(".card[data-id]").first().boundingBox();
  await page.mouse.move(edge.x + 20, edge.y + 20);
  await page.mouse.down();
  await page.mouse.move(edge.x + 20, 892, { steps: 20 });
  const initial = await page.evaluate(() => scrollY);
  await page.waitForTimeout(650);
  assert.ok((await page.evaluate(() => scrollY)) > initial + 100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.locator(".drag-placeholder").count(), 0);
  assert.deepEqual(
    await worker.evaluate(async () =>
      (await chrome.storage.local.get("sites")).sites.map((s) => s.id),
    ),
    before,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator(".card-link").first().hover();
  await page.locator(".card-edit").first().click();
  await page.locator("#editor[open]").waitFor();
  assert.equal(
    await page.locator("#monitor-options").evaluate((e) => e.open),
    false,
  );
  await page.locator('[data-close="editor"]').first().click();
  await page.click("#more");
  await page.locator('[data-theme-option="cream"]').click();
  await page.locator('[data-close="preferences"]').click();
  await page.reload();
  await page.locator(".card").first().waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "cream");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  // Public documentation image contains only this generated fixture, never a personal browser profile.
  if (process.env.YEYU_UPDATE_SCREENSHOT === "1") {
    await page.evaluate(async (sites) => {
      const data = { sites, appearance: "blue" };
      data["state:sample-0"] = {
        initialized: true,
        unread: Array.from({ length: 3 }, (_, i) => ({
          id: "demo-" + i,
          title: "示例内容 " + (i + 1),
        })),
      };
      data["state:sample-1"] = { initialized: true, changed: true };
      await chrome.storage.local.set(data);
    }, sites);
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator(".card-link").nth(2).hover();
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      document.querySelector("#toast").hidden = true;
      const label = document.createElement("span");
      label.textContent = "示例界面 · 演示数据";
      label.style.cssText = "font-size:11px;color:#788391";
      document
        .querySelector(".compact-header")
        .insertBefore(label, document.querySelector(".header-actions"));
    });
    await page.screenshot({ path: path.join(root, "docs/screenshot.png") });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Public extension: CRUD, RSS/page detection, mark-read, live drag, edge-scroll/cancel, persisted theme and responsive layout passed",
  );
} finally {
  await context?.close();
  server.close();
  await fs.rm(temp, { recursive: true, force: true });
}
