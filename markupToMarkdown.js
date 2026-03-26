/**
 * Преобразует text + markup (диапазоны MAX) в markdown-текст.
 * Поддерживает распространённые типы разметки; неизвестные типы пропускает.
 */
function getWrappers(mark) {
  const type = String(mark?.type ?? "");
  if (type === "bold") return { open: "**", close: "**" };
  if (type === "italic") return { open: "_", close: "_" };
  if (type === "strikethrough") return { open: "~~", close: "~~" };
  if (type === "spoiler") return { open: "||", close: "||" };
  if (type === "code") return { open: "`", close: "`" };
  if (type === "pre") return { open: "```", close: "```" };
  if (type === "underline") return { open: "__", close: "__" };
  if (type === "link") {
    const url =
      mark?.url ?? mark?.href ?? mark?.link ?? mark?.payload?.url ?? null;
    if (typeof url === "string" && url.trim()) {
      return { open: "[", close: `](${url.trim()})` };
    }
  }
  return null;
}

/**
 * @param {string | null | undefined} text
 * @param {unknown[] | null | undefined} markup
 * @returns {string}
 */
export function toMarkdownText(text, markup) {
  const src = String(text ?? "");
  if (!Array.isArray(markup) || markup.length === 0 || src.length === 0) {
    return src;
  }

  const opens = new Map();
  const closes = new Map();

  for (const m of markup) {
    if (!m || typeof m !== "object") continue;
    const from = Number(m.from);
    const length = Number(m.length);
    if (!Number.isFinite(from) || !Number.isFinite(length) || length <= 0) {
      continue;
    }
    const start = Math.max(0, Math.min(src.length, from));
    const end = Math.max(start, Math.min(src.length, from + length));
    const w = getWrappers(m);
    if (!w) continue;

    if (!opens.has(start)) opens.set(start, []);
    opens.get(start).push({ token: w.open, len: end - start });

    if (!closes.has(end)) closes.set(end, []);
    closes.get(end).push({ token: w.close, len: end - start });
  }

  // Вложенная разметка: открывать длинные диапазоны сначала, закрывать короткие сначала.
  for (const arr of opens.values()) arr.sort((a, b) => b.len - a.len);
  for (const arr of closes.values()) arr.sort((a, b) => a.len - b.len);

  let out = "";
  for (let i = 0; i <= src.length; i += 1) {
    if (closes.has(i)) {
      out += closes.get(i).map((x) => x.token).join("");
    }
    if (opens.has(i)) {
      out += opens.get(i).map((x) => x.token).join("");
    }
    if (i < src.length) out += src[i];
  }
  return out;
}
