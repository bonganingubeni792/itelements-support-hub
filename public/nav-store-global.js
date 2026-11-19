(function () {
  'use strict';
  var isStore = document.body.classList.contains('store-page');
  var header = isStore ? document.querySelector('body.store-page > header') :
    document.querySelector('nav.nav, nav.navbar, nav.site-nav, nav.main-nav, header.site-header');
  if (!header || header.closest('.app')) return;

  function makeLink(href, label) {
    var a = document.createElement('a'); a.href = href; a.textContent = label; return a;
  }
  function accountCartKey(email) {
    return 'itelements_store_cart_v2:' + encodeURIComponent('user:' + String(email || '').trim().toLowerCase());
  }
  function readAccountCart(email) {
    try {
      var value = JSON.parse(localStorage.getItem(accountCartKey(email)) || '[]');
      return Array.isArray(value) ? value.filter(function (item) {
        return item && typeof item.id === 'string' && Number.isInteger(Number(item.qty)) && Number(item.qty) > 0;
      }) : [];
    } catch (_) { return []; }
  }
  function mirrorIsFresh(email) {
    try {
      var stamp = Number(localStorage.getItem(accountCartKey(email) + ':savedAt') || 0);
      return stamp > 0 && Date.now() - stamp < 60000;
    } catch (_) { return false; }
  }
  function cartTotal(items) {
    return (items || []).reduce(function (n, item) { return n + (Number(item && item.qty) || 0); }, 0);
  }
  function updateCartBadge(total) {
    if (isStore) {
      var count = document.getElementById('cartCount');
      if (count) count.textContent = String(total);
      var productCount = document.getElementById('productCartCount');
      if (productCount) productCount.textContent = String(total);
    } else if (cartControl) {
      cartControl.textContent = 'Cart (' + total + ')';
      cartControl.href = '/store?openCart=1';
    }
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
    [['/','Home'],['/dashboard','Account'],['/services','Services'],['/store','Online Store'],['/onsite-support','On-site'],['/pricing','Plans'],['/business-support','Business'],['/reviews','Reviews'],['/about','About'],['/faq','FAQ'],['/contact','Contact'],['/client/login?next=%2Fdashboard','Client Portal']]
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
    if (text) { text.textContent = 'itelements.co.za'; }
    else if (!brand.textContent.trim()) brand.appendChild(document.createTextNode('itelements.co.za'));
  }
  var nav = isStore ? header.querySelector('nav') : header.querySelector('.nav-links, .links, nav');
  if (nav) {
    nav.classList.add('ite-header-links');
    nav.innerHTML = '';
    [['/','Home'],['/dashboard','Account'],['/services','Services'],['/store','Online Store'],['/contact','Contact']]
      .forEach(function (item) { nav.appendChild(makeLink(item[0], item[1])); });
    // Keep the compact approved primary header while making every other page
    // reachable on desktop as well as in the mobile drawer.
    var more = document.createElement('details'); more.className = 'ite-more-menu';
    var summary = document.createElement('summary'); summary.textContent = 'More'; more.appendChild(summary);
    var panel = document.createElement('div'); panel.className = 'ite-more-menu-panel';
    [['/onsite-support','On-site'],['/pricing','Plans'],['/business-support','Business Support'],['/reviews','Reviews'],['/about','About'],['/faq','FAQ'],['/support','Request Help'],['/booking','Booking'],['/business-tools','Business Tools'],['/client/login?next=%2Fdashboard','Client Portal']]
      .forEach(function (item) { panel.appendChild(makeLink(item[0], item[1])); });
    more.appendChild(panel); nav.appendChild(more);
  }

  var actions = header.querySelector('.ite-header-actions');
  if (!actions) { actions = document.createElement('div'); actions.className = 'ite-header-actions'; header.appendChild(actions); }
  // Remove old/duplicated account controls; exactly one is recreated below.
  Array.prototype.forEach.call(header.querySelectorAll('#accountAction, .ite-account-action, a[href="/client/login"].nav-cta'), function (node) { node.remove(); });
  var oldCart = isStore ? header.querySelector('#openCart') : null;
  // Remove stale/duplicate cart labels from older page-specific headers so every page
  // uses the same account-backed cart control created below.
  Array.prototype.forEach.call(header.querySelectorAll('button, a'), function (node) {
    if (node === oldCart) return;
    if (/^cart(?:\s*\(|$)/i.test(String(node.textContent || '').trim())) node.remove();
  });
  actions.innerHTML = '';
  var account = makeLink('/client/login?next=%2Fdashboard', 'Log in');
  account.id = 'accountAction';
  account.className = 'ite-account-action';
  account.setAttribute('aria-label', 'Log in to your IT Elements account');
  actions.appendChild(account);
  var accountNav = nav ? Array.prototype.find.call(nav.querySelectorAll('a'), function (a) { return a.textContent.trim() === 'Account'; }) : null;
  var drawerAccount = document.querySelector('#iteMobileDrawer a[href="/dashboard"]');
  if (accountNav) accountNav.href = '/client/login?next=%2Fdashboard';
  if (drawerAccount) drawerAccount.href = '/client/login?next=%2Fdashboard';
  var cartControl;
  if (isStore) {
    cartControl = oldCart || document.createElement('button');
    cartControl.type = 'button';
    cartControl.classList.add('ite-header-cart');
    cartControl.id = 'openCart';
    if (!oldCart) cartControl.innerHTML = 'Cart (<span id="cartCount">0</span>)';
    cartControl.hidden = true;
    actions.appendChild(cartControl);
  } else {
    // Keep the approved Store header's compact public-page appearance:
    // cart remains available inside the Store, not beside the brand on other pages.
    cartControl = null;
  }
  window.addEventListener('storage', function (event) {
    if (!event || !event.key || !authEmailForCart) return;
    if (event.key === accountCartKey(authEmailForCart)) {
      try { updateCartBadge(cartTotal(JSON.parse(event.newValue || '[]'))); } catch (_) {}
    }
  });
  window.addEventListener('ite:cart-updated', function (event) {
    if (event && event.detail && Number.isFinite(Number(event.detail.count))) {
      updateCartBadge(Number(event.detail.count));
    }
  });
  var authEmailForCart = '';

  var menu = header.querySelector('.menu-toggle, .ite-mobile-menu-trigger');
  if (!menu) { menu = document.createElement('button'); menu.type = 'button'; menu.className = 'ite-mobile-menu-trigger'; menu.textContent = '☰'; header.insertBefore(menu, brand || header.firstChild); }
  menu.classList.add('ite-mobile-menu-trigger');
  addDrawer(menu);

  fetch('/api/store/auth-status', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('Authentication status unavailable'); return response.json(); })
    .then(function (auth) {
      var productCart = document.getElementById('openCartFromProduct');
      if (auth && auth.authenticated) {
        authEmailForCart = auth.email || '';
        account.textContent = 'Log out'; account.href = '/client/logout';
        account.setAttribute('aria-label', 'Log out of your IT Elements account');
        if (accountNav) { accountNav.textContent = 'Log out'; accountNav.href = '/client/logout'; accountNav.setAttribute('aria-label', 'Log out of your IT Elements account'); }
        if (drawerAccount) { drawerAccount.textContent = 'Log out'; drawerAccount.href = '/client/logout'; }
        if (cartControl) cartControl.hidden = false;
        if (productCart) productCart.hidden = false;

        // Paint the account's most recent cart immediately. This mirror is written
        // by the Store page before the server save completes, so moving to another
        // page cannot briefly reset the shared badge to zero.
        var mirroredItems = readAccountCart(auth.email);
        var hasFreshMirror = mirrorIsFresh(auth.email);
        updateCartBadge(cartTotal(mirroredItems));

        return fetch('/api/store/cart', { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('Saved cart unavailable'); return r.json(); })
          .then(function (data) {
            if (!data || !data.success || !Array.isArray(data.items)) throw new Error('Saved cart response was invalid');
            var serverTotal = cartTotal(data.items);
            if (hasFreshMirror) {
              updateCartBadge(cartTotal(mirroredItems));
            } else {
              updateCartBadge(serverTotal);
              try {
                localStorage.setItem(accountCartKey(auth.email), JSON.stringify(data.items));
                localStorage.setItem(accountCartKey(auth.email) + ':savedAt', String(Date.now()));
              } catch (_) {}
            }
          })
          .catch(function () {
            // Keep the last locally mirrored account count visible if the cart
            // endpoint is temporarily unavailable.
            updateCartBadge(cartTotal(mirroredItems));
          });
      }

      account.textContent = 'Log in'; account.href = '/client/login?next=%2Fdashboard';
      account.setAttribute('aria-label', 'Log in to your IT Elements account');
      if (accountNav) { accountNav.href = '/client/login?next=%2Fdashboard'; accountNav.setAttribute('aria-label', 'Log in to access your customer account'); }
      if (drawerAccount) drawerAccount.href = '/client/login?next=%2Fdashboard';
      if (cartControl) cartControl.hidden = true;
      if (productCart) productCart.hidden = true;
    })
    .catch(function () {
      account.textContent = 'Log in'; account.href = '/client/login?next=%2Fdashboard';
      if (accountNav) accountNav.href = '/client/login?next=%2Fdashboard';
      if (drawerAccount) drawerAccount.href = '/client/login?next=%2Fdashboard';
      if (cartControl) cartControl.hidden = true;
      var productCart = document.getElementById('openCartFromProduct');
      if (productCart) productCart.hidden = true;
    });
})();


/* Site-wide WhatsApp contact button (same destination and label as Home/Store). */
(function () {
  function addWhatsAppButton() {
    if (document.querySelector('.whatsapp')) return;
    var link = document.createElement('a');
    link.className = 'whatsapp';
    link.href = 'https://wa.me/27606181229';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Chat with IT Elements on WhatsApp');
    link.textContent = 'WhatsApp Us';
    link.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:1400;background:#168d4d;color:#fff;border-radius:50px;padding:13px 19px;font-size:13px;font-weight:900;box-shadow:0 5px 20px rgba(0,0,0,.16);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;';
    document.body.appendChild(link);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addWhatsAppButton);
  else addWhatsAppButton();
})();
