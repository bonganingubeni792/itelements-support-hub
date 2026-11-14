
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
  function installSharedMobileDrawer(){
    if(!window.matchMedia || !window.matchMedia('(max-width:760px) and (orientation:portrait)').matches)return;
    var navs=Array.from(document.querySelectorAll('nav.nav, nav.navbar'));
    navs.forEach(function(nav){
      if(nav.closest('header') && nav.closest('header').querySelector('.mobile-menu-trigger'))return;
      var linksBox=nav.querySelector('.nav-links,.links');
      if(!linksBox)return;
      var brand=nav.querySelector('.brand,.nav-brand');
      var toggle=nav.querySelector('.menu-toggle,.ite-mobile-menu-trigger');
      if(!toggle){
        toggle=document.createElement('button');toggle.type='button';toggle.className='ite-mobile-menu-trigger';toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-expanded','false');toggle.textContent='☰';nav.appendChild(toggle);
      }
      var overlay=document.createElement('div');overlay.className='ite-mobile-drawer';overlay.innerHTML=
        '<aside class="ite-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="IT Elements navigation">'+
        '<div class="ite-mobile-drawer-head"><strong>Welcome</strong><button class="ite-mobile-drawer-close" type="button" aria-label="Close menu">×</button></div>'+
        '<div class="ite-mobile-drawer-welcome"><p>Sign in for a more seamless IT Elements experience</p><a href="/client/login">Login</a><span>New to IT Elements? <a href="/register">Register</a></span></div>'+
        '<nav class="ite-mobile-drawer-links" aria-label="Website links"></nav></aside>';
      var list=overlay.querySelector('.ite-mobile-drawer-links');
      Array.from(linksBox.querySelectorAll('a')).forEach(function(a){
        var copy=a.cloneNode(true);copy.className='';list.appendChild(copy);
      });
      document.body.appendChild(overlay);
      function open(){overlay.classList.add('open');toggle.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
      function close(){overlay.classList.remove('open');toggle.setAttribute('aria-expanded','false');document.body.style.overflow='';}
      toggle.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();open();},true);
      overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click',close);
      overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
      list.addEventListener('click',function(e){if(e.target.closest('a'))close();});
      document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
    });
  }
  function boot(){
    ensureStoreNavigation();
    installSharedMobileDrawer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
