/**
 * pulse 视频播放器上的两件事:滑动快进快退 + 点开播放时默认给最高画质。
 *
 * 只用站点自己的东西:进度走 video.js 现成的 currentTime(进度条与时间文本由站点更新),
 * 画质调站点播放器自己的 `player.src()` 与它自带的 `qualityChange` 事件 —— 不模拟点击、
 * 不弹它的清晰度菜单,用户看不到换档过程。不另造控制层。
 * 纵向手势仍交给页面滚动,进度条上的拖动也仍归站点。
 * 全屏看图(.pswp)里只有真视频吃这手势,live 图与动图交给站点的翻页。
 * 顺带一件同宿主的事:按到播放器时把视频真实比例报给原生,全屏方向按它定。
 */
(function () {
  if (!document.documentElement) return;
  if (window.__bwSeekReady) return;
  window.__bwSeekReady = true;

  var FULL_SWIPE_SECONDS = 60;   // 拖满整个播放器宽度 = 60s
  var START_THRESHOLD = 10;      // 超过这个横向位移才算拖动,避免吃掉点击
  // 看图器里的短片阈值:live 图实测 2.58 / 2.83 / 3.01s,真视频 38.64 / 143.4s。
  // 拖满一整屏等于 60s,对 3s 的片子只有"跳到结尾"一种结果 —— 不值得为它抢掉翻页。
  var FLIP_UNDER_SECONDS = 10;

  function secondsPerPx(host) {
    var w = host.getBoundingClientRect().width || 1;
    return FULL_SWIPE_SECONDS / w;
  }

  function isProgressBar(target) {
    var n = target;
    for (var d = 0; n && d < 5; n = n.parentElement, d++) {
      var c = String(n.className || '');
      if (/progress|seek|vjs-slider/i.test(c)) return true;
    }
    return false;
  }

  function videoOf(host) {
    return host.querySelector('video') || host;
  }

  /* 只接管"点开在播"的那层。信息流里的缩略图是 div.mwb-video.mwbv-play 挂在
     div.card-video 下,与站点真正播放用的那颗 div.video-player.mwb-layer 里的
     .video-js 是两个不同节点(实测)—— 在缩略图上横滑既不该跳进度,也不该把
     本该属于卡片的横向手势吃掉(绑上还会顺带写 touch-action:pan-y)。
     看图器 .pswp 里照旧按下面的时长规则决定让不让给翻页。 */
  function seekable(host) {
    return !!(host.closest && host.closest('.mwb-layer, .pswp'));
  }

  /* 站点的全屏看图(photoswipe)本身是个横向翻页的容器,而 live 图/动图在它里面
     就是一张视频卡片(见 mvGallery 给 slide 塞的 html video)。那张卡片上横滑该翻页
     还是该拖进度,按"这条片子值不值得拖"判:几秒的 live 图拖不动出意义,让给翻页;
     几十秒以上的真视频仍然归拖进度。时长要到手势发生时才知道(元数据是异步到的),
     拿不到时长时一律让给翻页 —— 宁可不拖,不能翻不动。 */
  function inGallery(el) {
    return !!(el.closest && el.closest('.pswp'));
  }

  /* ---- 拖动时的进度与目标时间示意(样式在 theme.js) ---- */
  var hud = null, hudTimer = null;

  /* 全屏时只有 :fullscreen 那棵子树会被渲染,挂在 <html> 上的节点根本不画
     (实测:往 documentElement 塞一块红、往 fullscreenElement 塞一块绿,截屏里只有绿)。
     所以示意的宿主要跟全屏元素走,否则"全屏后横滑看不见进度条"。 */
  function hudHost() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
      document.documentElement;
  }

  function ensureHud() {
    var host = hudHost();
    if (hud && hud.isConnected && hud.parentElement === host) return hud;
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'bw-scrub';
      hud.innerHTML = '<div class="t"></div><div class="bar"><i></i></div>';
    }
    host.appendChild(hud);
    return hud;
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t));
    var s = t % 60, m = Math.floor(t / 60), h = Math.floor(m / 60);
    return h ? h + ':' + pad(m % 60) + ':' + pad(s) : m + ':' + pad(s);
  }

  function showHud(host, target, dur) {
    var el = ensureHud(), r = host.getBoundingClientRect();
    el.style.left = Math.round(r.left + r.width / 2) + 'px';
    el.style.top = Math.round(r.top + r.height / 2) + 'px';
    el.querySelector('.t').innerHTML = fmt(target) + ' <em>/ ' + fmt(dur) + '</em>';
    el.querySelector('.bar i').style.width = (dur > 0 ? Math.min(100, target / dur * 100) : 0) + '%';
    el.classList.add('on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { el.classList.remove('on'); }, 700);
  }

  /* ---- 点开播放时默认切到最高画质:走站点自己的播放器接口,不模拟点击 ----
     站点默认给"标清"(实测点开一条 720p 的片子,在播的是 853×480 那一路)。
     它的清晰度控件是 video.js 组件 `QualityButton`,菜单项是它的 MenuItem,
     站点自己换档的那段代码是:
        currentTime 存一下 → player.src({src,type:'video/mp4'}) → load() → play()
        → currentTime(回去) → 给自己 addClass('vjs-selected')
        → trigger('toggleMenu') → trigger('qualityChange', options)
     其中 `toggleMenu` 会被 QualityButton.handleClick 接去翻 `.mwb-show-menu` ——
     **清晰度菜单就此弹在屏幕上**,那就是用户看到的"点击过程"。
     所以这里不 dispatch 任何 click,只按同样的顺序把换档那几步走一遍,
     并且不发 toggleMenu:标签与选中态由站点自己的 `qualityChange` 监听(updateLabel)负责。
     档位高低用站点自带的 `qualityList[].sign`(越大越高),不再靠文案去猜。 */
  var Q_TRIES = 5;      // 组件树是异步建起来的,读不到时最多再等几拍
  var Q_EVERY = 400;

  function playerOf(host) {
    if (!window.videojs) return null;
    var el = (host.classList && host.classList.contains('video-js'))
      ? host : host.querySelector('.video-js');
    if (!el) return null;
    try { return window.videojs(el) || null; } catch (e) { return null; }
  }

  /** 组件树里的 QualityButton 与它菜单下的档位项 */
  function qualityCtl(player) {
    var btn = null;
    (function walk(c) {
      if (btn) return;
      var n = null;
      try { n = typeof c.name === 'function' ? c.name() : null; } catch (e) { /* ignore */ }
      if (n === 'QualityButton') { btn = c; return; }
      (c.children_ || []).forEach(walk);
    })(player);
    if (!btn) return null;
    var items = [];
    (btn.children_ || []).forEach(function (k) {
      if (k.el_ && k.el_.classList && k.el_.classList.contains('vjs-menu')) {
        items = k.children_ || [];
      }
    });
    return {btn: btn, items: items};
  }

  /** {top, atTop}:top = 该切过去的那一项;atTop = 已经在最高档 */
  function readQuality(ctl) {
    var list = (ctl.btn.options_ && ctl.btn.options_.qualityList) || [];
    var topSrc = null, topSign = -1, i;
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      if (q && q.src && (q.sign || 0) > topSign) { topSign = q.sign || 0; topSrc = q.src; }
    }
    if (!topSrc) return {top: null, atTop: false};
    var out = null, selSrc = null;
    for (i = 0; i < ctl.items.length; i++) {
      var mi = ctl.items[i];
      var o = mi.options || mi.options_;
      if (!o || !o.src) continue;
      if (mi.el_ && mi.el_.classList.contains('vjs-selected')) selSrc = o.src;
      if (o.src === topSrc) out = {item: mi, opt: o};
    }
    if (!out) return {top: null, atTop: false};
    return out.opt.src === selSrc ? {top: null, atTop: true} : {top: out, atTop: false};
  }

  /** 站点自己那套换档动作,原样走一遍:进度与播放状态都不丢,也不碰弹层 */
  function applyQuality(player, ctl, out) {
    var keep = player.currentTime();
    var wasPaused = player.paused();
    player.src({src: out.opt.src, type: 'video/mp4'});
    player.load();
    if (!wasPaused) player.play();
    player.currentTime(keep);
    out.item.addClass('vjs-selected');            // 站点在 handleClick 里就是这一句
    player.trigger('qualityChange', out.opt);     // 标签/其余项的选中态交回站点
  }

  function raiseQuality(host) {
    /* .mwb-video 与它里面的 .video-js 都会被绑上,play 的捕获阶段两家各进一次;
       标记要挂在共同的浮层根上,否则两边会同时换一次档。 */
    var root = (host.closest && host.closest('.mwb-layer, .pswp')) || host;
    if (root.__bwQDone) return;
    var tries = 0;
    (function step() {
      var player = playerOf(host);
      var ctl = player ? qualityCtl(player) : null;
      var r = ctl ? readQuality(ctl) : {top: null, atTop: false};
      if (r.atTop) { root.__bwQDone = true; return; }
      if (!r.top) {                              // 组件树还没建好:再等一拍
        if (++tries < Q_TRIES) setTimeout(step, Q_EVERY);
        else root.__bwQDone = true;              // 等不到就不管这条片子
        return;
      }
      root.__bwQDone = true;
      try {
        applyQuality(player, ctl, r.top);
      } catch (e) { /* ignore */ }
    })();
  }

  function bind(host) {
    if (host.__bwSeekBound) return;
    host.__bwSeekBound = true;
    var gallery = inGallery(host);

    /* 按到哪个播放器,就把那条片子的真实比例报给原生 —— 全屏方向要按它定,
       而 onShowCustomView 那一刻原生侧看不到视频尺寸(容器树只有 0x0 的 FrameLayout)。
       loadedmetadata 不冒泡,但捕获阶段照样经过宿主,所以两个都挂在 host 上。 */
    function pushAspect() {
      var v = videoOf(host);
      if (v && v.videoWidth && window.BwNative && window.BwNative.setVideoAspect) {
        window.BwNative.setVideoAspect(v.videoWidth, v.videoHeight);
      }
    }
    host.addEventListener('pointerdown', pushAspect, true);
    host.addEventListener('loadedmetadata', pushAspect, true);
    /* play 不冒泡,但捕获阶段照样经过宿主。站点自己也会在换档后重新触发 play,
       所以 raiseQuality 用 __bwQDone 挡住第二次,不会来回切。 */
    host.addEventListener('play', function () { raiseQuality(host); }, true);

    var startX = 0, startY = 0, startTime = 0, scrubbing = false, video = null;

    host.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isProgressBar(e.target)) return;
      video = videoOf(host);
      if (!video || !isFinite(video.duration) || video.duration <= 0) return;
      // 看图器里的 live 图/动图:横滑归站点翻页
      if (gallery && video.duration < FLIP_UNDER_SECONDS) { video = null; return; }
      startX = e.clientX;
      startY = e.clientY;
      startTime = video.currentTime;
      scrubbing = false;
    }, true);

    host.addEventListener('pointermove', function (e) {
      if (!video) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!scrubbing) {
        // 横向不占优就交还给页面(点击 / 纵向滚动)
        if (Math.abs(dx) < START_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
        scrubbing = true;
      }
      e.preventDefault();
      e.stopPropagation();
      var dur = video.duration;
      var t = startTime + dx * secondsPerPx(host);
      t = Math.max(0, Math.min(dur - 0.05, t));
      video.currentTime = t;
      showHud(host, t, dur);
    }, {passive: false, capture: true});

    function end() {
      if (scrubbing) {
        // 松手后尽快收起示意,但留一点时间让人看清落点
        clearTimeout(hudTimer);
        if (hud) hudTimer = setTimeout(function () { hud.classList.remove('on'); }, 450);
      }
      scrubbing = false;
      video = null;
    }

    host.addEventListener('pointerup', end, true);
    host.addEventListener('pointercancel', end, true);

    // 横向手势不让页面跟着滚,纵向仍正常滚动
    host.style.touchAction = 'pan-y';
  }

  function scan() {
    var hosts = document.querySelectorAll('.video-js, .mwb-video, .video-container');
    for (var i = 0; i < hosts.length; i++) {
      if (seekable(hosts[i])) bind(hosts[i]);
    }
    var vids = document.querySelectorAll('video');
    for (var j = 0; j < vids.length; j++) {
      // 没有 video.js 包装的裸 video:自身作为手势宿主
      if (!vids[j].closest || !vids[j].closest('.video-js,.mwb-video,.video-container')) {
        if (seekable(vids[j])) bind(vids[j]);
      }
    }
  }

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      try { scan(); } catch (e) { /* ignore */ }
    }, 300);
  }

  schedule();
  try {
    new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
  } catch (e) { /* ignore */ }
})();
