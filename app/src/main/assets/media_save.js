/**
 * pulse 的长按手势 —— 只在"专门在看这条片子"的场合生效,两种片子两种走法。
 *
 * live 图:长按从头重播(live 图只自动放一遍,放过之后就是个停住的封面)。
 * 真视频:**按住不放走 2x,松手立刻还原**。倍速是"我此刻要快点看"而不是一个开关,
 * 所以不做 2x/1x 来回切 —— 松手回到按之前的倍速(站点或用户自己设的 1.5x 也照原样还)。
 *
 * 认场合:`.pswp`(全屏看图器)、`.mwb-layer`(站点那条视频浮层)、以及 HTML5 全屏的
 * 播放器(`:fullscreen`)。信息流里的内联视频不接长按,那是读帖时的误触面。
 *
 * 站点把 live 图与视频都渲染成一张 `<video>`,按直链分:live 图固定是
 * video.weibo.com/media/play?livephoto=<编码后的 .mov>(见 MainActivity#saveMediaUrl),
 * 比按时长猜稳。
 */
(function () {
  if (!document.documentElement) return;
  /* 注入在 onPageStarted 与 onPageFinished 各跑一次,没有这道守卫就会挂上两套监听:
     一次按下被处理两遍 —— 倍速按下去又立刻被"还原"回来,看着像没反应 */
  if (window.__bwMediaReady) return;
  window.__bwMediaReady = true;

  var FAST = 2;
  var HOLD_MS = 450;      // 长按判定,与平台 contextmenu 的节拍对齐
  var MOVE_SLOP = 16;     // 超过这个位移就不算"按住":让位给拖动快进与页面滚动
  var BADGE_MS = 900;     // 提示胶囊露多久(按住期间也会自己收起)
  var BADGE_TOP = 0.22;   // 竖向位置:视口高度的这个比例处,即页面中上部
  var hold = null;        // {v, id, x, y, back, timer}
  var badge = null, badgeTimer = null;

  /* 全屏时只有 :fullscreen 那棵子树会被渲染,挂在 <html> 上的节点根本不画 ——
     胶囊要跟着全屏宿主走(与 swipe_seek.js 的 #bw-scrub 同一个坑) */
  function badgeHost() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
      document.documentElement;
  }

  /** 摆在页面中上部(横向居中、竖向约 1/5 屏高),不挡进度条也不压在画面正中;
      露一小会儿自己收起 —— 按住不放也收,提示是说一次的,不是状态灯。 */
  function showBadge(text) {
    var parent = badgeHost();
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bw-rate';
    }
    if (!badge.isConnected || badge.parentElement !== parent) parent.appendChild(badge);
    badge.textContent = text;
    badge.style.left = Math.round(window.innerWidth / 2) + 'px';
    badge.style.top = Math.round((window.innerHeight || 0) * BADGE_TOP) + 'px';
    badge.classList.add('on');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(function () { badge.classList.remove('on'); }, BADGE_MS);
  }

  /** 场合判据:看图器 / 站点视频浮层 / HTML5 全屏播放器内部。
      全屏用 fullscreenElement.contains 判,不用 :fullscreen 伪类 —— 选择器不认识时
      closest() 会直接抛 SyntaxError 把整个监听打断 */
  function scopeVideo(t) {
    if (!t || !t.closest) return null;
    var v = t.tagName === 'VIDEO' ? t : t.closest('video');
    if (!v) return null;
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!(v.closest('.pswp') || v.closest('.mwb-layer') || (fsEl && fsEl.contains(v)))) return null;
    return v;
  }

  function isLive(v) {
    var src = v.currentSrc || v.src || '';
    if (!src && v.querySelector) {
      var s = v.querySelector('source');
      src = s ? (s.src || s.getAttribute('src') || '') : '';
    }
    return src.indexOf('livephoto=') >= 0;
  }

  function enterFast() {
    if (!hold) return;
    var v = hold.v;
    if (!v.isConnected) { hold = null; return; }
    hold.back = v.playbackRate || 1;         // 松手还回这里,不写死 1
    try {
      v.playbackRate = FAST;
    } catch (e) { /* ignore */ }
    showBadge('2× 倍速');
  }

  /** 松手 / 手指移出判定半径都走这里:进了倍速才需要还原并提示 */
  function leaveHold() {
    if (!hold) return;
    var v = hold.v, back = hold.back;
    clearTimeout(hold.timer);
    hold = null;
    if (back == null) return;                // 还没进倍速就抬了手:短按,什么都不做
    try {
      v.playbackRate = back;
    } catch (e) { /* ignore */ }
    showBadge(back === 1 ? '1× 原速' : back + '× 原速');
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (hold) leaveHold();                   // 上一根手指还没抬起就按新的:先还原
    var v = scopeVideo(e.target);
    if (!v || isLive(v)) return;             // live 图仍交给 contextmenu 的重播
    hold = {
      v: v, id: e.pointerId, x: e.clientX, y: e.clientY, back: null,
      timer: setTimeout(enterFast, HOLD_MS)
    };
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!hold || (e.pointerId != null && e.pointerId !== hold.id)) return;
    if (Math.abs(e.clientX - hold.x) > MOVE_SLOP || Math.abs(e.clientY - hold.y) > MOVE_SLOP) {
      leaveHold();
    }
  }, true);

  /* 抬起要挂在 window 上:手指滑出播放器甚至浮层外面才松手时,也得把速度还回去 */
  window.addEventListener('pointerup', leaveHold, true);
  window.addEventListener('pointercancel', leaveHold, true);

  document.addEventListener('contextmenu', function (e) {
    var v = scopeVideo(e.target);
    if (!v) return;
    e.preventDefault();                       // 挡掉原生"保存/复制链接"那层菜单
    if (!isLive(v)) return;                   // 真视频的长按由上面的按下状态机处理
    // 重播本身看得见,不再叠一颗提示胶囊
    try {
      v.currentTime = 0;
      v.play();
    } catch (err) { /* ignore */ }
  }, true);
})();
