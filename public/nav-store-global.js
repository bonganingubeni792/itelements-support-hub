
(function(){
 'use strict';
 function installMobileHeader(){
  if(!window.matchMedia||!window.matchMedia('(max-width:760px)').matches)return;
  var navs=Array.from(document.querySelectorAll('nav.nav,nav.navbar'));
  navs.forEach(function(nav){
   if(nav.dataset.iteMobileReady==='1')return;
   var linksBox=nav.querySelector('.nav-links,.links');
   var brand=nav.querySelector('.brand,.nav-brand');
   if(!linksBox||!brand)return;
   nav.dataset.iteMobileReady='1';
   var toggle=nav.querySelector('.menu-toggle,.ite-mobile-menu-trigger');
   if(!toggle){
    toggle=document.createElement('button');toggle.type='button';toggle.className='ite-mobile-menu-trigger';
    toggle.setAttribute('aria-label','Open menu');toggle.setAttribute('aria-expanded','false');toggle.textContent='☰';
    nav.insertBefore(toggle,brand);
   }
   toggle.classList.add('ite-mobile-menu-trigger');
   toggle.setAttribute('aria-label','Open menu');
   var cart=nav.querySelector('.ite-mobile-cart');
   if(!cart){
    cart=document.createElement('a');cart.className='ite-mobile-cart';cart.href='/store';
    cart.textContent='Cart (0)';cart.setAttribute('aria-label','Open shopping cart');
    nav.appendChild(cart);
   }
   var overlay=document.createElement('div');
   overlay.className='ite-mobile-drawer';
   overlay.innerHTML='<aside class="ite-mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="IT Elements menu">'+
    '<div class="ite-mobile-drawer-head"><strong>Welcome</strong><button class="ite-mobile-drawer-close" type="button" aria-label="Close menu">×</button></div>'+
    '<div class="ite-mobile-drawer-welcome"><p>Sign in for a more seamless IT Elements experience</p><a href="/client/login">Login</a><span>New to IT Elements? <a href="/register">Register</a></span></div>'+
    '<nav class="ite-mobile-drawer-links" aria-label="Website links"></nav></aside>';
   var list=overlay.querySelector('.ite-mobile-drawer-links');
   Array.from(linksBox.querySelectorAll('a')).forEach(function(a){
    var copy=a.cloneNode(true);copy.className='';list.appendChild(copy);
   });
   // Preserve access to the cart as a normal menu item as well.
   var cartLink=document.createElement('a');cartLink.href='/store';cartLink.textContent='Cart';list.appendChild(cartLink);
   document.body.appendChild(overlay);
   function open(){overlay.classList.add('open');toggle.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
   function close(){overlay.classList.remove('open');toggle.setAttribute('aria-expanded','false');document.body.style.overflow='';}
   toggle.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();open();});
   overlay.querySelector('.ite-mobile-drawer-close').addEventListener('click',close);
   overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
   list.addEventListener('click',function(e){if(e.target.closest('a'))close();});
   document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
  });
 }
 function ensureStoreLink(){
  var navs=Array.from(document.querySelectorAll('nav.nav,nav.navbar'));
  navs.forEach(function(nav){
   var links=nav.querySelector('.nav-links,.links');if(!links)return;
   if(!links.querySelector('a[href="/store"],a[href="/store/"]')){
    var a=document.createElement('a');a.href='/store';a.textContent='Online Store';links.appendChild(a);
   }
  });
 }
 function boot(){ensureStoreLink();installMobileHeader();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
