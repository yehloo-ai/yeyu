import { safeUrl, monitorKey, reorderVisible } from "./core.js";
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  return n;
};
const live = Boolean(globalThis.chrome?.storage);
const storage = live
  ? chrome.storage.local
  : {
      async get() {
        return JSON.parse(localStorage.getItem("preview") || "{}");
      },
      async set(v) {
        localStorage.setItem(
          "preview",
          JSON.stringify({ ...(await this.get()), ...v }),
        );
      },
      async remove(k) {
        const d = await this.get();
        delete d[k];
        localStorage.setItem("preview", JSON.stringify(d));
      },
    };
let dragId = null,
  dragVisible = [],
  thumbnailDraft = "",
  sites = [],
  states = {},
  filter = "all",
  group = "",
  editId = null,
  detailId = null;
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
const seed = [
  ["GitHub", "https://github.com/", "开发"],
  ["Chrome 扩展文档", "https://developer.chrome.com/docs/extensions/", "开发"],
  ["MDN Web Docs", "https://developer.mozilla.org/", "开发"],
  ["Wikipedia", "https://www.wikipedia.org/", "阅读"],
  ["Hacker News", "https://news.ycombinator.com/", "阅读"],
  ["YouTube", "https://www.youtube.com/", "媒体"],
  ["Figma", "https://www.figma.com/", "设计"],
  ["Dribbble", "https://dribbble.com/", "设计"],
  ["Behance", "https://www.behance.net/", "设计"],
].map(([title, url, group]) => ({
  id: crypto.randomUUID(),
  title,
  url,
  group,
  mode: "off",
  feed: "",
  selector: "",
}));
function state(s) {
  return states["state:" + s.id] || {};
}
function pending(s) {
  const st = state(s);
  return s.mode !== "off" && (st.changed || (st.unread || []).length > 0);
}
async function load() {
  const d = await storage.get(null);
  sites = d.sites || seed;
  states = d;
  applyTheme(d.appearance || "blue");
  if (!d.sites) await storage.set({ sites });
  render();
}
function render() {
  const total = sites.filter(pending).length;
  $("#updated").textContent = total;
  $("#count").textContent = total;
  $("#grid").replaceChildren();
  $("#groups").replaceChildren();
  $("#view-label").textContent =
    {
      all: "全部入口",
      updates: "有更新",
      watch: "正在关注",
      errors: "检查异常",
    }[filter] + (group ? " · " + group : "");
  for (const g of ["", ...new Set(sites.map((s) => s.group || "未分组"))]) {
    const b = el("button", g === group ? "selected" : "", g || "所有分组");
    b.onclick = () => {
      group = g;
      render();
      $("#preferences").close();
    };
    $("#groups").append(b);
  }
  const query = $("#search").value.trim().toLowerCase();
  const shown = sites.filter(
    (s) =>
      (!group || (s.group || "未分组") === group) &&
      [s.title, s.url, s.group].join(" ").toLowerCase().includes(query) &&
      (filter === "all" ||
        (filter === "updates" && pending(s)) ||
        (filter === "watch" && s.mode !== "off") ||
        (filter === "errors" && s.mode !== "off" && state(s).error)),
  );
  for (const s of shown) {
    const st = state(s);
    const c = el("article", "card");
    c.dataset.id = s.id;
    wireDrag(c, s, shown);
    const a = el("a", "card-link");
    a.href = s.url;
    a.title = s.url;
    a.draggable = false;
    const top = el("div", "card-top");
    if (validThumb(s.thumbnail)) {
      const img = el("img", "thumbnail");
      img.src = s.thumbnail;
      img.draggable = false;
      img.alt = s.title + "网页缩略图";
      top.append(img);
    } else {
      top.append(el("span", "thumbnail-placeholder", "暂无网页缩略图"));
    }
    const name = el("h3", "", s.title);
    name.title = s.title;
    a.append(top, name);
    c.append(a);
    if (s.mode !== "off" && (pending(s) || st.error)) {
      const b = el(
        "button",
        "badge" + (st.error ? " error" : ""),
        st.error
          ? "!"
          : s.mode === "rss"
            ? String(st.unread.length) + " 条更新"
            : "● 有更新",
      );
      b.title = st.error ? "检查异常；点击查看" : "查看更新详情";
      b.setAttribute("aria-label", s.title + "：" + b.title);
      b.onclick = () => details(s.id);
      c.append(b);
    }
    const edit = el("button", "card-edit", "编辑");
    edit.title = "编辑 " + s.title;
    edit.setAttribute("aria-label", edit.title);
    edit.onclick = () => editor(s);
    c.append(edit);
    if (pending(s)) c.classList.add("has-updates");
    $("#grid").append(c);
  }
  const add = el("button", "card add-card");
  add.append(el("b", "", "＋"), el("span", "", "添加快捷入口"));
  add.onclick = () => editor();
  $("#grid").append(add);
  $("#empty").hidden = shown.length > 0;
}
function editor(s) {
  thumbnailDraft = s?.thumbnail || "";
  showThumb();
  editId = s?.id || null;
  const f = $("#form");
  f.reset();
  for (const k of ["title", "url", "group", "mode", "feed", "selector"])
    f.elements[k].value = s?.[k] || (k === "mode" ? "off" : "");
  $("#form-title").textContent = s ? "编辑入口" : "添加入口";
  $("#delete").hidden = !s;
  $("#form-error").textContent = "";
  $("#thumbnail-options").open = false;
  $("#monitor-options").open = false;
  $("#group-options").replaceChildren(
    ...[...new Set(sites.map((x) => x.group).filter(Boolean))].map((g) => {
      const n = el("option");
      n.value = g;
      return n;
    }),
  );
  modeFields();
  $("#editor").showModal();
}
function modeFields() {
  const mode = $("#form").elements.mode.value;
  $("#feed-field").hidden = mode !== "rss";
  $("#selector-field").hidden = mode !== "page";
  $("#form").elements.feed.required = mode === "rss";
  $("#monitor-status").textContent = {
    off: "未开启",
    rss: "新增数量",
    page: "网页变化",
  }[mode];
}
$("#form").elements.mode.onchange = modeFields;
$("#form").onsubmit = async (e) => {
  e.preventDefault();
  const f = $("#form");
  try {
    const s = { id: editId || crypto.randomUUID(), thumbnail: thumbnailDraft };
    for (const k of ["title", "url", "group", "mode", "feed", "selector"])
      s[k] = f.elements[k].value.trim();
    s.url = safeUrl(s.url);
    if (!s.title) throw Error("请填写名称");
    if (s.mode === "rss") s.feed = safeUrl(s.feed);
    if (s.selector) {
      try {
        document.createDocumentFragment().querySelector(s.selector);
      } catch {
        throw Error("CSS 选择器格式无效");
      }
    }
    if (s.mode !== "off" && live) {
      const origin = new URL(s.mode === "rss" ? s.feed : s.url).origin + "/*";
      if (!(await chrome.permissions.request({ origins: [origin] })))
        throw Error("未获得网站读取权限，可改为“仅快捷入口”后保存");
    }
    const old = sites.find((x) => x.id === s.id);
    const latest = (await storage.get("sites")).sites || sites;
    const next = latest.some((x) => x.id === s.id)
      ? latest.map((x) => (x.id === s.id ? s : x))
      : [...latest, s];
    await storage.set({ sites: next });
    if (old && monitorKey(old) !== monitorKey(s))
      await storage.remove("state:" + s.id);
    $("#editor").close();
    await load();
    toast("入口已保存");
    if (s.mode !== "off") check(s.id);
  } catch (e) {
    $("#form-error").textContent = e.message;
  }
};
$("#delete").onclick = async () => {
  if (!confirm("删除这个快捷入口及其检查记录？")) return;
  const latest = (await storage.get("sites")).sites || sites;
  await storage.set({ sites: latest.filter((s) => s.id !== editId) });
  await storage.remove("state:" + editId);
  $("#editor").close();
  await load();
};
function details(id) {
  detailId = id;
  const s = sites.find((x) => x.id === id);
  const st = state(s);
  $("#detail-title").textContent = s.title;
  const body = $("#detail-body");
  body.replaceChildren();
  body.append(
    el(
      "p",
      "",
      s.mode === "off"
        ? "此入口尚未开启更新检测。点击卡片右下角菜单进行设置。"
        : st.error ||
            (!st.initialized
              ? "尚未完成首次检查。"
              : s.mode === "page"
                ? st.changed
                  ? "监测区域文字已发生变化，打开网页查看详情。"
                  : "监测区域文字暂无变化。"
                : "RSS 新增内容按条目去重；首次检查前的内容不计入。"),
    ),
  );
  if (st.checkedAt)
    body.append(
      el(
        "p",
        "hint",
        "上次尝试：" + new Date(st.checkedAt).toLocaleString("zh-CN"),
      ),
    );
  for (const item of st.unread || []) {
    const a = el(item.url ? "a" : "p", "", item.title);
    if (item.url) {
      try {
        a.href = safeUrl(item.url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      } catch {}
    }
    body.append(a);
  }
  const open = el("a", "", "打开网站 ↗");
  open.href = s.url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  body.append(open);
  $("#read").hidden = !pending(s);
  $("#details").showModal();
}
$("#read").onclick = async () => {
  if (live) await chrome.runtime.sendMessage({ type: "read", id: detailId });
  else
    await storage.set({
      ["state:" + detailId]: {
        ...states["state:" + detailId],
        unread: [],
        changed: false,
      },
    });
  $("#details").close();
  await load();
};
async function check(id) {
  if (!live) {
    toast("这是界面预览；安装扩展后才能检查更新");
    return;
  }
  const b = $("#check");
  b.disabled = true;
  b.textContent = "检查中…";
  try {
    const r = await chrome.runtime.sendMessage({ type: "check", id });
    if (r?.error) throw Error(r.error);
    await load();
    toast("检查完成，异常入口可点击 ! 查看原因");
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
    b.textContent = "↻ 检查更新";
  }
}
async function merge(input) {
  const latest = (await storage.get("sites")).sites || sites;
  const known = new Set(latest.map((x) => x.url));
  const added = [];
  let skipped = 0;
  for (const s of input) {
    try {
      const url = safeUrl(s.url);
      if (known.has(url)) continue;
      known.add(url);
      added.push({
        id: crypto.randomUUID(),
        title: String(s.title || new URL(url).hostname).slice(0, 100),
        url,
        group: String(s.group || "导入的入口").slice(0, 40),
        mode: "off",
        feed: typeof s.feed === "string" ? s.feed : "",
        selector: typeof s.selector === "string" ? s.selector : "",
        thumbnail: validThumb(s.thumbnail) ? s.thumbnail : "",
      });
    } catch {
      skipped++;
    }
  }
  await storage.set({ sites: [...latest, ...added] });
  await load();
  toast(
    `已导入 ${added.length} 个入口${skipped ? "，跳过 " + skipped + " 个无效网址" : ""}；检测默认关闭，请按需开启`,
  );
}
$("#import").onclick = async () => {
  if (!live) {
    toast("请安装扩展后导入 Chrome 书签，也可以导入书签 HTML 文件");
    return;
  }
  try {
    if (!(await chrome.permissions.request({ permissions: ["bookmarks"] })))
      return;
    const tree = await chrome.bookmarks.getTree();
    const result = [];
    const walk = (nodes, g) =>
      nodes.forEach((n) => {
        if (n.url) result.push({ title: n.title, url: n.url, group: g });
        if (n.children) walk(n.children, n.title || g);
      });
    walk(tree, "书签");
    await merge(result);
  } catch (e) {
    toast(e.message);
  }
};
$("#backup").onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, sites }, null, 2)], {
    type: "application/json",
  });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "页屿-入口备份.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("#restore").onclick = () => $("#file").click();
