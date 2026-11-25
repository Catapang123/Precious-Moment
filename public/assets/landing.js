(function(){
  'use strict';
  var CW = 1172, CH = 657;
  var TAB_MAX = 1080, TAB_MIN = 701, DW_MIN = 920;
  var R = 891, P = 891, N = 37, STEP = 360 / N, CULL = 42;
  var mobile = false, tablet = false, k = 1, tboost = 1, fill = 0;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('canvas');
  var stack = document.getElementById('stack');
  var showcase = document.getElementById('showcase');
  var ring = document.getElementById('ring');
  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var navBtn = document.getElementById('navBtn');
  var vpBtn = document.getElementById('vpBtn');
  var h1a = document.getElementById('h1a');
  var h1b = document.getElementById('h1b');
  var sub1 = document.getElementById('sub1');
  var sub2 = document.getElementById('sub2');
  var badgeTxt = document.getElementById('badgeTxt');
  var wmName = document.getElementById('wmName');
  var ctaLabel = document.getElementById('ctaLabel');
  var vpLabel = document.getElementById('vpLabel');
  var links = document.getElementById('links');
  var linkEls = Array.prototype.slice.call(links.querySelectorAll('a'));

  /* The star field is one giant box-shadow list on a 1px dot. */
  function stars(id, count, blur, lo, hi){
    var out = [];
    for(var i = 0; i < count; i++){
      var x = (Math.random() * 100).toFixed(2);
      var y = (Math.random() * 100).toFixed(2);
      var a = (lo + Math.random() * (hi - lo)).toFixed(3);
      out.push(x + 'vw ' + y + 'vh ' + blur + 'px 0 rgba(255,255,255,' + a + ')');
    }
    document.getElementById(id).style.boxShadow = out.join(',');
  }
  stars('stA', 150, 0, .05, .30);
  stars('stB', 18, 1.2, .35, .70);

  /* Precious Moments' own product photos, served from the shop's public
     Supabase Storage bucket (the same files the storefront uses). */
  var IMG = 'https://rgqocaxfnzidczabrhjx.supabase.co/storage/v1/object/public/product-images/';
  var SHOTS = [
    {v:'pay', url:IMG + 'c6395d3a-169a-4ab7-93b7-d6a98c95ff28.jpg'},
    {v:'launch', url:IMG + 'aba10ee6-3828-4d6a-a12b-b2fe02bd712e.jpg'},
    {v:'shop', url:IMG + 'e63a9fd7-7416-442c-87cf-e44f8cbfa256.jpg'},
    {v:'brand', url:IMG + '31922460-fdef-4bcd-8020-fd89006222b7.jpg'},
    {v:'frete', url:IMG + '4ce78305-54d7-421e-9f24-04e589fb3fbf.jpg'},
    {v:'plain', t:'MADE TO KEEP', url:IMG + '18e804ca-ded8-4055-ab48-34f4b9186519.jpg'},
    {v:'power', url:IMG + 'e2903bad-1c67-45be-a9c5-8fe0ae02bbb4.jpg'},
    {v:'plain', t:'NOW BOOKING', url:IMG + '9835968a-eaf3-4db4-bb5a-6a6a739db738.jpg'},
    {v:'off', url:IMG + '3218c3ae-ca99-4091-958d-3d6d7fbf16fc.jpg'},
    {v:'plain', t:'TEAM SHIRTS', url:IMG + 'cc4d9543-ddaa-4c9b-b355-4c7e70ceaf2f.jpg'},
    {v:'plain', t:'INVITATIONS', url:IMG + '75e0a555-dd8a-431d-b8f9-851d8bb8597d.jpg'},
    {v:'plain', t:'PRINTS', url:IMG + 'dce22c81-2627-4d7f-9c84-cf143adef242.jpg'},
    {v:'plain', t:'STICKERS', url:IMG + 'bcddb77d-34d6-460e-bb52-75a2c0d2f910.jpg'}
  ];

  function creative(d){
    var im = '<img alt="" src="' + d.url + '">';
    if(d.v === 'pay'){
      return '<div class="fill" style="background:#efedea"></div>' +
        '<div class="ph" style="top:112px;bottom:0">' + im + '</div>' +
        '<svg class="ph" style="top:118px;bottom:0" viewBox="0 0 130 182" preserveAspectRatio="none" aria-hidden="true">' +
          '<g stroke="#e5202f" stroke-width="8" fill="none" opacity=".92" stroke-linecap="square">' +
            '<path d="M2 42h30M14 30v96M4 100l26-16"/>' +
            '<path d="M96 34v58M120 34v58M96 92q12 15 24 0"/>' +
            '<path d="M92 108l14 34M126 108l-12 34"/>' +
          '</g></svg>' +
        '<div class="cv" style="top:20px;text-align:right;font-size:3.4px;letter-spacing:.15em;color:#8d9298">HOW BOOKING WORKS</div>' +
        '<div class="cv t-big" style="top:32px;font-size:14px;color:#16171b">One request</div>' +
        '<div class="cv t-big" style="top:47px;font-size:12px;color:#e5202f">Prints &amp; booths</div>' +
        '<div class="cv" style="top:76px;font-size:5.2px;font-weight:700;color:#16171b;line-height:1.7">' +
          '<div><b class="dot"></b>RESERVE WITH <b>50%</b></div>' +
          '<div style="margin-top:8px"><b class="dot sq"></b>OR PAY IN FULL<br>' +
          '<span style="margin-left:11px">ON THE DAY</span></div>' +
        '</div>';
    }
    if(d.v === 'launch'){
      return '<div class="fill" style="background:linear-gradient(168deg,#f9d9e5,#f3bdd2 55%,#e8a3c0)"></div>' +
        '<div class="ph" style="top:100px;bottom:0">' + im +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(249,217,229,.97),rgba(249,217,229,0) 30%)"></div>' +
        '</div>' +
        '<div class="cv t-serif" style="top:36px;font-size:17px;color:#b03a63">COLLECTION</div>' +
        '<div class="cv t-serif" style="top:55px;font-size:17px;color:#b03a63">NOW OPEN!</div>';
    }
    if(d.v === 'shop'){
      return '<div class="fill" style="background:#fff"></div>' +
        '<div class="ph" style="top:0;height:148px">' + im + '</div>' +
        '<div class="cv" style="top:158px;font-size:5.4px;font-weight:700;letter-spacing:.09em;color:#16171b">MADE TO KEEP</div>' +
        '<div class="cv" style="top:168px;font-size:4.2px;color:#7b8087">Prints · Shirts · Mugs</div>' +
        '<div style="position:absolute;left:10px;top:180px;padding:4px 11px;border-radius:20px;background:#16171b;font-size:4.6px;font-weight:600;color:#fff;letter-spacing:.05em">Book today</div>';
    }
    if(d.v === 'brand'){
      return '<div class="fill" style="background:linear-gradient(180deg,#0a2a4a,#0d3a63 50%,#08192b)"></div>' +
        '<div class="ph" style="top:92px;bottom:0">' + im +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(10,42,74,.98),rgba(10,42,74,0) 36%)"></div>' +
        '</div>' +
        '<div class="cv" style="top:16px;font-size:4.2px;line-height:1.7;color:rgba(255,255,255,.82);width:74px">Prints, keepsakes, photo coverage and booths — planned around your date, made in Batangas.</div>' +
        '<div style="position:absolute;right:10px;top:16px;font-size:5.4px;font-weight:600;color:#fff;opacity:.92">✳ Precious Moments</div>';
    }
    if(d.v === 'frete'){
      return '<div class="fill" style="background:linear-gradient(158deg,#4a0c80 0%,#7a16a6 40%,#a81fc6 66%,#5c0e90 100%)"></div>' +
        '<div class="ph" style="top:140px;bottom:0;opacity:.45;mix-blend-mode:screen">' + im + '</div>' +
        '<div class="fill" style="background:radial-gradient(44% 16% at 50% 62%, rgba(255,255,255,.92), rgba(255,255,255,0) 72%)"></div>' +
        '<div style="position:absolute;left:-6px;right:-6px;top:44px;height:13px;background:#ff2d8a;transform:rotate(-2.6deg);box-shadow:0 4px 12px rgba(255,45,138,.5)"></div>' +
        '<div style="position:absolute;left:0;right:0;top:45.5px;transform:rotate(-2.6deg);text-align:center;font-size:5.6px;font-weight:700;letter-spacing:.05em;color:#fff">MADE TO ORDER IN BATANGAS</div>' +
        '<div class="cv t-big" style="top:64px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Prints</div>' +
        '<div class="cv t-big" style="top:87px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Booths</div>' +
        '<div class="cv t-big" style="top:113px;font-size:19px;color:#fff">+</div>';
    }
    if(d.v === 'power'){
      return '<div class="ph phf">' + im + '</div>' +
        '<div class="fill" style="background:linear-gradient(180deg,rgba(6,5,10,0) 34%,rgba(6,5,10,.55) 52%,rgba(6,5,10,.92) 72%)"></div>' +
        '<div class="cv t-serif" style="top:132px;font-size:16px;color:#fff">THE PHOTO</div>' +
        '<div class="cv t-serif" style="top:150px;font-size:16px;color:#fff">BOOTH</div>' +
        '<div class="cv" style="top:171px;font-size:4.4px;letter-spacing:.07em;color:rgba(255,255,255,.85)">keeps every moment you make</div>';
    }
    if(d.v === 'off'){
      return '<div class="ph phf">' + im + '</div>' +
        '<div class="fill" style="background:linear-gradient(180deg,rgba(3,9,20,0) 30%,rgba(3,9,20,.6) 48%,rgba(3,9,20,.95) 70%)"></div>' +
        '<div class="cv t-big" style="top:126px;font-size:10px;color:#fff;opacity:.9">Now booking</div>' +
        '<div class="cv t-big" style="top:139px;font-size:22px;color:#ff8bbd;text-shadow:0 0 16px rgba(255,139,189,.5)">2026–27</div>';
    }
    return '<div class="ph phf">' + im + '</div>' +
      '<div class="fill" style="background:linear-gradient(180deg,rgba(4,8,16,0) 38%,rgba(4,8,16,.85) 68%)"></div>' +
      '<div class="cv" style="top:150px;font-size:5.4px;font-weight:600;letter-spacing:.2em;color:#fff">' + d.t + '</div>';
  }

  var cards = [];
  for(var ci = 0; ci < N; ci++){
    var d = SHOTS[ci % SHOTS.length];
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = creative(d) + '<div class="edge"></div>';
    var cimg = card.querySelector('img');
    if(cimg) cimg.addEventListener('error', function(){ this.closest('.card').classList.add('broken'); });
    ring.appendChild(card);
    cards.push(card);
  }

  /* ------------------------------------------------------------- fitter */
  var mctx = document.createElement('canvas').getContext('2d');
  function fontOf(el){
    var cs = getComputedStyle(el);
    return {weight: cs.fontWeight, size: parseFloat(cs.fontSize), family: cs.fontFamily};
  }
  function ctxFont(f, size){
    return f.weight + ' ' + size + 'px ' + f.family;
  }
  function capRatio(el){
    var f = fontOf(el);
    mctx.font = ctxFont(f, 100);
    var m = mctx.measureText('H');
    return (m.actualBoundingBoxAscent || 70) / 100;
  }
  function inkWidth(el){
    return el.getBoundingClientRect().width / (mobile ? 1 : k);
  }
  function fitW(el, target){
    el.style.fontSize = '';
    var base = parseFloat(getComputedStyle(el).fontSize);
    var w = inkWidth(el);
    if(w) el.style.fontSize = (base * target / w) + 'px';
  }
  function fitBox(el, tw, tc, pre){
    if(!el) return;
    pre = pre || '';
    el.style.transform = pre;
    el.style.fontSize = (tc / capRatio(el)) + 'px';
    var w = inkWidth(el);
    if(w) el.style.transform = pre + (pre ? ' ' : '') + 'scaleX(' + (tw / w) + ')';
  }
  function baseline(el, y){
    var f = fontOf(el);
    mctx.font = ctxFont(f, f.size);
    var m = mctx.measureText('Hg');
    var A = m.fontBoundingBoxAscent || f.size * .8;
    var D = m.fontBoundingBoxDescent || f.size * .2;
    el.style.top = (y - ((f.size - (A + D)) / 2 + A)) + 'px';
  }
  function centreLabel(btn, el, capPx){
    var btnH = parseFloat(getComputedStyle(btn).height);
    var f = fontOf(el);
    mctx.font = ctxFont(f, f.size);
    var m = mctx.measureText('Hg');
    var A = m.fontBoundingBoxAscent || f.size * .8;
    var D = m.fontBoundingBoxDescent || f.size * .2;
    var baselineIn = (f.size - (A + D)) / 2 + A;
    var spanTop = (btnH - f.size) / 2;
    var capCentre = spanTop + baselineIn - capPx / 2;
    var BIAS = 1.1;
    el.style.top = (btnH / 2 - capCentre + BIAS) + 'px';
  }

  function clearFit(){
    [h1a,h1b,sub1,sub2,badgeTxt,wmName,ctaLabel,vpLabel].forEach(function(el){
      el.style.fontSize = '';
      el.style.top = '';
      el.style.transform = '';
    });
    links.style.fontSize = '';
    links.style.transform = '';
    linkEls.forEach(function(a){ a.style.fontSize = ''; });
  }

  function layout(){
    if(mobile){
      clearFit();
      placeCards();
      return;
    }
    var T = tablet ? tboost : 1;
    fitBox(h1a, 563.5 * T, 37.2 * T, 'translateX(-50%)');
    baseline(h1a, 204.5);
    fitBox(h1b, 197.5 * T, 37.2 * T, 'translateX(-50%)');
    baseline(h1b, 258.5);
    fitBox(sub1, 389 * T, 8.4 * T, 'translateX(-50%)');
    baseline(sub1, 300.5);
    fitBox(sub2, 311 * T, 8.4 * T, 'translateX(-50%)');
    baseline(sub2, 316.5);
    fitBox(badgeTxt, 184 * T, 9.4 * T, 'translate(2px,-1px)');
    fitBox(wmName, 78 * T, 11.4 * T);
    baseline(wmName, 38.5);
    fitBox(ctaLabel, 87 * T, 8.9 * T);
    centreLabel(navBtn, ctaLabel, 8.9 * T);
    fitBox(vpLabel, 76 * T, 9.5 * T);
    centreLabel(vpBtn, vpLabel, 9.5 * T);

    if(tablet){
      links.style.transform = '';
      linkEls.forEach(function(a){ a.style.fontSize = ''; });
    }else{
      links.style.transform = '';
      var fs = 7.9 / capRatio(linkEls[0]);
      linkEls.forEach(function(a){ a.style.fontSize = fs + 'px'; });
      var rowW = links.getBoundingClientRect().width / k;
      if(rowW > 317) links.style.transform = 'scaleX(' + (317 / rowW) + ')';
    }
    placeCards();
  }

  /* -------------------------------------------------------------- ring */
  var phase = -2;
  var last = performance.now();
  function placeCards(){
    for(var i = 0; i < cards.length; i++){
      var el = cards[i];
      var a = ((i * STEP + phase) % 360 + 540) % 360 - 180;
      if(Math.abs(a) > CULL){
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      var r = a * Math.PI / 180;
      var c = Math.cos(r);
      el.style.transform = 'translate3d(' + (R * Math.sin(r)) + 'px,0,' + (R * (1 - c)) + 'px) rotateY(' + (-a) + 'deg)';
      el.style.filter = 'brightness(' + (0.84 + 0.5 * (1 / c - 1)) + ')';
    }
  }
  function tick(t){
    var dt = Math.min((t - last) / 1000, .1);
    last = t;
    if(!reduced) phase -= 1.9 * dt;
    placeCards();
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ responsive */
  function resize(){
    var vw = innerWidth, vh = innerHeight;
    mobile = vw <= 700;
    tablet = vw > 700 && vw <= TAB_MAX;

    if(mobile){
      k = 1;
      tboost = 1;
      canvas.style.removeProperty('--k');
      canvas.style.removeProperty('--fill');
      canvas.style.removeProperty('--stshift');
      canvas.style.removeProperty('--sshift');
      canvas.style.removeProperty('--rs');
      layout();
      return;
    }

    if(tablet){
      var W = DW_MIN + (vw - TAB_MIN) * (CW - DW_MIN) / (TAB_MAX - TAB_MIN);
      if(vh > vw * 1.15) W = Math.min(W, 900);
      k = Math.min(vw / W, vh / 560);
      var ramp = Math.min(1, (TAB_MAX - vw) / 120);
      tboost = 1 + 0.14 * ramp;
      fill = Math.max(0, vh / k - CH);
      var ss = 0, rs = 1, st = 0;
      if(fill > 0){
        ss = Math.min(fill * 0.55, 420) * ramp;
        rs = 1 + Math.min(fill / 1100, 0.75) * ramp;
        var slack = 219.5 - 125 * rs + ss;
        st = Math.max(0, slack / 2 - 28) * ramp;
        fill -= ss;
      }
      canvas.style.setProperty('--k', k);
      canvas.style.setProperty('--fill', fill + 'px');
      canvas.style.setProperty('--stshift', st + 'px');
      canvas.style.setProperty('--sshift', ss + 'px');
      canvas.style.setProperty('--rs', rs);
    }else{
      k = Math.min(vw / CW, vh / 560);
      tboost = 1;
      fill = Math.max(0, vh / k - CH);
      canvas.style.setProperty('--k', k);
      canvas.style.setProperty('--fill', fill + 'px');
      canvas.style.setProperty('--stshift', '0px');
      canvas.style.setProperty('--sshift', '0px');
      canvas.style.setProperty('--rs', '1');
    }

    if(vw > TAB_MAX) closeMenu(false);
    layout();
  }

  /* --------------------------------------------------------------- menu */
  function setMenu(open){
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeMenu(returnFocus){
    var wasOpen = nav.classList.contains('open');
    setMenu(false);
    if(wasOpen && returnFocus) burger.focus();
  }
  burger.addEventListener('click', function(e){
    e.stopPropagation();
    setMenu(!nav.classList.contains('open'));
  });
  document.addEventListener('click', function(e){
    if(!nav.contains(e.target)) closeMenu(false);
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && nav.classList.contains('open')) closeMenu(true);
  });
  links.addEventListener('click', function(e){
    if(e.target.closest('a')) closeMenu(false);
  });

  /* --------------------------------------------------------------- intro */
  function intro(){
    var root = document.documentElement;
    if(!root.classList.contains('intro') || reduced || !Element.prototype.animate){
      settle();
      return;
    }
    var D = innerWidth <= 700 ? .66 : 1;
    var EXPO = 'cubic-bezier(.16,1,.3,1)';
    var SOFT = 'cubic-bezier(.22,.61,.36,1)';
    function Y(px){ return '0 ' + (px * D) + 'px'; }
    var n = 0, lastAnim = null, lastEnd = 0;
    function play(el, from, dur, delay, ease){
      if(!el) return;
      var to = {opacity:1};
      if(from.translate) to.translate = '0 0';
      if(from.scale) to.scale = '1';
      if(from.clipPath) to.clipPath = 'inset(-30% 0 -30% 0)';
      var a = el.animate([from, to], {duration:dur, delay:delay, easing:ease, fill:'both'});
      a.id = 'intro:' + (n++);
      if(delay + dur >= lastEnd){
        lastEnd = delay + dur;
        lastAnim = a;
      }
    }
    play(nav, {opacity:0, translate:Y(-9)}, 620, 60, EXPO);
    play(document.querySelector('.mark'), {opacity:0, translate:Y(6)}, 520, 150, SOFT);
    play(document.querySelector('.wm'), {opacity:0, translate:Y(6)}, 520, 185, SOFT);
    linkEls.forEach(function(a, i){ play(a, {opacity:0, translate:Y(6)}, 460, 215 + i * 45, SOFT); });
    play(burger, {opacity:0, translate:Y(6)}, 460, 300, SOFT);
    play(navBtn, {opacity:0, translate:Y(6)}, 500, 400, SOFT);
    play(document.querySelector('.badge'), {opacity:0, translate:Y(11), scale:.985}, 560, 270, EXPO);
    play(h1a, {opacity:0, translate:Y(15), clipPath:'inset(100% 0 -30% 0)'}, 900, 380, EXPO);
    play(h1b, {opacity:0, translate:Y(15), clipPath:'inset(100% 0 -30% 0)'}, 900, 470, EXPO);
    play(sub1, {opacity:0, translate:Y(10)}, 620, 690, EXPO);
    play(sub2, {opacity:0, translate:Y(10)}, 620, 745, EXPO);
    play(vpBtn, {opacity:0, translate:Y(13), scale:.985}, 620, 830, EXPO);
    play(ring, {opacity:0, translate:Y(18), scale:.99}, 950, 700, EXPO);
    play(document.getElementById('browser'), {opacity:0, translate:Y(26)}, 900, 900, EXPO);
    if(lastAnim) lastAnim.finished.then(settle).catch(settle);
    else settle();
    setTimeout(settle, 4200);
  }
  var settled = false;
  function settle(){
    if(settled) return;
    settled = true;
    document.getAnimations().forEach(function(a){
      if(a.id && a.id.indexOf('intro:') === 0) a.cancel();
    });
    document.documentElement.classList.remove('intro');
  }

  /* ------------------------------------------------------------- wiring */
  addEventListener('resize', resize);
  if(window.visualViewport) visualViewport.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function(){
    last = performance.now();
  });
  if(window.matchMedia){
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if(mq.addEventListener) mq.addEventListener('change', function(e){ reduced = e.matches; });
  }

  resize();
  document.fonts.ready.then(function(){ resize(); layout(); });
  setTimeout(function(){ resize(); layout(); }, 400);
  setTimeout(function(){ resize(); layout(); }, 1400);
  requestAnimationFrame(tick);
  intro();
})();
