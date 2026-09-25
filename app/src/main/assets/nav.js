/**
 * pulse 悬浮导航栏注入脚本。
 * 手机:底部悬浮胶囊(首页/搜索/消息/我的);平板(≥768px):同组按钮变左侧悬浮栏。
 * 点击动作优先复用微博页内既有元素(隐藏的搜索/消息/我的按钮),
 * 页内没有该入口时按站点路由直达目标页,不再退回首页。
 */
(function () {
  if (!document.documentElement) return;

  // 与原生 LOGIN_URL 保持一致:这个入口自带回跳 m.weibo.cn 的参数
  var LOGIN_PAGE = 'https://passport.weibo.cn/signin/login';
  var host = location.hostname;
  // 登录/SSO 页不注入
  if (host.indexOf('passport') !== -1) return;
  // 第三方授权页(微信登录等):微博导航在这里没有意义,只给一条必定回得到的返回路
  if (!/(^|\.)(weibo\.(cn|com)|sina\.com\.cn|sina\.cn)$/.test(host)) {
    if (!document.getElementById('bw-back')) {
      var logged = !!window.__bwLoggedIn;
      var back = document.createElement('a');
      back.id = 'bw-back';
      back.href = logged ? 'https://m.weibo.cn/' : LOGIN_PAGE;
      back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M15 5l-7 7 7 7"/></svg><span>' +
        (logged ? '返回微博' : '返回登录') + '</span>';
      document.documentElement.appendChild(back);
    }
    return;
  }

  // /api/config 结果:{login, uid, user_token};本地 Cookie 可能已失效但仍在,以服务端为准
  var cfg = null;
  var cfgRequested = false;

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.6-4.6"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.9-4 3.9-6 7.5-6s6.6 2 7.5 6"/></svg>',
    cmt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1-4.1A7.5 7.5 0 1 1 20 12.5Z"/></svg>',
    rt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5 20.5 6 17 9.5"/><path d="M20.5 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M3.5 18H16a4 4 0 0 0 4-4v-1"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V9.5l4.2-7A2 2 0 0 1 14.8 5l-.9 4.5H20a2 2 0 0 1 2 2.4l-1.5 7A2 2 0 0 1 18.5 21H7Z"/><path d="M7 10H3v11h4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
  };
  var ITEMS = [
    {k: 'home', label: '首页', icon: ICONS.home},
    {k: 'search', label: '搜索', icon: ICONS.search},
    {k: 'msg', label: '消息', icon: ICONS.msg},
    {k: 'me', label: '我的', icon: ICONS.me}
  ];

  function build() {
    if (document.getElementById('bw-nav')) return;
    var nav = document.createElement('div');
    nav.id = 'bw-nav';
    var html = '';
    for (var i = 0; i < ITEMS.length; i++) {
      html += '<div class="bw-nav-item" data-k="' + ITEMS[i].k + '">' +
        ITEMS[i].icon + '<span>' + ITEMS[i].label + '</span></div>';
    }
    nav.innerHTML = html;
    document.documentElement.appendChild(nav);
    nav.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.bw-nav-item') : null;
      if (item) act(item.getAttribute('data-k'));
    });

    // 发微博悬浮球:复用页内"写微博"按钮
    var fab = document.createElement('div');
    fab.id = 'bw-fab';
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    document.documentElement.appendChild(fab);
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      var rel = document.querySelector('.lite-iconf-releas');
      if (rel) {
        rel.click();
      } else if (window.BwNative && window.BwNative.toast) {
        window.BwNative.toast('请先回到首页');
      }
    });
  }

  var OFF_PAGE_URL = {
    search: 'https://m.weibo.cn/search?containerid=231583',
    msg: 'https://m.weibo.cn/message'
  };

  function profileUrl(c) {
    if (!c || !c.uid) return '';
    return 'https://m.weibo.cn/profile/' + c.uid +
      (c.user_token ? '?user_token=' + encodeURIComponent(c.user_token) : '');
  }

  function loadConfig(cb) {
    cfgRequested = true;
    if (location.hostname !== 'm.weibo.cn') {
      if (cb) cb(null);
      return;
    }
    try {
      fetch('/api/config', {credentials: 'include'})
        .then(function (r) { return r.json(); })
        .then(function (j) {
          cfg = (j && j.data) || null;
          if (cfg && !cfg.login && window.BwNative && window.BwNative.needLogin) {
            window.BwNative.needLogin();
          }
          if (cb) cb(cfg);
        })
        .catch(function () { if (cb) cb(null); });
    } catch (e) { /* ignore */ if (cb) cb(null); }
  }

  var lastHomeTap = 0;

  function act(k) {
    if (k === 'home') {
      var p = location.pathname;
      if (p === '/' || p === '/index' || p === '') {
        var y = window.pageYOffset || 0;
        var btn = document.querySelector('.refresh-btn');
        /* 回顶一律走站点自己的控件(.refresh-btn 被 theme.js 收掉了但仍可程序化点击),
           不再自己 scrollTo(0)。实测对照:
             点它  —— 从 y=54575 落到 y=0、padding-top 0、padding-bottom 0、
                      20 张卡、文档高 5221,和刚进页面的样本完全一致;
             自己滚 —— 一秒内跨 7 万 px,站点的窗口化列表一次只补插一页,追不上,
                      到顶时只剩 padding-top 366px(滚得越深剩得越多,可至一整屏),
                      卡片没补回来 → 就是"回到顶部间距不对 / 一整屏背景色"。
           顺带把"要连点两下"改成点一下即回顶,和常见 App 点当前 tab 的行为一致。 */
        if (y > 4 && btn) {
          lastHomeTap = 0;
          btn.click();
          return;
        }
        var now = Date.now();
        if (now - lastHomeTap < 500) {
          lastHomeTap = 0;
          if (btn) btn.click();      /* 已在顶部:第二下 = 站点语义的"刷新信息流" */
        } else {
          lastHomeTap = now;
          window.scrollTo({top: 0, behavior: 'smooth'});
          /* 兜底:没有 .refresh-btn 时才自己滚,落定后轻推两像素(分两帧推,
             合在一帧会被吞掉)让站点的回收/补插重算一次 */
          setTimeout(function () {
            try {
              if ((window.pageYOffset || 0) > 4 || document.querySelector('.refresh-btn')) return;
              window.scrollBy(0, 2);
              setTimeout(function () { try { window.scrollBy(0, -2); } catch (e) { /* ignore */ } }, 60);
            } catch (e) { /* ignore */ }
          }, 700);
        }
        return;
      }
      lastHomeTap = 0;
      location.href = 'https://m.weibo.cn/';
      return;
    }
    var map = {search: '.nav-search', msg: '.lite-iconf-msg', me: '.lite-iconf-profile'};
    var target = document.querySelector(map[k]);
    if (target) {
      target.click();
      return;
    }
    // 当前页面顶栏没有该入口(消息页/搜索页/正文页):走站点路由直达
    if (k !== 'me') {
      location.href = OFF_PAGE_URL[k];
      return;
    }
    if (cfg && cfg.uid) {
      location.href = profileUrl(cfg);
      return;
    }
    loadConfig(function (c) {
      var url = profileUrl(c);
      if (url) {
        location.href = url;
      } else if (window.BwNative && window.BwNative.toast) {
        window.BwNative.toast('请先登录微博');
      }
    });
  }

  // 上滑(内容向上走)时顶栏、底部导航、发博球一起收起;反向下滑立刻放出。
  // 用锁存而不是纯阈值:否则滚过 200px 后导航就再也点不到,只能回顶部。
  var SCROLL_HIDE_AT = 200;
  var lastY = -1;
  var scrollHide = false;

  /* 正文页(/status|/detail|/comments|/attitudes)的返回球与评论条有另一个阈值:
     2026-09-26 按需求"下滑到差不多返回按钮遮挡头像时就隐藏返回按钮与评论框,
     上滑显示逻辑不变"。

     遮挡怎么算:返回球是 fixed、钉在 top:14 + --bw-topbar-pad(手机 16px)= y 14..54;
     作者头像(正文卡里第一枚 .m-img-box img)刚进页面时文档 y≈79、高 32
     —— 也就是 scrollY≈25 时球的下沿(54)就切到头像的上沿(79)。
     球只要再往下压一点就开始糊住头像,所以阈值取"球压到头像一半"那一点:
       avatarTop(79) + 半高(16) - ballBottom(54) ≈ 41 → 取 40。
     站点各帖版的头部高度不完全一致(有的带来源/关注按钮),所以不写死 40,
     改成**按当前这帖的头像实测**;量不到头像时退回 40。 */
  var DEEP_HIDE_FALLBACK = 40;
  function deepHideAt() {
    /* 平板不参与:content 带从 x=100 起、返回球在 x=14..54,两者本就不重叠,
       theme.js 里 .bw-scroll-hide 的位移也只写在 max-width:767px 档。
       这里直接给一个大到不会触发的值,让平板的收起状态与改动前一致。 */
    if (window.matchMedia('(min-width: 768px)').matches) return SCROLL_HIDE_AT;
    var img = document.querySelector('.lite-page-wrap .m-img-box img');
    if (!img) return DEEP_HIDE_FALLBACK;
    var r = img.getBoundingClientRect();
    if (!r.height) return DEEP_HIDE_FALLBACK;
    var ballBottom = 54;                       // 返回球下沿(14 + 40)
    var docTop = r.top + (window.pageYOffset || 0);
    // 头像未被滚走时:滚到"球压住头像中部"才算遮住(实测 79 + 32/2 - 54 = 41)
    return Math.max(12, Math.round(docTop + r.height / 2 - ballBottom));
  }

  function trackScroll(y) {
    if (lastY >= 0 && Math.abs(y - lastY) > 3) {
      var at = SCROLL_HIDE_AT;
      if (/^\/(status|detail|comments|attitudes)\//.test(location.pathname)) {
        at = deepHideAt();
      }
      scrollHide = y > lastY ? y > at : false;
    }
    lastY = y;
    return scrollHide;
  }

  /** 站点把视频层挂在 .mwb-layer 上(fixed、满屏、z 99999);信息流里的内联视频卡不算 */
  function videoLayerOpen() {
    var el = document.querySelector('.video-player.mwb-layer, .mwb-layer');
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * .6 && r.height >= window.innerHeight * .6;
  }

  /* 全屏看图(photoswipe):.pswp 平时就在 DOM 里(display:none),
     打开时实测 display:block、1280x744 满屏、z-index 999999999。
     我们悬浮件的 z-index 是 2147483590,比它高 —— 不判它,导航栏和发博球
     就直接压在整屏图片上(实测 nav=flex / fab=flex) */
  function pswpOpen() {
    var el = document.querySelector('.pswp');
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * .6 && r.height >= window.innerHeight * .6;
  }

  /* 卡片"..."菜单:站点自己的底部动作面板(.m-wpbtn-lbox + .m-wpop-box 遮罩,z 10000/10001)。
     我们的悬浮导航是 2147483600,不判它的话胶囊会浮在遮罩之上,像压在菜单后面的一层杂质 */
  function sheetOpen() {
    var el = document.querySelector('.m-wpbtn-lbox');
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function overlayOpen() { return videoLayerOpen() || pswpOpen() || sheetOpen(); }

  /* 站点的"打开APP查看更多精彩内容"引导:WOUI 的 .woo-modal(z9999 满屏)
     带一层 .woo-modal__mask(z999),超话页进去就是它盖住整屏,不点"取消"什么都动不了。
     只按类名一刀切会连带杀掉别的确认框,所以按文案识别:
     命中"打开APP/查看更多精彩内容/APP内打开"这类话的大块浮层才收 ——
     真确认框的文案不会带这些字。文案超过 120 字的也不动(那是页面本体)。 */
  var NAG_RE = /(打开|前往|进入|使用)\s*(微博)?\s*(APP|App|app)|查看更多精彩内容|(APP|App)\s*内(打开|查看)|下载\s*(微博)?\s*(APP|App|app)|微博内打开/;

  function killAppNags() {
    if (!document.body) return;
    var all = document.body.getElementsByTagName('div');
    for (var i = 0; i < all.length; i++) {
      var e = all[i], cs = window.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || e.style.display === 'none') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var z = parseInt(cs.zIndex, 10) || 0;
      if (z < 500) continue;
      var r = e.getBoundingClientRect();
      if (r.width < window.innerWidth * .5 || r.height < window.innerHeight * .25) continue;
      var t = (e.textContent || '').replace(/\s+/g, ' ');
      if (t.length > 120 || !NAG_RE.test(t)) continue;
      e.style.setProperty('display', 'none', 'important');
      /* 遮罩常是它的兄弟节点;顺手把同层带 mask/overlay/layer 字样的满屏兄弟一起收掉 */
      var p = e.parentElement;
      if (!p) continue;
      for (var j = 0; j < p.children.length; j++) {
        var s = p.children[j];
        if (s === e) continue;
        var scs = window.getComputedStyle(s);
        if (scs.position !== 'fixed') continue;
        if (!/mask|overlay|layer|bg-mask/.test((s.className || '').toString())) continue;
        s.style.setProperty('display', 'none', 'important');
      }
    }
    /* 满屏弹窗里常还嵌一颗"微博内打开"胶囊:它自己就一句话,和同一条里真正有用的动作
       (超话的"我也发一帖")是兄弟节点。判据必须是"整块文案恰好等于一句引流口号"——
       用长度上限会误伤:那条栏的合并文案"微博内打开我也发一帖"只有 11 字,
       按 ≤12 字 + 正则匹配会把整条收掉,连"我也发一帖"一起丢(实测踩过)。 */
    var NAG_TEXT = { '微博内打开': 1, '打开app': 1, '打开微博app': 1, '在app内打开': 1,
      '前往app': 1, '下载app': 1, 'app内打开': 1, '打开微博': 1, '查看更多精彩内容': 1 };
    var nodes = document.querySelectorAll('div, a, span, button');
    for (var k = 0; k < nodes.length; k++) {
      var e2 = nodes[k], cs2 = window.getComputedStyle(e2);
      if (cs2.display === 'none' || e2.style.display === 'none') continue;
      var t2 = (e2.textContent || '').replace(/\s+/g, '').trim().toLowerCase();
      if (!NAG_TEXT[t2]) continue;
      var r2 = e2.getBoundingClientRect();
      if (r2.width < 30 || r2.height < 16) continue;
      var up = e2, fixed = false;
      for (var d = 0; up && up !== document.body && d < 8; up = up.parentElement, d++) {
        if (window.getComputedStyle(up).position === 'fixed') { fixed = true; break; }
      }
      if (!fixed) continue;
      e2.style.setProperty('display', 'none', 'important');
    }
    /* 弹窗可能给 body 锁了滚动,收掉之后要放开 */
    if (document.body.style.overflow === 'hidden' && !overlayOpen()) {
      document.body.style.overflow = '';
    }
  }

  /* ===== 内页悬浮件:返回球 / 设置胶囊(手机+平板) + 竖置操作栏(仅平板) ===== */
  /* 站点的内页顶栏与正文页底栏都是 position:fixed,theme.js 把它们收掉;
     这里造代理控件去点站点自己的按钮(返回/设置/发表评论/转发/赞),
     不复制任何行为,所以评论面板、点赞态都还是站点原逻辑 */
  var WIDE = window.matchMedia ? window.matchMedia('(min-width: 768px)') : {matches: false};
  /* .module-topbar 是老架构页面(设置及其子页,根节点是 div#box、没有 #app)的顶栏返回,
     a.back-header 是更老的服务端页(屏蔽设置/悄悄关注/编辑资料)那条"返回"文字链 ——
     两者本身就是 javascript:history.go(-1),代理点击即可,不另造返回逻辑。
     .m-reles-top .m-font-arrow-left 是撰写页(/compose,热搜那条讨论栏点进去的页)顶栏里
     站点自己的返回箭头:它不归我们收,列进来只为"站点已经给了返回就别再浮一颗球"这条判据。
     .ntop-nav .nt-left 是搜索条左端那颗返回箭头(热搜条目页/关键词页都有,平板上它落在
     条带里 x=100,我们的球在 x=14,两颗并排就是两个返回键)。
     注意 querySelector 可能命中 0x0 的那份(站点为每个 tab 面板各留了一条),
     所以要挑第一个"看得见"的。 */
  var BACK_SEL = '.lite-page-top .nav-left, .prf-topbar .nav-left, ' +
    '.module-topbar .iconf_navbar_back, a.back-header, .m-reles-top .m-font-arrow-left, ' +
    '.ntop-nav .nt-left, ' +
    /* 服务端直出卡片页(/p/…)顶栏里站点自己的返回:.m-top-bar .m-font-arrow-left
       —— 不列进来的话我们的球会浮上去叠在站点那颗箭头上(实测两棵都画在 12..48 一带) */
    '.m-top-bar .m-font-arrow-left, .m-top-bar .m-top-bar__back';

  function firstVisible(sel) {
    var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return all[i];
    }
    return all.length ? all[0] : null;
  }

  /* firstVisible 在"全都不可见"时会退回第一个节点(那正是要代理点击的目标),
     所以"站点自己的返回是否真的在屏幕上"要单独量一次 */
  function onScreen(e) {
    if (!e) return false;
    var r = e.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  /* 只有这四个主 tab 页保留悬浮导航与发博按钮,其余(二级页、子页)一律不显示。
     - 热搜条目页路由也是 /search,但带 q(落地页 containerid=231583 不带),据此区分;
       站点把参数整体编码过,所以 `q%3D` 也要认(实测 `%26q%3D%E4…`)。
     - /message 是主 tab,/message/chat 是会话页(底部输入框会被胶囊压住,实测重叠 388x39)。
     - /profile、/u/ 是"我的"与主页,导航栏在这儿有实际落点,保留。 */
  function isMainTab() {
    var p = location.pathname, s = location.search || '';
    if (/^\/(index\.html)?$/.test(p)) return true;
    if (/^\/(my|u\/|profile)(\/|\?|$)/.test(p)) return true;
    if (/^\/message(\/|$)/.test(p) && p.indexOf('/message/chat') !== 0) return true;
    if (/^\/search/.test(p) && s.indexOf('q=') === -1 && s.indexOf('q%3D') === -1) return true;
    return false;
  }
  var SET_SEL = '.prf-topbar .nav-right';
  var ACTS = [
    {k: 'cmt', label: '评论', icon: ICONS.cmt, sel: '.lite-page-editor .box-left'},
    {k: 'rt', label: '转发', icon: ICONS.rt, sel: '.lite-page-editor .lite-iconf-report'},
    {k: 'like', label: '赞', icon: ICONS.like, sel: '.lite-page-editor .lite-iconf-like'}
  ];

  function buildFloatChrome() {
    if (!document.getElementById('bw-fback')) {
      var b = document.createElement('div');
      b.id = 'bw-fback';
      b.innerHTML = ICONS.back;
      document.documentElement.appendChild(b);
      b.addEventListener('click', function () {
        var t = firstVisible(BACK_SEL);
        if (t) { t.click(); return; }
        history.back();
      });
    }
    // 主页顶栏右侧还有"设置"入口,收掉顶栏时不能把它一起丢掉
    if (!document.getElementById('bw-fset')) {
      var st = document.createElement('div');
      st.id = 'bw-fset';
      st.textContent = '设置';
      document.documentElement.appendChild(st);
      st.addEventListener('click', function () {
        var t = document.querySelector(SET_SEL);
        if (t) t.click();
      });
    }
    if (!document.getElementById('bw-acts')) {
      var a = document.createElement('div');
      a.id = 'bw-acts';
      var html = '';
      for (var i = 0; i < ACTS.length; i++) {
        html += '<div class="bw-act" data-k="' + ACTS[i].k + '">' +
          ACTS[i].icon + '<span>' + ACTS[i].label + '</span></div>';
      }
      a.innerHTML = html;
      document.documentElement.appendChild(a);
      a.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.bw-act') : null;
        if (!item) return;
        var def = null;
        for (var i = 0; i < ACTS.length; i++) if (ACTS[i].k === item.getAttribute('data-k')) def = ACTS[i];
        var target = def && document.querySelector(def.sel);
        if (target) target.click();
      });
    }
  }

  /* ===== 首页分组选择框:锚位 + 点击别处自动收起 ===== */
  /* 开合仍是站点自己的逻辑(点 ul.nav_item li.cur span 切换),这里只补两件事:
     1) 把弹层的纵向锚位写进 --bw-drop-top(顶栏高度随平台、玻璃态、上滑收起而变,CSS 写不死);
     2) 点到弹层以外时,再点一次触发器把它收起——不另造一套开关状态,所以不会出现"我们以为开着" */
  var DROP_SEL = '.lite-nav-sublist';
  var TRIG_SEL = 'ul.nav_item li.cur span';

  function dropAnchor() {
    var tb = document.querySelector('.lite-topbar.main-top');
    var bottom = tb ? tb.getBoundingClientRect().bottom : 0;
    if (!(bottom > 0)) return -1;          /* 顶栏已滚走/收起:返回 -1 表示不该再显示 */
    document.documentElement.style.setProperty('--bw-drop-top', Math.round(bottom + 6) + 'px');
    return bottom;
  }

  /* 站点用 v-if 挂/摘这个节点,收起要等一次 Vue 渲染(一个微任务)才见到节点消失。
     滚动时 refresh 是逐事件触发的,不加这个闩就会在一次惯性滚动里点两次触发器 = 关了又开 */
  var dropClosing = false;
  function closeDrop() {
    if (dropClosing) return;
    var t = document.querySelector(TRIG_SEL);
    if (!t) return;
    dropClosing = true;
    t.click();
    setTimeout(function () { dropClosing = false; }, 400);
  }

  /* 弹层是 position:fixed 的内部滚动列表,展开时文档停在 y=0 —— 原生会以为「已在顶部」,
     用户在弹层里往上翻回列表头的手势被下拉刷新截走(见 MainActivity.setGroupDrop) */
  function tellDrop(open) {
    try {
      if (window.BwNative && BwNative.setGroupDrop) {
        BwNative.setGroupDrop(open);
      }
    } catch (e) { /* ignore */ }
  }

  function syncDrop() {
    var pop = document.querySelector(DROP_SEL);
    if (!pop) {
      dropClosing = false;
      tellDrop(false);
      return;
    }
    tellDrop(true);
    if (dropClosing) return;
    if (dropAnchor() < 0) closeDrop();     /* 顶栏不在屏幕上了,弹层不该独自飘着 */
  }

  /* 一个 document 里只绑一次:nav.js 会被多次 evaluateJavascript 注入,
     重复绑定会让同一次"点击外部"连点两次触发器 = 关了又开 */
  try {
    if (!window.__bwDropBound) {
      window.__bwDropBound = true;
      document.addEventListener('click', function (e) {
        var pop = document.querySelector(DROP_SEL);
        var t = e && e.target;
        if (!pop || !t || t.nodeType !== 1) return;
        var trig = document.querySelector(TRIG_SEL);
        if (trig && (t === trig || trig.contains(t))) { dropAnchor(); return; }  /* 触发器自己管开合 */
        if (pop === t || pop.contains(t)) return;                                /* 选中分组由站点自己关闭 */
        if (t.closest && t.closest('#bw-nav, #bw-fab, #bw-fback, #bw-fset, #bw-acts')) return;
        closeDrop();
      }, true);
    }
  } catch (e) { /* ignore */ }

  /* 评论框展开时站点会在编辑条里插入 textarea。这个开合必须同步跟:
     若等 refresh 的 250ms 节流,收起瞬间会先以"站点原始底栏"的样子露出来再消失(闪一下) */
  var edObs = null, edTarget = null;
  function syncEditorClass() {
    var open = !!(edTarget && edTarget.querySelector('textarea'));
    document.documentElement.classList.toggle('bw-editor-open', open);
  }
  function watchEditor() {
    var ed = document.querySelector('.lite-page-editor');
    if (ed === edTarget) return;
    edTarget = ed;
    if (edObs) { try { edObs.disconnect(); } catch (e) { edObs = null; } }
    if (!ed) { syncEditorClass(); return; }
    try {
      edObs = new MutationObserver(syncEditorClass);
      edObs.observe(ed, {childList: true, subtree: true, characterData: true, attributes: true});
    } catch (e) { /* ignore */ }
    syncEditorClass();
  }

  function syncFloatChrome(deep, hidden) {
    var wide = WIDE.matches;
    var editor = document.querySelector('.lite-page-editor');
    watchEditor();
    buildFloatChrome();
    var fb = document.getElementById('bw-fback');
    var acts = document.getElementById('bw-acts');
    var set = document.getElementById('bw-fset');
    var video = overlayOpen();
    /* 站点自己有返回控件时代理它;像"意见反馈"(/p/…)那种整页没有任何返回入口的子页,
       也放行悬浮球 —— 球里没有可代理的目标时点击走 history.back(),语义与站点那条返回链一致。
       首页/搜索/消息/我的这四页由悬浮导航负责出口,不额外浮球。 */
    var inner = !isMainTab();
    var back = firstVisible(BACK_SEL);
    /* 站点自己的箭头还在屏幕上(撰写页顶栏那颗不归我们收),就不要再叠一颗球压上去
       (实测球 14..56 正好盖住站点箭头 10,15 16x16);被我们 CSS 收掉的顶栏 rect 是 0x0,
       那种页面恰恰需要这颗球。 */
    fb.style.display = (!video && !onScreen(back) && (back || inner)) ? 'flex' : 'none';
    set.style.display = (!video && document.querySelector(SET_SEL)) ? 'flex' : 'none';
    // 手机端保留站点那条底栏(已改成横向悬浮),所以竖置操作栏只在平板出现
    acts.style.display = (wide && deep && !video && editor) ? 'flex' : 'none';
    /* 正文页:返回球压在正文上、评论条压在评论区上,读帖子时一直挡着 ——
       与首页那套悬浮件一样沿用上滑收起的锁存状态(下滑立刻放出)。
       评论框展开时不能收:那是人正在打字,收掉等于把输入框从他手里抽走。 */
    var chrome = hidden && deep && !document.documentElement.classList.contains('bw-editor-open');
    fb.classList.toggle('bw-scroll-hide', chrome);
    if (editor) editor.classList.toggle('bw-scroll-hide', chrome);
  }

  /* 站点会把搜索提示换成滚动的"大家都在搜：…",统一成一句朴素的占位 */
  function fixSearchHint() {
    var box = document.querySelector('.nt-search input');
    if (box) {
      if (box.placeholder && box.placeholder.indexOf('大家都在搜') === 0) box.placeholder = '搜索微博';
      // 手机键盘:回车键直接显示"搜索",关闭自动大写/纠错(搜中文用不上)
      box.setAttribute('enterkeyhint', 'search');
      box.setAttribute('inputmode', 'search');
      box.setAttribute('autocapitalize', 'none');
      box.setAttribute('autocorrect', 'off');
    }
    var hot = document.querySelectorAll('.nav-search .m-text-cut, .m-search .m-text-cut');
    for (var i = 0; i < hot.length; i++) {
      if ((hot[i].textContent || '').indexOf('大家都在搜') === 0) hot[i].textContent = '搜索微博';
    }
  }

  /* ===== 平板双列信息流:固定行位瀑布 + 双列口径记账 ===== */
  /* CSS Grid 不支持 masonry(Chrome 145 实测),行轨切成 2px 细格、按卡片高度写
     span 等价于瀑布流,且完全不动 DOM 结构(站点的无限追加、事件代理都不受影响)。

     站点虚拟列表(main.js 的 feed 组件)按**单列**记账:
       - 每卡高度 .hei 在首渲后量一次(offsetHeight)存进数据;
       - 滚动增量 a(300ms 节流)按 .hei 1:1 消耗:回收顶部 Σhei≤a 的卡、
         padding_top += Σhei,底部补进等量新卡。
     双列网格里同样的卡只占约一半纵向空间,1:1 消耗与 2:1 压缩率对不上:
       - 每次回收,padding_top 的增量约等于两倍的列内实际腾空量,
         内容被顶下去"另一列的回收量"——这就是"新加载微博时页面向上飞";
       - 且视口每滚 1px 视觉上跨过 2px 单列内容,窗口却只前进 1px,
         视口跑赢窗口,只能靠"内容被顶回来"硬拗,滚动进度被吃掉一半。
     历史上的两条对抗路线都被实测否决(详见 README):
       - 滚动补偿 scrollBy:fling 被打断、假高度正反馈,净负收益;
       - padding-top 静态减半:视口跑赢窗口,刷到底不再加载。
     正解是把记账本身换到双列口径,两个动作都在 MutationObserver 回调
     (paint 之前的微任务)里同步完成:
       1) .hei 减半(__bwHalf 标记,幂等):滚动 1px 消耗 2px 单列高度,
          与双列视觉消耗率一致 → 窗口与视口同步推进,padding_top 增量
          与列内腾空量对齐,平均位移归零;
       2) 行位固定:每卡写显式 grid-column + 绝对 grid-row,幸存卡在
          回收/补卡/回插时一律不动(新卡落最短列末尾、回插卡摞在列顶之上,
          高度变化只顺移同列下方)→ 列间差异位移也归零。
     padding_top 同时接管为常量(站点的写值只在重置时跟随一次),
     内容的文档坐标从此只由行号决定。站点从不回读 DOM 的 padding 也不回读
     .hei(只经 style 绑定写),两处改写都不会反馈进它的滚动逻辑;
     padding-bottom 不移动内容,保持站点原值。 */
  var MASON_UNIT = 2;      // 与 theme.js 的 grid-auto-rows 保持一致
  var masonTimer = null;
  // 凡是"直接子节点是信息流卡"的容器都走瀑布:首页 .pannelwrap 与我的页列表同一套
  var MASON_SEL = '#app div:has(> .wb-item-wrap)';

  // —— 固定行位状态(只挂在带虚拟列表记账的信息流 wrap 上)——
  function FeedState() {
    this.vm = null;            // 站点 feed 组件($refs.cont 指回 wrap 且带 list_all)
    this.nodeInfo = new Map(); // Node -> {col, row, h};h = 上次量到的外边距盒高
    this.ourPad = null;        // 接管后的 padding-top(px);null = 尚未接管
  }
  var feedStates = new WeakMap();
  var pinnedWraps = [];

  function feedStateOf(wrap) {
    var st = feedStates.get(wrap);
    if (!st) {
      st = new FeedState();
      feedStates.set(wrap, st);
      pinnedWraps.push(wrap);
    }
    return st;
  }

  /** 沿 DOM 向上找 __vue__,再沿 $parent 找 $refs.cont 指回 wrap 的 feed 组件 */
  function findFeedVm(wrap) {
    try {
      var n = wrap;
      while (n && !n.__vue__) n = n.parentElement;
      var vm = n && n.__vue__;
      while (vm && !(vm.$refs && vm.$refs.cont === wrap &&
          vm.list_all && vm.padding_top !== undefined)) {
        vm = vm.$parent;
      }
      return vm || null;
    } catch (e) { return null; }
  }

  /* 窗口顶相对视口顶的头部余量。站点的口径是 **窗口上下各留一半**
     (init 里 `first_scroll = .5*cont.offsetHeight - n/2`),所以平衡点
     `last_scrolltop ≈ scrollY - first_scroll` 天然把视口放在窗口正中。
     我们一度把它归零 —— 归零等于把视口顶推到窗口上沿,上边一点余量都不留:
       - 站点补插是事件驱动 + 300ms 一节拍,一次 fling 能冲 1500~2500px,
         节拍之间没有任何补插 → 视口冲出窗口上沿就是空白
         (实测上滑途中右列连续多帧整屏 744px 无卡,而手机单列同判据最差 18px);
       - 双列下两列顶还差着一张卡高(实测最高卡 1302px),余量小于它就必然露白。
     所以这里按站点原口径自己算(站点那次是在渲染前量的,量到的是单列整高,
     在双列下大到滚不到 → 冷启动永远不触发窗口化,这正是当初归零的理由):
     用当前窗口的记账总高 Σhei 取一半,并用"内容内还能滚多远"封顶。 */
  function sumHei(arr) {
    var t = 0;
    if (arr) for (var i = 0; i < arr.length; i++) t += (arr[i] && arr[i].hei) || 0;
    return t;
  }

  function leadOf(vm) {
    var vh = window.innerHeight || 744;
    var sum = sumHei(vm.list_cur);
    var cap = sum - vh;                       // 头部余量再大也不能超过内容可滚深度
    if (cap <= 0) return 0;
    return Math.min(Math.max(Math.round(sum / 2), Math.round(vh * 1.5)), Math.round(cap));
  }

  /* 双列下把站点的批量上限 count 抬到这么多。
     同样的 20 条微博,单列排出来是 12600px 滚动空间、双列只占一半(实测 Σhei 4700),
     于是"窗口对视口的覆盖"直接腰斩:手机实测 first_scroll=4166,一次硬 fling
     每拍冲 1800~2400px 也顶得住(逐帧判据实测两向最大空白 89/18px);
     平板按 Σhei/2 只有 2348,同一手势就露白(实测 534 / 744px)。
     需要量 = 2 × (每拍冲刺 + 一列顶的参差) + 视口 ≈ 2×(2000+700)+744 ≈ 6100px
     列内空间 ≈ 26~34 条。count 是站点 get_scroll_items 里唯一的批量口径,
     且首屏回插分支就是 `list_all.slice(0, count)`,抬它即可让窗口按双列口径变大。
     34 是实测出来的:再抬到 38 反而更糟(批量随 |a|≈fs 一起变大,窗口尾部一次性
     跳过的条目超过一页已加载量 → 下探时底部露白,实测 34:下 335/上 2px,
     38:下 744/上 349px)。 */
  var WIN_ITEMS = 34;

  /* 已加载条目领先窗口尾部多少条时才提前翻页(约 12×230 ≈ 2700px 列内空间,
     再加窗口自身的底部余量,足够覆盖一次网络往返)。 */
  var LOAD_AHEAD = 12;


  /** 门槛换算到记账口径:.hei 减半后,站点的 get_item_H 仍回读 DOM offsetHeight
      (整卡列内高 = 2 个 hei 单位),于是"要不要补"按整卡判、"补多少"按半卡算,
      补的速度只有消耗的一半 → 缺口只增不减。把它包成 ÷2,与 .hei 同口径。
      站点只在两个滚动门槛里调它(main.b53719c4.js 实测 2 处),不驱动渲染。 */
  function hookItemH(vm) {
    if (vm.__bwGih) return;
    var orig = vm.get_item_H;
    vm.__bwGih = orig;
    vm.get_item_H = function (t, e) {
      return Math.max(1, Math.round(orig.apply(this, arguments) / 2));
    };
  }

  function unhookItemH(vm) {
    if (vm.__bwGih) {
      vm.get_item_H = vm.__bwGih;
      delete vm.__bwGih;
    }
  }

  /** 记账同步到双列口径:.hei 减半 + 门槛同口径 + 窗口化留出头部余量。
      .hei 减半是幂等的:__bwHalf 标记随数据一起被站点持久化,恢复后不会二减;
      未经测量(hei 缺失)的条目等量完再换。 */
  function syncHeiUnits(vm) {
    try {
      var lead = leadOf(vm);
      if (vm.__bwFs === undefined) vm.__bwFs = vm.first_scroll;   // 退出宽屏时归还
      if (vm.first_scroll !== lead) vm.first_scroll = lead;
      if (vm.__bwCount === undefined) vm.__bwCount = vm.count;
      if (vm.count !== WIN_ITEMS) vm.count = WIN_ITEMS;
      hookItemH(vm);
      var lists = [vm.list_all, vm.list_cur, vm.diff_items];
      for (var l = 0; l < lists.length; l++) {
        var arr = lists[l];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (it && it.hei > 1 && !it.__bwHalf) {
            it.hei = Math.max(1, Math.round(it.hei / 2));
            it.__bwHalf = 1;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /** 退出宽屏(转手机单列)时把 .hei 换回单列口径,记账才不至于跑在视口前面 */
  function unscaleHeiUnits(vm) {
    try {
      unhookItemH(vm);
      if (vm.__bwFs !== undefined) {
        /* 门槛还给站点。不能直接回吐接管时抓的快照:站点只在首屏那次
           `first_scroll = .5*cont.offsetHeight - clientHeight/2` 里写它,
           我们抓到的可能是中途的值(实测回吐出 -200,等于把窗口顶压到视口顶
           下方 200px → 顶部一条空白)。所以按站点自己的公式就地重算一次,
           量不到容器时才退回快照。 */
        var fs = vm.__bwFs, cont = vm.$refs && vm.$refs.cont;
        if (cont && cont.offsetHeight > 0) {
          fs = Math.max(0, Math.round(0.5 * cont.offsetHeight -
              (document.documentElement.clientHeight || window.innerHeight || 744) / 2));
        }
        if (vm.first_scroll !== fs) vm.first_scroll = fs;
        delete vm.__bwFs;
      }
      if (vm.__bwCount !== undefined) {
        vm.count = vm.__bwCount;          // 批量口径也还给站点(单列 20 条够用)
        delete vm.__bwCount;
      }
      var lists = [vm.list_all, vm.list_cur, vm.diff_items];
      for (var l = 0; l < lists.length; l++) {
        var arr = lists[l];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (it && it.__bwHalf) {
            it.hei = Math.round((it.hei || 0) * 2);
            delete it.__bwHalf;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /** 老的自动排布(跨两列的稀疏 span):用于没有虚拟列表记账的瀑布容器(我的页等) */
  function layoutAuto(wrap) {
    var els = wrap.children;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var h = el.getBoundingClientRect().height;
      if (h <= 0) continue;
      var cs = window.getComputedStyle(el);
      var box = h + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      var span = 'span ' + Math.max(1, Math.round(box / MASON_UNIT));
      /* 值没变就不写:MO 回调里同步跑,无条件写等于自己触发下一轮变异;
         比对行内实际值而不是缓存 —— 站点整批重写 style 时会抹掉我们的值 */
      if (el.style.gridRowEnd !== span) el.style.gridRowEnd = span;
    }
  }

  /** 固定行位布局:幸存卡不动,新卡按最短列落位,顶部回插卡摞在列顶之上 */
  function layoutPinned(wrap, st, vm) {
    var children = wrap.children;
    if (!children.length) return;
    syncHeiUnits(vm);

    // —— 读:本帧全部子项的外边距盒高(先读后写,只强排一次)——
    var i, el, recs = [];
    for (i = 0; i < children.length; i++) {
      el = children[i];
      var box = el.getBoundingClientRect().height;
      if (box > 0) {
        var cs = window.getComputedStyle(el);
        box += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      recs.push({el: el, box: box, col: -1, row: 0, span: 1, h: null});
    }

    // —— 幸存卡:沿用 {col,row};高度变化量累计成同列下方的顺移 ——
    var cols = [[], []], c, j;
    for (i = 0; i < recs.length; i++) {
      var prev = st.nodeInfo.get(recs[i].el);
      if (!prev) continue;
      recs[i].col = prev.col; recs[i].row = prev.row; recs[i].h = prev.h;
      cols[prev.col].push(recs[i]);
    }
    for (c = 0; c < 2; c++) {
      var list = cols[c].sort(function (a, b) { return a.row - b.row; });
      var shift = 0;
      for (j = 0; j < list.length; j++) {
        var it = list[j];
        it.row += shift;
        var span = it.box > 0 ? Math.max(1, Math.round(it.box / MASON_UNIT)) : 1;
        if (it.h != null && it.h > 0) {
          shift += span - Math.max(1, Math.round(it.h / MASON_UNIT));
        }
        it.span = span; it.h = it.box;
      }
    }

    // —— 新卡:出现在幸存卡之前的 = 上方回插(倒序向上摞),其余落最短列末尾 ——
    var firstSurv = -1;
    for (i = 0; i < recs.length; i++) {
      if (recs[i].col >= 0) { firstSurv = i; break; }
    }
    var colEnd = [0, 0], colTop = [0, 0];
    for (c = 0; c < 2; c++) {
      for (j = 0; j < cols[c].length; j++) {
        var s0 = cols[c][j];
        if (s0.row + s0.span > colEnd[c]) colEnd[c] = s0.row + s0.span;
      }
      colTop[c] = cols[c].length ? cols[c][0].row : 0;
    }
    var upTop = [colTop[0], colTop[1]];
    var prepends = [], appends = [];
    for (i = 0; i < recs.length; i++) {
      if (recs[i].col >= 0) continue;
      (firstSurv >= 0 && i < firstSurv ? prepends : appends).push(recs[i]);
    }
    // 回插按 DOM 倒序向上摞:越靠后的条目离幸存卡越近,最先落位
    for (i = prepends.length - 1; i >= 0; i--) {
      var p = prepends[i];
      p.span = p.box > 0 ? Math.max(1, Math.round(p.box / MASON_UNIT)) : 1;
      var pc = upTop[0] >= upTop[1] ? 0 : 1;      // 填"列顶更低"的那列,镜像底部的 argmin
      p.col = pc; p.row = Math.max(0, upTop[pc] - p.span); p.h = p.box;
      upTop[pc] = p.row;
      cols[pc].push(p);
    }
    for (i = 0; i < appends.length; i++) {
      var a2 = appends[i];
      a2.span = a2.box > 0 ? Math.max(1, Math.round(a2.box / MASON_UNIT)) : 1;
      var ac = colEnd[0] <= colEnd[1] ? 0 : 1;
      a2.col = ac; a2.row = colEnd[ac]; a2.h = a2.box;
      colEnd[ac] = a2.row + a2.span;
      cols[ac].push(a2);
    }

    // —— 安全网:同列按行序推挤,任何原因造成的重叠都顺次压下去(罕见路径)——
    for (c = 0; c < 2; c++) {
      var list2 = cols[c].sort(function (a, b) { return a.row - b.row; });
      for (j = 1; j < list2.length; j++) {
        var minRow = list2[j - 1].row + list2[j - 1].span;
        if (list2[j].row < minRow) list2[j].row = minRow;
      }
    }

    // —— 写:显式列 + 绝对行位;值没变不写(理由同 layoutAuto)——
    for (c = 0; c < 2; c++) {
      for (j = 0; j < cols[c].length; j++) {
        var it2 = cols[c][j];
        var want = (it2.row + 1) + ' / span ' + it2.span;
        if (it2.el.style.gridRow !== want) it2.el.style.gridRow = want;
        var wantCol = String(c + 1);
        if (it2.el.style.gridColumn !== wantCol) it2.el.style.gridColumn = wantCol;
        st.nodeInfo.set(it2.el, {col: c, row: it2.row, h: it2.h});
      }
    }
    // 离场节点清账(Map 迭代中删除是安全的)
    st.nodeInfo.forEach(function (info, node) {
      var alive = false;
      for (var q = 0; q < recs.length; q++) if (recs[q].el === node) { alive = true; break; }
      if (!alive) st.nodeInfo.delete(node);
    });

    // —— padding-top 接管:内容文档坐标只由行号决定,站点的写值不再生效 ——
    // 重置判定:站点数据归零且页面在顶部附近(下拉刷新/切分组/首屏),
    // 或窗口已被清空 → 行位全部作废,从当前 padding 重新接管
    if (st.ourPad !== null && vm.padding_top === 0 &&
        ((window.scrollY || 0) < 60 || (vm.list_cur && vm.list_cur.length < 5))) {
      st.ourPad = null;
      st.nodeInfo.clear();
      wrap.style.paddingBottom = '';   // 刷新/切组:伺服燃料一并归零重计
    }
    if (st.ourPad === null) {
      st.ourPad = Math.max(0, parseFloat(wrap.style.paddingTop) || 0);
    }
    var wantPad = Math.ceil(st.ourPad) + 'px';
    if (wrap.style.paddingTop !== wantPad) wrap.style.paddingTop = wantPad;

    // —— padding-bottom 接管:滚动空间伺服 ——
    // padTop 定住之后,原版“文档随滚动净增”的机制就没了:原版每次窗口推进
    // 都是 padTop += 砍头记账、容器白赚补卡高,文档持续长,y 永远追不上底。
    // 我们行位固定 + padTop 常量,容器砍补等量,文档稳态 → y 迟早追上文档底
    // → 撞底死锁(实测静态燃料版 docH 10379→8215,缩量恰 = 补进条目×hei,
    // 滚到 y=7472 后 24 次滑动 scrollPx=0)。
    // 伺服式补法:每帧检查视口底到文档底的余量,不足一屏就补足一屏 ——
    // 滚动消耗多少视觉,燃料就补多少,文档与 y 等速增长,永不撞底;
    // 信息流的“无限”由燃料的持续再生产提供,翻页/补卡/回收都不用特殊处理。
    // 写入条件单调(只增不减),不会与自己的 MutationObserver 打转。
    // 内容坐标仍由行位固定 + padTop 常量保证不动。 */
    var vh2 = window.innerHeight || 744;
    var docH2 = document.documentElement.scrollHeight;
    var slack = docH2 - ((window.scrollY || 0) + vh2);
    if (slack < vh2) {
      var curPb = parseFloat(wrap.style.paddingBottom) || 0;
      var wantPb2 = Math.ceil(curPb + (vh2 - slack)) + 'px';
      if (wrap.style.paddingBottom !== wantPb2) wrap.style.paddingBottom = wantPb2;
    }

    // —— 提前翻页 ——
    // 站点翻页是 0 前瞻的:只有"窗口尾部撞上已加载末端"那一批才走 load_more 分支。
    // 双列每滚一屏要吃掉约两倍条目,极限手势(2400px/s 以上)会冲过已加载末端,
    // 底部短暂露白(实测 1.5~724px,取决于网络往返)。所以提前一点请它自己翻页。
    // 前瞻量必须按 **条数** 算,不能按高度:list_all 里未渲染条目的 .hei 还没被量到
    // (=0),按高度估会恒判"快见底"→ 每一批变异都触发一次请求 → 请求风暴
    // (实测 18 次下滑把 list_all 灌到 1282 条)。load_more 自带 is_request 闸门,
    // 但闸门只防并发,不防这种"永远够不着阈值"的判定错误。
    if (!vm.is_request && !vm.is_refresh && !vm.re_do && vm.nextPageApi &&
        vm.list_all && vm.list_cur && vm.list_cur.length) {
      var tail = vm.list_all.indexOf(vm.list_cur[vm.list_cur.length - 1]);
      if (tail >= 0 && vm.list_all.length - tail <= LOAD_AHEAD) vm.load_more(vm.nextPageApi);
    }

    // —— .hei 校准:记账 = 实际渲染高的一半 ——
    // 站点量 .hei 有两条路径:初始页在实际渲染容器里量(双列高 678),
    // 翻页增量在隐藏的单列测量容器里量(~474)——统一减半后一个 339 一个 237,
    // 而两者的真实视觉半高都是 339。翻页条目记账比视觉慢 30%,消耗不足
    // 让视口先撞底(实测滚到 y=5639 时窗口 [24..38] 只剩 15 张,耗尽线
    // 在视觉底之下 700+px)。v-for 顺序与 DOM 子节点一致,按索引对齐把
    // 已渲染卡的 hei 校准成 recs 量的实际高/2,记账从此与视觉消耗 1:1;
    // 未渲染条目等渲染后自然被校准。 */
    if (vm.list_cur && vm.list_cur.length === children.length) {
      for (var z = 0; z < children.length; z++) {
        var item = vm.list_cur[z];
        if (item && recs[z] && recs[z].box > 0) {
          var wantH = Math.max(1, Math.round(recs[z].box / 2));
          if (item.hei !== wantH) item.hei = wantH;
          item.__bwHalf = 1;
        }
      }
    }
  }

  function layoutMasonry() {
    /* 手机单列绝不接管:watchFeed / ResizeObserver 的回调也会直接走到这里,
       不设守卫的话单列同样会被写行位、.hei 被减半 —— 记账消耗快一倍,
       窗口推进过早,手机反而患上平板才有的病。归还交给 masonry() 的
       clearMasonry(refresh 每 250ms 会调到)。 */
    if (!WIDE.matches) return;
    var wraps = document.querySelectorAll(MASON_SEL);
    for (var w = 0; w < wraps.length; w++) {
      var wrap = wraps[w];
      var st = feedStates.get(wrap);
      var vm = st ? st.vm : null;
      if (!vm) vm = findFeedVm(wrap);   // 每次重试直到找到 feed 组件
      if (vm) {
        if (!st) st = feedStateOf(wrap);
        st.vm = vm;
        layoutPinned(wrap, st, vm);
      } else {
        layoutAuto(wrap);               // 我的页等:沿用自动排布
      }
    }
  }

  function clearMasonry() {
    var els = document.querySelectorAll('.wb-item-wrap, .profile-header, .lite-btn-more');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.style.gridRow) el.style.gridRow = '';
      if (el.style.gridRowEnd) el.style.gridRowEnd = '';
      if (el.style.gridColumn) el.style.gridColumn = '';
    }
    // 归还 padding-top / padding-bottom 与 .hei 口径:退回单列世界,站点自己的记账必须原样接手
    for (var w = pinnedWraps.length - 1; w >= 0; w--) {
      var wrap = pinnedWraps[w];
      if (!wrap.isConnected) { pinnedWraps.splice(w, 1); continue; }
      var st = feedStates.get(wrap);
      if (!st) { pinnedWraps.splice(w, 1); continue; }
      if (st.vm) {
        // 已渲染卡:布局已是单列,直接量实测高写回;未渲染条目:×2 近似回单列口径
        try {
          var vm2 = st.vm, kids2 = wrap.children;
          if (vm2.list_cur && vm2.list_cur.length === kids2.length) {
            for (var z2 = 0; z2 < kids2.length; z2++) {
              var it3 = vm2.list_cur[z2];
              var oh = kids2[z2].offsetHeight;
              if (it3 && oh > 0) { it3.hei = oh; delete it3.__bwHalf; }
            }
          }
        } catch (e) { /* ignore */ }
        unscaleHeiUnits(st.vm);
      }
      if (st.ourPad !== null) {
        st.ourPad = null;
        st.nodeInfo.clear();
        wrap.style.paddingTop = (st.vm && st.vm.padding_top !== undefined)
            ? Math.ceil(st.vm.padding_top) + 'px' : '';
        wrap.style.paddingBottom = (st.vm && st.vm.padding_bottom !== undefined)
            ? Math.ceil(st.vm.padding_bottom) + 'px' : '';
      } else {
        wrap.style.paddingBottom = (st.vm && st.vm.padding_bottom !== undefined)
            ? Math.ceil(st.vm.padding_bottom) + 'px' : '';
      }
    }
  }

  /* 信息流 wrap 的变异(站点写 padding / 增删卡片)在这里同步处理:
     微任务里、paint 之前,行位与记账一次到位,错位帧不会被画出来 */
  var masonEl = null, masonObs = null;
  function watchFeed() {
    var el = document.querySelector('#app .main-wrap .pannelwrap');
    if (el === masonEl) return;
    if (masonObs) { try { masonObs.disconnect(); } catch (e) { /* ignore */ } masonObs = null; }
    masonEl = el;
    if (!el) return;
    try {
      masonObs = new MutationObserver(function () {
        try { layoutMasonry(); } catch (e) { /* ignore */ }
      });
      masonObs.observe(el, {attributes: true, childList: true, subtree: true});
      /* 挂上就立即排一次:冷启动首批卡(以及容器被整换后的幸存卡)不能再等
         refresh 的 250ms + masonry 的 120ms 节流 —— 那 ~370ms 里未定位的卡
         会先上屏,随后行位写入整屏挪位(实测 t=894 单卡 -185px)。同一微任务里
         排完,首个绘制帧就是定位后的位置。 */
      try { layoutMasonry(); } catch (e) { /* ignore */ }
    } catch (e) { masonObs = null; }
  }

  function masonry() {
    if (!WIDE.matches) { clearMasonry(); return; }
    if (masonTimer) return;
    masonTimer = setTimeout(function () {
      masonTimer = null;
      try { layoutMasonry(); } catch (e) { /* ignore */ }
    }, 120);
  }

  /* 卡片高度会在图片加载完成后变化:ResizeObserver 在 layout 之后、paint 之前
     回调,直接重排(不走 120ms 防抖),高度变化的那一帧就把同列下方顺移完 */
  try {
    if (window.ResizeObserver) {
      var masonRo = new ResizeObserver(function () {
        try { layoutMasonry(); } catch (e) { /* ignore */ }
      });
      new MutationObserver(function () {
        var wraps = document.querySelectorAll(MASON_SEL);
        for (var w = 0; w < wraps.length; w++) {
          var els = wraps[w].children;
          for (var i = 0; i < els.length; i++) {
            if (!els[i].__bwRo) { els[i].__bwRo = true; masonRo.observe(els[i]); }
          }
        }
      }).observe(document.documentElement, {childList: true, subtree: true});
    }
  } catch (e) { /* ignore */ }
  try { window.addEventListener('resize', function () { masonry(); }); } catch (e) { /* ignore */ }

  /* 路由派生的结构标记:只看 location.pathname,不碰 DOM,所以可以在注入的那一刻
     和每次 DOM 变异时同步打。原来这些标记要等 schedule() 的 250ms 节流跑完 refresh()
     才落,于是点开正文会先看到 0.2s 没有页边框的版式再跳成终版 —— 首帧就该是终态。
     refresh() 里仍会按同样的判据重算一遍(幂等),这里只负责"第一时间"。 */
  function syncRouteClasses() {
    try {
      var p = location.pathname;
      var deep = /^\/(status|detail|comments|attitudes)\//.test(p);
      var root = document.documentElement;
      if (!root) { return; }
      root.classList.toggle('bw-deep', deep);
      root.classList.toggle('bw-page-search', p.indexOf('/search') === 0 || p.indexOf('/s/') === 0);
      root.classList.toggle('bw-page-msg', p.indexOf('/msg') === 0 || p.indexOf('/message') === 0);
      root.classList.toggle('bw-page-me', p.indexOf('/profile') === 0 || p.indexOf('/my') === 0 || p.indexOf('/u/') === 0);
      root.classList.toggle('bw-page-home', !deep && !(p.indexOf('/search') === 0 || p.indexOf('/s/') === 0
        || p.indexOf('/msg') === 0 || p.indexOf('/message') === 0 || p.indexOf('/profile') === 0
        || p.indexOf('/my') === 0 || p.indexOf('/u/') === 0));
    } catch (e) { /* ignore */ }
  }
  syncRouteClasses();

  function refresh() {
    try {
      var p = location.pathname;
      var cur = 'home';
      if (p.indexOf('/search') === 0 || p.indexOf('/s/') === 0) cur = 'search';
      // 站点的消息路由是 /message,不是 /msg —— 之前只比 '/msg' 会漏判(高亮和版式都受影响)
      else if (p.indexOf('/msg') === 0 || p.indexOf('/message') === 0) cur = 'msg';
      else if (p.indexOf('/profile') === 0 || p.indexOf('/my') === 0 || p.indexOf('/u/') === 0) cur = 'me';
      var items = document.querySelectorAll('.bw-nav-item');
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute('data-k') === cur) items[i].classList.add('cur');
        else items[i].classList.remove('cur');
      }
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      /* "上滑收起悬浮件"只为手机那种底部横条存在:那条横栏会挡住内容。
         平板上导航是左侧竖栏、发博球贴右下角,两者分处两角、都不压内容,
         收起来反而让人随时找不到入口 —— 所以宽屏下不收起(顶栏在平板本来就随内容滚走) */
      var hidden = trackScroll(y) && !WIDE.matches;
      var navEl = document.getElementById('bw-nav');
      // 撰写页、正文页(正文/评论/点赞列表)与打开的视频层要沉浸式观看,隐藏悬浮件;
      // 这些页面/图层自带返回箭头,配合系统返回键足够退出。
      // 同时在 <html> 上打 bw-deep 标记,theme.js 据此套用正文页的大屏双栏布局
      var deep = /^\/(status|detail|comments|attitudes)\//.test(p);
      // 私信会话页(见下方 immersive 的注释)
      var chat = p.indexOf('/message/chat') === 0;
      document.documentElement.classList.toggle('bw-deep', deep);
      // 给 theme.js 一个明确的路由钩子,免得用 :has(结构选择器) 猜页面
      var root = document.documentElement;
      root.classList.toggle('bw-page-search', cur === 'search');
      root.classList.toggle('bw-page-msg', cur === 'msg');
      root.classList.toggle('bw-page-me', cur === 'me');
      root.classList.toggle('bw-page-home', cur === 'home' && !deep);
      /* 设置及其子页是另一套老架构(根节点 div#box、没有 #app),按结构标记而不是按路由猜:
         凡是带 .module-topbar 的页面都走 theme.js 里 html.bw-legacy 那一组版式 */
      root.classList.toggle('bw-legacy', !document.getElementById('app') && !!document.querySelector('.module-topbar'));
      /* 还有一批更老的"服务端直出页"(隐私设置 /setting/priset、屏蔽设置 /setting?tab=block、
         悄悄关注、编辑资料 /users/…?set=1、账号安全 security.weibo.com/account/security):
         既没有 #app 也没有 .module-topbar,根节点是 .m-container-max / #h5_page_wrap /
         裸 div>form / div.card11。全站那套 #app 作用域的边距/卡片规则一条都落不到
         它们身上,实测 1280 下内容是 750px / 640px 贴左、顶栏 797px 固定,像另一个 App。
         判据就按"没有 #app"来定:passport 与站外主机在文件头已经 return,老架构 #box 页
         由 bw-legacy 单独负责(它自己带 #box 的让位规则,再叠 bw-server 会变成双份顶距)。 */
      root.classList.toggle('bw-server', !document.getElementById('app') && !root.classList.contains('bw-legacy'));
      /* 设置首页还有第二种壳:从"我的"点设置进去是 Vue 路由页(#app + 一串 .lite-setup 行),
         直接输入 /home/setting 才是老架构 #box 页。Vue 那种的顶栏同样被我们收掉了,
         但站点留的 44px 让位带不够,左上返回球(14..56)会压住第一行 */
      root.classList.toggle('bw-setup', !!document.querySelector('.lite-setup'));
      /* "服务端直出的卡片页"(/p/<containerid>)是另一套老壳:根节点是 .m-container-max、
         没有任何 .main-wrap/.lite-topbar,顶部一条原生 .m-top-bar.m-topbar-max。
         典型入口是"我的 → 查看全部微博"(/p/230413…_-_WEIBO_SECOND_PROFILE_WEIBO)、
         话题聚合、榜单卡等。它既不是 bw-legacy(没有 .module-topbar)也不是
         /setting 那族 bw-server,于是路由标记兜底落成 bw-page-home —— 顶栏版式、
         卡片描边、条带全都没命中,整页还是站点原样(实测顶栏 rgb(245,245,245)、
         搜索框带 rgb(248,248,248)、卡片虽有 18px 圆角但没描边)。
         判据按结构定,不按路由猜:有 .m-top-bar 且没有 .main-wrap。 */
      root.classList.toggle('bw-cardpage',
        !!document.querySelector('.m-top-bar') && !document.querySelector('.main-wrap'));
      /* 头条文章页(card.weibo.com/article/m/show/…):也是 .m-container-max 壳,
         但版式要单独按阅读栏排,给 theme.js 一个结构标记 */
      root.classList.toggle('bw-article', !!document.querySelector('.m-feed .f-art, h2.f-art-tit'));
      killAppNags();
      masonry();
      watchFeed();
      /* 悬浮导航与发博按钮只在四个主 tab 出现,其余一律收掉:
         正文页 / 私信会话(那条输入框在常规流里,胶囊压上去实测重叠 388x39) / 撰写 /
         设置族(老架构 #box + 服务端直出子页) / 头条文章 / 超话 / 热搜条目页
         都自然落在 !isMainTab() 里,不用再逐个枚举。
         全屏看图与全屏视频层即使在主 tab 上也要临时收掉(悬浮件 z 比它们高)。 */
      var immersive = !isMainTab() || overlayOpen();
      if (navEl) {
        navEl.style.display = immersive ? 'none' : 'flex';
        navEl.classList.toggle('bw-scroll-hide', hidden);
      }
      var tb = document.querySelector('.lite-topbar.main-top');
      if (tb) {
        /* 玻璃底已在 theme.js 常驻(不再按滚动位置切换),这里只管上滑隐藏 */
        tb.classList.toggle('bw-hidden', hidden);
      }
      var fabEl = document.getElementById('bw-fab');
      if (fabEl) {
        fabEl.classList.toggle('bw-hide', immersive || !document.querySelector('.lite-iconf-releas'));
        fabEl.classList.toggle('bw-scroll-hide', hidden);
      }
      syncFloatChrome(deep, hidden);      syncDrop();
      fixSearchHint();
    } catch (e) { /* ignore */ }
  }

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      build();
      refresh();
      if (!cfgRequested) loadConfig(null);
    }, 250);
  }

  schedule();
  try {
    window.addEventListener('scroll', refresh, {passive: true});
    new MutationObserver(function () {
      /* 快路径:宽屏下信息流容器一出现(或被整换)就立刻挂专守,
         不等 schedule 的 250ms 节流;挂上时 layoutMasonry 同步排首批。
         判空 + isConnected 两个检查都很轻,每次变异批次只多一次函数调用。 */
      if (WIDE.matches && (!masonEl || !masonEl.isConnected)) {
        try { watchFeed(); } catch (e) { /* ignore */ }
      }
      syncRouteClasses();
      schedule();
    }).observe(document.documentElement, {
      childList: true, subtree: true
    });
  } catch (e) { /* ignore */ }
})();
