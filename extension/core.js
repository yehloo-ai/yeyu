export function safeUrl(value) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("请填写有效的 HTTP / HTTPS 网址");
  return u.href;
}
export function monitorKey(s) {
  return JSON.stringify([s.mode, s.feed, s.selector, s.url]);
}
export function applySnapshot(state, snapshot, mode, now = Date.now()) {
  const next = { ...state, checkedAt: now, error: null };
  if (mode === "rss") {
    const items = [...new Map(snapshot.items.map((x) => [x.id, x])).values()];
    const known = new Set(state.seen || []);
    const added = state.initialized
      ? items.filter((x) => !known.has(x.id))
      : [];
    next.seen = [...new Set([...items.map((x) => x.id), ...known])].slice(
      0,
      10000,
    );
    next.unread = [
      ...new Map(
        [...(state.unread || []), ...added].map((x) => [x.id, x]),
      ).values(),
    ];
  } else {
    next.changed = Boolean(
      state.changed || (state.initialized && state.hash !== snapshot.hash),
    );
    next.hash = snapshot.hash;
  }
  next.initialized = true;
  return next;
}
export function parseSource(raw, site, Parser) {
  const doc = new Parser().parseFromString(
    raw,
    site.mode === "rss" ? "text/xml" : "text/html",
  );
  if (site.mode === "rss") {
    if (
      doc.querySelector("parsererror") ||
      !["rss", "feed", "rdf:RDF"].includes(doc.documentElement.nodeName)
    )
      throw Error("不是有效的 RSS / Atom 订阅源");
    const items = [...doc.querySelectorAll("item,entry")].map((n) => {
      const title =
        n.querySelector("title")?.textContent?.trim() || "未命名内容";
      const link = n.querySelector("link");
      const href =
        link?.getAttribute("href") || link?.textContent?.trim() || "";
      const id =
        n.querySelector("guid,id")?.textContent?.trim() || href || title;
      let url = "";
      try {
        url = safeUrl(new URL(href, site.feed || site.url).href);
      } catch {}
      return { id, title, url };
    });
    return { items };
  }
  if (
    doc.querySelector("input[type=password]") ||
    /^(登录|登入|sign in|log in|just a moment|access denied)/i.test(
      doc.title.trim(),
    )
  )
    throw Error("页面要求登录或验证，请打开网站检查");
  doc
    .querySelectorAll(
      "script,style,noscript,iframe,img,svg,video,audio,canvas,nav,footer,time",
    )
    .forEach((n) => n.remove());
  let nodes;
  try {
    nodes = doc.querySelectorAll(site.selector || "main,article");
  } catch {
    throw Error("监测区域的 CSS 选择器无效");
  }
  if (!nodes.length)
    throw Error("未找到监测区域；动态网页可能需要专门适配，请设置 CSS 选择器");
  const text = [...nodes]
    .map((n) => n.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 30) throw Error("可读取的内容太少，可能需要登录或动态加载");
  return { text };
}

// Reorder only visible slots: filtered-out cards keep their original positions.
export function reorderVisible(
  all,
  visibleIds,
  sourceId,
  targetId,
  after = false,
) {
  const visible = new Set(visibleIds);
  const ordered = all.filter((s) => visible.has(s.id));
  const source = ordered.find((s) => s.id === sourceId);
  if (
    !source ||
    sourceId === targetId ||
    !ordered.some((s) => s.id === targetId)
  )
    return all;
  const rest = ordered.filter((s) => s.id !== sourceId);
  const at = rest.findIndex((s) => s.id === targetId);
  rest.splice(at + (after ? 1 : 0), 0, source);
  let i = 0;
  return all.map((s) => (visible.has(s.id) ? rest[i++] : s));
}