$("#file").onchange = async () => {
  try {
    const f = $("#file").files[0];
    if (!f) return;
    if (f.size > 5000000) throw Error("导入文件请小于 5 MB");
    const text = await f.text();
    let entries;
    if (f.name.endsWith(".json")) {
      const data = JSON.parse(text);
      entries = Array.isArray(data) ? data : data.sites;
      if (!Array.isArray(entries)) throw Error("JSON 中需要 sites 数组");
    } else {
      const doc = new DOMParser().parseFromString(text, "text/html");
      entries = [...doc.querySelectorAll("a[href]")].map((a) => ({
        title: a.textContent,
        url: a.getAttribute("href"),
      }));
    }
    await merge(entries);
  } catch (e) {
    toast("导入失败：" + e.message);
  } finally {
    $("#file").value = "";
  }
};
$("#add").onclick = () => editor();
$("#search").oninput = render;
$("#check").onclick = () => check();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $("#" + b.dataset.close).close()));
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      render();
      $("#preferences").close();
    }),
);
$("#more").onclick = () => $("#preferences").showModal();
if (live)
  chrome.storage.onChanged.addListener(() => {
    if (!dragId) load();
  });
await load();

function validThumb(value) {
  return (
    typeof value === "string" &&
    value.length < 180000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}
function showThumb() {
  const image = $("#thumb-preview");
  image.hidden = !validThumb(thumbnailDraft);
  image.src = validThumb(thumbnailDraft) ? thumbnailDraft : "";
  $("#remove-thumb").hidden = !thumbnailDraft;
  $("#thumbnail-status").textContent = validThumb(thumbnailDraft)
    ? "已设置"
    : "未设置";
}
$("#remove-thumb").onclick = () => {
  thumbnailDraft = "";
  showThumb();
};
$("#thumb-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 15000000
    )
      throw Error("请选择小于 15 MB 的 PNG、JPG 或 WebP 图片");
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 250;
    const ctx = canvas.getContext("2d");
    const scale = Math.max(400 / bitmap.width, 250 / bitmap.height);
    ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
    thumbnailDraft = canvas.toDataURL("image/jpeg", 0.72);
    showThumb();
  } catch (e) {
    $("#form-error").textContent = e.message;
  } finally {
    e.target.value = "";
  }
};

