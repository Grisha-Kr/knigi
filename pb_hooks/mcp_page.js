// Этап 4: страница входа и согласия /oauth/authorize в оформлении «Библиотеки».
// Скрипт и стили отдельными файлами (pb_public/oauth.js, oauth.css): страница идёт со строгой
// политикой безопасности (CSP) без встроенных скриптов. Данные для скрипта лежат в <script type="application/json">.
function page(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#F4EFE6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15181B" media="(prefers-color-scheme: dark)">
<title>Вход · Библиотека</title>
<link rel="icon" href="/icons/favicon-32.png?v=2" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/oauth.css?v=1">
<script src="/oauth-theme.js?v=1"></script>
</head>
<body>
<main class="oa">
  <div class="oa-card">
    <div class="oa-brand"><span class="oa-logo" aria-hidden="true"></span><span class="oa-name">Библиотека</span></div>
    <div id="oa-body" aria-live="polite"><p class="oa-muted">Загружаю…</p></div>
  </div>
  <p class="oa-foot">Отключить помощника можно в приложении: Профиль → «Подключение к ИИ».</p>
</main>
<script type="application/json" id="oa-data">${json}</script>
<script src="/oauth.js?v=1"></script>
</body>
</html>`;
}
module.exports = { page };
