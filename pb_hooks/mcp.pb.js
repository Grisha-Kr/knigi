/// <reference path="../pb_data/types.d.ts" />

// Этап 4: удалённый сервер MCP для ИИ-помощников (Claude, ChatGPT, Perplexity) и вход по OAuth.
// Адрес для помощников: https://knigi.grishaweb.ru/mcp
// Вход и токены: mcp_lib.js, инструменты: mcp_tools.js, страница входа: mcp_page.js.
// Подключать может только администратор библиотеки. MCP_ENABLED=0 отключает /mcp и выдачу токенов.

/* ---------- Описание ресурса и сервера авторизации ---------- */
routerAdd("GET", "/.well-known/oauth-protected-resource", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "pr"));
routerAdd("GET", "/.well-known/oauth-protected-resource/mcp", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "pr"));
routerAdd("GET", "/.well-known/oauth-authorization-server", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "as"));
routerAdd("GET", "/.well-known/oauth-authorization-server/mcp", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "as"));
routerAdd("GET", "/.well-known/openid-configuration", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "as"));
routerAdd("GET", "/.well-known/openid-configuration/mcp", (e) => require(`${__hooks}/mcp_lib.js`).meta(e, "as"));

/* ---------- Регистрация клиента (DCR, RFC 7591) ---------- */
routerAdd("POST", "/oauth/register", (e) => {
  const M = require(`${__hooks}/mcp_lib.js`);
  e.response.header().set("Cache-Control", "no-store");
  if (!M.CFG.enabled()) return e.json(503, { error: "temporarily_unavailable", error_description: "Подключение к ИИ-помощникам выключено на сервере (MCP_ENABLED=0)." });
  let body = {};
  try { body = JSON.parse(readerToString(e.request.body, 64 * 1024) || "{}"); } catch (_) { return e.json(400, { error: "invalid_client_metadata", error_description: "Нужен JSON." }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return e.json(400, { error: "invalid_client_metadata", error_description: "Нужен JSON-объект." });
  const r = M.register(e, body);
  return e.json(r.status, r.body);
});

/* ---------- Обмен кода и обновление токена ---------- */
routerAdd("POST", "/oauth/token", (e) => {
  const r = require(`${__hooks}/mcp_lib.js`).tokenEndpoint(e);
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Pragma", "no-cache");
  if (r.status === 401) e.response.header().set("WWW-Authenticate", 'Basic realm="knigi"');
  return e.json(r.status, r.body);
});

/* ---------- Страница входа и согласия ---------- */
routerAdd("GET", "/oauth/authorize", (e) => {
  const M = require(`${__hooks}/mcp_lib.js`);
  const q = e.requestInfo().query || {};
  const a = M.checkAuthorize(e, q);
  if (a.redirect) return e.redirect(302, a.redirect);
  const h = e.response.header();
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  const data = a.fatal ? { fatal: a.fatal } : {
    service: a.service.label,
    params: {
      response_type: "code", client_id: a.client.getString("client_id"), redirect_uri: a.uri, state: a.state,
      code_challenge: a.challenge, code_challenge_method: "S256", scope: a.scope, resource: a.resource,
    },
  };
  return e.html(a.fatal ? 400 : 200, require(`${__hooks}/mcp_page.js`).page(data));
});

// «Разрешить» или «Отказать». Вход приложения (ключ PocketBase) в заголовке Authorization: страница
// берёт его из памяти браузера, где выполнен вход в «Библиотеку», или после формы входа.
routerAdd("POST", "/oauth/authorize", (e) => {
  const M = require(`${__hooks}/mcp_lib.js`);
  e.response.header().set("Cache-Control", "no-store");
  const body = e.requestInfo().body || {};
  const a = M.checkAuthorize(e, body);
  if (a.fatal) return e.json(400, { message: a.fatal });
  if (a.redirect) return e.json(200, { redirect: a.redirect });
  if (!body.allow) return e.json(200, { redirect: a.back("access_denied", "Владелец библиотеки отказал в доступе.").redirect });
  if (!require(`${__hooks}/lib.js`).isAdmin(e.auth)) {
    return e.json(403, { message: "Подключение к ИИ-помощникам доступно только администратору библиотеки." });
  }
  return e.json(200, { redirect: M.issueCode(e, a, e.auth) });
}, $apis.requireAuth("users"));

// Кто вошёл (для страницы согласия)
routerAdd("GET", "/oauth/me", (e) => {
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, { id: e.auth.id, name: e.auth.getString("name"), email: e.auth.getString("email"), admin: require(`${__hooks}/lib.js`).isAdmin(e.auth) });
}, $apis.requireAuth("users"));

// Вход почтой и паролем на странице согласия, с ограничением частоты: 10 попыток за 15 минут
// с одного адреса и 10 на одну почту. Ответ как у обычного входа PocketBase (ключ и запись),
// поэтому после этого и приложение в этом браузере открывается уже вошедшим.
routerAdd("POST", "/oauth/login", (e) => {
  const M = require(`${__hooks}/mcp_lib.js`);
  e.response.header().set("Cache-Control", "no-store");
  const body = e.requestInfo().body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const ip = e.realIP();
  if (!M.rateHit("login:" + ip, 10, 900) || !M.rateHit("login:" + email, 10, 900)) {
    return e.json(429, { message: `Слишком много попыток входа. Подождите ${M.rateWait("login:" + ip, 900)} мин. и попробуйте снова.` });
  }
  let u = null;
  try { u = $app.findAuthRecordByEmail("users", email); } catch (_) {}
  if (!u || !u.validatePassword(String(body.password || ""))) {
    return e.json(400, { message: "Неверная почта или пароль." });
  }
  return $apis.recordAuthResponse(e, u, "password", null);
});

/* ---------- Сервер MCP (Streamable HTTP, ответы JSON) ---------- */
// SSE не нужен: каждый запрос получает один ответ JSON, уведомления сервер не шлёт.
routerAdd("GET", "/mcp", (e) => {
  e.response.header().set("Allow", "POST");
  return e.json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Используйте POST. Потока SSE у этого сервера нет." } });
});
routerAdd("DELETE", "/mcp", (e) => {
  e.response.header().set("Allow", "POST");
  return e.json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Сеансов у этого сервера нет, закрывать нечего." } });
});
routerAdd("POST", "/mcp", (e) => {
  const M = require(`${__hooks}/mcp_lib.js`);
  const T = require(`${__hooks}/mcp_tools.js`);
  const h = e.response.header();
  h.set("Cache-Control", "no-store");
  const err = (status, code, message) => e.json(status, { jsonrpc: "2.0", id: null, error: { code, message } });
  if (!M.CFG.enabled()) return err(503, -32000, "Подключение к ИИ-помощникам выключено на сервере (MCP_ENABLED=0).");
  const ip = e.realIP();
  if (!M.ipAllowed(ip)) {
    console.log(`MCP: отклонён запрос с адреса ${ip} (нет в MCP_IP_ALLOW)`);
    return err(403, -32000, "Доступ с этого адреса закрыт (MCP_IP_ALLOW).");
  }
  // Origin из браузера: только свой сайт, сайты помощников и localhost (MCP Inspector). Защита от DNS rebinding.
  const origin = String(e.request.header.get("Origin") || "");
  if (origin) {
    const m = /^https?:\/\/([^/:]+)/i.exec(origin);
    const host = m ? m[1].toLowerCase() : "";
    const own = (/^https?:\/\/([^/:]+)/i.exec(M.baseUrl(e)) || [])[1] || "";
    const ok = host && (host === own.toLowerCase() || host === "localhost" || host === "127.0.0.1" ||
      M.CFG.redirectHosts().some((x) => host === x || host.endsWith("." + x)));
    if (!ok) return err(403, -32000, "Запрос с чужого сайта отклонён.");
  }
  if (!M.rateHit("mcp:" + ip, 300, 60)) return err(429, -32000, "Слишком много запросов. Подождите минуту.");
  const auth = M.bearerGrant(e);
  if (!auth.grant) {
    h.set("WWW-Authenticate", M.wwwAuth(e, auth.why));
    return err(401, -32001, auth.why ? "Токен недействителен или устарел. Войдите заново." : "Нужен вход: подключите библиотеку как коннектор с OAuth.");
  }
  const pv = String(e.request.header.get("MCP-Protocol-Version") || "");
  let raw = "";
  try { raw = readerToString(e.request.body, 2 * 1024 * 1024); } catch (_) {}
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return err(400, -32700, "Не удалось разобрать JSON."); }
  const batch = Array.isArray(msg);
  const list = batch ? msg : [msg];
  const isInit = list.some((x) => x && x.method === "initialize");
  if (pv && !isInit && M.PROTOCOLS.indexOf(pv) < 0) return err(400, -32600, "Неподдерживаемая версия протокола MCP: " + pv);
  const ctx = { user: auth.user, grant: auth.grant, base: M.baseUrl(e), service: auth.grant.getString("service") };
  const out = [];
  for (const x of list) {
    const r = T.rpc(x, ctx);
    if (r) out.push(r);
  }
  if (!out.length) return e.noContent(202);
  return e.json(200, batch ? out : out[0]);
});

/* ---------- Раздел «Подключение к ИИ» в профиле (только администратор) ---------- */
routerAdd("GET", "/api/knigi/admin/mcp", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const M = require(`${__hooks}/mcp_lib.js`);
  return e.json(200, {
    url: M.resourceUrl(e), enabled: M.CFG.enabled(), ip_allow: M.CFG.ipAllow(), redirect_hosts: M.CFG.redirectHosts(),
    connections: M.connections(e.auth.id), log: M.logRows(100),
  });
}, $apis.requireAuth("users"));
// «Отключить»: подключение удаляется вместе со всеми его токенами и кодами
routerAdd("DELETE", "/api/knigi/admin/mcp/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  let g = null;
  try { g = $app.findRecordById("mcp_grants", e.request.pathValue("id")); } catch (_) {}
  if (!g || g.getString("user") !== e.auth.id) throw new NotFoundError("Подключение не найдено: возможно, его уже отключили.");
  $app.delete(g);
  $app.logger().info("ИИ-помощник отключён", "service", g.getString("service"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

cronAdd("knigi_mcp_clean", "29 4 * * *", () => {
  try { require(`${__hooks}/mcp_lib.js`).clean(); } catch (err) { $app.logger().error("Уборка MCP", "error", String(err)); }
});
