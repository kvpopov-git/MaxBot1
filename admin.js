/**
 * @param {string | undefined} raw
 * @returns {Set<number>}
 */
export function parseAdminIds(raw) {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
}

/**
 * @param {import('@maxhub/max-bot-api').Context} ctx
 * @param {Set<number>} adminIds
 */
export function isAdmin(ctx, adminIds) {
  if (adminIds.size === 0) return false;
  const uid = ctx.user?.user_id;
  return uid != null && adminIds.has(uid);
}
