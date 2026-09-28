/**
 * pulse 的长按手势 —— 只在"专门在看这条片子"的场合生效,两种片子两种走法。
 *
 * live 图:长按从头重播(live 图只自动放一遍,放过之后就是个停住的封面)。
 * 真视频:长按切 2x / 1x 倍速。
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
  /* 注入在 onPageStarted 与 onPageFinished 各跑一次,没有这道守卫就会挂上两个监听:
     一次长按被处理两遍 —— 倍速 2→1→2 看着像"没反应" */
  if (window.__bwMediaReady) return;
  window.__bwMediaReady = true;

  var FAST = 2;
  var badge = null, badgeTimer = null;

  /* 全屏时只有 :fullscreen 那棵子树会被渲染,挂在 <html> 上的节点根本不画 ——
     胶囊要跟着全屏宿主走(与 swipe_seek.js 的 #bw-scrub 同一个坑) */
  function badgeHost() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
      document.documentElement;
  }

  function showBadge(host, text) {
    var parent = badgeHost();
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'bw-rate';
    }
    if (!badge.isConnected || badge.parentElement !== parent) parent.appendChild(badge);
    var r = host.getBoundingClientRect();
    badge.textContent = text;
    badge.style.left = Math.round(r.left + r.width / 2) + 'px';
    badge.style.top = Math.round(r.top + r.height / 2) + 'px';
    badge.classList.add('on');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(function () { badge.classList.remove('on'); }, 1100);
  }

  document.addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var v = t.tagName === 'VIDEO' ? t : t.closest('video');
    if (!v) return;
    /* 场合判据:看图器 / 站点视频浮层 / HTML5 全屏播放器内部。
       全屏用 fullscreenElement.contains 判,不用 :fullscreen 伪类 —— 选择器不认识时
       closest() 会直接抛 SyntaxError 把整个监听打断 */
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!(v.closest('.pswp') || v.closest('.mwb-layer') || (fsEl && fsEl.contains(v)))) return;
    var src = v.currentSrc || v.src || '';
    if (!src && v.querySelector) {
      var s = v.querySelector('source');
      src = s ? (s.src || s.getAttribute('src') || '') : '';
    }
    var live = src.indexOf('livephoto=') >= 0;
    e.preventDefault();
    if (live) {
      // 重播本身看得见,不再叠一颗提示胶囊
      try {
        v.currentTime = 0;
        v.play();
      } catch (err) { /* ignore */ }
      return;
    }
    var fast = (v.playbackRate || 1) + 0.01 < FAST;
    try {
      v.playbackRate = fast ? FAST : 1;
    } catch (err) { /* ignore */ }
    showBadge(v, fast ? '2× 倍速' : '1× 原速');
  }, true);
})();
