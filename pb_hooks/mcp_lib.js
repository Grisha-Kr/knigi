// Этап 4: вход ИИ-помощников по OAuth и общие функции сервера MCP.
// Подключается в обработчиках через require(`${__hooks}/mcp_lib.js`).
//
// Как устроено:
// 1. Помощник обращается к /mcp без токена и получает 401 с адресом описания ресурса.
// 2. Читает /.well-known/oauth-protected-resource и /.well-known/oauth-authorization-server.
// 3. Регистрируется сам: POST /oauth/register (DCR), получает client_id и client_secret.
// 4. Открывает человеку /oauth/authorize: вход «Библиотеки» и «Разрешить» (только администратор).
// 5. Меняет одноразовый код на токены: POST /oauth/token (PKCE S256 обязателен).
// 6. Ходит на /mcp с заголовком Authorization: Bearer ТОКЕН, обновляет токен через /oauth/token.
// В базе только хэши токенов, кодов и секретов (sha256).

const ABC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ACCESS_TTL = 3600;              // токен доступа: час
const REFRESH_TTL = 60 * 86400;       // токен обновления: 60 дней, при каждом обновлении срок начинается заново
const CODE_TTL = 300;                 // код авторизации: 5 минут, одноразовый
const LOG_DAYS = 90;                  // журнал обращений
const SCOPES = ["library", "offline_access"];
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/* ---------- Настройки из knigi.env ---------- */
const env = (n) => String($os.getenv(n) || "").trim();
const CFG = {
  enabled: () => { const v = env("MCP_ENABLED").toLowerCase(); return v === "" || v === "1" || v === "true" || v === "да"; },
  redirectHosts: () => (env("MCP_REDIRECT_HOSTS") || "claude.ai,chatgpt.com,perplexity.ai").split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\*?\./, "")).filter(Boolean),
  ipAllow: () => env("MCP_IP_ALLOW").split(",").map((x) => x.trim()).filter(Boolean),
  maxChars: () => { const n = parseInt(env("MCP_MAX_CHARS"), 10); return n >= 2000 && n <= 500000 ? n : 40000; },
};

// Адрес библиотеки: APP_URL из настроек, иначе из запроса (у себя на компьютере)
function baseUrl(e) {
  let u = env("APP_URL");
  if (!u && e) {
    const proto = String(e.request.header.get("X-Forwarded-Proto") || "").toLowerCase() === "https" || e.isTLS() ? "https" : "http";
    u = proto + "://" + e.request.host;
  }
  return String(u || "http://127.0.0.1:8093").replace(/\/+$/, "");
}
// Адрес ресурса MCP в каноническом виде: строчные схема и хост, без косой черты в конце
function resourceUrl(e) {
  const b = baseUrl(e);
  const m = /^(https?):\/\/([^/]+)(.*)$/i.exec(b);
  return (m ? m[1].toLowerCase() + "://" + m[2].toLowerCase() + m[3] : b) + "/mcp";
}
function sameResource(e, r) {
  r = String(r || "").trim().replace(/\/+$/, "");
  if (!r) return true;
  const m = /^(https?):\/\/([^/]+)(.*)$/i.exec(r);
  if (!m) return false;
  const canon = m[1].toLowerCase() + "://" + m[2].toLowerCase().replace(/:443$/, "").replace(/:80$/, "") + m[3];
  return canon === resourceUrl(e) || canon === baseUrl(e);
}

/* ---------- Хэши и случайные строки ---------- */
const randomToken = (prefix, n) => prefix + $security.randomStringWithAlphabet(n, ABC);
const hash = (s) => $security.sha256(String(s || ""));
function same(a, b) { return $security.equal(String(a || ""), String(b || "")); }

