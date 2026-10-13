import { safeUrl, monitorKey, applySnapshot } from "./core.js";
let queue = Promise.resolve();
let creating;
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}
async function parser() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "解析用户指定网页和 RSS 内容以检测更新",
      })
      .finally(() => (creating = null));
  await creating;
}
async function check(id) {
  const { sites = [] } = await chrome.storage.local.get("sites");
  const site = sites.find((x) => x.id === id);
  if (!site || site.mode === "off") return;
  const key = monitorKey(site);
  const storeKey = "state:" + id;
  const old = (await chrome.storage.local.get(storeKey))[storeKey] || {};
  let next;
  try {
    const url = safeUrl(site.mode === "rss" ? site.feed : site.url);
    const origin = new URL(url).origin + "/*";
    if (!(await chrome.permissions.contains({ origins: [origin] })))
      throw Error("未授权读取网站，请编辑入口后保存以授权");
    const r = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(18000),
    });
    if (!r.ok) throw Error("网站返回 HTTP " + r.status);
    const reader = r.body.getReader();
    let total = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 3000000) {
        await reader.cancel();
        throw Error("页面超过 3 MB，请改用 RSS 或更小的内容页");
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    const raw = new TextDecoder().decode(all);
    await parser();
    const result = await chrome.runtime.sendMessage({
      target: "parser",
      raw,
      site,
    });
    if (result.error) throw Error(result.error);
    const snapshot = result.data;
    if (site.mode === "page")
      snapshot.hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(snapshot.text),
          ),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    next = applySnapshot(old.key === key ? old : {}, snapshot, site.mode);
    next.key = key;
  } catch (e) {
    next = {
      ...(old.key === key ? old : {}),
      key,
      checkedAt: Date.now(),
      error:
        e.message === "Failed to fetch"
          ? "无法读取网站：请检查网络、登录状态或重定向后的准确网址"
          : e.message,
    };
  }
  const latest = (await chrome.storage.local.get("sites")).sites || [];
  if (latest.some((x) => x.id === id && monitorKey(x) === key))
    await chrome.storage.local.set({ [storeKey]: next });
}
async function alarm() {
  const a = await chrome.alarms.get("check");
  if (!a) await chrome.alarms.create("check", { periodInMinutes: 30 });
}
chrome.runtime.onInstalled.addListener(alarm);
chrome.runtime.onStartup.addListener(alarm);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "check")
    serial(async () => {
      const { sites = [] } = await chrome.storage.local.get("sites");
      for (const s of sites) await check(s.id);
    });
});
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m.target === "parser") return;
  if (m.type === "check") {
    serial(async () => {
      await alarm();
      const { sites = [] } = await chrome.storage.local.get("sites");
      for (const site of sites.filter((x) => !m.id || x.id === m.id))
        await check(site.id);
    }).then(
      () => reply({ ok: true }),
      (e) => reply({ error: e.message }),
    );
    return true;
  }
  if (m.type === "read") {
    serial(async () => {
      const k = "state:" + m.id;
      const state = (await chrome.storage.local.get(k))[k] || {};
      await chrome.storage.local.set({
        [k]: { ...state, unread: [], changed: false },
      });
    }).then(() => reply({ ok: true }));
    return true;
  }
});

// Only capture after a deliberate toolbar click; never send screenshots to a server.
chrome.action.onClicked.addListener(async (tab) => {
  const feedback = async (text, color) => {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text, tabId: tab.id });
  };
  try {
    const url = safeUrl(tab.url);
    const { sites = [] } = await chrome.storage.local.get("sites");
    const matches = sites.filter((s) => s.url === url);
    if (!matches.length) {
      await chrome.action.setTitle({
        tabId: tab.id,
        title: "请先在新标签页添加这个网页的完整地址，再点击保存缩略图",
      });
      await feedback("未添加", "#936039");
      return;
    }
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 80,
    });
    const current = await chrome.tabs.get(tab.id);
    const [active] = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId,
    });
    if (current.url !== url || active?.id !== tab.id)
      throw Error("网页已切换，请重新点击保存");
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const canvas = new OffscreenCanvas(400, 250);
    const ctx = canvas.getContext("2d");
    const scale = Math.max(400 / bitmap.width, 250 / bitmap.height);
    ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.72,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const thumbnail = "data:image/jpeg;base64," + btoa(binary);
    const latest = (await chrome.storage.local.get("sites")).sites || [];
    await chrome.storage.local.set({
      sites: latest.map((s) => (s.url === url ? { ...s, thumbnail } : s)),
    });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "缩略图已保存，回到新标签页即可查看",
    });
    await feedback("✓", "#284e3c");
  } catch (e) {
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "缩略图保存失败：" + e.message,
    });
    await feedback("!", "#936039");
  }
});
