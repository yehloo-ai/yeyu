import test from "node:test";
import assert from "node:assert/strict";
import { safeUrl, applySnapshot, monitorKey } from "../extension/core.js";
test("reject unsafe URLs and embedded credentials", () => {
  for (const u of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://a:b@example.com",
  ])
    assert.throws(() => safeUrl(u));
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});
test("RSS baseline, deduplication, unread persistence and read", () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  let s = applySnapshot({}, { items: [a] }, "rss");
  assert.deepEqual(s.unread, []);
  s = applySnapshot(s, { items: [a, b, b] }, "rss");
  assert.equal(s.unread.length, 1);
  s = applySnapshot(s, { items: [a, b] }, "rss");
  assert.equal(s.unread.length, 1);
  s = applySnapshot({ ...s, unread: [] }, { items: [a, b] }, "rss");
  assert.equal(s.unread.length, 0);
});
test("page baseline and persistent change until read", () => {
  let s = applySnapshot({}, { hash: "a" }, "page");
  assert.equal(s.changed, false);
  s = applySnapshot(s, { hash: "b" }, "page");
  assert.equal(s.changed, true);
  s = applySnapshot(s, { hash: "b" }, "page");
  assert.equal(s.changed, true);
  s = applySnapshot({ ...s, changed: false }, { hash: "b" }, "page");
  assert.equal(s.changed, false);
});
test("success clears error and selector changes reset monitor identity", () => {
  assert.equal(
    applySnapshot({ error: "bad" }, { hash: "x" }, "page").error,
    null,
  );
  assert.notEqual(
    monitorKey({ mode: "page", url: "https://a", selector: "main" }),
    monitorKey({ mode: "page", url: "https://a", selector: "article" }),
  );
});

test("filtered reorder keeps hidden slots and retains each item once", async () => {
  const { reorderVisible } = await import("../extension/core.js");
  const all = "abcde".split("").map((id) => ({ id }));
  assert.equal(
    reorderVisible(all, ["a", "c", "e"], "e", "a")
      .map((s) => s.id)
      .join(""),
    "ebadc",
  );
  assert.equal(
    reorderVisible(all, ["a", "c", "e"], "a", "e", true)
      .map((s) => s.id)
      .join(""),
    "cb eda".replace(/ /g, ""),
  );
  assert.equal(reorderVisible(all, ["a"], "a", "a"), all);
});
