import "dotenv/config";
import { Bot } from "@maxhub/max-bot-api";
import { createChannelScheduler } from "./scheduler.js";
import { parseAdminIds, isAdmin } from "./admin.js";
import { parsePostBody } from "./parse.js";

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
  Number.isFinite(channelId) && channelId > 0
    ? createChannelScheduler(bot, { channelId })
    : null;

function denySchedule(ctx) {
  if (!scheduler) {
    return ctx.reply(
      "Отложенный постинг не настроен: задайте CHANNEL_ID в .env (числовой chat_id канала, где бот — администратор)."
    );
  }
  if (adminIds.size === 0) {
    return ctx.reply(
      "Задайте ADMIN_USER_IDS в .env (ваш user_id через запятую). Свой id можно узнать командой /my_id."
    );
  }
  if (!isAdmin(ctx, adminIds)) {
    return ctx.reply("Нет прав на планирование постов.");
  }
  return null;
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "MaxBot1 — мессенджер MAX.",
      "",
      "**Канал (отложенный постинг)**",
      "• /post_in <минуты> <текст> — публикация через N минут",
      "• /post_at <ISO-время> <текст> — в момент времени",
      "  с **картинкой** (URL, подпись опциональна):",
      "  `/post_in 60 --img https://example.com/a.jpg Текст под постом`",
      "• /post_list — запланированные посты",
      "• /post_cancel <id> — отменить",
      "",
      "**Прочее**",
      "• /my_id — ваш user_id (для ADMIN_USER_IDS)",
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

bot.hears(/^\/post_in(?:@\S+)?\s+(\d+)\s+([\s\S]+)$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;
  const minutes = Number(ctx.match[1]);
  const rawBody = ctx.match[2];
  if (minutes <= 0 || minutes > 525600) {
    await ctx.reply("Укажите от 1 до 525600 минут (год).");
    return;
  }
  const parsed = parsePostBody(rawBody);
  if (parsed.error === "bad_url") {
    await ctx.reply(
      "После --img укажите корректный URL картинки (http или https)."
    );
    return;
  }
  if (!parsed.text && !parsed.imageUrl) {
    await ctx.reply("Нужен текст поста и/или картинка: `--img <URL> подпись`.");
    return;
  }
  const runAt = Date.now() + minutes * 60_000;
  const job = scheduler.addJob(runAt, parsed.text, parsed.imageUrl);
  const imgNote = job.imageUrl ? "\n**фото:** URL" : "";
  await ctx.reply(
    `Пост запланирован.${imgNote}\n**id:** \`${job.id}\`\n**время:** ${new Date(job.runAt).toISOString()}`,
    { format: "markdown" }
  );
});

bot.hears(/^\/post_at(?:@\S+)?\s+(\S+)\s+([\s\S]+)$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;
  const iso = ctx.match[1];
  const rawBody = ctx.match[2];
  const runAt = new Date(iso).getTime();
  if (Number.isNaN(runAt)) {
    await ctx.reply(
      "Неверная дата. Пример: /post_at 2026-03-25T15:00:00+03:00 Текст поста"
    );
    return;
  }
  const parsed = parsePostBody(rawBody);
  if (parsed.error === "bad_url") {
    await ctx.reply(
      "После --img укажите корректный URL картинки (http или https)."
    );
    return;
  }
  if (!parsed.text && !parsed.imageUrl) {
    await ctx.reply("Нужен текст поста и/или картинка: `--img <URL> подпись`.");
    return;
  }
  if (runAt <= Date.now()) {
    await ctx.reply("Укажите время в будущем.");
    return;
  }
  const job = scheduler.addJob(runAt, parsed.text, parsed.imageUrl);
  const imgNote = job.imageUrl ? "\n**фото:** URL" : "";
  await ctx.reply(
    `Пост запланирован.${imgNote}\n**id:** \`${job.id}\`\n**время:** ${new Date(job.runAt).toISOString()}`,
    { format: "markdown" }
  );
});

bot.hears(/^\/post_list(?:@\S+)?\s*$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;
  const list = scheduler.list();
  if (list.length === 0) {
    await ctx.reply("Нет запланированных постов.");
    return;
  }
  const lines = list.map((j) => {
    const pic = j.imageUrl ? " 📷 " : "";
    const preview = j.text.slice(0, 200) + (j.text.length > 200 ? "…" : "");
    return `• \`${j.id}\` — ${new Date(j.runAt).toISOString()}${pic}\n  ${preview || "(без текста)"}`;
  });
  await ctx.reply(lines.join("\n\n"), { format: "markdown" });
});

bot.hears(/^\/post_cancel(?:@\S+)?\s+(\S+)$/i, async (ctx) => {
  const denied = denySchedule(ctx);
  if (denied) return;
  const id = ctx.match[1].trim();
  const n = scheduler.cancel(id);
  await ctx.reply(
    n ? `Отменено: ${id}` : `Задание ${id} не найдено.`
  );
});

bot.hears(/.+/, async (ctx) => {
  const text = ctx.message?.body?.text ?? "";
  if (text.startsWith("/")) return;
  await ctx.reply(`Вы написали: ${text}`);
});

bot.catch((err, ctx) => {
  console.error("Ошибка бота:", err);
  if (ctx?.updateType) console.error("update:", ctx.updateType);
});

if (scheduler) {
  scheduler.start();
  console.log(`Планировщик канала: CHANNEL_ID=${channelId}`);
} else {
  console.warn(
    "CHANNEL_ID не задан или неверный — отложенный постинг в канал отключён."
  );
}
if (adminIds.size === 0) {
  console.warn(
    "ADMIN_USER_IDS пуст — команды /post_* будут недоступны до настройки .env."
  );
}

await bot.start();
console.log("MaxBot1 подключён к MAX, ожидаю обновления…");
