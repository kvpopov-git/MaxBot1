# MaxBot1

Чат-бот для мессенджера [MAX](https://dev.max.ru) на Node.js: отложенная публикация в канал, опционально с изображением по URL.

## Запуск

1. Скопируйте `.env.example` в `.env`, заполните переменные.
2. `npm install`
3. `npm start`

Подробности — в [PROJECT_RULES.md](./PROJECT_RULES.md).

## Git и GitHub

### Локальный репозиторий

Укажите автора коммитов (один раз для этого клона или глобально):

```bash
git config user.name "Ваше имя"
git config user.email "ваш@email"
```

### Новый репозиторий на GitHub

1. Войдите на [github.com](https://github.com), **New repository** (можно без README, чтобы не было конфликта).
2. В папке проекта:

```bash
git remote add origin https://github.com/<ваш_логин>/<имя_репозитория>.git
git push -u origin main
```

Для **SSH**:

```bash
git remote add origin git@github.com:<ваш_логин>/<имя_репозитория>.git
git push -u origin main
```

При первом `push` GitHub запросит аутентификацию: [Personal Access Token](https://github.com/settings/tokens) (HTTPS) или ключ SSH.

### В Cursor / VS Code

Установите расширение **GitHub** (при необходимости), войдите в аккаунт (**Accounts** в левой панели), затем работа с remotes и push из панели **Source Control**.

## Что не попадает в репозиторий

См. `.gitignore`: `node_modules/`, `.env`, `data/`, логи.