// base64url от шестнадцатеричной строки (для PKCE: base64url(sha256(verifier)))
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function hexToB64url(hex) {
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
function pkceOk(verifier, challenge) {
  verifier = String(verifier || "");
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return same(hexToB64url($security.sha256(verifier)), challenge);
}
// base64 → строка (заголовок Authorization: Basic …; client_id и секрет у нас латиница и цифры)
function b64decode(s) {
  s = String(s || "").replace(/[\s=]/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  let bits = 0, val = 0, out = "";
  for (const ch of s) {
    const i = B64.indexOf(ch);
    if (i < 0) return "";
    val = (val << 6) | i; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 255); }
  }
  try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
}

const nowIso = () => new Date().toISOString().replace("T", " ");
const isoAfter = (sec) => new Date(Date.now() + sec * 1000).toISOString().replace("T", " ");
const expired = (d) => !d || String(d) < nowIso();

/* ---------- Ограничение частоты ---------- */
// Окно в памяти сервера ($app.store): не больше max событий за sec секунд по ключу. После перезапуска с нуля.
function rateHit(key, max, sec) {
  let ok = true;
  const now = Date.now();
  $app.store().setFunc("kn_mcp_rate:" + key, (old) => {
    let st = old && now - old.t < sec * 1000 ? old : { t: now, n: 0 };
    if (st.n >= max) { ok = false; return st; }
    return { t: st.t, n: st.n + 1 };
  });
  return ok;
}
function rateWait(key, sec) {
  const st = $app.store().get("kn_mcp_rate:" + key);
  return st ? Math.max(1, Math.ceil((st.t + sec * 1000 - Date.now()) / 60000)) : 1;
}

