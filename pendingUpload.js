/** Ожидание файла-картинки после /post_in_file или /post_at_file */

/** @typedef {{ runAt: number, text: string, expiresAt: number }} PendingImagePost */

const PENDING_MS = 5 * 60 * 1000;
const pendingImageByUser = new Map();

/**
 * @param {number} userId
 * @param {number} runAt
 * @param {string} text
 */
export function setPendingImagePost(userId, runAt, text) {
  pendingImageByUser.set(userId, {
    runAt,
    text: String(text ?? "").trim(),
    expiresAt: Date.now() + PENDING_MS,
  });
}

/**
 * @param {number} userId
 * @returns {PendingImagePost | null}
 */
export function getPendingImagePost(userId) {
  const p = pendingImageByUser.get(userId);
  if (!p) return null;
  if (Date.now() > p.expiresAt) {
    pendingImageByUser.delete(userId);
    return null;
  }
  return p;
}

/** @param {number} userId */
export function clearPendingImagePost(userId) {
  pendingImageByUser.delete(userId);
}
