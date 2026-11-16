(function () {
  'use strict';
  // This file only updates the existing sign-in link. It deliberately does not
  // rebuild headers, rename navigation items, change layout, or touch cart UI.
  var isStore = document.body && document.body.classList.contains('store-page');
  if (isStore) return; // Store page has its own account/cart controller.

  var nav = document.querySelector('nav.nav .nav-links, nav.nav .links, nav.navbar .nav-links, nav.navbar .links, nav.site-nav .links, nav.main-nav .links, nav[aria-label="Main navigation"]');
  if (!nav) return;

  var loginLink = nav.querySelector('a[href="/client/login"], a[href^="/client/login?"]');
  if (!loginLink) return;

  function removeLogout() {
    var existing = nav.querySelector('[data-ite-auth-logout="1"]');
    if (existing) existing.remove();
  }
  function setLoggedOut() {
    removeLogout();
    loginLink.textContent = 'Log in';
    loginLink.href = '/client/login?next=%2Faccount';
    loginLink.setAttribute('aria-label', 'Log in to your IT Elements account');
  }
  function setLoggedIn() {
    loginLink.textContent = 'Account';
    loginLink.href = '/account';
    loginLink.setAttribute('aria-label', 'Open your IT Elements account');
    removeLogout();
    var logout = document.createElement('a');
    logout.href = '/client/logout';
    logout.textContent = 'Log out';
    logout.className = loginLink.className;
    logout.setAttribute('data-ite-auth-logout', '1');
    logout.setAttribute('aria-label', 'Log out of your IT Elements account');
    loginLink.insertAdjacentElement('afterend', logout);
  }

  fetch('/api/store/auth-status', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('Authentication status unavailable');
      return response.json();
    })
    .then(function (auth) {
      if (auth && auth.authenticated) setLoggedIn();
      else setLoggedOut();
    })
    .catch(setLoggedOut);
})();