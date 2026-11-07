/**
 * 统一判"真视频 / 动图 / live 图"。
 *
 * 站点把三种东西都渲染成 <video>。以前几处各写一份判据:swipe_seek 认 livephoto= 与
 * gif_mp4,media_save 只认 livephoto=;看图器手势还额外按 duration<10s 猜循环短片 ——
 * 那会把 10 秒内的真视频也当成动图。这里只留一处判定,其它脚本统一查 BwClip.kindOf。
 *
 * 判据:
 *   live   : 直链含 livephoto=      —— 实测,站点固定写法
 *   gif    : 直链含 label=gif_mp4   —— 实测,gif 转出来的 mp4
 *   video  : 元数据已到(readyState>=1)且直链上没有上面两个标记 —— 推断
 *   unknown: 首帧还没拿到直链(空 src / 只有 blob:)且元数据未到
 *
 * 偏置:unknown 一律不建控件条 —— 宁可晚一点出现,也不让动图先冒条再收回;
 * 而元数据一到、又没有 loop 标记就按真视频,绝不为了避开循环片让真视频丢进度条。
 * 不按时长猜:任何时长的真视频都按视频,10 秒以内也一样。
 *
 * 边界(推断,非实测):只有 blob:/空直链、且 data-* 也拿不到原始直链的循环片,
 * 元数据一到会按真视频 —— 误判方向是多一条控件条,不会反过来。
 */
(function () {
  if (!document.documentElement) return;
  if (window.__bwClipKindReady) return;
  window.__bwClipKindReady = true;

  /* 直链不一定在 currentSrc 上:首帧为空,或已被站点换成 blob:。
     按优先级收集候选;data-src / data-url / data-original 是推断来的常见落点,
     有就用来找回 livephoto=/gif_mp4 标记。 */
  function candidates(v) {
    var out = [];
    function push(x) { if (x && out.indexOf(x) < 0) out.push(String(x)); }
    push(v.currentSrc);
    push(v.src);
    if (v.getAttribute) {
      push(v.getAttribute('src'));
      push(v.getAttribute('data-src'));
      push(v.getAttribute('data-url'));
      push(v.getAttribute('data-original'));
    }
    if (v.querySelectorAll) {
      var so = v.querySelectorAll('source');
      for (var i = 0; i < so.length; i++) {
        push(so[i].src);
        push(so[i].getAttribute('src'));
      }
    }
    return out;
  }

  function marker(v) {
    var c = candidates(v);
    for (var i = 0; i < c.length; i++) {
      if (/livephoto=/i.test(c[i])) return 'live';
      if (/label=gif_mp4/i.test(c[i])) return 'gif';
    }
    return '';
  }

  function kindOf(v) {
    if (!v) return 'unknown';
    var m = marker(v);
    if (m) { v.__bwClipKind = m; return m; }
    /* 元数据没到之前不下"视频"的结论:src 还可能被改成 blob:,或者补上 gif_mp4 参数。
       先判视频会让控件条先冒出来再收回去。readyState>=1 表示元数据/首帧已定。 */
    if (v.readyState >= 1) { v.__bwClipKind = 'video'; return 'video'; }
    /* 之前确实见过 loop 标记、后来直链被换成 blob: 的,沿用标记 */
    if (v.__bwClipKind === 'live' || v.__bwClipKind === 'gif') return v.__bwClipKind;
    return 'unknown';
  }

  window.BwClip = {
    kindOf: kindOf,
    isLoop: function (v) { var k = kindOf(v); return k === 'live' || k === 'gif'; }
  };
})();
