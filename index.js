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
      "Полная настройка канала и прав пользователей: **/help**",
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
      "• /chat_id — id текущего чата/канала (для CHANNEL_ID в .env)",
    ].join("\n"),
    { format: "markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "**Настройка бота на канал и пользователей**",
      "",
      "**1. Токен и файл .env**",
      "• Зарегистрируйте бота на [dev.max.ru](https://dev.max.ru), скопируйте **BOT_TOKEN**.",
      "• На сервере с ботом в корне проекта создайте файл **`.env`** (образец — **`.env.example`**).",
      "• Строка: `BOT_TOKEN=...`",
      "",
      "**2. Привязка к конкретному каналу (CHANNEL_ID)**",
      "• Добавьте бота в нужный **канал** и выдайте права на **публикацию сообщений** (администратор канала).",
      "• В **этом канале** отправьте команду **`/chat_id`** — бот ответит числом **chat_id**.",
      "• Если **тип** в ответе **`channel`**, это id канала: добавьте в `.env`:",
      "`CHANNEL_ID=<это число>`",
      "",
      "**3. Кто может планировать посты (ADMIN_USER_IDS)**",
      "• Каждый администратор в MAX пишет боту в **личку** **`/my_id`** — получает свой **user_id**.",
      "• В **`.env`** перечислите id через запятую:",
      "`ADMIN_USER_IDS=12345678,87654321`",
      "",
      "**4. Перезапуск**",
      "• Сохраните `.env` и перезапустите процесс (`npm start`).",
      "• Проверка: от имени пользователя из списка отправьте **`/post_list`** или **`/post_in 1 тест`**.",
      "",
      "**Справка по командам** — **`/start`**.",
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
      "Не удалось определить chat_id. Отправьте /chat_id прямо из нужного чата или канала, где бот получает сообщения."
    );
    return;
  }
  const type = chat?.type ?? "неизвестно";
  const title = chat?.title?.trim() ? chat.title : "—";
  const link = chat?.link?.trim() ? `\n• **ссылка:** ${chat.link}` : "";
  await ctx.reply(
    [
      "**Текущий чат (по этому сообщению)**",
      `• **chat_id:** \`${cid}\` — подставьте в CHANNEL_ID, если это целевой канал`,
      `• **тип:** ${type} (channel / chat / dialog)`,
      `• **название:** ${title}${link}`,
    ].join("\n"),
    { format: "markdown" }
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