/* ---------- Адреса в интернете (MCP_IP_ALLOW) ---------- */
function ipBytes(ip) {
  ip = String(ip || "").trim().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) return v4.slice(1).map(Number).every((x) => x <= 255) ? v4.slice(1).map(Number) : null;
  if (ip.indexOf(":") < 0) return null;
  const m4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip); // ::ffff:1.2.3.4
  let tail = [];
  if (m4) { const t = ipBytes(m4[2]); if (!t) return null; tail = t; ip = m4[1] + "0:0"; }
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (fill < 0 || (parts.length === 1 && fill !== 0)) return null;
  const words = head.concat(Array(parts.length === 2 ? fill : 0).fill("0"), rest);
  const out = [];
  for (const w of words) { if (!/^[0-9a-f]{1,4}$/i.test(w)) return null; const n = parseInt(w, 16); out.push(n >> 8, n & 255); }
  if (tail.length) { out.splice(12, 4, ...tail); }
  // IPv4 внутри IPv6 (::ffff:a.b.c.d) сравниваем как IPv4
  if (out.slice(0, 10).every((x) => x === 0) && out[10] === 255 && out[11] === 255) return out.slice(12);
  return out;
}
function inRange(ip, cidr) {
  const [net, bitsS] = String(cidr).split("/");
  const a = ipBytes(ip), b = ipBytes(net);
  if (!a || !b || a.length !== b.length) return false;
  let bits = bitsS === undefined ? a.length * 8 : parseInt(bitsS, 10);
  if (!(bits >= 0 && bits <= a.length * 8)) return false;
  for (let i = 0; i < a.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 255 : (255 << (8 - bits)) & 255;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
}
function ipAllowed(ip) {
  const list = CFG.ipAllow();
  return !list.length || list.some((c) => inRange(ip, c));
}

/* ---------- Адреса возврата и названия сервисов ---------- */
const BRANDS = [
  { key: "claude", name: "Claude", hosts: ["claude.ai", "claude.com", "anthropic.com"] },
  { key: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com", "openai.com"] },
  { key: "perplexity", name: "Perplexity", hosts: ["perplexity.ai"] },
];
// Сайты, которые показываются по-человечески: «Claude (claude.ai)». Незнакомый поддомен показывается как есть.
const KNOWN = { "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "perplexity.ai": "Perplexity", "www.perplexity.ai": "Perplexity" };
const hostMatch = (host, h) => host === h || host.endsWith("." + h);

// Разобрать адрес возврата: только https, без логина в адресе и без #
function parseRedirect(uri) {
  const m = /^https:\/\/([a-z0-9.-]+)(:\d{1,5})?(\/[^#\s]*)?$/i.exec(String(uri || ""));
  return m ? { host: m[1].toLowerCase(), uri: String(uri) } : null;
}
function redirectAllowed(uri) {
  const p = parseRedirect(uri);
  return !!(p && CFG.redirectHosts().some((h) => hostMatch(p.host, h)));
}
function logRejected(uri, where, ip) {
  $app.logger().warn(`Отклонён адрес возврата: ${String(uri).slice(0, 300)}`, "где", where, "ip", ip || "",
    "разрешены", CFG.redirectHosts().join(","));
  console.log(`Отклонён адрес возврата: ${String(uri).slice(0, 300)} (${where}; разрешены сайты: ${CFG.redirectHosts().join(", ")}, настройка MCP_REDIRECT_HOSTS)`);
}
// Кто это: { name: «Claude», label: «Claude (claude.ai)», host }
function serviceOf(uri) {
  const p = parseRedirect(uri);
  const host = p ? p.host : String(uri || "");
  const brand = BRANDS.find((b) => b.hosts.some((h) => hostMatch(host, h)));
  const known = KNOWN[host];
  const site = host.replace(/^www\./, "");
  return {
    host,
    name: known || (brand ? brand.name : host),
    label: known ? `${known} (${site})` : host,
  };
}

/* ---------- Клиенты (DCR, RFC 7591) ---------- */
function findClient(clientId) {
  clientId = String(clientId || "");
  if (!clientId || clientId.length > 64) return null;
  try { return $app.findFirstRecordByData("mcp_clients", "client_id", clientId); } catch (_) { return null; }
}
function clientRedirects(c) {
  let list = [];
  try { list = JSON.parse(toString(c.get("redirect_uris")) || "[]"); } catch (_) { list = []; }
  return Array.isArray(list) ? list.map(String) : [];
}
// Регистрация. Секрет выдаётся всегда (Perplexity без него обрывает подключение),
// но проверяется на /oauth/token только у клиентов client_secret_post и client_secret_basic.
function register(e, body) {
  const ip = e.realIP();
  if (!rateHit("reg:" + ip, 30, 3600)) return { status: 429, body: { error: "too_many_requests", error_description: "Слишком много регистраций с этого адреса. Попробуйте через час." } };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Нужен хотя бы один адрес возврата (redirect_uris)." } };
  for (const u of uris) {
    if (!redirectAllowed(u)) {
      logRejected(u, "регистрация клиента", ip);
      return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Адрес возврата не разрешён: " + u.slice(0, 200) } };
    }
  }
  let method = String(body.token_endpoint_auth_method || "client_secret_basic");
  if (["none", "client_secret_post", "client_secret_basic"].indexOf(method) < 0) method = "client_secret_basic";
  const gt = Array.isArray(body.grant_types) ? body.grant_types.map(String) : ["authorization_code", "refresh_token"];
  if (gt.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return { status: 400, body: { error: "invalid_client_metadata", error_description: "Поддерживаются только authorization_code и refresh_token." } };
  }
  const clientId = "kn_" + $security.randomStringWithAlphabet(24, "abcdefghijkmnpqrstuvwxyz23456789");
  const secret = randomToken("kns_", 40);
  const c = new Record($app.findCollectionByNameOrId("mcp_clients"));
  c.set("client_id", clientId);
  c.set("secret_hash", hash(secret));
  c.set("auth_method", method);
  c.set("name", String(body.client_name || "").slice(0, 200));
  c.set("redirect_uris", uris);
  c.set("ip", ip);
  $app.save(c);
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_secret: secret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      client_name: c.getString("name") || undefined,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      scope: SCOPES.join(" "),
    },
  };
}

/* ---------- Запрос авторизации ---------- */
// Проверка параметров /oauth/authorize. Возвращает:
// { fatal: текст } — показать ошибку на странице (адрес возврата неизвестен, перенаправлять нельзя);
// { redirect: адрес } — вернуть ошибку помощнику по его адресу возврата;
// { ok: true, ... } — всё верно.
function checkAuthorize(e, q) {
  if (!CFG.enabled()) return { fatal: "Подключение к ИИ-помощникам сейчас выключено на сервере (настройка MCP_ENABLED)." };
  const c = findClient(q.client_id);
  if (!c) return { fatal: "Это подключение не зарегистрировано или устарело. Удалите коннектор в помощнике и добавьте его заново." };
  const list = clientRedirects(c);
  let uri = String(q.redirect_uri || "");
  if (!uri && list.length === 1) uri = list[0];
  if (!uri || list.indexOf(uri) < 0) {
    logRejected(uri || "(пусто)", "вход: адрес не совпадает с зарегистрированным", e.realIP());
    return { fatal: "Адрес возврата не совпадает с тем, что помощник указал при регистрации. Удалите коннектор и добавьте заново." };
  }
  if (!redirectAllowed(uri)) {
    logRejected(uri, "вход", e.realIP());
    return { fatal: "Этот сайт не входит в список разрешённых (настройка MCP_REDIRECT_HOSTS)." };
  }
  const state = String(q.state || "").slice(0, 2000);
  const back = (err, desc) => {
    const sep = uri.indexOf("?") >= 0 ? "&" : "?";
    return { redirect: uri + sep + "error=" + encodeURIComponent(err) + "&error_description=" + encodeURIComponent(desc) +
      (state ? "&state=" + encodeURIComponent(state) : "") + "&iss=" + encodeURIComponent(baseUrl(e)) };
  };
  if (String(q.response_type || "") !== "code") return back("unsupported_response_type", "Поддерживается только response_type=code.");
  const ch = String(q.code_challenge || "");
  if (!ch || String(q.code_challenge_method || "") !== "S256" || !/^[A-Za-z0-9\-_]{43,128}$/.test(ch)) {
    return back("invalid_request", "Нужен PKCE: code_challenge и code_challenge_method=S256.");
  }
  if (q.resource && !sameResource(e, q.resource)) return back("invalid_target", "Неизвестный ресурс: " + String(q.resource).slice(0, 200));
  const asked = String(q.scope || "").split(/\s+/).filter(Boolean);
  const scope = SCOPES.filter((s) => !asked.length || asked.indexOf(s) >= 0 || s === "library");
  return { ok: true, client: c, uri, state, challenge: ch, scope: scope.join(" "), resource: String(q.resource || ""), service: serviceOf(uri), back };
}

// «Разрешить»: одноразовый код на 5 минут. Подключение (mcp_grants) появится при обмене кода на токены.
function issueCode(e, a, user) {
  const code = randomToken("knc_", 40);
  const r = new Record($app.findCollectionByNameOrId("mcp_codes"));
  r.set("hash", hash(code));
  r.set("client", a.client.id);
  r.set("user", user.id);
  r.set("redirect_uri", a.uri);
  r.set("challenge", a.challenge);
  r.set("scope", a.scope);
  r.set("resource", a.resource);
  r.set("expires", isoAfter(CODE_TTL));
  $app.save(r);
  const sep = a.uri.indexOf("?") >= 0 ? "&" : "?";
  return a.uri + sep + "code=" + encodeURIComponent(code) + (a.state ? "&state=" + encodeURIComponent(a.state) : "") +
    "&iss=" + encodeURIComponent(baseUrl(e));
}

/* ---------- Токены ---------- */
function oauthErr(status, error, desc) { return { status, body: { error, error_description: desc } }; }

function saveToken(grantId, kind, ttl) {
  const token = randomToken(kind === "access" ? "kna_" : "knr_", 48);
  const r = new Record($app.findCollectionByNameOrId("mcp_tokens"));
  r.set("grant", grantId);
  r.set("kind", kind);
  r.set("hash", hash(token));
  r.set("expires", isoAfter(ttl));
  $app.save(r);
  return token;
}
function tokenPair(grant) {
  return {
    access_token: saveToken(grant.id, "access", ACCESS_TTL),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: saveToken(grant.id, "refresh", REFRESH_TTL),
    scope: grant.getString("scope") || SCOPES.join(" "),
  };
}

// Проверка клиента на /oauth/token: client_id из формы или из Basic, секрет по способу регистрации
function tokenClient(e, body) {
  let id = String(body.client_id || ""), secret = body.client_secret != null ? String(body.client_secret) : null;
  const auth = String(e.request.header.get("Authorization") || "");
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (m) {
    const s = b64decode(m[1]), i = s.indexOf(":");
    if (i > 0) {
      let bid = s.slice(0, i), bsec = s.slice(i + 1);
      try { bid = decodeURIComponent(bid.replace(/\+/g, " ")); bsec = decodeURIComponent(bsec.replace(/\+/g, " ")); } catch (_) {}
      if (id && id !== bid) return { err: oauthErr(401, "invalid_client", "client_id не совпадает.") };
      id = bid; secret = bsec;
    }
  }
  const c = findClient(id);
  if (!c) return { err: oauthErr(401, "invalid_client", "Неизвестный клиент. Подключите коннектор заново.") };
  const method = c.getString("auth_method");
  // публичный клиент (none) секрет не присылает; если всё же прислал, он должен быть верным
  if (method !== "none" || (secret != null && secret !== "")) {
    if (secret == null || !same(hash(secret), c.getString("secret_hash"))) {
      return { err: oauthErr(401, "invalid_client", "Неверный секрет клиента.") };
    }
  }
  return { client: c };
}

function tokenEndpoint(e) {
  const ip = e.realIP();
  if (!rateHit("tok:" + ip, 60, 60)) return oauthErr(429, "slow_down", "Слишком много запросов. Подождите минуту.");
  if (!CFG.enabled()) return oauthErr(503, "temporarily_unavailable", "Подключение к ИИ-помощникам выключено на сервере (MCP_ENABLED=0).");
  const ct = String(e.request.header.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("application/x-www-form-urlencoded") < 0) {
    return oauthErr(400, "invalid_request", "Нужен запрос application/x-www-form-urlencoded.");
  }
  const body = e.requestInfo().body || {};
  const one = (k) => { const v = body[k]; return Array.isArray(v) ? String(v[0] || "") : v == null ? "" : String(v); };
  const form = {}; for (const k of Object.keys(body)) form[k] = one(k);
  const cl = tokenClient(e, form);
  if (cl.err) {
    if (!rateHit("tokbad:" + ip, 20, 900)) return oauthErr(429, "slow_down", "Слишком много неверных попыток. Подождите 15 минут.");
    return cl.err;
  }
  const client = cl.client;
  const gt = form.grant_type;

  if (gt === "authorization_code") {
    let code = null;
    try { code = $app.findFirstRecordByData("mcp_codes", "hash", hash(form.code)); } catch (_) {}
    if (!code) return oauthErr(400, "invalid_grant", "Код недействителен или уже использован.");
    // код одноразовый: удаляем сразу, даже если дальше что-то не сошлось
    try { $app.delete(code); } catch (_) { return oauthErr(400, "invalid_grant", "Код уже использован."); }
    if (expired(code.getString("expires"))) return oauthErr(400, "invalid_grant", "Срок кода истёк (5 минут). Подключите заново.");
    if (code.getString("client") !== client.id) return oauthErr(400, "invalid_grant", "Код выдан другому клиенту.");
    if (form.redirect_uri && form.redirect_uri !== code.getString("redirect_uri")) return oauthErr(400, "invalid_grant", "Адрес возврата не совпадает.");
    if (!pkceOk(form.code_verifier, code.getString("challenge"))) return oauthErr(400, "invalid_grant", "Проверка PKCE не прошла (code_verifier).");
    if (form.resource && !sameResource(e, form.resource)) return oauthErr(400, "invalid_target", "Неизвестный ресурс.");
    let user = null;
    try { user = $app.findRecordById("users", code.getString("user")); } catch (_) {}
    if (!user || user.getString("role") !== "admin") return oauthErr(400, "invalid_grant", "Подключать может только администратор библиотеки.");
    const svc = serviceOf(code.getString("redirect_uri"));
    const g = new Record($app.findCollectionByNameOrId("mcp_grants"));
    g.set("user", user.id);
    g.set("client", client.id);
    g.set("service", svc.name);
    g.set("host", svc.host);
    g.set("scope", code.getString("scope"));
    $app.save(g);
    $app.logger().info("ИИ-помощник подключён", "service", svc.name, "host", svc.host, "ip", ip);
    return { status: 200, body: tokenPair(g) };
  }

  if (gt === "refresh_token") {
    let t = null;
    try { t = $app.findFirstRecordByData("mcp_tokens", "hash", hash(form.refresh_token)); } catch (_) {}
    if (!t || t.getString("kind") !== "refresh") return oauthErr(400, "invalid_grant", "Токен обновления недействителен. Подключите коннектор заново.");
    let g = null;
    try { g = $app.findRecordById("mcp_grants", t.getString("grant")); } catch (_) {}
    if (!g || g.getString("client") !== client.id) return oauthErr(400, "invalid_grant", "Токен обновления выдан другому клиенту.");
    if (expired(t.getString("expires"))) { try { $app.delete(t); } catch (_) {} return oauthErr(400, "invalid_grant", "Срок токена обновления истёк. Подключите коннектор заново."); }
    let user = null;
    try { user = $app.findRecordById("users", g.getString("user")); } catch (_) {}
    if (!user || user.getString("role") !== "admin") return oauthErr(400, "invalid_grant", "Подключать может только администратор библиотеки.");
    // старый токен обновления перестаёт работать сразу (его удаление и есть проверка: второй одновременный запрос не пройдёт)
    try { $app.delete(t); } catch (_) { return oauthErr(400, "invalid_grant", "Токен обновления уже использован."); }
    return { status: 200, body: tokenPair(g) };
  }
  return oauthErr(400, "unsupported_grant_type", "Поддерживаются authorization_code и refresh_token.");
}

// Токен из заголовка Authorization: Bearer … (в адресе токен не принимается)
function bearerGrant(e) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(e.request.header.get("Authorization") || ""));
  if (!m) return { why: "" };
  let t = null;
  try { t = $app.findFirstRecordByData("mcp_tokens", "hash", hash(m[1])); } catch (_) {}
  if (!t || t.getString("kind") !== "access") return { why: "invalid_token" };
  if (expired(t.getString("expires"))) return { why: "invalid_token" };
  let g = null, user = null;
  try { g = $app.findRecordById("mcp_grants", t.getString("grant")); user = $app.findRecordById("users", g.getString("user")); } catch (_) {}
  if (!g || !user || user.getString("role") !== "admin") return { why: "invalid_token" };
  // «последний раз использовалось» пишем не чаще раза в минуту
  const last = g.getString("last_used");
  if (!last || last < new Date(Date.now() - 60e3).toISOString().replace("T", " ")) {
    $app.db().newQuery("UPDATE mcp_grants SET last_used = {:t} WHERE id = {:id}").bind({ t: nowIso(), id: g.id }).execute();
  }
  return { grant: g, user };
}

/* ---------- Метаданные ---------- */
function protectedResource(e) {
  const b = baseUrl(e);
  return {
    resource: resourceUrl(e),
    authorization_servers: [b],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Библиотека",
    resource_documentation: b + "/",
  };
}
function authServer(e) {
  const b = baseUrl(e);
  return {
    issuer: b,
    authorization_endpoint: b + "/oauth/authorize",
    token_endpoint: b + "/oauth/token",
    registration_endpoint: b + "/oauth/register",
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: b + "/",
  };
}
function meta(e, what) {
  e.response.header().set("Cache-Control", "public, max-age=300");
  return e.json(200, what === "pr" ? protectedResource(e) : authServer(e));
}
function wwwAuth(e, err) {
  return `Bearer ${err ? `error="${err}", ` : ""}resource_metadata="${baseUrl(e)}/.well-known/oauth-protected-resource", scope="${SCOPES.join(" ")}"`;
}

/* ---------- Подключения в профиле ---------- */
function connections(userId) {
  return $app.findRecordsByFilter("mcp_grants", "user = {:u}", "-created", 200, 0, { u: userId }).map((g) => ({
    id: g.id, service: g.getString("service"), host: g.getString("host"), created: g.getString("created"), last_used: g.getString("last_used"),
  }));
}
function logRows(limit) {
  return $app.findRecordsByFilter("mcp_log", "id != ''", "-created", limit || 100, 0).map((r) => ({
    id: r.id, created: r.getString("created"), service: r.getString("service"), tool: r.getString("tool"),
    book: r.getString("book"), book_title: r.getString("book_title"), note: r.getString("note"), error: r.getBool("error"),
  }));
}
function writeLog(grant, tool, info) {
  try {
    const r = new Record($app.findCollectionByNameOrId("mcp_log"));
    r.set("grant", grant.id);
    r.set("service", grant.getString("service"));
    r.set("tool", String(tool || "").slice(0, 60));
    r.set("book", String((info && info.book) || "").slice(0, 15));
    r.set("book_title", String((info && info.title) || "").slice(0, 500));
    r.set("note", String((info && info.note) || "").slice(0, 300));
    r.set("error", !!(info && info.error));
    $app.save(r);
  } catch (err) { $app.logger().warn("Журнал MCP не записан", "error", String(err)); }
}
// Уборка раз в сутки: журнал старше 90 дней, просроченные коды и токены, подключения без живых токенов,
// клиенты, которые зарегистрировались и не подключились за сутки.
function clean() {
  const db = $app.db();
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().replace("T", " ");
  db.newQuery("DELETE FROM mcp_log WHERE created < {:t}").bind({ t: ago(LOG_DAYS) }).execute();
  db.newQuery("DELETE FROM mcp_codes WHERE expires < {:t}").bind({ t: nowIso() }).execute();
  db.newQuery("DELETE FROM mcp_tokens WHERE expires < {:t}").bind({ t: nowIso() }).execute();
  for (const g of $app.findRecordsByFilter("mcp_grants", "created < {:t}", "", 0, 0, { t: ago(1) })) {
    if ($app.countRecords("mcp_tokens", $dbx.hashExp({ grant: g.id })) === 0) { try { $app.delete(g); } catch (_) {} }
  }
  for (const c of $app.findRecordsByFilter("mcp_clients", "created < {:t}", "", 0, 0, { t: ago(1) })) {
    if ($app.countRecords("mcp_grants", $dbx.hashExp({ client: c.id })) === 0) { try { $app.delete(c); } catch (_) {} }
  }
}

module.exports = {
  CFG, PROTOCOLS, SCOPES, ACCESS_TTL, REFRESH_TTL, baseUrl, resourceUrl, rateHit, rateWait, ipAllowed, inRange, ipBytes,
  redirectAllowed, logRejected, serviceOf, parseRedirect, register, checkAuthorize, issueCode, tokenEndpoint, bearerGrant,
  protectedResource, authServer, meta, wwwAuth, connections, logRows, writeLog, clean, hexToB64url, pkceOk, hash, findClient,
};
