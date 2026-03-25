import "dotenv/config";
import { Bot } from "@maxhub/max-bot-api";
import { createChannelScheduler } from "./scheduler.js";
import { parseAdminIds, isAdmin } from "./admin.js";
import {
  extractImageUrlsFromAttachments,
  fetchImageBuffer,
  processBufferToStoredJpeg,
} from "./imageStore.js";
import {
  beginDraft,
  clearDraft,
  getDraft,
  parsePostTime,
  setDraftContent,
} from "./postDraft.js";

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error(
    "Укажите BOT_TOKEN в файле .env (скопируйте из настроек бота на dev.max.ru)."
  );
  process.exit(1);
}

const channelIdRaw = process.env.CHANNEL_ID?.trim();
const channelId = channelIdRaw ? Number(channelIdRaw) : NaN;
const adminIds = parseAdminIds(process.env.ADMIN_USER_IDS);

const bot = new Bot(token);
const scheduler =
  Number.isFinite(channelId) && channelId !== 0
    ? createChannelScheduler(bot, { channelId })
    : null;

function denySchedule(ctx) {
  if (!scheduler) {
    return ctx.reply(
      "Постинг не настроен: задайте CHANNEL_ID в .env (chat_id канала, где бот — администратор)."
    );
  }
  if (adminIds.size === 0) {
    return ctx.reply(
      "Задайте ADMIN_USER_IDS в .env (ваш user_id через запятую). Узнать id: /my_id."
    );
  }
  if (!isAdmin(ctx, adminIds)) {
    return ctx.reply("Нет прав на формирование постов.");
  }
  return null;
}

