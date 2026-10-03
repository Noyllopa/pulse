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
    /* 看图器里我们自搭的那条控件容器也带 video-js 类(为了吃站点的样式),
       别把它当播放器绑一遍 —— 它里面没有 video,绑上只会多一套手势与重试。 */
    if (host.classList && host.classList.contains('bw-gbar')) return false;
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
    /* 去重要按"这条片子的源地址"记,不能只挂一个布尔标记:
       `.mwb-layer` 这个节点在站点的 SPA 里是常驻的(关掉再点开下一条,还是同一个节点),
       布尔标记会把第一条之后的所有片子全挡掉 —— 实测第一条升到 1280x720、
       第二条就停在站点默认那路 853x480。
       记的是一本"这条片子已处理过的源"账:同一条片子会被绑两次(.mwb-video 与它里面的
       .video-js,play 的捕获阶段各进一次),换档后站点还会再发一次 play;
       把这片子全部档位的地址都记进去,也就顺带尊重了用户/站点之后手动调档
       —— 手动降到标清不该被我们立刻顶回最高。
       读到一本不含当前地址的新账 = 换了一条片子,重新起账。 */
    var root = (host.closest && host.closest('.mwb-layer, .pswp')) || host;
    var vd = root.querySelector ? root.querySelector('video') : null;
    var key = vd ? (vd.currentSrc || vd.src || '') : '';
    var seen = root.__bwQSeen;
    if (seen && seen.indexOf(key) >= 0) return;
    seen = root.__bwQSeen = [key];
    var tries = 0;
    (function step() {
      var player = playerOf(host);
      var ctl = player ? qualityCtl(player) : null;
      var r = ctl ? readQuality(ctl) : {top: null, atTop: false};
      if (r.atTop) return;
      if (!r.top) {                              // 组件树还没建好:再等一拍
        if (++tries < Q_TRIES) setTimeout(step, Q_EVERY);
        return;                                  // 等不到就不管这条片子
      }
      var list = (ctl.btn.options_ && ctl.btn.options_.qualityList) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].src && seen.indexOf(list[i].src) < 0) seen.push(list[i].src);
      }
      try {
        applyQuality(player, ctl, r.top);
        markQuality(host);
      } catch (e) { /* ignore */ }
    })();
  }

  /* 画质菜单里"当前这一档"的标记。站点只给自己点中的那个 li 挂 vjs-selected,换档后它会把
     这批 li 重建一遍(类随之丢掉) —— 实测在播标清时菜单三项全是白字,看不出哪档是当前;
     而倍速那颗的选中项是带色的,两处不一致。这里按那颗自己显示的文字(它就是当前档)
     把对应的 li 标回来,颜色与倍速那颗一起走主题蓝(见 theme.js)。
     时机只有两处需要:按下落在画质那颗上(菜单将开)、我们自己升档之后 —— 菜单只在这两种
     场合被人看到。写的是类与 aria,不碰 video.js 的 selected() —— 那会 trigger('select'),
     站点可能接去再换一次源。 */
  function markQuality(host) {
    var btn = host.querySelector ? host.querySelector('.mwb-quality-button') : null;
    if (!btn && host.classList && host.classList.contains('mwb-quality-button')) btn = host;
    if (!btn) return;
    var val = btn.querySelector('.mwb-quality-button-value');
    var cur = (val ? val.innerText : '').replace(/\s+/g, '');
    if (!cur) return;
    var items = btn.querySelectorAll('.vjs-menu-item');
    for (var i = 0; i < items.length; i++) {
      var t = items[i].querySelector('.vjs-menu-item-text') || items[i];
      var on = (t.innerText || '').replace(/\s+/g, '') === cur;
      items[i].classList.toggle('vjs-selected', on);
      items[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  /* ---- 倍速:插在站点那颗画质按钮的左边,菜单沿用 video.js 那一套类 ----
     站点画质那颗是 `.mwb-quality-button`(绝对定位,right:60px、宽 24),弹层是
     `.vjs-menu > .vjs-menu-content > li.vjs-menu-item`,选中项加 `vjs-selected`(站点原色是橙,
     两处菜单的字色都改成主题蓝,见 theme.js)。倍速这颗照同一套结构建(形状/选中态/字号都是
     站点自己的 CSS,不另画一份),
     只把"开"这一态挂在自己的 `bw-speed-open` 上 —— 站点那条 `.mwb-show-menu` 只认它自己的按钮。
     变速只走 video.js 现成的 `player.playbackRate()`(拿不到播放器就退到 video.playbackRate),
     不碰站点的画质组件,也不模拟它的点击。 */
  var RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

  /* 按钮上:没调过写"倍速"(与站点那颗同字号同字族),调过写当前档位。
     菜单里每一项一律写档位 —— "倍速"是控件的名字,不是一档速度。 */
  function speedLabel(r) {
    return r === 1 ? '倍速' : String(r) + 'x';
  }

  function rateText(r) {
    return String(r) + 'x';
  }

  function ctlBarOf(host) {
    var q = host.querySelector ? host.querySelector('.mwb-quality-button') : null;
    if (!q && host.classList && host.classList.contains('mwb-quality-button')) q = host;
    return q && q.parentElement ? q.parentElement : null;
  }

  function videoElOf(host) {
    var v = host.querySelector ? host.querySelector('video') : null;
    if (!v && host.tagName === 'VIDEO') v = host;
    return v;
  }

  function speedOf(host) {
    var v = videoElOf(host);
    if (typeof host.__bwSpeed === 'number') return host.__bwSpeed;
    if (v && isFinite(v.playbackRate) && v.playbackRate !== 1) return v.playbackRate;
    return typeof window.__bwSpeedPref === 'number' ? window.__bwSpeedPref : 1;
  }

  function paintSpeed(el, r) {
    var box = el.querySelector('.bw-speed-value');
    if (box) box.textContent = speedLabel(r);
    [].forEach.call(el.querySelectorAll('.vjs-menu-item'), function (li) {
      var on = parseFloat(li.getAttribute('data-bw-speed')) === r;
      li.classList.toggle('vjs-selected', on);
      li.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /** 往一个 .bw-speed 节点上装出档位菜单;读写走传进来的 api(播放器路径与看图器路径各一套) */
  function mountSpeed(el, api) {
    if (el.querySelector('.vjs-menu')) return el;      // 装过了
    el.classList.add('vjs-menu-button', 'vjs-menu-button-popup', 'vjs-control');
    el.innerHTML = '<span class="bw-speed-value"></span>' +
      '<div class="vjs-menu"><ul class="vjs-menu-content" role="menu"></ul></div>';
    var ul = el.querySelector('.vjs-menu-content');
    RATES.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'vjs-menu-item';
      li.setAttribute('role', 'menuitemradio');
      li.setAttribute('tabindex', '-1');
      li.setAttribute('data-bw-speed', String(r));
      li.innerHTML = '<span class="vjs-menu-item-text"></span>';
      li.firstChild.textContent = rateText(r);
      ul.appendChild(li);
    });
    el.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.vjs-menu-item') : null;
      if (li && el.contains(li)) {
        api.set(parseFloat(li.getAttribute('data-bw-speed')));
        el.classList.remove('bw-speed-open');
      } else {
        el.classList.toggle('bw-speed-open');
      }
      e.preventDefault();
      e.stopPropagation();
    });
    return el;
  }

  function setSpeed(host, r, remember) {
    if (!(r > 0)) return;
    host.__bwSpeed = r;
    if (remember) window.__bwSpeedPref = r;   // 同一会话里后续打开的播放器跟着走
    var player = playerOf(host);
    var v = videoElOf(host);
    try {
      if (player && player.playbackRate) player.playbackRate(r);
      else if (v) v.playbackRate = r;
    } catch (e) {
      if (v) v.playbackRate = r;
    }
    if (v && v.playbackRate !== r) { try { v.playbackRate = r; } catch (e) { /* ignore */ } }
    paintSpeed(host.__bwSpeedEl, r);
  }

  function buildSpeed(host) {
    var bar = ctlBarOf(host);
    if (!bar) return false;
    var el = bar.querySelector('.bw-speed');
    if (el && el.isConnected) { host.__bwSpeedEl = el; return true; }
    el = document.createElement('div');
    el.className = 'bw-speed';
    mountSpeed(el, { set: function (r) { setSpeed(host, r, true); } });
    bar.insertBefore(el, bar.querySelector('.mwb-quality-button'));
    host.__bwSpeedEl = el;
    paintSpeed(el, speedOf(host));
    // 点别处就收起。挂在宿主上而不是 document:这一族的播放器浮层本来就铺满整屏,
    // 而绑在 document 上的话,节点被换掉后那个监听还会拽着旧元素不放。
    host.addEventListener('pointerdown', function (e) {
      if (!el.isConnected || !el.classList.contains('bw-speed-open')) return;
      if (el.contains(e.target)) return;
      el.classList.remove('bw-speed-open');
    }, true);
    return true;
  }

  /* 控制条与画质那颗都是异步建起来的,和 raiseQuality 同一套重试节奏 */
  function ensureSpeed(host) {
    if (host.__bwSpeedEl && host.__bwSpeedEl.isConnected) return;
    if (buildSpeed(host)) { host.__bwSpeedTry = 0; return; }
    host.__bwSpeedTry = host.__bwSpeedTry || 0;
    if (++host.__bwSpeedTry < Q_TRIES * 2) setTimeout(function () { ensureSpeed(host); }, Q_EVERY);
  }

  /* ---- 看图器里真视频的控件条 ----
     多视频 / 图文混合的微博,站点走的是看图器(.pswp)而不是它自己的播放器,那一层里只有裸
     <video>:0 个 video-js、0 条控制条,点画面也不响应。浏览器自带的控件条又没法改样式
     (在闭 shadow root 里),所以要统一成站点那条只能自己搭。
     搭法是"借壳":容器标成 video-js + vjs-controls-enabled/vjs-has-started/vjs-user-active,
     子节点用 vjs-play-control / vjs-mute-control / vjs-current-time / vjs-time-divider /
     vjs-duration / vjs-progress-control(.vjs-progress-holder > .vjs-load-progress +
     .vjs-play-progress) / vjs-fullscreen-control —— 36 高、上透明下 50% 黑的渐变、白字、
     48 一格、VideoJS 图标字体,全是站点已经加载好的那份 CSS,我们只写定位与行为。
     每颗按钮都要带 vjs-button:图标字号那条是 `.vjs-button > .vjs-icon-placeholder:before`,
     漏了它那颗音量键会退回 1em(12px),比播放/全屏的 1.8em(21.6px)小一整号。
     live 图与动图不在此列(见下面 isLoopClipSrc)。 */
  /* 站点把"点开就是循环放一小段"的两种卡片都渲染成 <video>,它们都不该有播放器控件条:
     live 图的直链固定是 video.weibo.com/media/play?livephoto=<编码后的 .mov>
     (见 media_save.js#saveMediaUrl);动图是 gif 转的 mp4,直链带 `label=gif_mp4`
     (实测 2.07s、212x204)。分辨只看这两个标记,不看时长 —— 元数据是异步到的,
     按时长判会让控件条先冒出来再收回去。 */
  function isLoopClipSrc(v) {
    var s = v.currentSrc || v.src || '';
    if (!s && v.querySelector) {
      var so = v.querySelector('source');
      s = so ? (so.src || so.getAttribute('src') || '') : '';
    }
    return s.indexOf('livephoto=') >= 0 || s.indexOf('gif_mp4') >= 0;
  }

  function liveRoot() {
    var p = null;
    [].forEach.call(document.querySelectorAll('.pswp'), function (k) {
      if (k.getBoundingClientRect().width > 0) p = p || k;
    });
    return p;
  }

  /* 当前这一页的真视频:矩形落在视口里、且不是循环短片(live 图/动图) */
  function galVideo(p) {
    var vs = p.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) {
      var r = vs[i].getBoundingClientRect();
      if (r.width < 40 || r.right < 20 || r.left > innerWidth - 20) continue;
      if (isLoopClipSrc(vs[i])) continue;
      return vs[i];
    }
    return null;
  }

  function buildGalBar() {
    var p = liveRoot();
    if (!p) return;
    var bar = null;
    for (var i = 0; i < p.children.length; i++) {
      if (p.children[i].classList.contains('bw-gbar')) bar = p.children[i];
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'video-js bw-gbar vjs-controls-enabled vjs-has-started vjs-user-active vjs-paused';
      bar.innerHTML =
        '<div class="vjs-control-bar">' +
          '<button type="button" class="vjs-play-control vjs-control vjs-button" tabindex="0">' +
            '<span class="vjs-icon-placeholder"></span><span class="vjs-control-text">播放</span></button>' +
          '<button type="button" class="vjs-mute-control vjs-control vjs-button vjs-vol-3" tabindex="0">' +
            '<span class="vjs-icon-placeholder"></span><span class="vjs-control-text">静音</span></button>' +
          '<div class="vjs-current-time vjs-time-control vjs-control">' +
            '<span class="vjs-current-time-display">0:00</span></div>' +
          '<div class="vjs-time-control vjs-time-divider"><div><span>/</span></div></div>' +
          '<div class="vjs-duration vjs-time-control vjs-control">' +
            '<span class="vjs-duration-display">0:00</span></div>' +
          '<div class="vjs-progress-control vjs-control"><div class="vjs-progress-holder vjs-slider">' +
            '<div class="vjs-load-progress"></div>' +
            '<div class="vjs-play-progress"><div class="vjs-slider-handle"></div></div>' +
          '</div></div>' +
          '<div class="bw-speed"></div>' +
          '<button type="button" class="vjs-fullscreen-control vjs-control vjs-button" tabindex="0">' +
            '<span class="vjs-icon-placeholder"></span><span class="vjs-control-text">全屏</span></button>' +
        '</div>';
      p.appendChild(bar);
      /* 站点给 :fullscreen 里的 .video-js 写了铺满整屏的规则(它自己的视频页要占满),
         同为 !important 时它比特异性还高 —— 只有内联 !important 压得住。
         不压的话全屏时这条会撑成一整屏高,把画面上的点击全接走。 */
      bar.style.setProperty('height', '36px', 'important');
      bar.style.setProperty('top', 'auto', 'important');
      wireGalBar(p, bar);
    }
    syncGalBar(p, bar);
  }

  function wireGalBar(p, bar) {
    var cur = null;
    function v() { return cur; }
    bar.__bind = function (vid) {
      if (cur === vid) return;
      cur = vid;
      wake();
      if (!vid || vid.__bwGalBound) return;
      vid.__bwGalBound = true;
      var once = function (fn) { return function () { if (cur === vid) fn(); }; };
      vid.addEventListener('timeupdate', once(paint));
      vid.addEventListener('durationchange', once(paint));
      vid.addEventListener('progress', once(paint));
      vid.addEventListener('ratechange', once(paint));
      vid.addEventListener('play', once(state));
      vid.addEventListener('pause', once(state));
      vid.addEventListener('ended', once(state));
      vid.addEventListener('volumechange', once(state));
    };
    function state() {
      var x = v();
      if (!x) return;
      bar.classList.toggle('vjs-playing', !x.paused);
      bar.classList.toggle('vjs-paused', !!x.paused);
      bar.classList.toggle('vjs-ended', !!x.ended);
      // 站点那条暂停时是常驻的(它的规则要 vjs-playing)—— 停下来就把条子叫回来
      if (x.paused) wake();
      /* 播放/暂停的字形看的是**按钮上**的 vjs-playing(video.js 的选择器是
         `.video-js .vjs-play-control.vjs-playing .vjs-icon-placeholder:before`),
         只挂容器会永远停在"▶"。 */
      var pb = bar.querySelector('.vjs-play-control');
      if (pb) pb.classList.toggle('vjs-playing', !x.paused);
      var m = bar.querySelector('.vjs-mute-control');
      if (m) {
        m.classList.toggle('vjs-vol-0', !!x.muted || x.volume === 0);
        m.classList.toggle('vjs-vol-3', !(x.muted || x.volume === 0));
      }
      paint();
    }
    function paint() {
      var x = v();
      if (!x) return;
      var dur = isFinite(x.duration) ? x.duration : 0;
      bar.querySelector('.vjs-current-time-display').textContent = fmt(x.currentTime || 0);
      bar.querySelector('.vjs-duration-display').textContent = fmt(dur);
      var pl = bar.querySelector('.vjs-play-progress');
      var ld = bar.querySelector('.vjs-load-progress');
      pl.style.width = (dur > 0 ? Math.min(100, (x.currentTime || 0) / dur * 100) : 0) + '%';
      try {
        if (ld && x.buffered.length && dur > 0) {
          ld.style.width = Math.min(100, x.buffered.end(x.buffered.length - 1) / dur * 100) + '%';
        }
      } catch (e) { /* ignore */ }
      paintSpeed(bar.__speedEl, x.playbackRate || 1);
      /* 条子摆在**整层看图器的底边**(用户要的"页面底部"),不跟着画面下沿跑 ——
         画面在竖屏里通常是居中一条,贴着它放就等于悬在屏幕中间。
         左右仍按画面的矩形收,横屏全屏时条子只占画面那一段。
         这三行必须是 important 的内联样式:站点给 :fullscreen 里的 .video-js 写了
         `width/height:100% !important`(它自己的视频页要铺满整屏),借壳的容器也吃这条,
         普通内联压不住 —— 实测全屏后条子被拉成整屏宽,最右那颗全屏键甩出屏外 66px。 */
      var pr = p.getBoundingClientRect(), vr = x.getBoundingClientRect();
      bar.style.setProperty('left', Math.round(Math.max(0, vr.left - pr.left)) + 'px', 'important');
      bar.style.setProperty('width', Math.round(Math.min(pr.width, vr.width)) + 'px', 'important');
      bar.style.setProperty('bottom', Math.round(Math.min(0, pr.bottom - vr.bottom)) + 'px', 'important');
    }
    bar.querySelector('.vjs-play-control').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var x = v(); if (!x) return;
      if (x.ended) { try { x.currentTime = 0; } catch (err) { /* ignore */ } }
      if (x.paused) { try { x.play(); } catch (err) { /* ignore */ } } else { x.pause(); }
    });
    bar.querySelector('.vjs-mute-control').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var x = v(); if (!x) return;
      x.muted = !x.muted;
      state();
    });
    bar.querySelector('.vjs-fullscreen-control').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) {
        try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (err) { /* ignore */ }
        return;
      }
      /* 全屏请求发给整层看图器而不是 <video>:HTML5 全屏只渲染 :fullscreen 那棵子树,
         只让 video 进全屏的话这条控件条就不在子树里,又变成"全屏后没控件"。 */
      var rq = p.requestFullscreen || p.webkitRequestFullscreen || p.webkitRequestFullScreen;
      try { if (rq) rq.call(p); } catch (err) { /* ignore */ }
    });
    bar.__speedEl = mountSpeed(bar.querySelector('.bw-speed'), {
      set: function (r) {
        var x = v(); if (!x || !(r > 0)) return;
        x.playbackRate = r;
        window.__bwSpeedPref = r;
        paint();
      }
    });
    /* 拖进度:按下/拖动都按 holder 的矩形换算成时间,期间不碰站点的翻页 */
    var hold = bar.querySelector('.vjs-progress-holder');
    var seekTo = function (clientX) {
      var x = v(); if (!x || !isFinite(x.duration)) return;
      var r = hold.getBoundingClientRect();
      var f = (clientX - r.left) / Math.max(1, r.width);
      x.currentTime = Math.max(0, Math.min(x.duration - 0.05, f * x.duration));
      paint();
    };
    var dragging = false;
    bar.querySelector('.vjs-progress-control').addEventListener('pointerdown', function (e) {
      dragging = true; seekTo(e.clientX);
      e.preventDefault(); e.stopPropagation();
    });
    bar.querySelector('.vjs-progress-control').addEventListener('pointermove', function (e) {
      if (!dragging) return;
      seekTo(e.clientX);
      e.preventDefault(); e.stopPropagation();
    });
    var endDrag = function (e) {
      if (!dragging) return;
      dragging = false;
      if (e) e.stopPropagation();
    };
    bar.querySelector('.vjs-progress-control').addEventListener('pointerup', endDrag);
    bar.querySelector('.vjs-progress-control').addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerup', endDrag, true);
    /* 收起倍速菜单:按下落在条子外面就收 */
    p.addEventListener('pointerdown', function (e) {
      var el = bar.__speedEl;
      if (!el || !el.classList.contains('bw-speed-open')) return;
      if (el.contains(e.target)) return;
      el.classList.remove('bw-speed-open');
    }, true);
    /* ---- 闲置自动收 + 点画面翻显隐 ----
       站点那条靠 video.js 的 user-active 态:实测约 2s 没有活动就把 vjs-user-inactive 挂上,
       控制条 opacity 归 0、pointer-events 变 none(所以收起来之后不吃点击)。这里翻同一对类,
       淡入淡出与"藏起来不挡手"都由站点已加载的那份 CSS 出。
       "点画面"这一手势在看图器里本来是空的(裸 <video> 点着不应),就派给显隐;
       判定用按下-抬起的位移与时序:横滑翻页、拖进度、长按倍速都不满足(>12px 或 >350ms)。 */
    var hideAt = 0;
    function wake() {
      bar.classList.remove('vjs-user-inactive');
      bar.classList.add('vjs-user-active');
      hideAt = Date.now() + 2000;
    }
    function sleep() {
      bar.classList.remove('vjs-user-active');
      bar.classList.add('vjs-user-inactive');
    }
    bar.__idle = function () {
      if (!hideAt || Date.now() < hideAt) return;
      var el = bar.__speedEl;
      // 菜单开着不收,顺手把时限往后推一格
      if (el && el.classList.contains('bw-speed-open')) { hideAt = Date.now() + 2000; return; }
      sleep();
    };
    bar.__wake = wake;
    bar.addEventListener('pointerdown', wake, true);
    bar.addEventListener('pointermove', wake, true);
    var tx = 0, ty = 0, tt = 0;
    p.addEventListener('pointerdown', function (e) {
      if (bar.contains(e.target)) { tt = 0; return; }
      tx = e.clientX; ty = e.clientY; tt = Date.now();
    }, true);
    p.addEventListener('pointerup', function (e) {
      if (!tt) return;
      var moved = Math.abs(e.clientX - tx) + Math.abs(e.clientY - ty);
      var dur = Date.now() - tt;
      tt = 0;
      if (bar.contains(e.target) || moved > 12 || dur > 350) return;
      var x = v();
      // 暂停时站点那条是常驻的(它的规则要 vjs-playing),这时点画面只把它叫醒
      if (bar.classList.contains('vjs-user-inactive') || !x || x.paused) wake();
      else sleep();
    }, true);
    p.addEventListener('pointercancel', function () { tt = 0; }, true);
    document.addEventListener('fullscreenchange', function () {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      bar.classList.toggle('vjs-fullscreen', !!fs);
      syncGalBar(p, bar);
    });
    bar.__state = state;
  }

  function syncGalBar(p, bar) {
    var v = galVideo(p);
    if (!v) {
      bar.classList.add('bw-gbar-off');
      return;
    }
    bar.classList.remove('bw-gbar-off');
    bar.__bind(v);
    if (bar.__state) bar.__state();
    if (bar.__idle) bar.__idle();
  }

  /* 站点的画质菜单只在自己那颗按钮上翻 `.mwb-show-menu`(实测挂上 display:block、摘掉 display:none),
     点画面、点进度条、点别处都不收 —— 菜单就一直杵在屏幕上,要再点一次画质才翻得回去。
     这里补"点空白处收起":按下落在按钮之外就把类摘掉。落在菜单项上不算"外面"
     (菜单是按钮的子节点),所以选档位照旧走站点自己的处理。
     挂在 document 而不是播放器宿主上:这条与"哪个播放器"无关,且整份脚本有 __bwSeekReady 守卫,
     一次页面加载只注册一个监听。 */
  document.addEventListener('pointerdown', function (e) {
    var open = document.querySelectorAll('.mwb-quality-button.mwb-show-menu');
    for (var i = 0; i < open.length; i++) {
      if (open[i].contains(e.target)) continue;
      open[i].classList.remove('mwb-show-menu');
    }
  }, true);

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
       raiseQuality 按"这条片子的源地址"去重,换档后那一次只会读到"已在最高档"。 */
    host.addEventListener('play', function () { raiseQuality(host); }, true);
    /* 按下落在画质那颗上 = 菜单将开,趁这一拍把"当前档"标回去(捕获阶段,站点的开菜单在后头) */
    host.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.mwb-quality-button')) markQuality(host);
    }, true);

    /* 倍速那颗:控制条建好才有地方插,交给 ensureSpeed 自己重试。
       换画质会走一遍 src()+load(),新元数据到达时速率会被打回 1x —— 所以在
       loadedmetadata 上把这一层记住的值再按一次(只在"确实不等于记住值"时动手,
       免得和站点自己的 ratechange 来回咬)。 */
    ensureSpeed(host);
    host.addEventListener('loadedmetadata', function () {
      ensureSpeed(host);
      var want = speedOf(host);
      var v = videoElOf(host);
      if (want !== 1 && v && v.playbackRate !== want) setSpeed(host, want, false);
      paintSpeed(host, speedOf(host));
    }, true);

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
    /* "点开播放"那一层是铺满整屏的浮层(实测 .mwb-layer 与它里面的 .mwb-video 都是
       0,0,411,840):在它上面竖滑,后面那叠微博会跟着滚 —— 用户报的"视频播放界面上下滑动,
       背后的微博也会上下滑动"。
       锁法试过三种(同一台 WebView、同一条 adb 竖滑、每次都验过手指落点确实在浮层上):
         ① 浮层 touch-action:none → 照滚 Δ=330,这条路在本 WebView 不成立;
         ② html,body{overflow:hidden} → Δ=0 但 scrollY 当场从 1588 跳到 0,
            背后读到一半的位置被甩掉,不能用;
         ③ 浮层上挂非 passive 的 touchmove + preventDefault → Δ=0 且不动 scrollY。
       取 ③。菜单那一层例外:条目多到出框时它自己要能滚,那种目标放行。 */
    var layer = host.closest ? host.closest('.mwb-layer') : null;
    if (layer && !layer.__bwScrollLock) {
      layer.__bwScrollLock = true;
      layer.addEventListener('touchmove', function (e) {
        var t = e.target;
        var box = t && t.closest ? t.closest('.vjs-menu-content') : null;
        if (box && box.scrollHeight > box.clientHeight + 1) return;
        e.preventDefault();
      }, {passive: false});
    }
  }

  function scan() {
    var hosts = document.querySelectorAll('.video-js, .mwb-video, .video-container');
    for (var i = 0; i < hosts.length; i++) {
      if (seekable(hosts[i])) {
        bind(hosts[i]);
        // 站点重建控制条(换源、重开浮层)后那颗会掉,bind 是幂等的、这里补一次
        if (hosts[i].__bwSeekBound) ensureSpeed(hosts[i]);
      }
    }
    var vids = document.querySelectorAll('video');
    for (var j = 0; j < vids.length; j++) {
      // 没有 video.js 包装的裸 video:自身作为手势宿主
      if (!vids[j].closest || !vids[j].closest('.video-js,.mwb-video,.video-container')) {
        if (seekable(vids[j])) bind(vids[j]);
      }
    }
    /* 多视频 / 图文混合的微博,点开走的是站点看图器(.pswp)而不是那条 .mwb-layer 播放器:
       实测里面是裸 <video>、0 个 video-js、0 条控制条,点画面也不响应 —— 用户报的
       "这种微博的播放页下面没有进度条那一排"就是它。控件条由 buildGalBar 自己搭
       (借 video.js 的类名吃站点的样式),所以这里一律关掉浏览器原生控件:
       原生那条在闭 shadow root 里改不了样式,留着就是两种样子叠在一起。
       live 图与动图不搭也不加(它们是循环短片) —— 分辨看 isLoopClipSrc。 */
    var groot = liveRoot();
    if (groot) {
      var gal = groot.querySelectorAll('video');
      for (var g = 0; g < gal.length; g++) { if (gal[g].controls) gal[g].controls = false; }
      buildGalBar();
      /* 翻页是 transform,不一定触发变异观察器 → 看图器开着时自己续一拍 */
      setTimeout(schedule, 600);
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