$("#form").elements.feed.addEventListener(
  "invalid",
  () => ($("#monitor-options").open = true),
);

function applyTheme(theme) {
  if (!["moss", "paper", "blue", "cream", "minimal"].includes(theme))
    theme = "moss";
  document.documentElement.dataset.theme = theme;
  document
    .querySelectorAll("[data-theme-option]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.themeOption === theme)),
    );
}
document.querySelectorAll("[data-theme-option]").forEach(
  (b) =>
    (b.onclick = async () => {
      await storage.set({ appearance: b.dataset.themeOption });
      applyTheme(b.dataset.themeOption);
    }),
);
function clearDrop() {
  document
    .querySelectorAll(".drop-before,.drop-after")
    .forEach((c) => c.classList.remove("drop-before", "drop-after"));
}
async function persistOrder(source, target, after, visible) {
  const d = await storage.get("sites");
  const latest = d.sites || sites;
  const next = reorderVisible(latest, visible, source, target, after);
  await storage.set({ sites: next });
  await load();
  toast("排列顺序已保存");
}

let dragSession = null,
  pointerStart = null,
  suppressDragClick = false;
function animateGrid(change) {
  const nodes = [
    ...$("#grid").querySelectorAll(".card[data-id]:not(.dragging)"),
  ];
  const before = new Map(nodes.map((n) => [n, n.getBoundingClientRect()]));
  for (const n of nodes) n.getAnimations().forEach((a) => a.cancel());
  change();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const n of nodes) {
    const old = before.get(n),
      now = n.getBoundingClientRect();
    const dx = old.x - now.x,
      dy = old.y - now.y;
    if (dx || dy)
      n.animate(
        [
          { transform: `translate(${dx}px,${dy}px)` },
          { transform: "translate(0,0)" },
        ],
        { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
  }
}
function finishDrag() {
  const active = dragSession;
  dragSession = null;
  if (active) {
    cancelAnimationFrame(active.frame);
    active.placeholder.remove();
    active.image.remove();
    active.card.classList.remove("dragging");
    active.card.style.removeProperty("width");
    if (pointerStart && active.card.hasPointerCapture(pointerStart.id))
      active.card.releasePointerCapture(pointerStart.id);
  }
  dragId = null;
  pointerStart = null;
  $("#grid").classList.remove("is-dragging");
  clearDrop();
}
function wireDrag(card, site, shown) {
  card.draggable = false;
  card.tabIndex = 0;
  card.setAttribute(
    "aria-label",
    site.title + "；可拖动排序，按 Alt 加左右箭头调整位置",
  );
  card.addEventListener("dragstart", (e) => e.preventDefault());
  card.addEventListener("pointerdown", (e) => {
    if (
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      e.target.closest("button")
    )
      return;
    pointerStart = {
      card,
      site,
      shown,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      box: card.getBoundingClientRect(),
    };
  });
  card.addEventListener("keydown", async (e) => {
    if (!e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = shown.findIndex((s) => s.id === site.id);
    const target = shown[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (!target) return;
    try {
      await persistOrder(
        site.id,
        target.id,
        e.key === "ArrowRight",
        shown.map((s) => s.id),
      );
      document
        .querySelector('[data-id="' + CSS.escape(site.id) + '"]')
        ?.focus();
    } catch {
      toast("保存失败，请重试");
    }
  });
}
function dragSlots() {
  return [...$("#grid").children]
    .filter(
      (n) =>
        n === dragSession.placeholder ||
        n.matches(".card[data-id]:not(.dragging)"),
    )
    .map((n) => ({
      x: n.offsetLeft,
      y: n.offsetTop,
      width: n.offsetWidth,
      height: n.offsetHeight,
    }));
}
function movePlaceholderAt(x, y) {
  const grid = $("#grid"),
    origin = grid.getBoundingClientRect();
  // Hit-test the dragged card's center against fixed layout slots, not animated cards or the cursor.
  const center = {
    x:
      x -
      (pointerStart.x - pointerStart.box.x) +
      dragSession.width / 2 -
      origin.x,
    y:
      y -
      (pointerStart.y - pointerStart.box.y) +
      dragSession.height / 2 -
      origin.y,
  };
  if (
    center.x < -dragSession.width / 2 ||
    center.x > grid.clientWidth + dragSession.width / 2
  )
    return;
  if (dragSession.gridWidth !== grid.clientWidth) {
    dragSession.slots = dragSlots();
    dragSession.gridWidth = grid.clientWidth;
  }
  const slots = dragSession.slots;
  const distance = (slot) =>
    ((center.x - slot.x - slot.width / 2) / slot.width) ** 2 +
    ((center.y - slot.y - slot.height / 2) / slot.height) ** 2;
  let best = 0;
  for (let i = 1; i < slots.length; i++)
    if (distance(slots[i]) < distance(slots[best])) best = i;
  // A small dead zone keeps stationary drags stable near row and column boundaries.
  if (
    best === dragSession.index ||
    distance(slots[best]) + 0.025 >= distance(slots[dragSession.index])
  )
    return;
  const others = [
    ...grid.querySelectorAll(":scope > .card[data-id]:not(.dragging)"),
  ];
  dragSession.index = best;
  animateGrid(() =>
    grid.insertBefore(
      dragSession.placeholder,
      others[best] || grid.querySelector(".add-card"),
    ),
  );
}
function updateDrag(time, scroll = true) {
  if (!dragSession || !pointerStart) return;
  const x = dragSession.pointerX,
    y = dragSession.pointerY;
  dragSession.image.style.left =
    x - (pointerStart.x - pointerStart.box.x) + "px";
  dragSession.image.style.top =
    y - (pointerStart.y - pointerStart.box.y) + "px";
  if (scroll) {
    const dt = Math.min(32, Math.max(0, time - dragSession.lastFrame)) / 1000;
    const top = $(".compact-header").getBoundingClientRect().bottom + 65;
    const bottom = innerHeight - 85;
    const velocity =
      y > bottom
        ? Math.min(850, (y - bottom) * 12)
        : y < top
          ? -Math.min(850, (top - y) * 12)
          : 0;
    if (velocity) window.scrollBy(0, velocity * dt);
  }
  dragSession.lastFrame = time;
  movePlaceholderAt(x, y);
}
function tickDrag(time) {
  if (!dragSession) return;
  updateDrag(time);
  if (dragSession) dragSession.frame = requestAnimationFrame(tickDrag);
}
document.addEventListener("pointermove", (e) => {
  if (!pointerStart || e.pointerId !== pointerStart.id) return;
  if (!dragSession) {
    if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 7)
      return;
    const { card, site, shown, box } = pointerStart;
    dragId = site.id;
    dragVisible = shown.map((s) => s.id);
    suppressDragClick = true;
    const width = card.offsetWidth,
      height = card.offsetHeight;
    const image = card.cloneNode(true);
    image.className = "card drag-image";
    image.style.width = width + "px";
    image.style.height = height + "px";
    image.setAttribute("aria-hidden", "true");
    image.querySelectorAll("button,a").forEach((n) => (n.tabIndex = -1));
    document.body.append(image);
    const placeholder = el("div", "drag-placeholder");
    placeholder.style.height = height + "px";
    placeholder.append(el("span", "", "放在这里"));
    placeholder.setAttribute("aria-hidden", "true");
    dragSession = {
      card,
      placeholder,
      image,
      width,
      height,
      index: shown.findIndex((s) => s.id === site.id),
      gridWidth: $("#grid").clientWidth,
      pointerX: e.clientX,
      pointerY: e.clientY,
      lastFrame: performance.now(),
      frame: 0,
      slots: [],
    };
    card.style.width = width + "px";
    card.before(placeholder);
    card.classList.add("dragging");
    $("#grid").classList.add("is-dragging");
    dragSession.slots = dragSlots();
    card.setPointerCapture(e.pointerId);
    dragSession.frame = requestAnimationFrame(tickDrag);
  }
  e.preventDefault();
  dragSession.pointerX = e.clientX;
  dragSession.pointerY = e.clientY;
  updateDrag(performance.now(), false);
});
document.addEventListener("pointerup", async (e) => {
  if (!pointerStart || e.pointerId !== pointerStart.id) return;
  if (!dragSession) {
    pointerStart = null;
    return;
  }
  e.preventDefault();
  dragSession.pointerX = e.clientX;
  dragSession.pointerY = e.clientY;
  updateDrag(performance.now(), false);
  const source = dragId,
    visible = [...dragVisible];
  const order = [...$("#grid").children].filter(
    (n) =>
      n === dragSession.placeholder ||
      n.matches(".card[data-id]:not(.dragging)"),
  );
  const i = order.indexOf(dragSession.placeholder);
  const next = order[i + 1],
    prev = order[i - 1],
    target = next?.dataset.id || prev?.dataset.id;
  dragSession.placeholder.before(dragSession.card);
  finishDrag();
  try {
    if (target) await persistOrder(source, target, !next, visible);
    else await load();
  } catch {
    await load();
    toast("保存失败，请重新拖动");
  }
  setTimeout(() => (suppressDragClick = false), 0);
});
document.addEventListener(
  "click",
  (e) => {
    if (suppressDragClick) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressDragClick = false;
    }
  },
  true,
);
document.addEventListener("pointercancel", () => {
  if (pointerStart) {
    finishDrag();
    suppressDragClick = false;
    load();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dragSession) {
    e.preventDefault();
    finishDrag();
    suppressDragClick = false;
    load();
  }
});