// Двухшаговый черновик: /post on -> сообщение с контентом/вложениями -> /post time ...
bot.use(async (ctx, next) => {
  if (ctx.updateType !== "message_created") return next();
  const uid = ctx.user?.user_id;
  if (uid == null) return next();

  const draft = getDraft(uid);
  if (!draft || draft.stage !== "await_content") return next();

  const text = (ctx.message?.body?.text ?? "").trim();
  if (text.startsWith("/")) return next();

  const denied = denySchedule(ctx);
  if (denied) {
    clearDraft(uid);
    return;
  }

  if (draft.chatId != null && ctx.chatId !== draft.chatId) {
    await ctx.reply("Отправьте содержимое поста в тот же чат, где был /post on.");
    return;
  }

  const urls = extractImageUrlsFromAttachments(ctx.message?.body?.attachments);
  if (!text && urls.length === 0) {
    await ctx.reply(
      "Пусто. Следующим сообщением пришлите текст поста и/или вложения с изображениями."
    );
    return;
  }

  const imageFiles = [];
  if (urls.length > 0) {
    await ctx.reply("Принял пост, обрабатываю вложения (JPEG + ресайз)…");
    try {
      for (const url of urls) {
        const buf = await fetchImageBuffer(url);
        const rel = await processBufferToStoredJpeg(buf);
        imageFiles.push(rel);
      }
    } catch (err) {
      console.error("[post draft image]", err);
      await ctx.reply(
        `Не удалось обработать вложение: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
  }

  setDraftContent(uid, text, imageFiles);
  await ctx.reply(
    [
      "Черновик поста сохранен.",
      "Теперь задайте время командой:",
      "• `/post time 2026-03-25 18h30m`",
      "или",
      "• `/post time +1h 30m`",
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "MaxBot1 — отложенный постинг в канал MAX.",
      "",
      "**Новый поток постинга**",
      "1) `/post on`",
      "2) Следующим сообщением отправьте пост (текст и/или вложения-изображения)",
      "3) `/post time 2026-03-25 18h30m` или `/post time +1h 30m`",
      "",
      "**Сервисные**",
      "• `/post list [asc|desc]` — список постов (сортировка по времени)",
      "• `/post delete <id>` — удалить пост по id",
      "• `/post off` — сбросить текущий черновик",
      "• `/help` — подробная инструкция",
      "• `/my_id` — ваш user_id",
      "• `/chat_id` — id текущего чата/канала",
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "**Настройка и постинг**",
      "",
      "**Подготовка**",
      "• В `.env`: `BOT_TOKEN`, `CHANNEL_ID`, `ADMIN_USER_IDS`.",
      "• `CHANNEL_ID` возьмите командой `/chat_id` в нужном канале.",
      "• Для `ADMIN_USER_IDS`: в личке `/my_id` и внесите id через запятую.",
      "",
      "**Как запланировать пост**",
      "1. `/post on`",
      "2. Следующим сообщением отправьте текст и/или вложения с изображениями.",
      "3. `/post time ...`",
      "   - Точно: `yyyy-mm-dd HHhMMm` (пример `2026-03-25 18h30m`)",
      "   - Относительно: `+1h 30m`, `+90m`, `+2h`",
      "   - После успешного планирования бот возвращает `id` поста.",
      "",
      "**Дополнительно**",
      "• `/post list [asc|desc]` — список (id, время, первая строка).",
      "• `/post delete <id>` — удаление поста по идентификатору.",
      "• `/post off` — отменить черновик.",
      "• Изображения из поста обрабатываются: JPEG + ресайз и хранятся локально до отправки.",
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.command("my_id", async (ctx) => {
  const id = ctx.user?.user_id;
  await ctx.reply(
    id != null
      ? `Ваш user_id: ${id}\nДобавьте его в ADMIN_USER_IDS в .env через запятую.`
      : "Не удалось определить user_id."
  );
});

bot.command("chat_id", async (ctx) => {
  const cid = ctx.chatId;
  const chat = ctx.chat;
  if (cid == null) {
    await ctx.reply(
      "Не удалось определить chat_id. Отправьте /chat_id в нужном чате/канале."
    );
    return;
  }
  const type = chat?.type ?? "неизвестно";
  const title = chat?.title?.trim() ? chat.title : "—";
  await ctx.reply(
    [
      "**Текущий чат**",
      `• **chat_id:** \`${cid}\``,
      `• **тип:** ${type} (channel / chat / dialog)`,
      `• **название:** ${title}`,
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.hears(/^\/post(?:@\S+)?\s+on\s*$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;
  const uid = ctx.user?.user_id;
  if (uid == null) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }
  beginDraft(uid, ctx.chatId);
  await ctx.reply(
    [
      "Режим формирования поста включен.",
      "Следующим сообщением отправьте то, что нужно постить (текст и/или вложения).",
      "После этого завершите командой `/post time ...`.",
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.hears(/^\/post(?:@\S+)?\s+off\s*$/i, async (ctx) => {
  const uid = ctx.user?.user_id;
  if (uid != null) clearDraft(uid);
  await ctx.reply("Черновик поста сброшен.");
});

bot.hears(/^\/post(?:@\S+)?\s+time\s+(.+)$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;

  const uid = ctx.user?.user_id;
  if (uid == null) {
    await ctx.reply("Не удалось определить пользователя.");
    return;
  }

  const draft = getDraft(uid);
  if (!draft) {
    await ctx.reply("Черновик не найден. Начните с `/post on`.");
    return;
  }
  if (draft.stage !== "await_time") {
    await ctx.reply(
      "Сначала отправьте следующим сообщением содержимое поста (текст и/или вложения), затем `/post time ...`."
    );
    return;
  }

  const parsed = parsePostTime(ctx.match[1]);
  if (!parsed.ok) {
    await ctx.reply(
      [
        "Неверный формат времени.",
        "Точно: `/post time 2026-03-25 18h30m`",
        "Относительно: `/post time +1h 30m`",
      ].join("\n"),
      { format: "markdown" }
    );
    return;
  }

  try {
    const job = scheduler.addJob(
      parsed.runAt,
      draft.text,
      null,
      null,
      draft.imageFiles
    );
    clearDraft(uid);
    await ctx.reply(
      [
        "Пост запланирован.",
        `**id:** \`${job.id}\``,
        `**время:** ${new Date(job.runAt).toISOString()}`,
      ].join("\n"),
      { format: "markdown" }
    );
  } catch (err) {
    console.error("[post time]", err);
    await ctx.reply(
      `Не удалось запланировать пост: ${err instanceof Error ? err.message : String(err)}`
    );
  }
});

bot.hears(/^\/post(?:@\S+)?\s+list(?:\s+(\S+))?\s*$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;

  const sortArg = (ctx.match[1] ?? "asc").toLowerCase();
  const list = scheduler.list();
  if (list.length === 0) {
    await ctx.reply("Запланированных постов нет.");
    return;
  }

  if (sortArg === "desc" || sortArg === "new" || sortArg === "latest") {
    list.reverse();
  } else if (
    sortArg !== "asc" &&
    sortArg !== "old" &&
    sortArg !== "earliest"
  ) {
    await ctx.reply(
      "Неизвестный режим сортировки. Используйте `/post list asc` или `/post list desc`.",
      { format: "markdown" }
    );
    return;
  }

  const lines = list.map((j) => {
    const first = (j.text ?? "").split(/\r?\n/, 1)[0].trim();
    const preview = first.length > 120 ? `${first.slice(0, 120)}…` : first;
    const textLine = preview || "(без текста)";
    const imgMark =
      (Array.isArray(j.imageFiles) && j.imageFiles.length > 0) ||
      (typeof j.imageFile === "string" && j.imageFile)
        ? " 📷"
        : "";
    return `• \`${j.id}\` — ${new Date(j.runAt).toISOString()}${imgMark}\n  ${textLine}`;
  });

  await ctx.reply(lines.join("\n\n"), { format: "markdown" });
});

bot.hears(/^\/post(?:@\S+)?\s+delete\s+(\S+)\s*$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;

  const id = ctx.match[1].trim();
  const removed = scheduler.cancel(id);
  await ctx.reply(
    removed ? `Пост удален: ${id}` : `Пост с id ${id} не найден.`
  );
});

bot.hears(/.+/, async (ctx) => {
  const text = ctx.message?.body?.text ?? "";
  if (text.startsWith("/")) return;
  await ctx.reply("Команда не распознана. Используйте /start.");
});

bot.catch((err, ctx) => {
  console.error("Ошибка бота:", err);
  if (ctx?.updateType) console.error("update:", ctx.updateType);
});

if (scheduler) {
  scheduler.start();
  console.log(`Планировщик канала: CHANNEL_ID=${channelId}`);
} else {
  console.warn("CHANNEL_ID не задан или неверный — постинг отключен.");
}
if (adminIds.size === 0) {
  console.warn(
    "ADMIN_USER_IDS пуст — команды /post будут недоступны до настройки .env."
  );
}

await bot.start();
console.log("MaxBot1 подключен к MAX, ожидаю обновления…");
