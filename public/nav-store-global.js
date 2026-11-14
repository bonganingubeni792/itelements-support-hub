(function () {
  'use strict';

  var mobileQuery = '(max-width: 760px)';
  var drawerSequence = 0;

  function makeLink(href, label) {
    var link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    return link;
  }

  function closeDrawer(drawer, trigger) {
    if (!drawer) return;
    drawer.classList.remove('open');
    document.body.classList.remove('ite-drawer-open');
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', 'Open menu');
    }
  }

  function openDrawer(drawer, trigger) {
    if (!drawer) return;
    drawer.classList.add('open');
    document.body.classList.add('ite-drawer-open');
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-label', 'Close menu');
    }
  }

  function createDrawer(nav, linksBox, trigger) {
    if (!trigger || trigger.dataset.iteDrawerId) return;
    drawerSequence += 1;
    var drawerId = 'iteMobileDrawer' + drawerSequence;
    trigger.dataset.iteDrawerId = drawerId;
    trigger.setAttribute('aria-controls', drawerId);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Open menu');

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
    var standardLinks = [
      ['/','Home'],
      ['/store#catalogue','Shop by Category'],
      ['/store#featured','Deals & featured products'],
      ['/client/login','Orders & order history'],
      ['/client/login','My Account'],
      ['/store#cart','Cart']
    ];
    standardLinks.forEach(function (item) {
      list.appendChild(makeLink(item[0], item[1]));
    });

    // Retain every existing navigation destination from this page in the drawer.
    if (linksBox) {
      Array.prototype.forEach.call(linksBox.querySelectorAll('a'), function (original) {
        var href = original.getAttribute('href') || '#';
        var label = (original.textContent || '').trim();
        if (!label) return;
        var exists = Array.prototype.some.call(list.querySelectorAll('a'), function (a) {
          return a.getAttribute('href') === href &&
            a.textContent.trim().toLowerCase() === label.toLowerCase();
        });
        if (!exists) list.appendChild(makeLink(href, label));
      });
    }

    // Ensure the full set of public destinations is available even on pages
    // whose desktop header has a shorter navigation list.
    [
      ['/services','Services'],
      ['/onsite-support','On-site'],
      ['/pricing','Plans'],
      ['/business-support','Business'],
      ['/reviews','Reviews'],
      ['/about','About'],
      ['/faq','FAQ'],
      ['/contact','Contact'],
      ['/client/login','Client Portal']
    ].forEach(function (item) {
      var exists = Array.prototype.some.call(list.querySelectorAll('a'), function (a) {
        return a.getAttribute('href') === item[0] &&
          a.textContent.trim().toLowerCase() === item[1].toLowerCase();
      });
      if (!exists) list.appendChild(makeLink(item[0], item[1]));
    });

    document.body.appendChild(overlay);
    overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click', function () {
      closeDrawer(overlay, trigger);
    });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || (event.target.closest && event.target.closest('a'))) {
        closeDrawer(overlay, trigger);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer(overlay, trigger);
    });
  }

  function setupPublicNavigation() {
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav, nav.navbar'), function (nav) {
      // Ignore the admin workspace sidebar; it has its own navigation controls.
      if (nav.closest('.app') || nav.getAttribute('aria-label') === 'Store management') return;

      var brand = nav.querySelector('.brand, .nav-brand');
      if (!brand) return;
      var linksBox = nav.querySelector('.nav-links, .links');
      var trigger = nav.querySelector('.menu-toggle, .ite-mobile-menu-trigger');

      if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ite-mobile-menu-trigger';
        trigger.textContent = '☰';
        nav.appendChild(trigger);
      }
      trigger.classList.add('ite-mobile-menu-trigger');
      createDrawer(nav, linksBox, trigger);
    });
  }

  function setupStoreNavigation() {
    var header = document.querySelector('body.store-page header, header');
    if (!header || !header.querySelector('.cartbtn')) return;
    var brand = header.querySelector('.brand');
    var links = header.querySelector('nav');
    if (!brand) return;

    var trigger = header.querySelector('.ite-generated-menu');
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ite-generated-menu';
      trigger.textContent = '☰';
      trigger.setAttribute('aria-label', 'Open menu');
      header.insertBefore(trigger, brand);
    }
    createDrawer(header, links, trigger);
  }

  function boot() {
    setupPublicNavigation();
    setupStoreNavigation();
  }

  // One capture-phase handler owns mobile menu clicks. This prevents legacy
  // inline menu-grid handlers from opening the old oversized button panel.
  document.addEventListener('click', function (event) {
    if (!window.matchMedia || !window.matchMedia(mobileQuery).matches) return;
    var trigger = event.target.closest && event.target.closest(
      '.menu-toggle, .ite-mobile-menu-trigger, .ite-generated-menu'
    );
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    var drawer = document.getElementById(trigger.dataset.iteDrawerId);
    if (!drawer) return;
    if (drawer.classList.contains('open')) closeDrawer(drawer, trigger);
    else openDrawer(drawer, trigger);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
