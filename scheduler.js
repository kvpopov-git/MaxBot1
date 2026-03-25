import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TICK_MS = 10_000;

/**
 * Отложенная публикация в канал (по chat_id). API MAX шлёт сообщения только сразу —
 * время публикации обеспечивает сам бот.
 *
 * @typedef {{ id: string, runAt: number, text: string, imageUrl?: string | null }} ScheduledJob
 */
export function createChannelScheduler(bot, options) {
  const channelId = Number(options.channelId);
  const filePath =
    options.filePath ?? path.join(process.cwd(), "data", "scheduled.json");
  /** @type {ScheduledJob[]} */
  let jobs = [];
  let timer = null;

  function ensureDir() {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  function load() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      jobs = Array.isArray(data.jobs) ? data.jobs : [];
    } catch {
      jobs = [];
    }
    jobs = jobs.filter((j) => {
      if (!j || typeof j.id !== "string" || typeof j.runAt !== "number") {
        return false;
      }
      if (typeof j.text !== "string") return false;
      if (
        j.imageUrl != null &&
        j.imageUrl !== "" &&
        typeof j.imageUrl !== "string"
      ) {
        return false;
      }
      const hasText = j.text.trim().length > 0;
      const hasImg = Boolean(j.imageUrl && String(j.imageUrl).trim());
      return hasText || hasImg;
    });
  }

  function save() {
    ensureDir();
    fs.writeFileSync(filePath, JSON.stringify({ jobs }, null, 2), "utf8");
  }

  /**
   * @param {ScheduledJob} job
   */
  async function sendJob(job) {
    const text = job.text ?? "";
    if (job.imageUrl) {
      const image = await bot.api.uploadImage({ url: job.imageUrl });
      await bot.api.sendMessageToChat(channelId, text, {
        attachments: [image.toJson()],
      });
    } else {
      await bot.api.sendMessageToChat(channelId, text);
    }
  }

  async function runDue() {
    const now = Date.now();
    const due = jobs.filter((j) => j.runAt <= now);
    for (const job of due) {
      try {
        await sendJob(job);
        jobs = jobs.filter((j) => j.id !== job.id);
        save();
        console.log(`[scheduler] опубликовано в канал ${channelId}, id=${job.id}`);
      } catch (err) {
        console.error(`[scheduler] ошибка отправки id=${job.id}:`, err);
      }
    }
  }

  function start() {
    load();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      runDue().catch((e) => console.error("[scheduler]", e));
    }, TICK_MS);
    runDue().catch((e) => console.error("[scheduler]", e));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /**
   * @param {number} runAt
   * @param {string} text
   * @param {string | null} [imageUrl]
   */
  function addJob(runAt, text, imageUrl = null) {
    const id = `s_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const t = text.trim();
    const img =
      imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null;
    if (!t && !img) throw new Error("empty_text");
    /** @type {ScheduledJob} */
    const job = { id, runAt, text: t, imageUrl: img };
    jobs.push(job);
    save();
    return job;
  }

  function cancel(id) {
    const before = jobs.length;
    jobs = jobs.filter((j) => j.id !== id);
    save();
    return before - jobs.length;
  }

  function list() {
    return [...jobs].sort((a, b) => a.runAt - b.runAt);
  }

  return {
    channelId,
    start,
    stop,
    addJob,
    cancel,
    list,
  };
}
