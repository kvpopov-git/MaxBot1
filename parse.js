/**
 * Разбор текста после времени в /post_in и /post_at.
 * Формат с картинкой: --img <https URL> остальной текст подписи (может быть пустым).
 */
export function parsePostBody(rest) {
  const trimmed = rest.trim();
  const m = trimmed.match(/^--img\s+(\S+)\s*([\s\S]*)$/i);
  if (!m) {
    return { text: trimmed, imageUrl: null };
  }
  const urlStr = m[1];
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { error: "bad_url" };
    }
    return { text: m[2].trim(), imageUrl: urlStr };
  } catch {
    return { error: "bad_url" };
  }
}
