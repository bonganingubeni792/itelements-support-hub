(function () {
  'use strict';
  var body = document.body;
  if (!body) return;

  function addLogoutAfter(link, className) {
    var old = document.querySelector('[data-ite-auth-logout="1"]');
    if (old) old.remove();
    var logout = document.createElement('a');
    logout.href = '/client/logout';
    logout.textContent = 'Log out';
    logout.className = className || link.className || '';
    logout.setAttribute('data-ite-auth-logout', '1');
    logout.setAttribute('aria-label', 'Log out of your IT Elements account');
    link.insertAdjacentElement('afterend', logout);
  }

  function removeInjectedHeaderBits() {
    document.querySelectorAll('.ite-mobile-menu-trigger, #iteMobileDrawer, .ite-more-menu').forEach(function (el) { el.remove(); });
  }

  function updateStore() {
    var login = document.getElementById('accountAction');
    if (!login) return;
    var logout = document.getElementById('logoutAction');
    if (!logout) {
      logout = document.createElement('a');
      logout.id = 'logoutAction';
      logout.className = 'cartbtn';
      logout.href = '/client/logout';
      logout.textContent = 'Log out';
      logout.hidden = true;
      logout.style.textDecoration = 'none';
      logout.style.marginRight = '0';
      login.insertAdjacentElement('afterend', logout);
    }
    fetch('/api/store/auth-status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(function (auth) {
        if (auth && auth.authenticated) {
          login.textContent = 'Account';
          login.href = '/account';
          login.setAttribute('aria-label', 'Open your IT Elements account');
          logout.hidden = false;
        } else {
          login.textContent = 'Log in';
          login.href = '/client/login?next=%2Faccount';
          login.setAttribute('aria-label', 'Log in to your IT Elements account');
          logout.hidden = true;
        }
      })
      .catch(function () {
        login.textContent = 'Log in';
        login.href = '/client/login?next=%2Faccount';
        logout.hidden = true;
      });
  }

  function updatePublicPage() {
    var nav = document.querySelector('nav.nav .nav-links, nav.nav .links, nav.navbar .nav-links, nav.navbar .links, nav.site-nav .links, nav.main-nav .links, nav[aria-label="Main navigation"]');
    if (!nav) return;
    var login = nav.querySelector('a[href="/client/login"], a[href^="/client/login?"]');
    if (!login) return;
    fetch('/api/store/auth-status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(function (auth) {
        if (auth && auth.authenticated) {
          login.textContent = 'Account';
          login.href = '/account';
          login.setAttribute('aria-label', 'Open your IT Elements account');
          addLogoutAfter(login, login.className);
        } else {
          var old = nav.querySelector('[data-ite-auth-logout="1"]');
          if (old) old.remove();
          login.textContent = 'Log in';
          login.href = '/client/login?next=%2Faccount';
          login.setAttribute('aria-label', 'Log in to your IT Elements account');
        }
      })
      .catch(function () {
        var old = nav.querySelector('[data-ite-auth-logout="1"]');
        if (old) old.remove();
        login.textContent = 'Log in';
        login.href = '/client/login?next=%2Faccount';
      });
  }

  removeInjectedHeaderBits();
  if (body.classList.contains('store-page')) updateStore();
  else updatePublicPage();
})();