import fs from "node:fs";
import crypto from "node:crypto";
import { ImageAttachment, VideoAttachment } from "@maxhub/max-bot-api";
import { resolveDataFile, deleteStoredImage } from "./imageStore.js";

const TICK_MS = 10_000;
const STORAGE_MARKER = "#MAXBOT_SCHEDULE";

/**
 * @typedef {{
 *   id: string,
 *   runAt: number,
 *   text: string,
 *   imageFiles?: string[] | null,
 *   videoTokens?: string[] | null,
 *   storageMid?: string | null
 * }} ScheduledJob
 */
export function createChannelScheduler(bot, options) {
  const channelId = Number(options.channelId);
  const storageChatId = Number(options.storageChatId);
  const hasStorageChat = Number.isFinite(storageChatId) && storageChatId !== 0;
  /** @type {ScheduledJob[]} */
  let jobs = [];
  let timer = null;
  let loaded = false;

  function buildStorageText(id, runAt, text) {
    return `${STORAGE_MARKER}|${id}|${runAt}\n${text ?? ""}`;
  }

  function parseStorageText(raw) {
    if (typeof raw !== "string" || !raw.startsWith(STORAGE_MARKER)) {
      return null;
    }
    const [metaLine, ...rest] = raw.split(/\r?\n/);
    const m = metaLine.match(/^#MAXBOT_SCHEDULE\|([^|]+)\|(\d+)$/);
    if (!m) return null;
    const runAt = Number(m[2]);
    if (!Number.isFinite(runAt)) return null;
    return { id: m[1], runAt, text: rest.join("\n") };
  }

  function attachmentsFromTokens(imageTokens, videoTokens) {
    const out = [];
    for (const t of imageTokens ?? []) {
      out.push(new ImageAttachment({ token: t }).toJson());
    }
    for (const t of videoTokens ?? []) {
      out.push(new VideoAttachment({ token: t }).toJson());
    }
    return out;
  }

  function extractMediaTokensFromAttachments(attachments) {
    if (!Array.isArray(attachments)) return { images: [], videos: [] };
    const images = [];
    const videos = [];
    for (const a of attachments) {
      if (
        a &&
        typeof a === "object" &&
        a.type === "image" &&
        a.payload &&
        typeof a.payload.token === "string" &&
        a.payload.token
      ) {
        if (a.type === "image") images.push(a.payload.token);
        if (a.type === "video") videos.push(a.payload.token);
      }
    }
    return { images, videos };
  }

  async function loadFromStorage() {
    if (!hasStorageChat) return;
    // MAX API ограничивает count до 100
    const res = await bot.api.getMessages(storageChatId, { count: 100 });
    const parsed = [];
    for (const m of res.messages ?? []) {
      const p = parseStorageText(m?.body?.text ?? "");
      if (!p) continue;
      const media = extractMediaTokensFromAttachments(m?.body?.attachments);
      parsed.push({
        id: p.id,
        runAt: p.runAt,
        text: p.text,
        imageFiles: media.images,
        videoTokens: media.videos,
        storageMid: m?.body?.mid,
      });
    }
    parsed.sort((a, b) => a.runAt - b.runAt);
    jobs = parsed;
    loaded = true;
  }

  async function ensureLoaded() {
    if (loaded) return;
    await loadFromStorage();
  }

  async function sendJob(job) {
    const text = job.text ?? "";
    const hasImages = Array.isArray(job.imageFiles) && job.imageFiles.length > 0;
    const hasVideos = Array.isArray(job.videoTokens) && job.videoTokens.length > 0;
    if (hasImages || hasVideos) {
      const attachments = attachmentsFromTokens(job.imageFiles, job.videoTokens);
      await bot.api.sendMessageToChat(channelId, text, { attachments });
    } else {
      await bot.api.sendMessageToChat(channelId, text);
    }
  }

  async function runDue() {
    await ensureLoaded();
    const now = Date.now();
    const due = jobs.filter((j) => j.runAt <= now);
    for (const job of due) {
      try {
        await sendJob(job);
        if (job.storageMid) {
          await bot.api.deleteMessage(job.storageMid);
        }
        jobs = jobs.filter((j) => j.id !== job.id);
        console.log(`[scheduler] опубликовано в канал ${channelId}, id=${job.id}`);
      } catch (err) {
        console.error(`[scheduler] ошибка отправки id=${job.id}:`, err);
      }
    }
  }

  function start() {
    loaded = false;
    loadFromStorage().catch((e) => {
      console.error("[scheduler] загрузка из STORAGE_CHAT_ID не удалась:", e);
    });
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
   * @param {string | null} [imageFile]
   * @param {string[] | null} [imageFiles]
   * @param {string[] | null} [videoTokens]
   */
  async function addJob(
    runAt,
    text,
    imageUrl = null,
    imageFile = null,
    imageFiles = null,
    videoTokens = null
  ) {
    await ensureLoaded();
    const id = `s_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const t = text.trim();
    const tokens = [];
    const videos = Array.isArray(videoTokens)
      ? videoTokens.map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (Array.isArray(imageFiles) && imageFiles.length > 0) {
      for (const rel of imageFiles.map((x) => String(x).trim()).filter(Boolean)) {
        try {
          const abs = resolveDataFile(rel);
          if (!fs.existsSync(abs)) continue;
          const image = await bot.api.uploadImage({ source: abs });
          if (typeof image.token === "string" && image.token) {
            tokens.push(image.token);
          }
        } finally {
          deleteStoredImage(rel);
        }
      }
    } else if (imageFile && String(imageFile).trim()) {
      const rel = String(imageFile).trim();
      try {
        const abs = resolveDataFile(rel);
        if (fs.existsSync(abs)) {
          const image = await bot.api.uploadImage({ source: abs });
          if (typeof image.token === "string" && image.token) {
            tokens.push(image.token);
          }
        }
      } finally {
        deleteStoredImage(rel);
      }
    } else if (imageUrl && String(imageUrl).trim()) {
      const image = await bot.api.uploadImage({ url: String(imageUrl).trim() });
      if (typeof image.token === "string" && image.token) {
        tokens.push(image.token);
      }
    }

    if (!t && tokens.length === 0 && videos.length === 0) throw new Error("empty_text");

    const storageText = buildStorageText(id, runAt, t);
    const storageMsg = await bot.api.sendMessageToChat(storageChatId, storageText, {
      attachments: attachmentsFromTokens(tokens, videos),
    });

    const job = {
      id,
      runAt,
      text: t,
      imageFiles: tokens,
      videoTokens: videos,
      storageMid: storageMsg.body.mid,
    };
    jobs.push(job);

    return job;
  }

  async function cancel(id) {
    await ensureLoaded();
    const job = jobs.find((j) => j.id === id);
    if (!job) return 0;
    if (job.storageMid) await bot.api.deleteMessage(job.storageMid);
    const before = jobs.length;
    jobs = jobs.filter((j) => j.id !== id);
    return before - jobs.length;
  }

  function list() {
    return [...jobs].sort((a, b) => a.runAt - b.runAt);
  }

  function getById(id) {
    return jobs.find((j) => j.id === id) ?? null;
  }

  async function updateTime(id, runAt) {
    await ensureLoaded();
    const job = jobs.find((j) => j.id === id);
    if (!job) return false;
    if (job.storageMid) {
      await bot.api.editMessage(job.storageMid, {
        text: buildStorageText(id, runAt, job.text),
      });
    }
    job.runAt = runAt;
    return true;
  }

  return {
    channelId,
    start,
    stop,
    addJob,
    cancel,
    list,
    getById,
    updateTime,
  };
}
