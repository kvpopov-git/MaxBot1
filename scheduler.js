import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveDataFile, deleteStoredImage } from "./imageStore.js";

const TICK_MS = 10_000;

/**
 * @typedef {{
 *   id: string,
 *   runAt: number,
 *   text: string,
 *   imageUrl?: string | null,
 *   imageFile?: string | null,
 *   imageFiles?: string[] | null
 * }} ScheduledJob
 * imageFile — путь относительно data/, например uploads/xxx.jpg (после обработки JPEG на диске)
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
      if (
        j.imageFile != null &&
        j.imageFile !== "" &&
        typeof j.imageFile !== "string"
      ) {
        return false;
      }
      if (
        j.imageFiles != null &&
        (!Array.isArray(j.imageFiles) ||
          !j.imageFiles.every((x) => typeof x === "string"))
      ) {
        return false;
      }
      const hasText = j.text.trim().length > 0;
      const hasImg = Boolean(
        (j.imageUrl && String(j.imageUrl).trim()) ||
          (j.imageFile && String(j.imageFile).trim()) ||
          (Array.isArray(j.imageFiles) && j.imageFiles.length > 0)
      );
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
    if (Array.isArray(job.imageFiles) && job.imageFiles.length > 0) {
      const attachments = [];
      for (const rel of job.imageFiles) {
        const abs = resolveDataFile(rel);
        if (!fs.existsSync(abs)) {
          throw new Error(`нет файла изображения: ${rel}`);
        }
        const image = await bot.api.uploadImage({ source: abs });
        attachments.push(image.toJson());
      }
      await bot.api.sendMessageToChat(channelId, text, { attachments });
      for (const rel of job.imageFiles) {
        deleteStoredImage(rel);
      }
    } else if (job.imageFile) {
      const abs = resolveDataFile(job.imageFile);
      if (!fs.existsSync(abs)) {
        throw new Error(`нет файла изображения: ${job.imageFile}`);
      }
      const image = await bot.api.uploadImage({ source: abs });
      await bot.api.sendMessageToChat(channelId, text, {
        attachments: [image.toJson()],
      });
      deleteStoredImage(job.imageFile);
    } else if (job.imageUrl) {
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
   * @param {string | null} [imageUrl] легаси: без обработки, URL в MAX
   * @param {string | null} [imageFile] относительно data/, JPEG на диске (legacy)
   * @param {string[] | null} [imageFiles] относительно data/, несколько JPEG
   */
  function addJob(runAt, text, imageUrl = null, imageFile = null, imageFiles = null) {
    const id = `s_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const t = text.trim();
    const url = imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null;
    const file =
      imageFile && String(imageFile).trim() ? String(imageFile).trim() : null;
    const files = Array.isArray(imageFiles)
      ? imageFiles
          .map((x) => String(x).trim())
          .filter((x) => x.length > 0)
      : [];
    if (!t && !url && !file && files.length === 0) throw new Error("empty_text");
    /** @type {ScheduledJob} */
    const job = {
      id,
      runAt,
      text: t,
      imageUrl: url,
      imageFile: file,
      imageFiles: files,
    };
    jobs.push(job);
    save();
    return job;
  }

  function cancel(id) {
    const job = jobs.find((j) => j.id === id);
    if (job?.imageFile) {
      deleteStoredImage(job.imageFile);
    }
    if (Array.isArray(job?.imageFiles)) {
      for (const rel of job.imageFiles) deleteStoredImage(rel);
    }
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
