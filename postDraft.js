const DRAFT_TTL_MS = 30 * 60 * 1000;
const drafts = new Map();

/**
 * @typedef {{
 *   stage: "await_content" | "await_time",
 *   chatId: number | undefined,
 *   text: string,
 *   imageFiles: string[],
 *   expiresAt: number
 * }} PostDraft
 */

/** @param {number} userId @param {number | undefined} chatId */
export function beginDraft(userId, chatId) {
  drafts.set(userId, {
    stage: "await_content",
    chatId,
    text: "",
    imageFiles: [],
    expiresAt: Date.now() + DRAFT_TTL_MS,
  });
}

/** @param {number} userId */
export function clearDraft(userId) {
  drafts.delete(userId);
}

/** @param {number} userId */
export function getDraft(userId) {
  const d = drafts.get(userId);
  if (!d) return null;
  if (Date.now() > d.expiresAt) {
    drafts.delete(userId);
    return null;
  }
  return d;
}

/**
 * @param {number} userId
 * @param {string} text
 * @param {string[]} imageFiles
 */
export function setDraftContent(userId, text, imageFiles) {
  const d = getDraft(userId);
  if (!d) return null;
  d.stage = "await_time";
  d.text = (text ?? "").trim();
  d.imageFiles = Array.isArray(imageFiles) ? imageFiles : [];
  d.expiresAt = Date.now() + DRAFT_TTL_MS;
  return d;
}

/**
 * /post time:
 * - exact: yyyy-mm-dd HHhMMm
 * - relative: +1h 30m, +90m, +2h
 * @param {string} raw
 */
export function parsePostTime(raw) {
  const spec = String(raw ?? "").trim();
  if (!spec) return { ok: false, error: "empty" };

  const exact = spec.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+([01]\d|2[0-3])h([0-5]\d)m$/i
  );
  if (exact) {
    const year = Number(exact[1]);
    const month = Number(exact[2]);
    const day = Number(exact[3]);
    const hour = Number(exact[4]);
    const minute = Number(exact[5]);
    const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
    const valid =
      dt.getFullYear() === year &&
      dt.getMonth() === month - 1 &&
      dt.getDate() === day &&
      dt.getHours() === hour &&
      dt.getMinutes() === minute;
    if (!valid) return { ok: false, error: "bad_exact" };
    if (dt.getTime() <= Date.now()) return { ok: false, error: "past" };
    return { ok: true, runAt: dt.getTime() };
  }

  if (!spec.startsWith("+")) return { ok: false, error: "bad_format" };
  const rest = spec.slice(1);
  const re = /(\d+)\s*([hm])/gi;
  let match;
  let ms = 0;
  let found = 0;
  while ((match = re.exec(rest)) !== null) {
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "bad_rel" };
    ms += unit === "h" ? n * 60 * 60 * 1000 : n * 60 * 1000;
    found += 1;
  }
  if (found === 0 || ms <= 0) return { ok: false, error: "bad_rel" };
  return { ok: true, runAt: Date.now() + ms };
}
