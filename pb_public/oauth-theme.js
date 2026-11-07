// Тема страницы входа как в приложении (kn_theme), до отрисовки, чтобы не мигало
try{var t=JSON.parse(localStorage.getItem('kn_theme')||'""');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}
