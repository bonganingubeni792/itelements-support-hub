(function () {
  'use strict';

  var drawerCounter = 0;

  function makeLink(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  }

  function makeDrawer(owner, linksBox, trigger) {
    if (!linksBox || !trigger || trigger.dataset.iteDrawerReady === '1') return;
    trigger.dataset.iteDrawerReady = '1';
    trigger.setAttribute('aria-label', 'Open menu');
    trigger.setAttribute('aria-expanded', 'false');

    drawerCounter += 1;
    var drawerId = 'iteMobileDrawer' + drawerCounter;
    trigger.dataset.iteDrawerId = drawerId;

    var overlay = document.createElement('div');
    overlay.className = 'ite-mobile-drawer';
    overlay.id = drawerId;
    overlay.innerHTML =
      '<aside class="ite-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="IT Elements menu">' +
        '<div class="ite-mobile-drawer-head"><strong>Welcome</strong><button class="ite-mobile-drawer-close" type="button" aria-label="Close menu">×</button></div>' +
        '<div class="ite-mobile-drawer-welcome">' +
          '<p>Sign in for a more seamless shopping experience</p>' +
          '<a class="ite-drawer-login" href="/client/login">Login</a>' +
          '<span>New to IT Elements? <a class="ite-drawer-register" href="/register">Register</a></span>' +
        '</div>' +
        '<nav class="ite-mobile-drawer-links" aria-label="Website links"></nav>' +
      '</aside>';

    var list = overlay.querySelector('.ite-mobile-drawer-links');

    // Store-style shortcuts shown in the user's reference menu.
    [
      ['/','Home'],
      ['/store#catalogue','Shop by Category'],
      ['/store#catalogue','Deals & featured products'],
      ['/client/login','Orders & order history'],
      ['/client/login','My Account'],
      ['/store','Cart']
    ].forEach(function (item) { list.appendChild(makeLink(item[0], item[1])); });

    // Keep every existing page navigation link available in the drawer.
    Array.prototype.forEach.call(linksBox.querySelectorAll('a'), function (original) {
      var href = original.getAttribute('href') || '#';
      var label = (original.textContent || '').trim();
      if (!label) return;
      var duplicate = Array.prototype.some.call(list.querySelectorAll('a'), function (a) {
        return a.getAttribute('href') === href && a.textContent.trim().toLowerCase() === label.toLowerCase();
      });
      if (!duplicate) list.appendChild(makeLink(href, label));
    });

    document.body.appendChild(overlay);

    function openDrawer() {
      overlay.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('ite-drawer-open');
    }
    function closeDrawer() {
      overlay.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('ite-drawer-open');
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (overlay.classList.contains('open')) closeDrawer();
      else openDrawer();
    });

    overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeDrawer();
      if (event.target.closest('a')) closeDrawer();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
    });
  }

  function install() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;

    // Main public pages: keep their existing nav and links; only change mobile presentation.
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav, nav.navbar'), function (nav) {
      var linksBox = nav.querySelector('.nav-links, .links');
      var brand = nav.querySelector('.brand, .nav-brand');
      if (!linksBox || !brand) return;

      var trigger = nav.querySelector('.menu-toggle, .ite-mobile-menu-trigger');
      if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ite-mobile-menu-trigger';
        trigger.textContent = '☰';
        nav.insertBefore(trigger, brand);
      }
      trigger.classList.add('ite-mobile-menu-trigger');

      var cart = nav.querySelector('.ite-mobile-cart');
      if (!cart) {
        cart = document.createElement('a');
        cart.className = 'ite-mobile-cart';
        cart.href = '/store';
        cart.textContent = 'Cart (0)';
        cart.setAttribute('aria-label', 'Open shopping cart');
        nav.appendChild(cart);
      }
      makeDrawer(nav, linksBox, trigger);
    });

    // Store page: use the same hamburger + brand + Cart header as the reference.
    var storeHeader = document.querySelector('header');
    if (storeHeader && storeHeader.querySelector('.cartbtn')) {
      var storeBrand = storeHeader.querySelector('.brand');
      var storeLinks = storeHeader.querySelector('nav');
      var storeTrigger = storeHeader.querySelector('.ite-generated-menu');
      if (storeBrand && storeLinks) {
        if (!storeTrigger) {
          storeTrigger = document.createElement('button');
          storeTrigger.type = 'button';
          storeTrigger.className = 'ite-generated-menu';
          storeTrigger.textContent = '☰';
          storeTrigger.setAttribute('aria-label', 'Open menu');
          storeHeader.insertBefore(storeTrigger, storeBrand);
        }
        makeDrawer(storeHeader, storeLinks, storeTrigger);
      }
    }
  }

  // Capture before legacy inline menu handlers so the old large button-grid/dropdown
  // does not open on mobile. The new drawer is the only mobile menu interaction.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest && event.target.closest('.menu-toggle, .ite-mobile-menu-trigger, .ite-generated-menu');
    if (!trigger || !window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    var drawer = document.getElementById(trigger.dataset.iteDrawerId);
    if (!drawer) return;
    var isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
    trigger.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
    document.body.classList.toggle('ite-drawer-open', !isOpen);
  }, true);

  function ensureStoreLink() {
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav, nav.navbar'), function (nav) {
      var links = nav.querySelector('.nav-links, .links');
      if (!links) return;
      if (!links.querySelector('a[href="/store"],a[href="/store/"]')) {
        links.appendChild(makeLink('/store', 'Online Store'));
      }
    });
  }

  function boot() { ensureStoreLink(); install(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
