(function () {
  'use strict';
  var isStore = document.body.classList.contains('store-page');
  var header = isStore ? document.querySelector('body.store-page > header') :
    document.querySelector('nav.nav, nav.navbar, nav.site-nav, nav.main-nav, header.site-header');
  if (!header || header.closest('.app')) return;

  function makeLink(href, label) {
    var a = document.createElement('a'); a.href = href; a.textContent = label; return a;
  }
  function addDrawer(trigger) {
    if (!trigger || document.getElementById('iteMobileDrawer')) return;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'iteMobileDrawer');
    trigger.setAttribute('aria-label', 'Open menu');
    var overlay = document.createElement('div');
    overlay.className = 'ite-mobile-drawer'; overlay.id = 'iteMobileDrawer';
    overlay.innerHTML = '<aside class="ite-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="IT Elements menu">' +
      '<div class="ite-mobile-drawer-head"><strong>Menu</strong><button class="ite-mobile-drawer-close" type="button" aria-label="Close menu">×</button></div>' +
      '<nav class="ite-mobile-drawer-links" aria-label="Website links"></nav></aside>';
    var list = overlay.querySelector('.ite-mobile-drawer-links');
    [['/','Home'],['/services','Services'],['/store','Online Store'],['/onsite-support','On-site'],['/pricing','Plans'],['/business-support','Business'],['/reviews','Reviews'],['/about','About'],['/faq','FAQ'],['/contact','Contact'],['/client/login','Client Portal']]
      .forEach(function (item) { list.appendChild(makeLink(item[0], item[1])); });
    document.body.appendChild(overlay);
    function close() { overlay.classList.remove('open'); document.body.classList.remove('ite-drawer-open'); trigger.setAttribute('aria-expanded','false'); }
    trigger.addEventListener('click', function (e) { e.preventDefault(); var open = !overlay.classList.contains('open'); overlay.classList.toggle('open', open); document.body.classList.toggle('ite-drawer-open', open); trigger.setAttribute('aria-expanded', String(open)); });
    overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.closest('a')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // Normalize the brand and navigation on every public page to the approved store header.
  var brand = header.querySelector('.brand, .nav-brand');
  if (brand) {
    brand.classList.add('ite-header-brand');
    Array.prototype.forEach.call(brand.querySelectorAll('.brand-support'), function (node) { node.remove(); });
    var text = brand.querySelector('span');
    if (text) { text.textContent = 'IT Elements.'; }
    else if (!brand.textContent.trim()) brand.appendChild(document.createTextNode('IT Elements.'));
  }
  var nav = isStore ? header.querySelector('nav') : header.querySelector('.nav-links, .links, nav');
  if (nav) {
    nav.classList.add('ite-header-links');
    nav.innerHTML = '';
    [['/','Home'],['/services','Services'],['/store','Online Store'],['/contact','Contact']]
      .forEach(function (item) { nav.appendChild(makeLink(item[0], item[1])); });
  }

  var actions = header.querySelector('.ite-header-actions');
  if (!actions) { actions = document.createElement('div'); actions.className = 'ite-header-actions'; header.appendChild(actions); }
  // Remove old/duplicated account controls; exactly one is recreated below.
  Array.prototype.forEach.call(header.querySelectorAll('#accountAction, .ite-account-action, a[href="/client/login"].nav-cta'), function (node) { node.remove(); });
  var oldCart = isStore ? header.querySelector('#openCart') : null;
  actions.innerHTML = '';
  var account = makeLink('/client/login', 'Login');
  account.className = 'ite-account-action';
  account.setAttribute('aria-label', 'Log in to your IT Elements account');
  actions.appendChild(account);
  if (isStore) {
    var cart = oldCart || document.createElement('button'); cart.type = 'button'; cart.classList.add('ite-header-cart'); cart.id = 'openCart';
    if (!oldCart) cart.innerHTML = 'Cart (<span id="cartCount">0</span>)'; actions.appendChild(cart);
  } else {
    var cartLink = makeLink('/store#cart', 'Cart (0)'); cartLink.className = 'ite-header-cart'; cartLink.setAttribute('aria-label','Open shopping cart'); actions.appendChild(cartLink);
  }
  var menu = header.querySelector('.menu-toggle, .ite-mobile-menu-trigger');
  if (!menu) { menu = document.createElement('button'); menu.type = 'button'; menu.className = 'ite-mobile-menu-trigger'; menu.textContent = '☰'; header.insertBefore(menu, brand || header.firstChild); }
  menu.classList.add('ite-mobile-menu-trigger');
  addDrawer(menu);

  fetch('/api/store/auth-status', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('Authentication status unavailable'); return response.json(); })
    .then(function (auth) {
      if (auth && auth.authenticated) {
        account.textContent = 'Logout'; account.href = '/client/logout';
        account.setAttribute('aria-label', 'Log out of your IT Elements account');
        if (!isStore) fetch('/api/store/cart', { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) { if (data && Array.isArray(data.items)) { var total = data.items.reduce(function (n, item) { return n + (Number(item.qty) || 0); }, 0); actions.querySelector('.ite-header-cart').textContent = 'Cart (' + total + ')'; } })
          .catch(function () {});
      } else {
        account.textContent = 'Login'; account.href = '/client/login';
        account.setAttribute('aria-label', 'Log in to your IT Elements account');
        if (!isStore) { try { var guest = JSON.parse(localStorage.getItem('itelements_store_cart_guest_v2') || '[]'); var total = Array.isArray(guest) ? guest.reduce(function (n, item) { return n + (Number(item.qty) || 0); }, 0) : 0; actions.querySelector('.ite-header-cart').textContent = 'Cart (' + total + ')'; } catch (_) {} }
      }
    }).catch(function () {
      account.textContent = 'Login'; account.href = '/client/login';
    });
})();
