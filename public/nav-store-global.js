(function () {
  'use strict';
  var mobileQuery = '(max-width: 760px)';
  var sequence = 0;
  function makeLink(href, label, extra) {
    var a = document.createElement('a'); a.href = href; a.textContent = label;
    if (extra) a.className = extra;
    return a;
  }
  function closeDrawer(drawer, trigger) {
    if (!drawer) return;
    drawer.classList.remove('open'); document.body.classList.remove('ite-drawer-open');
    if (trigger) { trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-label','Open menu'); }
  }
  function openDrawer(drawer, trigger) {
    if (!drawer) return;
    drawer.classList.add('open'); document.body.classList.add('ite-drawer-open');
    if (trigger) { trigger.setAttribute('aria-expanded','true'); trigger.setAttribute('aria-label','Close menu'); }
  }
  function createDrawer(nav, linksBox, trigger) {
    if (!trigger || trigger.dataset.iteDrawerId) return;
    sequence++;
    var id = 'iteMobileDrawer' + sequence;
    trigger.dataset.iteDrawerId = id; trigger.setAttribute('aria-controls',id);
    trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-label','Open menu');
    var overlay = document.createElement('div'); overlay.className='ite-mobile-drawer'; overlay.id=id;
    overlay.innerHTML = '<aside class="ite-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="IT Elements menu">' +
      '<div class="ite-mobile-drawer-head"><strong>Welcome</strong><button class="ite-mobile-drawer-close" type="button" aria-label="Close menu">×</button></div>' +
      '<div class="ite-mobile-drawer-welcome"><p>Sign in for a more seamless shopping experience</p><a class="ite-drawer-login" href="/client/login">Login</a><span>New to IT Elements? <a class="ite-drawer-register" href="/register">Register</a></span></div>' +
      '<nav class="ite-mobile-drawer-links" aria-label="Website links"></nav></aside>';
    var list=overlay.querySelector('.ite-mobile-drawer-links');
    // Keep the exact shopping-drawer order from the user's reference first.
    // The remaining IT Elements pages follow underneath; no page destinations are removed.
    var canonical=[
      ['/','Home'],['/store#catalogue','Shop by Category'],['/store#featured','Deals & featured products'],
      ['/client/login','Orders & order history'],['/client/login','My Account'],['/store#cart','Cart'],
      ['/store','Store'],['/services','Services'],['/onsite-support','On-site'],['/pricing','Plans'],
      ['/business-support','Business'],['/reviews','Reviews'],['/about','About'],['/faq','FAQ'],['/contact','Contact'],
      ['/client/login','Client Portal']
    ];
    canonical.forEach(function(item){list.appendChild(makeLink(item[0],item[1]));});
    // Preserve every other destination already present in the page's own navigation.
    if (linksBox) Array.prototype.forEach.call(linksBox.querySelectorAll('a'),function(original){
      var href=original.getAttribute('href')||'#', label=(original.textContent||'').trim(); if(!label)return;
      var exists=Array.prototype.some.call(list.querySelectorAll('a'),function(a){return a.getAttribute('href')===href && a.textContent.trim().toLowerCase()===label.toLowerCase();});
      if(!exists) list.appendChild(makeLink(href,label));
    });
    document.body.appendChild(overlay);
    overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click',function(){closeDrawer(overlay,trigger);});
    overlay.addEventListener('click',function(e){if(e.target===overlay || (e.target.closest && e.target.closest('a')))closeDrawer(overlay,trigger);});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer(overlay,trigger);});
  }
  function setup(){
    // Public navigation variants: standard pages, reviews, customer portal and account headers.
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav, nav.navbar, nav.site-nav, nav.main-nav, nav.nav-links, nav.header-actions'),function(nav){
      if(nav.closest('.app') || nav.getAttribute('aria-label')==='Store management')return;
      var header=nav.closest('header');
      var brand=nav.querySelector('.brand, .nav-brand') || (header && header.querySelector('.brand, .nav-brand, h1'));
      if(!brand)return;
      var links=nav.querySelector('.nav-links, .links') || nav;
      var trigger=nav.querySelector('.menu-toggle, .ite-mobile-menu-trigger') || (header && header.querySelector('.menu-toggle, .ite-mobile-menu-trigger'));
      if(!trigger){trigger=document.createElement('button');trigger.type='button';trigger.className='ite-mobile-menu-trigger';trigger.textContent='☰';brand.insertAdjacentElement('afterend',trigger);}
      trigger.classList.add('ite-mobile-menu-trigger'); createDrawer(nav,links,trigger);
    });
    // Account-only pages have a logo header but no page navigation; give them the same drawer.
    Array.prototype.forEach.call(document.querySelectorAll('header.site-header'),function(header){
      if(header.querySelector('.ite-mobile-menu-trigger'))return;
      var brand=header.querySelector('.logo, .brand');if(!brand)return;
      var trigger=document.createElement('button');trigger.type='button';trigger.className='ite-mobile-menu-trigger';trigger.textContent='☰';header.appendChild(trigger);
      createDrawer(header,null,trigger);
    });
    // Store keeps its cart logic and product catalogue; mobile uses the same Welcome drawer.
    var storeHeader=document.querySelector('body.store-page header');
    if(storeHeader && storeHeader.querySelector('.cartbtn')){
      var brand=storeHeader.querySelector('.brand'), links=storeHeader.querySelector('nav');
      if(brand){var trigger=storeHeader.querySelector('.ite-generated-menu');
        if(!trigger){trigger=document.createElement('button');trigger.type='button';trigger.className='ite-generated-menu';trigger.textContent='☰';storeHeader.appendChild(trigger);}
        createDrawer(storeHeader,links,trigger);
      }
    }
  }

  document.addEventListener('click',function(e){
    if(!window.matchMedia || !window.matchMedia(mobileQuery).matches)return;
    var trigger=e.target.closest && e.target.closest('.menu-toggle, .ite-mobile-menu-trigger, .ite-generated-menu');
    if(!trigger)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    var drawer=document.getElementById(trigger.dataset.iteDrawerId); if(!drawer)return;
    drawer.classList.contains('open')?closeDrawer(drawer,trigger):openDrawer(drawer,trigger);
  },true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
