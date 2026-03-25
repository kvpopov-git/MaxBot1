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

/**
 * Скачать изображение по URL, привести к JPEG, вписать в рамки (без увеличения мелких).
 * Сохраняет в data/uploads/. Возвращает путь относительно data/, с прямыми слешами.
 *
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
export async function downloadProcessSaveJpeg(imageUrl) {
  const res = await fetch(imageUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`скачивание: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("файл слишком большой (лимит 25 МБ)");
  }

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
 * Абсолютный путь к файлу, указанному относительно каталога data/.
 * @param {string} relativeFromData например uploads/x.jpg
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
