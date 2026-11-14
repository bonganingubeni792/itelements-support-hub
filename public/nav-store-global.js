
(function () {
  function ensureStoreNavigation() {
    var storeUrl = '/store';
    var navs = Array.from(document.querySelectorAll('header nav, .nav-links, .site-nav, .main-nav, .navbar .links'));
    if (!navs.length) navs = Array.from(document.querySelectorAll('nav')).filter(function(n){ return n.closest('header') || /home|services|contact/i.test(n.innerText || ''); });
    navs.forEach(function(nav) {
      var existing = nav.querySelector('a[href="/store"], a[href="/store/"]');
      if (existing) {
        existing.textContent = 'Online Store';
        existing.classList.add('ite-store-nav-link');
        existing.setAttribute('aria-label','Visit the IT Elements Online Store');
        return;
      }
      var link = document.createElement('a');
      link.href = storeUrl;
      link.textContent = 'Online Store';
      link.className = 'ite-store-nav-link';
      link.setAttribute('aria-label','Visit the IT Elements Online Store');
      var services = Array.from(nav.querySelectorAll('a')).find(function(a){ return /services/i.test(a.textContent || '') && a.getAttribute('href') !== '/store'; });
      if (services && services.nextSibling) nav.insertBefore(link, services.nextSibling);
      else nav.appendChild(link);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStoreNavigation);
  else ensureStoreNavigation();
})();
