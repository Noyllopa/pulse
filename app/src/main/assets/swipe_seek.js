/**
 * pulse 视频滑动快进快退。
 *
 * 只用站点自己的播放器(video.js)与它现成的时间显示:横向拖动直接改 video.currentTime,
 * 进度条与时间文本由站点自己更新,不另造控制层。
 * 纵向手势仍交给页面滚动,进度条上的拖动也仍归站点。
 */
(function () {
  if (!document.documentElement) return;
  if (window.__bwSeekReady) return;
  window.__bwSeekReady = true;

  var FULL_SWIPE_SECONDS = 60;   // 拖满整个播放器宽度 = 60s
  var START_THRESHOLD = 10;      // 超过这个横向位移才算拖动,避免吃掉点击

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

  /* ---- 拖动时的进度与目标时间示意(样式在 theme.js) ---- */
  var hud = null, hudTimer = null;

  function ensureHud() {
    if (hud && hud.isConnected) return hud;
    hud = document.createElement('div');
    hud.id = 'bw-scrub';
    hud.innerHTML = '<div class="t"></div><div class="bar"><i></i></div>';
    document.documentElement.appendChild(hud);
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

  function bind(host) {
    if (host.__bwSeekBound) return;
    host.__bwSeekBound = true;

    var startX = 0, startY = 0, startTime = 0, scrubbing = false, video = null;

    host.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isProgressBar(e.target)) return;
      video = videoOf(host);
      if (!video || !isFinite(video.duration) || video.duration <= 0) return;
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
    for (var i = 0; i < hosts.length; i++) bind(hosts[i]);
    var vids = document.querySelectorAll('video');
    for (var j = 0; j < vids.length; j++) {
      // 没有 video.js 包装的裸 video:自身作为手势宿主
      if (!vids[j].closest || !vids[j].closest('.video-js,.mwb-video,.video-container')) bind(vids[j]);
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
