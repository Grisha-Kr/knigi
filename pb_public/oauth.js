// Страница входа и согласия для ИИ-помощников (/oauth/authorize), этап 4.
// 1. Если в этом браузере уже выполнен вход в «Библиотеку», сразу экран «… просит доступ».
// 2. Иначе форма почты и пароля (тот же вход, что в приложении), потом тот же экран.
// 3. «Разрешить» и «Отказать» отправляют решение на сервер, он отвечает адресом, куда вернуть человека.
// Разрешить может только администратор библиотеки: остальным сервер отказывает, кнопки нет.
(function(){
  'use strict';
  var data = {};
  try { data = JSON.parse(document.getElementById('oa-data').textContent || '{}'); } catch(e){}
  var box = document.getElementById('oa-body');
  var KEY = 'pocketbase_auth'; // там же хранит вход приложение (PocketBase JS SDK)
  var me = null, token = '';

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function stored(){ try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.token ? v : null; } catch(e){ return null; } }
  function save(v){ try { localStorage.setItem(KEY, JSON.stringify(v)); } catch(e){} }
  function forget(){ try { localStorage.removeItem(KEY); } catch(e){} }
  function api(path, body, auth){
    var opts = {method: body ? 'POST' : 'GET', headers: {'Accept': 'application/json'}, cache: 'no-store', credentials: 'omit'};
    if(body){ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if(auth) opts.headers['Authorization'] = auth;
    return fetch(path, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){ return {ok: r.ok, status: r.status, body: b}; });
    }, function(){ return {ok: false, status: 0, body: {message: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'}}; });
  }
  function go(url){ location.replace(url); }

  if(data.fatal){
    box.innerHTML = '<h1 class="oa-title">Не получается подключить</h1><p class="oa-warn">' + esc(data.fatal) + '</p>';
    return;
  }
  var service = data.service || 'Помощник';

  function start(){
    var s = stored();
    if(!s){ login(''); return; }
    api('/oauth/me', null, s.token).then(function(r){
      if(!r.ok){ if(r.status === 401 || r.status === 403) forget(); login(r.status === 0 ? r.body.message : ''); return; }
      me = r.body; token = s.token; consent();
    });
  }

  function login(msg){
    box.innerHTML = '<h1 class="oa-title"><b>' + esc(service) + '</b> просит доступ к вашей библиотеке</h1>' +
      '<p class="oa-muted">Войдите своей почтой и паролем от «Библиотеки».</p>' +
      '<form id="oa-login" novalidate>' +
      '<div class="oa-field"><label for="oa-email">Почта</label><input type="email" id="oa-email" autocomplete="username" required></div>' +
      '<div class="oa-field oa-gap"><label for="oa-pass">Пароль</label><input type="password" id="oa-pass" autocomplete="current-password" required></div>' +
      '<p class="oa-err" id="oa-err" role="alert">' + esc(msg || '') + '</p>' +
      '<div class="oa-acts oa-gap"><button type="submit" class="oa-btn primary" id="oa-go">Войти</button></div></form>';
    var f = document.getElementById('oa-login'), err = document.getElementById('oa-err'), btn = document.getElementById('oa-go');
    document.getElementById('oa-email').focus();
    f.addEventListener('submit', function(ev){
      ev.preventDefault();
      var email = document.getElementById('oa-email').value.trim(), pass = document.getElementById('oa-pass').value;
      if(!email || !pass){ err.textContent = 'Введите почту и пароль.'; return; }
      btn.disabled = true; btn.textContent = 'Вхожу…'; err.textContent = '';
      api('/oauth/login', {email: email, password: pass}).then(function(r){
        btn.disabled = false; btn.textContent = 'Войти';
        if(!r.ok || !r.body.token){ err.textContent = r.body.message || 'Не получилось войти.'; return; }
        save({token: r.body.token, record: r.body.record});
        start();
      });
    });
  }

  function consent(){
    var who = '<div class="oa-who"><span>Вы вошли как <b>' + esc(me.name || me.email) + '</b>' + (me.name ? ' (' + esc(me.email) + ')' : '') + '</span>' +
      '<button type="button" class="oa-link" id="oa-switch">Другой аккаунт</button></div>';
    if(!me.admin){
      box.innerHTML = '<h1 class="oa-title"><b>' + esc(service) + '</b> просит доступ к библиотеке</h1>' + who +
        '<p class="oa-warn">Подключение к ИИ-помощникам доступно только администратору библиотеки.</p>' +
        '<p class="oa-err" id="oa-err" role="alert"></p>' +
        '<div class="oa-acts"><button type="button" class="oa-btn" id="oa-no">Вернуться</button></div>';
    } else {
      box.innerHTML = '<h1 class="oa-title"><b>' + esc(service) + '</b> просит доступ к вашей библиотеке</h1>' + who +
        '<p class="oa-muted">После разрешения помощник сможет:</p>' +
        '<ul class="oa-list"><li>искать книги и читать их текст (сами файлы книг не передаются)</li>' +
        '<li>читать ваши заметки, уроки и цитаты</li><li>читать заметки и комментарии ваших групп чтения</li>' +
        '<li>создавать новые заметки (старые он не меняет и не удаляет)</li></ul>' +
        '<p class="oa-err" id="oa-err" role="alert"></p>' +
        '<div class="oa-acts"><button type="button" class="oa-btn" id="oa-no">Отказать</button><button type="button" class="oa-btn primary" id="oa-yes">Разрешить</button></div>';
      document.getElementById('oa-yes').addEventListener('click', function(){ decide(true); });
    }
    document.getElementById('oa-no').addEventListener('click', function(){ decide(false); });
    document.getElementById('oa-switch').addEventListener('click', function(){ forget(); me = null; token = ''; login(''); });
  }

  function decide(allow){
    var btns = box.querySelectorAll('button');
    for(var i = 0; i < btns.length; i++) btns[i].disabled = true;
    var body = {}, p = data.params || {};
    for(var k in p) if(Object.prototype.hasOwnProperty.call(p, k)) body[k] = p[k];
    body.allow = !!allow;
    api('/oauth/authorize', body, token).then(function(r){
      if(r.ok && r.body.redirect){
        box.innerHTML = '<p class="oa-muted">' + (allow ? 'Готово. Возвращаю в ' + esc(service) + '…' : 'Возвращаю…') + '</p>';
        go(r.body.redirect); return;
      }
      for(var i = 0; i < btns.length; i++) btns[i].disabled = false;
      if(r.status === 401){ forget(); login('Вход устарел, войдите снова.'); return; }
      var err = document.getElementById('oa-err');
      if(err) err.textContent = r.body.message || 'Не получилось. Попробуйте ещё раз.';
    });
  }

  start();
})();
