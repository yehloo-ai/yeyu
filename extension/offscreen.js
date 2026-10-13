import { parseSource } from "./core.js";
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m.target !== "parser") return;
  try {
    reply({ data: parseSource(m.raw, m.site, DOMParser) });
  } catch (e) {
    reply({ error: e.message });
  }
});
