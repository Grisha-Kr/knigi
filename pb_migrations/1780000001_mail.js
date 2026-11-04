/// <reference path="../pb_data/types.d.ts" />

// Письма на русском и защита ящика от лишних писем (как в «Молитвенном дневнике», правки 2.2).
// 1. Шаблоны всех писем коллекции users: сброс пароля, подтверждение почты, смена почты, код для входа (OTP),
//    вход с нового устройства. Ссылки ведут в само приложение: /?reset=КЛЮЧ, /?verify=КЛЮЧ, /?email-change=КЛЮЧ.
//    {MOL_HELLO} (обращение по имени) и {MOL_TTL} (срок ссылки из настроек коллекции) подставляет хук
//    при отправке (mailPolish в lib.js), он же меняет стандартную обёртку письма PocketBase на свою.
// 2. Ограничение частоты (rate limits): 3 запроса в час с одного адреса в интернете на каждое письмо.
//    Стандартные правила PocketBase, пока ограничения были выключены, убираются: остальные запросы не ограничиваются, как и раньше.
// 3. mail_log: учёт писем для лимита «5 писем в сутки на одну почту» (проверяет хук). Видит только суперпользователь.
// Настройки почты (SMTP, адрес и имя отправителя) миграция не трогает.

migrate((app) => {
  const MAIL_RULES = ["requestPasswordReset", "requestVerification", "requestEmailChange", "requestOTP"]
    .map((a) => ({ label: "users:" + a, audience: "", duration: 3600, maxRequests: 3 }));
  const PB_DEFAULTS = ["*:auth|3|2", "*:create|5|20", "/api/batch|1|3", "/api/|10|300"];

  // --- письма ---
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const P = `margin:0 0 16px;font-size:16px;line-height:24px;color:#26231F;`;
  const SMALL = `margin:0 0 12px;font-size:14px;line-height:20px;color:#6E665A;`;
  const p = (text) => `<p class="mol-ink" style="${P}">${text}</p>`;
  const small = (text) => `<p class="mol-muted" style="${SMALL}">${text}</p>`;
  const button = (href, text) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td class="mol-btn" align="center" bgcolor="#2C4A66" style="background:#2C4A66;border-radius:12px;">
<a class="mol-btn-a" href="${href}" target="_blank" rel="noopener" style="display:block;padding:15px 20px;font-family:${font};font-size:17px;line-height:22px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:12px;">${text}</a>
</td></tr></table>`;
  const linkText = (href) => small(`Если кнопка не нажимается, скопируйте ссылку в адресную строку браузера:<br>
<a class="mol-link" href="${href}" target="_blank" rel="noopener" style="color:#2C4A66;word-break:break-all;">${href}</a>`);
  const box = (inner) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
<td class="mol-box" bgcolor="#E3E8EC" style="background:#E3E8EC;border-radius:12px;padding:14px 16px;font-family:${font};font-size:15px;line-height:22px;color:#26231F;">${inner}</td>
</tr></table>`;
  const letter = (title, inner) => `<!--mol-->
<table class="mol-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4EFE6" style="width:100%;background:#F4EFE6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;">
<tr><td class="mol-card" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px;padding:28px 22px 16px;font-family:${font};color:#26231F;text-align:left;">
<h1 class="mol-ink" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:bold;color:#26231F;">${title}</h1>
${p("{MOL_HELLO}")}
${inner}
</td></tr>
<tr><td class="mol-muted" align="center" style="padding:16px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:#6E665A;">
Библиотека<br><a class="mol-muted" href="{APP_URL}" target="_blank" rel="noopener" style="color:#6E665A;">{APP_URL}</a>
</td></tr>
</table>
</td></tr></table>
<!--/mol-->`;

  const NOTHING = "Если вы ничего не запрашивали, просто удалите это письмо.";
  const reset = "{APP_URL}/?reset={TOKEN}";
  const verify = "{APP_URL}/?verify={TOKEN}";
  const change = "{APP_URL}/?email-change={TOKEN}";

  const templates = {
    resetPasswordTemplate: {
      subject: "Сброс пароля в Библиотеке",
      body: letter("Новый пароль",
        p("Вы попросили сбросить пароль в Библиотеке. Чтобы задать новый пароль, нажмите на кнопку.") +
        button(reset, "Задать новый пароль") +
        small("Ссылка действует {MOL_TTL} и срабатывает один раз.") +
        linkText(reset) +
        small(NOTHING + " Пароль останется прежним.")),
    },
    verificationTemplate: {
      subject: "Подтвердите почту в Библиотеке",
      body: letter("Подтверждение почты",
        p("Нажмите на кнопку, чтобы подтвердить, что этот адрес ваш.") +
        button(verify, "Подтвердить почту") +
        small("Ссылка действует {MOL_TTL}.") +
        linkText(verify) +
        small(NOTHING)),
    },
    confirmEmailChangeTemplate: {
      subject: "Подтвердите новую почту в Библиотеке",
      body: letter("Новая почта для входа",
        p("Вы попросили сменить почту для входа в Библиотеку на этот адрес. Нажмите на кнопку и введите текущий пароль, чтобы подтвердить.") +
        button(change, "Подтвердить новую почту") +
        small("Ссылка действует {MOL_TTL} и срабатывает один раз.") +
        linkText(change) +
        small(NOTHING + " Почта для входа останется прежней.")),
    },
    otp: {
      emailTemplate: {
        subject: "Код для входа в Библиотеку",
        body: letter("Код для входа",
          p("Ваш код для входа в Библиотеку:") +
          box(`<span style="font-size:30px;line-height:38px;font-weight:bold;letter-spacing:6px;">{OTP}</span>`) +
          small("Код действует {MOL_TTL}. Никому его не сообщайте.") +
          small(NOTHING)),
      },
    },
    authAlert: {
      emailTemplate: {
        subject: "Вход в Библиотеку с нового устройства",
        body: letter("Вход с нового устройства",
          p("В ваш аккаунт только что вошли с нового устройства или из новой сети:") +
          box(`<span class="mol-info">{ALERT_INFO}</span>`) +
          p("Если это были вы, ничего делать не нужно, письмо можно удалить.") +
          p("Если вы не входили, смените пароль: «Профиль» → «Сменить пароль». После смены все другие входы в аккаунт завершатся.") +
          button("{APP_URL}/#/profile", "Открыть библиотеку") +
          linkText("{APP_URL}/#/profile")),
      },
    },
  };
  const users = app.findCollectionByNameOrId("users");
  unmarshal(templates, users);
  app.save(users);

  // --- учёт писем для лимита на одну почту ---
  app.save(new Collection({
    type: "base",
    name: "mail_log",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
      { type: "text", name: "kind", max: 20 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_mail_log_user ON mail_log (user, created)"],
  }));

  // --- ограничение частоты ---
  const s = app.settings();
  const key = (r) => `${r.label}|${r.duration}|${r.maxRequests}`;
  let rules = (s.rateLimits.rules || []).map((r) => ({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests }));
  if (!s.rateLimits.enabled) rules = rules.filter((r) => r.audience || PB_DEFAULTS.indexOf(key(r)) < 0);
  rules = rules.filter((r) => !MAIL_RULES.some((m) => m.label === r.label));
  unmarshal({ rateLimits: { enabled: true, rules: rules.concat(MAIL_RULES) } }, s);
  app.save(s);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("mail_log")); } catch (_) {}
  const s = app.settings();
  const rules = (s.rateLimits.rules || [])
    .filter((r) => r.label.indexOf("users:request") !== 0)
    .map((r) => ({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests }));
  unmarshal({ rateLimits: { enabled: rules.length > 0, rules } }, s);
  app.save(s);
  // шаблоны писем остаются русскими: старые английские ссылки вели в панель PocketBase
});
