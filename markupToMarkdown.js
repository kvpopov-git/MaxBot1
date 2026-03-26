/**
 * Преобразует text + markup (диапазоны MAX) в markdown-текст.
 * Поддерживает распространённые типы разметки; неизвестные типы пропускает.
 */
function wrappersByName(name) {
  const n = String(name ?? "").toLowerCase();
  if (n === "bold" || n === "strong") return { open: "**", close: "**" };
  if (n === "italic" || n === "em") return { open: "_", close: "_" };
  if (n === "strikethrough" || n === "strike") return { open: "~~", close: "~~" };
  if (n === "spoiler") return { open: "||", close: "||" };
  if (n === "code" || n === "monospace") return { open: "`", close: "`" };
  if (n === "pre" || n === "preformatted" || n === "code_block") {
    return { open: "```", close: "```" };
  }
  if (n === "underline" || n === "underlined") return { open: "__", close: "__" };
  return null;
}

function getWrappers(mark) {
  const type = String(mark?.type ?? "");
  const direct = wrappersByName(type);
  if (direct) return direct;

  // Некоторые клиенты передают стили списком в `styles`
  if (Array.isArray(mark?.styles) && mark.styles.length > 0) {
    const styleWrappers = mark.styles
      .map((s) => wrappersByName(s))
      .filter(Boolean);
    if (styleWrappers.length > 0) {
      return {
        open: styleWrappers.map((w) => w.open).join(""),
        close: styleWrappers
          .slice()
          .reverse()
          .map((w) => w.close)
          .join(""),
      };
    }
  }

  if (type === "link" || type === "url") {
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
