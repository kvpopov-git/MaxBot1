import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const DEFAULT_MAX_W = 1920;
const DEFAULT_MAX_H = 2560;
const DEFAULT_QUALITY = 85;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function getConfig() {
  const maxW = Number(process.env.IMAGE_MAX_WIDTH) || DEFAULT_MAX_W;
  const maxH = Number(process.env.IMAGE_MAX_HEIGHT) || DEFAULT_MAX_H;
  const quality = Math.min(
    100,
    Math.max(40, Number(process.env.JPEG_QUALITY) || DEFAULT_QUALITY)
  );
  return { maxW, maxH, quality };
}

export function getUploadsDir() {
  return path.join(process.cwd(), "data", "uploads");
}

/** @param {unknown[] | null | undefined} attachments */
export function extractImageUrlsFromAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  const urls = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const att = /** @type {{ type?: string, payload?: { url?: string }, filename?: string }} */ (a);
    if (att.type === "image") {
      const u = att.payload?.url;
      if (typeof u === "string" && u.length > 0) urls.push(u);
    }
    if (att.type === "file" && typeof att.filename === "string") {
      if (/\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$/i.test(att.filename)) {
        const u = att.payload?.url;
        if (typeof u === "string" && u.length > 0) urls.push(u);
      }
    }
  }
  return urls;
}

/** @param {unknown[] | null | undefined} attachments */
export function extractImageUrlFromAttachments(attachments) {
  return extractImageUrlsFromAttachments(attachments)[0] ?? null;
}

/** @param {unknown[] | null | undefined} attachments */
export function extractVideoTokensFromAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  const tokens = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const att = /** @type {{ type?: string, payload?: { token?: string } }} */ (a);
    if (att.type === "video") {
      const t = att.payload?.token;
      if (typeof t === "string" && t.length > 0) tokens.push(t);
    }
  }
  return tokens;
}

/**
 * @param {string} imageUrl
 * @returns {Promise<Buffer>}
 */
export async function fetchImageBuffer(imageUrl) {
  const token = process.env.BOT_TOKEN?.trim();
  let res = await fetch(imageUrl, { redirect: "follow" });
  if (!res.ok && token && (res.status === 401 || res.status === 403)) {
    res = await fetch(imageUrl, {
      redirect: "follow",
      headers: { Authorization: token },
    });
  }
  if (!res.ok) {
    throw new Error(`скачивание: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("файл слишком большой (лимит 25 МБ)");
  }
  return buf;
}

/**
 * @param {Buffer} buf
 * @returns {Promise<string>} путь относительно data/
 */
export async function processBufferToStoredJpeg(buf) {
  const { maxW, maxH, quality } = getConfig();
  const uploadsDir = getUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });

  const name = `img_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.jpg`;
  const absOut = path.join(uploadsDir, name);

  await sharp(buf, { animated: false, limitInputPixels: 268402689 })
    .rotate()
    .resize(maxW, maxH, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toFile(absOut);

  return `uploads/${name}`.replace(/\\/g, "/");
}

/**
 * Скачать по URL, JPEG + ресайз → data/uploads/
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
export async function downloadProcessSaveJpeg(imageUrl) {
  const buf = await fetchImageBuffer(imageUrl);
  return processBufferToStoredJpeg(buf);
}

/**
 * Абсолютный путь к файлу относительно data/
 * @param {string} relativeFromData
 */
export function resolveDataFile(relativeFromData) {
  if (
    !relativeFromData ||
    relativeFromData.includes("..") ||
    path.isAbsolute(relativeFromData)
  ) {
    throw new Error("invalid_path");
  }
  const abs = path.resolve(process.cwd(), "data", relativeFromData);
  const dataRoot = path.resolve(process.cwd(), "data");
  if (!abs.startsWith(dataRoot)) {
    throw new Error("invalid_path");
  }
  return abs;
}

export function deleteStoredImage(relativeFromData) {
  if (!relativeFromData || typeof relativeFromData !== "string") return;
  try {
    const abs = resolveDataFile(relativeFromData);
    fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}
