/**
 * pulse 悬浮导航栏注入脚本。
 * 手机:底部悬浮胶囊(首页/搜索/消息/我的);平板(≥768px):同组按钮变左侧悬浮栏。
 * 点击动作优先复用微博页内既有元素(隐藏的搜索/消息/我的按钮),
 * 页内没有该入口时按站点路由直达目标页,不再退回首页。
 */
(function () {
  if (!document.documentElement) return;

  /* 一份文档里只准有一套接管实例。注入侧 onPageStarted 与 onPageFinished 各来一遍
     (实测同一份文档最多进 5 次),而这套逻辑的状态(排布账本、观察器、悬浮件)都在
     闭包里 —— 第二套实例带着另一本账改写同一批卡片,两边交替把同一张卡写到不同的
     grid-column / grid-row 上:实测单页 1.2 万次对写、文档高来回抖 398px、渲染主线程
     100%、CDP 120s 不回话,用户看到的就是"微博自己挪位、页面卡住点不动、
     全屏图片停在页面上方关不掉"。
     守卫挂在 window 上:换文档(整页加载/刷新)时 window 是新的,自然重新注入。 */
  if (window.__bwNavReady) return;
  window.__bwNavReady = true;

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
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.8 4.4v5.4h-5.4"/></svg>'
  };
  var ITEMS = [
    {k: 'home', label: '首页', icon: ICONS.home},
    {k: 'search', label: '搜索', icon: ICONS.search},
    {k: 'msg', label: '消息', icon: ICONS.msg},
    {k: 'me', label: '我的', icon: ICONS.me}
  ];

  /* 刷新提示的"接力棒":首页图标缩小消失 → 环形进度条转满 → 环淡出 → 图标放大回来。
     环要严丝合缝压在图标上,所以给图标套一个 22x22 的相对定位壳(这两个节点都是
     我们自己造的,不动站点 DOM)。 */
  var RING = '<svg class="bw-ring" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle class="trk" cx="12" cy="12" r="8.5"></circle>' +
    '<circle class="arc" cx="12" cy="12" r="8.5"></circle></svg>';

  function build() {
    if (document.getElementById('bw-nav')) return;
    var nav = document.createElement('div');
    nav.id = 'bw-nav';
    var html = '';
    for (var i = 0; i < ITEMS.length; i++) {
      var ic = ITEMS[i].k === 'home'
        ? '<span class="bw-icowrap">' + ITEMS[i].icon + RING + '</span>'
        : ITEMS[i].icon;
      html += '<div class="bw-nav-item" data-k="' + ITEMS[i].k + '">' +
        ic + '<span>' + ITEMS[i].label + '</span></div>';
    }
    nav.innerHTML = html;
    document.documentElement.appendChild(nav);
    nav.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.bw-nav-item') : null;
      if (item) act(item.getAttribute('data-k'));
    });
    /* 收尾把类摘掉:留着状态不干净,而重启动画靠的是"摘了再加"。
       两条动画(图标 + 环)时长同值、同一帧结束,任一一条报结束都可以摘。 */
    nav.addEventListener('animationend', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.bw-nav-item') : null;
      if (item) item.classList.remove('bw-refreshing');
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

    /* 刷新球:站点自己在信息流上浮的那颗 .refresh-btn 被 theme.js 收掉了(手机右下角
       与发博球重叠才收的),这里把它还原成一颗看得见的圆球,只放在发博球正上方、
       与它同尺寸(样式全吃 --bw-fab-* 令牌,见 theme.js 的 #bw-fres)。
       行为一律代理给站点那颗控件,不复制:实测点它 = 回顶 + 按站点自己的窗口化口径
       重建首页流(padTop/padBottom 归零、卡片补回),自己 scrollTo(0) 反而会把
       窗口化列表甩在身后(见 dev-notes"回顶与下拉刷新")。
       只在平板出现(theme.js 里手机档 base 是 display:none)。 */
    var fres = document.createElement('div');
    fres.id = 'bw-fres';
    fres.innerHTML = ICONS.refresh;
    document.documentElement.appendChild(fres);
    fres.addEventListener('click', function (e) {
      e.stopPropagation();
      var btn = document.querySelector('.refresh-btn');
      if (btn) btn.click();
    });
  }

  /* 热搜结果页底部那条"和 N 人一起讨论"是站点的通栏 fixed 条,占掉屏幕底一条。
     这里让它改由右下角那颗悬浮球承担:球本身在这页让出 pointer-events,
     theme.js 把那条栏收成球大小的透明点击层垫在球下面 —— 用户那一记真点击
     落在站点自己的节点上,落点(该话题页)与上下文都不需要我们复制。
     (试过"藏掉栏 + 球去 .click()":这个控件对程序化 click 不响应,要真手势。)
     判据用头像域名:讨论那半的图是本人头像(tvax*.sinaimg.cn),
     "问智搜"那半是 simg.s.weibo.com 的运营图(已被 theme.js 收掉)。
     只在 /search 与 /s/ 生效 —— 超话页同一条栏维持原样。 */
  function searchDiscuss() {
    if (!/(^\/search)|(^\/s\/)/.test(location.pathname)) return null;
    var btns = document.querySelectorAll('.m-bar-panel .m-diy-btn');
    for (var i = 0; i < btns.length; i++) {
      /* 只看结构,不看可见性 —— 这条栏正是被我们用 display:none 收掉的,
         按可见性判会自我拆台(球接管后判不到 → 类被摘掉 → 栏又冒出来)。
         点击不需要元素可见:站点自己那条 .lite-iconf-releas 也是 0x0 的隐藏节点 */
      if (btns[i].querySelector('img[src*="sinaimg.cn"]')) return btns[i];
    }
    return null;
  }

  var OFF_PAGE_URL = {
    search: 'https://m.weibo.cn/search?containerid=231583',
    msg: 'https://m.weibo.cn/message'
  };

  /* 撰写页的图标:站点用的是自家 iconfont(wb440),笔画与全站悬浮件那套线性 SVG
     (24 格 / 1.8 描边 / 圆头,与发博球的铅笔同源)不是一套。这里只往站点已有的按钮里
     **追加**一个 svg 并打 data-bw-ico(字形由 theme.js 用 ::before{content:none} 关掉),
     不搬节点、不改结构、不碰点击 —— Vue 之后重渲染也不会跟我们抢 DOM。
     注意:站点会在同一颗控件上换 class —— 表情面板展开时 `lite-iconf-emote`→`lite-iconf-edit`,
     可见性循环时 `iconf_compose_earth`→`heart`→`lock`。所以这些状态都要各配一枚图形,
     且要按"当前命中的 class"重画(见 paintComposeIcons 里的 key 判定),否则会停在旧图标。 */
  var COMPOSE_ICONS = {
    'lite-iconf-pic': '<rect x="3" y="4.5" width="18" height="15" rx="3"></rect>' +
      '<circle cx="8.6" cy="9.8" r="1.7"></circle><path d="M21 15.3l-4.7-4.5-9.6 8.9"></path>',
    'lite-iconf-emote': '<circle cx="12" cy="12" r="8.6"></circle>' +
      '<path d="M8.7 14.1a4.3 4.3 0 0 0 6.6 0"></path><path d="M9.3 9.9h.01M14.7 9.9h.01"></path>',
    'lite-iconf-edit': '<rect x="2.6" y="6.6" width="18.8" height="10.8" rx="2.6"></rect>' +
      '<path d="M6.4 10.2h.01M9.6 10.2h.01M12.8 10.2h.01M16 10.2h.01' +
      'M6.4 13.4h.01M9.6 13.4h.01M12.8 13.4h.01M16 13.4h.01"></path>' +
      '<path d="M8.4 15.6h7.2"></path>',
    'iconf_compose_earth': '<circle cx="12" cy="12" r="8.6"></circle>' +
      '<path d="M3.4 12h17.2"></path><path d="M12 3.4c2.5 2.6 2.5 14.6 0 17.2M12 3.4c-2.5 2.6-2.5 14.6 0 17.2"></path>',
    'iconf_compose_heart': '<path d="M12 20.1l-6.8-6.6a4.6 4.6 0 0 1 6.4-6.6l.4.4.4-.4a4.6 4.6 0 0 1 6.4 6.6z"></path>',
    'iconf_compose_lock': '<rect x="4.6" y="10.6" width="14.8" height="9.4" rx="2.6"></rect>' +
      '<path d="M8.2 10.6V8.4a3.8 3.8 0 0 1 7.6 0v2.2"></path>'
  };

  /* 只画撰写页(.m-main)那一排。原来按类名全文档扫,私信会话页底部的
     <i class="lite-iconf-pic/_emote"> 也被扫到 —— 那两颗的站点字形是画在 i 自己的
     ::before 上,而 theme.js 关字形的规则只罩 h4[data-bw-ico]::before,于是我们的 svg
     与站点的字形并排出现(用户报"表情与图片图标重复")。会话页那两颗归站点自己画。 */
  function paintComposeIcons() {
    for (var k in COMPOSE_ICONS) {
      if (!Object.prototype.hasOwnProperty.call(COMPOSE_ICONS, k)) continue;
      var list = document.querySelectorAll('.m-main .' + k);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        /* 一颗控件可能同时命中多个 key 的历史残留,取它 class 上当前真正有的那一个 */
        var key = '';
        for (var j = 0; j < el.classList.length; j++) {
          if (Object.prototype.hasOwnProperty.call(COMPOSE_ICONS, el.classList[j])) { key = el.classList[j]; break; }
        }
        if (key !== k || el.getAttribute('data-bw-ico') === key) continue;
        el.setAttribute('data-bw-ico', key);
        var box = el.querySelector('.bw-ico:not(.bw-caret)');
        if (!box) {
          box = document.createElement('span');
          box.className = 'bw-ico';
          el.insertBefore(box, el.firstChild);
        }
        box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round">' + COMPOSE_ICONS[key] + '</svg>';
      }
    }
  }

  /* 站点换按钮语义时只改 class(表情⇄键盘、地球⇄心⇄锁),不改节点 ——
     主观察器只看 childList,这类变化不会触发 refresh,图标就会停在旧的那枚
     (实测切到"好友圈"仍是地球)。所以给撰写页单独挂一个只看 class 属性的观察器。
     只监听 attributeFilter:class,我们自己写的 data-bw-ico 不会反过来触发它。 */
  var icoObs = null;
  function watchComposeIcons() {
    var host = document.querySelector('.m-main');
    if (!host || (icoObs && icoObs.__el === host)) return;
    try {
      if (icoObs) icoObs.disconnect();
      icoObs = new MutationObserver(function () {
        try { paintComposeIcons(); paintComposeCaret(); } catch (e) { /* ignore */ }
      });
      icoObs.observe(host, {attributes: true, subtree: true, attributeFilter: ['class']});
      icoObs.__el = host;
    } catch (e) { icoObs = null; }
  }

  /* 站点让输入框自增靠的是一面克隆 textarea(absolute + z-index:-9999 + visibility:hidden),
     它读克隆的 scrollHeight 再写回可见那颗的 height。问题是克隆是绝对定位的,
     宽度落到整行(实测 391)而不是可见那颗的 311 —— 同样一段字在克隆里少绕几行,
     报回来的数就偏小,输入框比自己的内容矮一截(实测内容 206、框 177),字被吃掉一行。
     把克隆的宽度钉成可见那颗的宽度,量出来的高度才是真的。 */
  function syncComposeMirror() {
    var all = document.querySelectorAll('.m-wz-def textarea');
    if (all.length < 2) return;
    var vis = null, mir = null;
    for (var i = 0; i < all.length; i++) {
      if (getComputedStyle(all[i]).zIndex === '-9999') mir = all[i]; else vis = all[i];
    }
    if (!vis || !mir) return;
    var w = Math.round(vis.getBoundingClientRect().width);
    if (w > 10 && mir.style.width !== w + 'px') mir.style.width = w + 'px';
  }

  /* 撰写页点缩略图看大图:站点那条路被 `if (this.isPCPlatform)` 挡死(那颗 computed 读
     navigator.platform 与 ontouchstart),而它要发的 mvGallery 挂在一条独立的事件总线上 ——
     不在组件树里,实测从 self/parent/root 逐个 $emit 都没人接。所以只把这一颗组件实例上的
     isPCPlatform 顶成 true,站点自己的 @click 就通了,不另造看图层。
     副作用只有 addPhoto 里那句 `isPCPlatform || URL.revokeObjectURL(src)`:blob 不被提前
     回收 —— 正好让放大那张有源可取(实测 slide 用的是上传回来的 CDN 直链)。 */
  function allowComposeThumbnails() {
    var host = document.querySelector('.image-list');
    if (!host) return;
    var v = null, n = host;
    while (n && !v) { v = n.__vue__; n = n.parentElement; }
    if (!v || v.__bwPc) return;
    try {
      Object.defineProperty(v, 'isPCPlatform',
        {configurable: true, get: function () { return true }});
      v.__bwPc = true;
    } catch (e) { /* ignore */ }
  }

  function closeGallery() {
    var b = document.querySelector('.pswp__button--close');
    if (b) { b.click(); return; }
    var p = document.querySelector('.pswp');
    if (p) p.style.display = 'none';
  }
  /* 看图浮层不产生历史记录,原生返回回调开着它时要先关浮层,否则会直接跳出这一页 */
  window.__bwCloseGallery = closeGallery;

  /* .pswp 那颗节点是常驻的(收起只是 display:none),所以盯它自己:
     class/style 一变就同步一次状态,不等 refresh 的 250ms 防抖。 */
  var pswpObs = null, galleryWasOpen = null, obsLayer = null;
  function syncGalleryOverlay() {
    var open = pswpOpen();
    /* 只在真的换态时过一趟 JS→Java 桥:原来每次调用都无条件报一遍,
       而调用方是滚动事件 + 每 250ms 的调度 + .pswp 的变异观察器。 */
    if (open !== galleryWasOpen) {
      galleryWasOpen = open;
      if (window.BwNative && window.BwNative.setGalleryOpen) {
        try { window.BwNative.setGalleryOpen(open); } catch (e) { /* ignore */ }
      }
      /* 收起的那一刻补排:浮层开着时 layoutMasonry 直接 return(见那里的守卫),
         关掉的瞬间信息流要回到接管态。站点自己的收合动画还要跑几百毫秒,
         期间它写的仍是单列口径的行位,所以过后再补一次,别停在半程状态。
         换态才补,不在每帧的 class/style 变异里补。 */
      if (!open) {
        try { masonry(); } catch (e) { /* ignore */ }
        setTimeout(function () { try { masonry(); } catch (e) { /* ignore */ } }, 420);
      }
    }
    var p = document.querySelector('.pswp');
    if (!p) {
      if (pswpObs) { try { pswpObs.disconnect(); } catch (e) { /* ignore */ } pswpObs = null; }
      return;
    }
    if (!pswpObs) {
      try {
        /* 这一趟除了报状态给原生，还要把悬浮件按当前浮层态摆回去(overlayEdge)：
           浮层的开合一刀就写在这两个属性上，盯住它们才不依赖 refresh 什么时候再来。 */
        pswpObs = new MutationObserver(function () {
          syncGalleryOverlay();
          overlayEdge(overlayOpen());
        });
        /* 只看 .pswp 自己的 class/style —— 开关态就写在这两个属性上。
           原来带 subtree:true,而 PhotoSwipe 拖动时**每帧**都在写后代的 transform,
           实测一次拖动手势里观察器进 60 次、每次一趟强制重排;漏掉的态还有
           refresh()(滚动 + 250ms 调度)兜着。 */
        pswpObs.observe(p, {attributes: true, attributeFilter: ['class', 'style']});
      } catch (e) { pswpObs = null; }
    }
    /* 全屏视频层同样只把开关态写在 class/style 上，一起盯；它是常驻节点，
       第一次进来才挂上(挂过就不重复 observe 同一个元素) */
    var ly = document.querySelector('.mwb-layer');
    if (pswpObs && ly && ly !== obsLayer) {
      obsLayer = ly;
      try { pswpObs.observe(ly, {attributes: true, attributeFilter: ['class', 'style']}); } catch (e) { /* ignore */ }
    }
    /* 左上角返回胶囊:站点自己的关闭键在右上,这条补的是"左上角也能退"。
       只在撰写页放 —— 信息流看图没这个要求,不去改它既有的样子。 */
    var chip = p.querySelector('.bw-pswp-back');
    var want = open && !!document.querySelector('.m-reles-top');
    if (want && !chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bw-pswp-back';
      chip.setAttribute('aria-label', '返回');
      chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"></path></svg>';
      chip.addEventListener('click', closeGallery);
      p.appendChild(chip);
    } else if (!want && chip) {
      chip.remove();
    }
  }

  /* 编辑卡按规则铺到功能区上方之后,卡里有一大块是空白,而站点只在 textarea 那一小截
     上响应点击 —— 空白处点了没反应会像坏了。补一条:点在卡里的非交互区域就把光标交给输入框。 */
  function watchComposeFocus() {
    var card = document.querySelector('.m-reles-nr');
    if (!card || card.__bwFocusBound) return;
    card.__bwFocusBound = true;
    card.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || t.closest('a,button,input,label,textarea,.bw-avatar')) return;
      var ta = document.querySelector('.m-reles-con textarea');
      if (ta && document.activeElement !== ta) {
        try { ta.focus(); } catch (err) { /* ignore */ }
      }
    });
    /* 输入时先在捕获阶段把克隆那颗的宽度钉好 —— 站点的自增就在这次 input 里量,
       等不到下一次 refresh */
    card.addEventListener('input', function () { syncComposeMirror(); }, true);
  }

  /* 站点给的"公开"只有一个地球图标 + 两个字,读起来像两件东西、也不知道能点。
     在字样后面补一枚矢量下拉箭头,让"地球 + 公开 + ▾"读成一个可见性选择器。 */
  function paintComposeCaret() {
    var list = document.querySelectorAll('.m-fcb-col .visible h4');
    for (var i = 0; i < list.length; i++) {
      if (list[i].querySelector('.bw-caret')) continue;
      var box = document.createElement('span');
      box.className = 'bw-ico bw-caret';
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 9.8 12 15.2l5.6-5.4"></path></svg>';
      list[i].appendChild(box);
    }
  }

  /* 头像从顶栏搬进编辑卡左上角:不搬站点那个 <img>(它在 Vue 手里,搬走会和它的
     重渲染抢 DOM),而是插一个我们自己的 img,src 每次刷新时从站点那颗同步。
     外面再套一层我们自己的圆盒 —— 尺寸/圆角/外边距都挂在壳上,不挂在 img 上:
     dark_fix.js 那条"圆形小头像躲反相"的兜底会把命中的 img 放大到 600% 再 scale 回来,
     边距若留在 img 上会被一起推开(实测头像被顶出圆盒、下沿被裁,看着"不圆且显示不全");
     壳与原图同尺寸时兜底只给壳补 overflow:hidden,不会再套第二层壳,位置就稳了。 */
  function placeComposeAvatar() {
    var card = document.querySelector('.m-reles-nr');
    var src = document.querySelector('.m-ruser-img');
    if (!card || !src || !src.src) return;
    var box = card.querySelector('.bw-avatar');
    if (!box) {
      box = document.createElement('span');
      box.className = 'bw-avatar';
      var im = document.createElement('img');
      im.alt = '';
      box.appendChild(im);
      card.insertBefore(box, card.firstChild);
    }
    var img = box.querySelector('img');
    if (img && img.getAttribute('src') !== src.src) img.setAttribute('src', src.src);
  }

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

  /* 刷新反馈:让首页那颗图标与环接力(动画本体在 theme.js 的 .bw-refreshing 那组)。
     只在这一支调用 —— 回顶那一支有滚动当反馈,不该再动。
     重触发必须"摘类 → 强制回流 → 加类":只加类名时浏览器认为动画已经在跑,
     连着两次刷新就只有第一次会动。void offsetWidth 是同步把那次摘类落地。 */
  function cueRefresh() {
    var it = document.querySelector('.bw-nav-item[data-k="home"]');
    if (!it) return;
    it.classList.remove('bw-refreshing');
    void it.offsetWidth;
    it.classList.add('bw-refreshing');
  }

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
          if (btn) {                 /* 已在顶部:第二下 = 站点语义的"刷新信息流" */
            cueRefresh();
            btn.click();
          }
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
    /* 和 pswpOpen/sheetOpen 一样先看可见性再量尺寸:这一层收起来时站点通常把尺寸塌成 0x0，
       但不是每条路径都塌(实测它的内联 display:none 要等自身收合动画结束才写)。
       只量尺寸的话，一层"显示不出来但仍占满屏"的壳就能把悬浮件永久按住。 */
    if (el.style.display === 'none') return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
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
    /* 站点收起时写的是内联 display:none —— 先读内联值就能判掉,省一次强制重排。
       这条不是微优化:syncGalleryOverlay 挂在 refresh() 上,每个滚动事件都要进来
       一趟(实测单页 3114 次),每次都 getComputedStyle + getBoundingClientRect。 */
    if (el.style.display === 'none') return false;
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

  /* 最近一次 overlayOpen() 读到的"黑底那两层"状态。留这个数而不是让 syncMediaBars
     自己再判一遍:两个分量各要一次 querySelector + 可能两次 getComputedStyle,
     而 refresh 挂在每个滚动事件上(profiler 里 pswpOpen 一项就占 2.4%),不能量两遍。 */
  var mediaLayerWasOpen = false;

  function overlayOpen() {
    /* 黑底满屏的那两层先单独记一笔,给 syncMediaBars 用(见那里的注释) */
    var media = videoLayerOpen() || pswpOpen();
    mediaLayerWasOpen = media;
    /* 卡片"..."菜单那层是白底面板,只算"有东西压住悬浮件",不算黑底 */
    return media || sheetOpen();
  }

  /* 系统栏那两条带是原生画的(网页被 content_holder 的 padding 顶在状态栏下面)。
     黑底那两层开着时不换,黑屏上面就压着一条页面底色 —— 实测深色 17 压 0、浅色 241 压 0。 */
  var mediaBarsSent = null;
  function syncMediaBars() {
    if (mediaLayerWasOpen === mediaBarsSent) return;
    if (!window.BwNative || !BwNative.setMediaBars) return;
    try {
      BwNative.setMediaBars(mediaLayerWasOpen);
      mediaBarsSent = mediaLayerWasOpen;
    } catch (e) { /* ignore */ }
  }

  /* 悬浮导航与发博按钮的显隐：只看"是不是主 tab"+"有没有浮层压在上面"。
     从 refresh() 里摘出来单独成函数，是因为浮层的开合一刀不能等 refresh —— 见 overlayEdge。 */
  var lastHidden = false;

  function syncOverlayChrome(ov) {
    var immersive = !isMainTab() || ov;
    var navEl = document.getElementById('bw-nav');
    if (navEl) {
      navEl.style.display = immersive ? 'none' : 'flex';
      navEl.classList.toggle('bw-scroll-hide', lastHidden);
    }
    var root = document.documentElement;
    var fabEl = document.getElementById('bw-fab');
    var disc = searchDiscuss();
    /* 有那条讨论栏时:球顶替它(主题样式在 theme.js 按这个类切换) */
    root.classList.toggle('bw-fab-disc', !!disc);
    if (fabEl) {
      fabEl.classList.toggle('bw-hide',
        disc ? ov : (immersive || !document.querySelector('.lite-iconf-releas')));
      fabEl.classList.toggle('bw-scroll-hide', lastHidden);
    }
    /* 刷新球只在"站点自己那颗 .refresh-btn 在页里"时放出 —— 它是那颗控件的替身,
       没有替身对象就没有落点。讨论条那页(球顶替讨论条)也不算信息流页,一并收掉。
       与发博球同一处判定,免得两条路各判各的、错开 250ms。 */
    var fresEl = document.getElementById('bw-fres');
    if (fresEl) {
      fresEl.classList.toggle('bw-hide',
        !!disc || immersive || !document.querySelector('.refresh-btn'));
    }
  }

  /* 浮层换态的那一刻要自己把悬浮件摆回去，不能等下一趟 refresh：
     refresh 只由滚动、路由变化和 childList 变异驱动，而站点收起看图器写的是
     .pswp 自己的 class/style —— 属性变异进不了那条观察器。实测平板首页关掉大图：
     判定在 494ms 就翻成"没开"，导航栏到 746ms 才回来，中间那 252ms 全靠
     信息流顺带重排产生的 childList 补了一脚。那一脚没来（收合时页面正好没有
     增删节点），导航栏和发博球就一直躺着 —— 用户看到的就是"关掉图片后左侧
     导航和右下角发博球没了"。 */
  var ovWasOpen = null;

  function overlayEdge(ov) {
    /* 黑底那两层的换态不等合计 ov 的边沿:看图器关掉的同时卡片菜单可能正开着,
       ov 一直是 true,而系统栏该换回页面底色。放在这里是因为 refresh 与
       .pswp/.mwb-layer 的观察器两条路都过这里。 */
    syncMediaBars();
    if (ov === ovWasOpen) return;
    ovWasOpen = ov;
    syncOverlayChrome(ov);
    /* 收起这一头沿用看图器收合动画的时长再补一次：动画期间尺寸还是满屏 */
    if (!ov) {
      setTimeout(function () {
        syncOverlayChrome(overlayOpen());
        syncMediaBars();
      }, 420);
    }
  }

  /* 站点的"打开APP查看更多精彩内容"引导:WOUI 的 .woo-modal(z9999 满屏)
     带一层 .woo-modal__mask(z999),超话页进去就是它盖住整屏,不点"取消"什么都动不了。
     只按类名一刀切会连带杀掉别的确认框,所以按文案识别:
     命中"打开APP/查看更多精彩内容/APP内打开"这类话的大块浮层才收 ——
     真确认框的文案不会带这些字。文案超过 120 字的也不动(那是页面本体)。 */
  var NAG_RE = /(打开|前往|进入|使用)\s*(微博)?\s*(APP|App|app)|查看更多精彩内容|(APP|App)\s*内(打开|查看)|下载\s*(微博)?\s*(APP|App|app)|微博内打开/;

  /* 限流:这一趟要遍历全文档(实测滚动中的首页 820 个 div + 上千个 a/span/button),
     逐个 getComputedStyle 并取 rect —— CPU profiler 实测占滚动期主线程 **9.4%**,
     是排布之外的第一热点。而它要收的是"打开 APP"引导弹层,那是换页/换路由才出现的
     东西,与滚动无关;refresh 又挂在每个滚动事件上,等于一直在做无用功。
     250ms 一次足够(弹层多活 0.25s 看不出来)。 */
  var nagAt = 0;
  function killAppNags() {
    if (!document.body) return;
    var now = Date.now();
    if (now - nagAt < 250) return;
    nagAt = now;
    var all = document.body.getElementsByTagName('div');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      /* 判据顺序要"从便宜到贵":原来第一句就是 getComputedStyle,而它正是这条
         循环的全部成本(整页 800+ 个 div 每个都算一次)。文案与长度两条都不碰样式,
         先把绝大多数 div 排掉,再对少数候选算样式/取 rect。 */
      if (e.style.display === 'none') continue;
      var t = (e.textContent || '').replace(/\s+/g, ' ');
      if (t.length > 120 || !NAG_RE.test(t)) continue;
      var cs = window.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var z = parseInt(cs.zIndex, 10) || 0;
      if (z < 500) continue;
      var r = e.getBoundingClientRect();
      if (r.width < window.innerWidth * .5 || r.height < window.innerHeight * .25) continue;
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
      var e2 = nodes[k];
      /* 同上:文案判据放到样式之前。NAG_TEXT 是**整串精确匹配**,长度天然受限,
         不必另设长度上限 —— 设了反而会误伤模板里带缩进/换行的节点(去空白前的
         长度会超)。取值用 `=== 1` 而不是直接取真值:对象字面量继承 Object.prototype,
         节点文案恰好是 "constructor" 之类时会误命中。 */
      var t2 = (e2.textContent || '').replace(/\s+/g, '').trim().toLowerCase();
      if (NAG_TEXT[t2] !== 1) continue;
      if (e2.style.display === 'none') continue;
      var cs2 = window.getComputedStyle(e2);
      if (cs2.display === 'none') continue;
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

  /* 站点的编辑条/表情面板在 body 上挂 touchstart 做"点到框外就收起"。这里补一次这种
     触摸:target 直接给 body —— 它只被 body 及其祖先上的监听收到,不会命中任何站内控件,
     所以不会顺手点到别的东西。 */
  function tapOutsideBody() {
    try {
      var t = new Touch({identifier: 1, target: document.body, clientX: 1, clientY: 1});
      document.body.dispatchEvent(new TouchEvent('touchstart', {
        bubbles: true, cancelable: true, touches: [t], changedTouches: [t]}));
      return true;
    } catch (e) { return false; }
  }

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
        if (!def) return;
        var target = document.querySelector(def.sel);
        if (target) { target.click(); return; }
        /* 评论框一展开,站点就把折叠那一排整排摘掉(换成 .composer-mini-wrap),
           转发/赞的目标节点临时不在 DOM 里 —— 直接返回就是"按了没反应"。
           收起这一步站点自己听的是 body 上的 touchstart(组件里 emit update:show),
           而我们的操作条挂在 documentElement 上:真触摸从这儿向上找不到 body 就抛了,
           收不掉。所以这里补一次"点到框外",等站点把折叠排挂回来再点它。
           实测:补的那一下 touchstart 之后,下一个微任务里 .box-left 就已经在了。 */
        var ta = document.querySelector('.lite-page-editor textarea');
        if (!ta) return;
        if (def.k === 'cmt') {
          /* 已经展开了,再点评论就是把光标交回输入框(不该收起重开,那会清掉正在写的字) */
          try { ta.focus(); } catch (err) { /* ignore */ }
          return;
        }
        if (!tapOutsideBody()) return;
        setTimeout(function () {
          var el = document.querySelector(def.sel);
          if (el) el.click();
        }, 0);
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
        if (t.closest && t.closest('#bw-nav, #bw-fab, #bw-fres, #bw-fback, #bw-fset, #bw-acts')) return;
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

  /* 搜索壳(返回钮 + 搜索框)该不该收起。判据一句话:分类条离屏顶还有几像素。
     站点正是"到顶"那一刻给 .module-page-fragment 挂 fixed,两者同一帧换 ——
     壳收下去、条子接上,中间不留空档。
     实现上顶边只能自己记账(在常规流里读一次 rect,钉住时 rect 恒为 0 读不到真值),
     然后 记到的文档顶边 - scrollY 与 6 比。前两版各栽在一半:
       - 直接读站点的 fixed 类:那个类由站点写、摘得比我们这次求值晚,快速上滑停手时
         最后一帧看到的还是 fixed=true,收起态就被留在 on(2026-09-30"上滑过快,搜索框回不来");
       - 账是对的,但拿它去跟"壳的底边"比:壳是 sticky 的,`offsetTop - scrollY + offsetHeight`
         得到的是它在**文档里**的底边(实测 58),而 `文档顶边 - scrollY` 是**视口**坐标,
         两个坐标系混着比再加 10+24 的提前量,阈值抬到 92 —— 这条页分类条本来只从文档 68
         起头,于是 y=0 就判成"到顶",一进去壳就是收着的、上滑也回不来(2026-10-02 用户报的这条)。
     没有分类条(或没有搜索壳)的页面一律不收 —— 那等于把改关键词的入口弄丢。 */
  var FRAG_TOP_LEAD = 6;
  var fragDocTop = null;
  function searchHeadAtTop() {
    var shell = document.querySelector('.ntop-nav');
    var bar = document.querySelector('.m-top-nav');
    if (!shell || !bar) { fragDocTop = null; return false; }
    var frag = (bar.closest && bar.closest('.module-page-fragment')) || bar;
    var r = frag.getBoundingClientRect();
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    /* 记账只在常规流里做:条子被钉住时 rect 恒为 0,读不到它真实的位置。
       站点摘 fixed 的时机排在我们这次求值之后 —— 那一帧类还在、rect 也还是 0,
       跳过记账正好躲开它,判据用的是上一次记到的文档坐标。 */
    if (r.height && !frag.classList.contains('fixed')) fragDocTop = r.top + y;
    if (fragDocTop === null) return frag.classList.contains('fixed');
    // 两个量都在视口里比:差几像素就到顶,与站点挂 fixed 那一刻对齐
    return fragDocTop - y <= FRAG_TOP_LEAD;
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
    /* 读内容的页面(正文页 / 个人主页与博主主页 / 服务端直出的卡片页):左上返回球
       一直压在正文上 —— 与首页那套悬浮件一样沿用上滑收起的锁存状态(下滑立刻放出)。
       私信会话页不在名单里:那条页面唯一的出口就是这颗球,而且它本来也不滚。
       评论框展开时不能收:那是人正在打字,收掉等于把输入框从他手里抽走。 */
    var hcls = document.documentElement.classList;
    var reading = deep || hcls.contains('bw-page-me') || hcls.contains('bw-cardpage');
    var chrome = hidden && reading && !hcls.contains('bw-editor-open');
    fb.classList.toggle('bw-scroll-hide', chrome);
    set.classList.toggle('bw-scroll-hide', chrome);
    if (editor) editor.classList.toggle('bw-scroll-hide', chrome);
    /* 卡片页(博主主页那一族)底部那条站点自己的操作栏(已关注/私信/热门)跟着同一把锁
       —— 它是这一页唯一的底部控件,读内容时和上面三件一起让开,反向一滚立刻放回。
       只给这一族:搜索页那条讨论栏也是 .m-tab-bar.m-bar-panel,不在本次需求里。
       平板档不打(那条要么整条不出现、要么居中在条带里,位移语义不一样)。 */
    var tbar = document.querySelector('.m-tab-bar.m-bar-panel');
    if (tbar) tbar.classList.toggle('bw-scroll-hide', chrome && !wide && hcls.contains('bw-cardpage'));
    /* 搜索/热搜条目页:收起左上返回钮与搜索框,让分类条自己顶到屏顶。
       时机不再跟悬浮件那套锁存 —— 固定 200px 与"分类条到没到顶"根本不对齐
       (实测这条页分类条在 scrollY≈99 就吸住了,原来要等到 200 才收,
       中间那 100px 就是用户报的"条已经到顶了搜索框还杵在那儿")。
       改由 searchHeadAtTop 按分类条自己的位置判,上滑回去也按同一个位置放。
       只在手机档:平板档这一页没有常驻顶栏(搜索壳不吸顶、分类条改左侧竖栏,
       见 theme.js 大屏段),没有要收的东西。 */
    var collapse = !wide && hcls.contains('bw-page-search') && searchHeadAtTop();
    hcls.toggle('bw-bar-collapse', collapse);
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

  /* 搜索页分组条:12 项 676px 装在 391px 内容列里,尾巴必然被圆角切一半。
     站点自己那条 .scroll-box.nav_item 是 overflow-x:scroll(实测真手势能从 0 滑到 202,
     点选时也会把选中项滚进视野 —— 0→173),所以**能滑**、只是**没有任何线索**。
     这里只补两件事,不去平行造站已有的机制:
     ① 按当前滑动位置给两端打 bw-tab-more-left / -right 标记,
        theme.js 用 mask 把"还有内容"的那一端淡出(纯 alpha 合成,不参与加深的颜色映射);
     ② 选中项因**非点击**的原因变化时(切页签后返回、深链落在靠后的分类)滚进视野。
        只在选中项文字真的变了的那一次动手 —— 用户手动横滑浏览时绝不干预。 */
  var tabStripSel = null;
  function syncTabStrip(bar) {
    var box = bar.querySelector('.scroll-box.nav_item') || bar;
    var max = box.scrollWidth - box.clientWidth;
    var x = box.scrollLeft;
    bar.classList.toggle('bw-tab-more-left', x > 2);
    bar.classList.toggle('bw-tab-more-right', x < max - 2);
    if (!box.__bwTabScroll) {
      box.__bwTabScroll = true;
      try { box.addEventListener('scroll', function () { syncTabStrip(bar); }, { passive: true }); } catch (e) { /* ignore */ }
    }
    var cur = bar.querySelector('li.m-cur');
    var key = cur ? (cur.textContent || '').trim() : '';
    if (!key || key === tabStripSel) return;
    tabStripSel = key;
    if (!cur) return;
    var cr = cur.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (cr.left >= br.left - 1 && cr.right <= br.right + 1) return;   // 已经看得见,别抢用户的滑动
    box.scrollLeft = Math.max(0, Math.min(max,
      x + (cr.left - br.left) - (br.width - cr.width) / 2));
  }
  function syncSearchTabStrip() {
    var bar = document.querySelector('.m-top-nav');
    if (bar) syncTabStrip(bar);
  }

  /* 一条微博超过 9 张图:只显示前 8 张,第 9 格换成一块同样大小的 "+x" 面牌
     (x = 被藏起来的张数)。点面牌跳到第 9 张 —— 面牌自己不吃点击
     (pointer-events:none),按下落到第 9 格那张图上,走站点自己的看图链路
     (实测点第 5 格 → #&gid=1&pid=5、计数器 "5 / 12"),不模拟点击也不拼路由。
     正好 9 张(以及更少的)一律不动。 */
  var NINE_KEEP = 8;
  var DEEP_RE = /^\/(status|detail|comments|attitudes)\//;
  function clampNineGrid() {
    /* 只管列表卡。正文页(/status|/detail|/comments|/attitudes)一条都不动 ——
       用户要的是"列表里收一下,点进去有多少张显示多少张";再加一道结构闸
       (必须挂在列表卡 .wb-item-wrap 里),正文页那套媒体本来也不在这个壳里。 */
    if (DEEP_RE.test(location.pathname)) return;
    var lists = document.querySelectorAll(
      '.wb-item-wrap .weibo-media-wraps ul.m-auto-list');
    for (var i = 0; i < lists.length; i++) {
      var ul = lists[i];
      var n = ul.children.length;
      if (n <= 9) {
        if (ul.__bwClamp !== n) { ul.__bwClamp = n; ul.__bwTile = null; }
        continue;
      }
      if (ul.__bwClamp === n && ul.__bwTile && ul.__bwTile.isConnected) continue;
      ul.__bwClamp = n;
      var tile = null;
      for (var k = NINE_KEEP; k < n; k++) {
        var li = ul.children[k];
        if (k === NINE_KEEP) {
          li.style.display = '';
          tile = moreTile(li, n - NINE_KEEP);
        } else {
          if (li.style.display !== 'none') li.style.display = 'none';
        }
      }
      ul.__bwTile = tile;
    }
  }

  /** 在第 9 格的图盒上盖一块 "+x" 面牌(格子的圆角/裁切由站点那层 .m-img-box 自带) */
  function moreTile(li, hidden) {
    var box = li.querySelector('.m-img-box') || li;
    var t = box.querySelector('.bw-more');
    if (!t) {
      t = document.createElement('div');
      t.className = 'bw-more';
      box.appendChild(t);
    }
    var txt = '+' + hidden;
    if (t.textContent !== txt) t.textContent = txt;
    return t;
  }

  /* ---- 路由回来时列表整棵重建:先把图的位置按原高钉住,别让内容上下跳 ----
     实测(搜索页 → 点一条正文 → 返回):返回后 87/87 个 <img> 都是新节点,当帧 53/93 张
     没就绪;没回来的那张把盒子从 115.4 塌成 17,一页里几张这样的卡先后长回来,
     scrollY 一直停在 420 不动、内容却上下挪(实测文档高 6508→7091→6710→6941 来回)。
     站点自己的九宫格有 .m-imghold-* 占位,塌的只是 OG 单图这类"高度由图撑"的盒。
     办法:按 src 记住加载完成后的显示高,新节点没解码回来之前先写死这个高,
     load 回来立刻摘掉(摘掉的那一帧高度与钉住值同一档,看不出动)。
     钉按 src+显示宽配,避免同一张图在别处是小缩略图时被钉错。 */
  var IMG_H = Object.create(null);
  var IMG_N = 0;
  function imgKey(im) {
    var src = im.currentSrc || im.src;
    if (!src || src.indexOf('data:') === 0) return null;
    return src;
  }
  function noteImg(im, src) {
    var r = im.getBoundingClientRect();
    var h = Math.round(r.height * 10) / 10, w = Math.round(r.width * 10) / 10;
    if (!(h > 1) || !(w > 1)) return;
    if (!IMG_H[src]) IMG_N++;
    IMG_H[src] = [w, h];
    // 一次会话里别攒太多:超量就整本重记(代价是再滚一趟列表才重新有账)
    if (IMG_N > 900) { IMG_H = Object.create(null); IMG_N = 0; }
  }
  function holdImg(im) {
    var src = imgKey(im);
    if (!src) return;
    if (im.complete && im.naturalWidth) {
      if (im.__bwHoldH) { im.__bwHoldH = 0; im.style.height = ''; }
      if (!IMG_H[src]) noteImg(im, src);
      return;
    }
    var rec = IMG_H[src];
    if (!rec) return;
    if (Math.abs(im.getBoundingClientRect().width - rec[0]) > 2) return;
    if (im.__bwHoldH === rec[1]) return;
    im.__bwHoldH = rec[1];
    im.style.height = rec[1] + 'px';
  }
  function holdAdded(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i];
      if (!k || k.nodeType !== 1) continue;
      if (k.tagName === 'IMG') holdImg(k);
      if (k.getElementsByTagName) {
        var im = k.getElementsByTagName('img');
        for (var j = 0; j < im.length; j++) holdImg(im[j]);
      }
    }
  }
  function releaseHold(im, src) {
    if (im.__bwHoldH) { im.__bwHoldH = 0; im.style.height = ''; }
    if (src) noteImg(im, src);
  }
  document.addEventListener('load', function (e) {
    var im = e.target;
    if (!im || im.tagName !== 'IMG') return;
    releaseHold(im, imgKey(im));
  }, true);
  document.addEventListener('error', function (e) {
    var im = e.target;
    if (!im || im.tagName !== 'IMG') return;
    if (im.__bwHoldH) { im.__bwHoldH = 0; im.style.height = ''; }
  }, true);
  /* 只盯新增节点(不看属性),一次改动只遍历被加进来的那些,别学瀑布流那样
     在观察器里做全文档查询 —— 那条实测过一秒 380 轮会把主线程吃满。
     观察对象写死 `document`:注入发生在 onPageStarted,那会儿 body 还没有,
     `document.body` 是 null → observe(null) 抛异常被 catch 掉,整套钉位就静默失效了
     (实测第一版就是这样,pins 恒为 0)。document 节点一定在,subtree 覆盖到 #app。 */
  try {
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var a = ms[i].addedNodes;
        if (a && a.length) holdAdded(a);
      }
    }).observe(document, {childList: true, subtree: true});
  } catch (e) { /* ignore */ }
  /* 注入之前就已经加载完的图不会再发 load,补一趟总的(只补没账的,读一次布局) */
  setTimeout(function () {
    var im = document.getElementsByTagName('img');
    for (var i = 0; i < im.length; i++) if (imgKey(im[i])) holdImg(im[i]);
  }, 1600);

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

  /* 把元素身上现有的 inline 列/行读回成排布账(账查不到时的兜底事实来源)。
     行位写作 "N / span M",N 是 1 起的网格行号;账里存 0 起的 row 与高度 h。 */
  function domPlacement(el) {
    var gc = el.style.gridColumn, gr = el.style.gridRow;
    if (!gc || !gr) return null;
    var m = /^(\d+)\s*\/\s*span\s*(\d+)$/.exec(gr);
    var col = parseInt(gc, 10) - 1;
    if (!m || !(col === 0 || col === 1)) return null;
    var span = Math.max(1, parseInt(m[2], 10) || 1);
    return {col: col, row: Math.max(0, (parseInt(m[1], 10) || 1) - 1), h: span * MASON_UNIT};
  }

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
      /* 新状态第一次起锚前先按测量保连续(见 layoutPinned 里 stFresh 那段):
         容器换人时卡片上还挂着上一份状态写的行位,直接按站点账本起锚会跳位 */
      st.stFresh = true;
      feedStates.set(wrap, st);
      /* pinnedWraps 是**强引用数组**(feedStates 是 WeakMap,它管不了这里):
         修剪原先只发生在 clearMasonry 里,而那是"非宽屏"才走的分支 ——
         平板恒宽屏,于是容器每被换一次(路由/整页重建)就有一个已脱离文档的
         信息流子树被永久留在数组里。新状态建立时顺手把断开的清掉,数组长度
         就跟着"当前活着的容器数"走。 */
      for (var q = pinnedWraps.length - 1; q >= 0; q--) {
        if (!pinnedWraps[q].isConnected) pinnedWraps.splice(q, 1);
      }
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

  /* ===== 滚动节拍接管:修"快速上划/下划时卡片消失,隔约半秒才回来" =====
     逆向 main.b53719c4.js:站点把 window.onscroll 绑到 scrolling(),它有两处先天缺陷:
     1) 节拍是 is_scrolling 闩 + setTimeout(300),而 scrollTop 在**监听入口**捕获、
        300ms 后才在节拍里使用 —— 硬甩一拍差出 1000~2000px;换向后的第一拍更是整拍
        浪费(手里的 s 还是旧方向深处的位置,算出的 a≈0 什么都不做),第二拍(再 300ms)
        才真正补插。视口在这 ~600ms 里冲出窗口,上/下部露出整段空白,停手后还要再等
        一拍才追平 —— 与用户报的"卡片消失隔约半秒"逐帧对上(screencast 实测空洞 0.4s+)。
     2) 下行分支要求 wb_list_top 与 wb_list_bottom 都非空才动账,否则整拍静默跳过。
     修法:接管 vm.scrolling —— 账目分支逐行照抄站点(同一批助手 get_scroll_items /
     get_wb_hei / get_item_H / load_more,含 s===0、padding_top=0 的特殊分支),只改两点:
     s 改为**节拍执行时**现读(换向第一拍拿到的就是新方向),节拍间隔 300ms → 80ms。
     节拍间的视口冲刺由窗口头部余量(first_scroll≈4106px)与尾部余量(≈2900px)吸收。
     v-for 带 key,节拍提频只增量挂摘头尾几张卡。仅在宽屏接管期内生效(与 .hei 减半
     同进退,见 syncHeiUnits/unscaleHeiUnits),退出时还原原函数。 */
  function pumpScrolling(vm) {
    /* 守卫用**函数身份**比对而不只看标记:实测存在 scrolling 被换回原函数而
       __bwPumped 标记残留的状态(多重注入实例的挂/卸交错),此时必须重新接管。
       __bwPumped 只在第一次接管时保存原函数,重挂不覆盖它,退出时才有得还。 */
    if (vm.__bwPumpFn && vm.scrolling === vm.__bwPumpFn) return;
    /* 账本机制不齐的组件(别的页面恰好长着 list_all/padding_top)不接管:
       节拍里要调它的 get_scroll_items/get_wb_hei,缺了会抛错 */
    if (typeof vm.get_scroll_items !== 'function' ||
        typeof vm.get_wb_hei !== 'function' ||
        typeof vm.get_item_H !== 'function') return;
    if (!vm.__bwPumped) vm.__bwPumped = vm.scrolling;
    vm.__bwPumpFn = function () {
      var e = vm;
      var doc = document.scrollingElement || document.body;
      var s = doc.scrollTop;
      if (!e.is_refresh && s > 0) {
        e.is_upglide = s >= e.lastHeight;
      }
      e.lastHeight = s;
      if (e.is_scrolling) return;
      e.is_scrolling = true;
      setTimeout(function () {
        e.is_scrolling = false;
        if (!e.$refs.cont) return;
        /* 节拍执行时现读位置:换向后的第一拍拿到的就是新方向(原版用入口的过期值) */
        var s2 = doc.scrollTop;
        if (e.padding_top === 0 && s2 < e.first_scroll) return;
        var a = s2 - e.first_scroll - e.last_scrolltop;
        if (a > 0 && s2 - e.last_scrolltop > 0) {
          if (Math.abs(a) >= e.get_item_H('start', 1)) {
            var i = e.get_scroll_items(a, 'max');
            if (i && typeof i === 'object') {
              if (i.wb_list_top.length > 0 && i.wb_list_bottom.length > 0) {
                e.padding_top += e.get_wb_hei(i.wb_list_top);
                e.padding_bottom = e.padding_bottom > e.get_wb_hei(i.wb_list_bottom)
                  ? e.padding_bottom - e.get_wb_hei(i.wb_list_bottom) : 0;
                var c = e.list_cur.slice(i.diff_wb_list.length);
                e.list_cur = c.concat(i.add_wb_list);
                e.max = e.list_cur[e.list_cur.length - 1].feed_id;
                e.since = e.list_cur[0].feed_id;
                e.last_scrolltop += e.get_wb_hei(i.wb_list_top);
                e.is_loading = false;
              }
            } else if (e.nextPageApi) {
              /* 失败限流:网络失败时请求瞬断→catch→is_request 复位→下一拍(80ms)
                 又发 → 12.5 次/秒的失败风暴,甩动途中主线程被打满(用户报"卡死")。
                 同一次 load_more 3s 内不重发;慢网络下 is_request 本身就闸住并发。 */
              var now = Date.now();
              if (!e.__bwLmAt || now - e.__bwLmAt > 2500) {
                e.__bwLmAt = now;
                e.load_more(e.nextPageApi);
                e.is_loading = true;
              }
            }
          }
        } else if (a < 0 && s2 - (e.last_scrolltop + e.first_scroll) < 0 &&
                   Math.abs(a) >= e.get_item_H('end', 1)) {
          var n = e.get_scroll_items(Math.abs(a), 'since');
          if (n && typeof n === 'object') {
            if (n.wb_list_top.length > 0 && n.wb_list_bottom.length > 0) {
              e.padding_bottom += e.get_wb_hei(n.wb_list_bottom);
              e.padding_top = e.padding_top > e.get_wb_hei(n.wb_list_top)
                ? e.padding_top - e.get_wb_hei(n.wb_list_top) : 0;
              var o = e.list_cur.length;
              var l = e.list_cur.slice(0, o - n.diff_wb_list.length);
              e.list_cur = n.add_wb_list.concat(l);
              e.max = e.list_cur[e.list_cur.length - 1].feed_id;
              e.since = e.list_cur[0].feed_id;
              if (s2 === 0) e.last_scrolltop = 0;
              else e.last_scrolltop -= e.get_wb_hei(n.wb_list_top);
            }
          } else {
            e.padding_top = 0;
          }
        }
        healFeed(e);
      }, 80);
    };
    vm.scrolling = vm.__bwPumpFn;
    /* 站点若已把旧函数挂上 window.onscroll,换成泵;还是 null(尚未初始化)时不动,
       站点自己会在 init_first_data 里把(已被替换的)vm.scrolling 挂上去 */
    if (window.onscroll) window.onscroll = vm.scrolling;
    /* 自愈不能只挂在滚动上:燃料见底时文档已经滚不动,也就再没有滚动事件。 */
    if (!vm.__bwHealTimer) vm.__bwHealTimer = setInterval(function () {
      healFeed(vm);
    }, 2000);
  }

  /** 与滚动无关的信息流自愈。两条都是"新的加载不出来"的死路:
      ① 站点翻页失败会把 re_do 置 true(模板据此画"加载异常，稍后再试试~"),
        而重试只挂在**用户点击那条提示**和滚动上 —— 我们补的燃料见底后文档
        滚不动,视口停在 padding 的虚空里(那条提示在视口上方),re_do 永远出不去。
        这里直接调用站点自己的 load_more(nextPageApi),与点那条提示是同一个动作。
      ② 下拉刷新撞上断网 → 首页拉取失败 → net_error 整页替掉信息流。list_all
        已空时没什么可保护,每 5s 代拉一次首屏,网络一恢复就自动回来;
        列表非空绝不代拉(pull_refresh 会清滚动位置)。
      限流与泵/提前翻页共用 __bwLmAt 那道闸。 */
  function healFeed(e) {
    try {
      if (!e || !e.$refs || !e.$refs.cont) return;
      var now = Date.now();
      if (e.re_do && !e.is_request && !e.is_loading && e.nextPageApi &&
          (!e.__bwLmAt || now - e.__bwLmAt > 2500)) {
        e.__bwLmAt = now;
        e.load_more(e.nextPageApi);
      }
      if (e.net_error && e.net_error.flag && e.list_all && !e.list_all.length &&
          !e.is_request && !e.is_refresh && now - (e.__bwHealAt || 0) > 5000) {
        e.__bwHealAt = now;
        e.pull_refresh();
      }
      /* 页面一安静,信息流的两条驱动会同时断掉:伺服补燃料挂在 DOM 变异上、
         提前翻页挂在 layoutPinned(同样由变异触发)里,而泵的窗口推进挂在滚动事件上。
         "顶在文档底"恰好三样都榨不出来,于是死在水上:
         · 实测一:y=14189 / roomLeft=0 / all=156,窗口前面压着 27 条已加载未渲染条目,
           燃料不再补 —— 踢一次 masonry() 就让伺服按自己的上限补、翻页按自己的闸门判。
         · 实测二:y=123433 / docH=124177 / roomLeft=0 / all=524,账本上
           a = y-first_scroll-last_scrolltop = 9857 ≥ get_item_H(287),泵去问
           get_scroll_items(9857,'max') 拿到的是**标量**(条目不够填满这段位移),
           按站点的规矩该分支就是去要下一页 —— 可要下一页这个动作本身也要滚动事件
           才会被执行第二次。gap=524-497=27 > LOAD_AHEAD 12,所以只踢排布救不回来
           (上一版栽在这里)。心跳因此照泵那条分支自己走一次:顶在底、没有请求在飞、
           还有下一页,就要一页;限流仍共用 __bwLmAt。站点自己说没有更多了
           (no_data.flag)时不收,免得对着尽头一路预取。 */
      var de = document.scrollingElement || document.body;
      if (de && de.scrollHeight - (de.scrollTop + (window.innerHeight || 0)) <= 4) {
        masonry();
        if (!e.is_request && !e.is_loading && !e.is_refresh && !e.re_do &&
            e.nextPageApi && (!e.no_data || !e.no_data.flag) &&
            (!e.__bwLmAt || now - e.__bwLmAt > 2500)) {
          e.__bwLmAt = now;
          e.load_more(e.nextPageApi);
        }
      }
    } catch (err) { /* ignore */ }
  }

  function unpumpScrolling(vm) {
    if (!vm.__bwPumped) return;
    if (vm.__bwHealTimer) { clearInterval(vm.__bwHealTimer); vm.__bwHealTimer = null; }
    vm.scrolling = vm.__bwPumped;
    delete vm.__bwPumped;
    delete vm.__bwPumpFn;
    if (window.onscroll) window.onscroll = vm.scrolling;
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
      pumpScrolling(vm);
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
      unpumpScrolling(vm);
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
  /* padding-bottom 的"零"有两种写法:重置/站点归零写 ''(没有内联值),伺服补到 0
     时写 '0px'。数值相同、字符串不同 —— 按字符串判"有没有变"就会让重置与回收互相
     触发(实测 layoutPinned 自转 11000+ 次、每批 6 条 attr:style,渲染主线程 100%
     挂死在骨架屏之后)。一律按数值比对,写回时零统一落成 ''。 */
  function setPadBottom(wrap, wantNum) {
    var cur = parseFloat(wrap.style.paddingBottom) || 0;
    if (cur === wantNum) return;
    wrap.style.paddingBottom = wantNum > 0 ? wantNum + 'px' : '';
  }

  /* —— 按卡片身份的连续性记忆 ——
     行位账(nodeInfo)按 DOM 节点记,而进正文再返回首页时 Vue 把整批卡换了人:
     幸存卡归零 → 重锚。重锚只能量"此刻的 DOM",可站点在这之前已经把它自己的
     padding_top 写进了同一棵树(实测 domPT 33204 → 49630,正好等于 last_scrolltop),
     于是量到的是**已经跳过之后**的位置,连续性等式把这次跳动当成现状钉死 ——
     用户看到的就是"返回首页后卡片比进入前低 150~240px"。
     所以另记一笔与节点无关的账:最近一轮排完后,视口顶那张卡的
     {身份, 文档坐标, scrollY}。身份用站点自己的 mblog.id(换人前后是同一张卡),
     重锚写完行位与 padding 之后,再量一次那张卡的落点,把残差补进 padding-top。
     只在"滚动位置基本没变"时校正(站点自己滚走了就别抢它的方向盘),
     并在下拉刷新/切分组那一支清空(那里的位移是语义,不是缺陷)。 */
  var REF_TOP_SLACK = 160;      // 参考卡 = 上沿落在视口顶下方 160px 以内最靠下的那张
  var REF_SCROLL_SLACK = 120;   // 记忆只在 scrollY 相差小于此值时生效
  var REF_TTL = 600000;         // 记忆 10 分钟过期
  var contMem = null;           // {key, docTop, y, at}

  /* 排布本身也要跨"整份状态重建"活下来。进正文再返回首页时 feed 组件会重建,
     feedStates 按新 wrap 取到的是一份**空**账本 —— 于是每张卡都当"新卡"重排:
     实测返回首页后 23 张卡的行号全部重编、其中 3~6 张换了列,
     用户报的就是"右栏那条含图的微博,返回首页跑到左栏去了"。
     列/行/高按卡片身份另记一份模块级的账,新状态起手先照它复位;
     下拉刷新/切分组那一支清空它(那里重排是语义,不是缺陷)。 */
  var placeMem = new Map();     // id -> {col, row, h}
  var placePad = null;          // 这套行位当初是配着哪个 padding-top 写的
  var PLACE_MAX = 400;

  /** 卡片身份:DOM 子节点与 vm.list_cur 同序(站点 v-for,原代码的 .hei 校准也这么对),
      按索引回查站点自己的 id。取不到返回 null(不同序 / 无 feed 组件时不校正)。 */
  function cardKeyAt(vm, idx) {
    try {
      var it = vm && vm.list_cur && vm.list_cur[idx];
      if (!it) return null;
      var k = (it.mblog && (it.mblog.id || it.mblog.mid)) || it.id || it.feed_id;
      return k === undefined || k === null || k === '' ? null : String(k);
    } catch (e) { return null; }
  }

  /** 本轮读到的参考卡:优先"上沿在折叠线附近的最靠下那张",全在下方时退到最顶一张 */
  function refCard(recs, y) {
    var lowIdx = -1, lowTop = -1e9, minIdx = -1, minTop = 1e9;
    for (var q = 0; q < recs.length; q++) {
      if (recs[q].box <= 0) continue;
      if (recs[q].docTop < minTop) { minTop = recs[q].docTop; minIdx = q; }
      if (recs[q].docTop <= y + REF_TOP_SLACK && recs[q].docTop > lowTop) {
        lowTop = recs[q].docTop; lowIdx = q;
      }
    }
    return lowIdx >= 0 ? lowIdx : minIdx;
  }

  function layoutPinned(wrap, st, vm) {
    var children = wrap.children;
    if (!children.length) return;
    syncHeiUnits(vm);

    /* DOM 子节点与 vm.list_cur 严格同序时,按索引回查到的 id 才可信
       (与下面 .hei 校准同一道闸);不同序时退回按节点记。 */
    var idOK = !!(vm.list_cur && vm.list_cur.length === children.length);
    // —— 读:本帧全部子项的外边距盒高(先读后写,只强排一次)——
    var i, el, recs = [];
    for (i = 0; i < children.length; i++) {
      el = children[i];
      var rr = el.getBoundingClientRect();
      var box = rr.height;
      if (box > 0) {
        var cs = window.getComputedStyle(el);
        box += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      /* 文档坐标 = 视口坐标 + scrollY(rect 已经是视口坐标,别再乘一次) */
      recs.push({el: el, key: idOK ? cardKeyAt(vm, i) : null,
                 box: box, docTop: rr.top + (window.scrollY || 0),
                 col: -1, row: 0, span: 1, h: null});
    }
    /* 容器有子卡却一张都量不到高度 = 它此刻根本没被渲染
       (实测:进正文再返回首页的路由切换期间,旧正文视图被整体包进 .main-pos 隐藏,
        所有 rect 都是 0)。这一轮**什么都别决定**:既不能按测量保连续(没得测),
        也不该按账本起锚 —— 账本与行号表示之间实测有 154~236px 的漂移,
        在隐藏帧里把它写死,回到可见时就是一次可见跳动。
        等下一轮(可见了)再按测量锚,连续性等式那时才成立。 */
    var anyBox = false;
    for (i = 0; i < recs.length; i++) { if (recs[i].box > 0) { anyBox = true; break; } }
    if (!anyBox) return;

    /* —— 连续性:本轮的参考卡,以及记忆那张卡此刻在哪 ——
       参考卡在**读阶段**选(写之前量到的才是用户这一轮真正看到的),
       memIdx 按身份匹配上一轮记下的那张卡。二者可以不是同一张:
       记忆负责"把该留在原地的留在原地",参考卡负责"下一轮该拿什么当原地"。 */
    var yRef = window.scrollY || 0;
    var refIdx = refCard(recs, yRef);
    var refKey = (refIdx >= 0 && idOK) ? cardKeyAt(vm, refIdx) : null;
    var refDoc = refIdx >= 0 ? recs[refIdx].docTop : 0;
    var memIdx = -1;
    if (idOK && contMem && Math.abs(yRef - contMem.y) <= REF_SCROLL_SLACK &&
        Date.now() - contMem.at < REF_TTL) {
      for (i = 0; i < recs.length; i++) {
        if (recs[i].box > 0 && cardKeyAt(vm, i) === contMem.key) { memIdx = i; break; }
      }
    }
    var anchored = false;   // 本轮是否重新定了锚(只有这一支才做落点校正)
    var restored = 0;       // 本轮有多少张卡是从**身份排布记忆**复位的(状态换了人)

    // —— 幸存卡:沿用 {col,row};高度变化量累计成同列下方的顺移 ——
    var cols = [[], []], c, j;
    for (i = 0; i < recs.length; i++) {
      /* 按身份查账而不是按节点:站点重渲染会换掉 DOM 节点,按节点记的账一换人
         就当"新卡"重新排位 —— 同一张卡在两次排布里落到不同列、行号差几百,
         这正是"已显示的微博位置突然变化"的形态。 */
      var pkey = recs[i].key || recs[i].el;
      var prev = st.nodeInfo.get(pkey);
      if (!prev && recs[i].key) {
        prev = placeMem.get(recs[i].key);
        if (prev) restored++;      // 行位是从上一份状态那儿接过来的
      }
      if (!prev) {
        /* 两本账都查不到,但元素身上还挂着我们上一轮写的列与行 —— 以 DOM 自己为准。
           否则这一张会被当"新卡"重排:一次低幸存的排布能把屏幕上五六张已显示的卡
           **成批换列**(2026-09-30 实测刹停瞬间同帧 5 条 col 事件,3 张 2→1、2 张 1→2,
           用户看到的就是"某张卡跳到另一栏")。账为什么会空是另一回事(键取不到、
           状态换人),这里先把"已经画在屏幕上的位置"抬成事实来源。 */
        prev = domPlacement(recs[i].el);
        if (prev) {
          if (recs[i].key) placeMem.set(recs[i].key, prev);
          st.nodeInfo.set(pkey, prev);
        }
      }
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
    /* 整窗换掉(硬 fling 一次冲过一屏,站点把 list_cur 整个推进)时幸存卡为 0:
       行号只能从 0 重排。不 re-anchor 的后果是实测过的:新窗口被钉在旧锚点的
       行 0 上,内容整体留在原处而视口已经走远 —— 整屏无卡 ~0.5s,或者反过来把
       文档高度撑回原处。
       锚值**怎么**定见下面这一支:先按测量保连续,量不到时才退回账本
       (anchorOf = Σ 窗口之前条目的 .hei;它与站点 last_scrolltop 冲突超 200px
       时信 last_scrolltop,因为 Σhei 会被 save_height 在隐藏容器里量出的单列整卡高
       污染 —— 条目 __bwHalf 标记早在,syncHeiUnits 的减半会跳过,账面由此虚高)。 */
    /* 加 st.nodeInfo.size 这一道:重锚是**整窗换掉**这个动作的善后,只有"我们确实
       排过行位、而这一轮幸存卡归零"才成立。原来只看 firstSurv<0,而首轮(以及任何
       账本被清空的轮次)nodeInfo 本来就是空的 —— 于是这一支变成电平条件,每轮都
       重锚一次;它写的又是 padding-top(深度场景下 anchorOf 与 lst 实测能差 29 万 px,
       探针实测 re# 与轮次 1:1 同步、每轮 nInfo=0)。首轮该由下面 ourPad===null
       那条按站点的 padding_top 起锚,不该被这里抢走。 */
    if (firstSurv < 0 && children.length && st.nodeInfo.size) {
      /* 重锚按**测量**保连续,不按账本取偏移。
         这一支之后行号从 0 重排,偏移整个从"行号"搬到"padding-top"上扛;
         若 padding-top 取站点账本(或 Σhei),而它们与行号当前表示的位置不一致,
         换表示的那一瞬间差值就变成一次可见跳动 —— 实测进正文再返回
         (list_all 被重建、fi 变成 -1,于是这一支被触发)时,同一张卡在同一个
         scrollY=10566 下从文档 7453 挪到 7770,跳了 **317px**,用户看到的
         就是"返回首页后不在原位"。
         量出来的连续性等式:卡片边框顶 = wrap 边框顶 + paddingTop + 行号×UNIT,
         行号归零后要原地不动 => paddingTop_new = gridTop_now - wrapTop_now。
         账本该决定"文档有多长",不该决定"已经显示的内容跳不跳"。
         一张都量不到(全 0 高)时才退回账本口径。 */
      var wb = wrap.getBoundingClientRect();
      var gTop = 1e9;
      for (i = 0; i < recs.length; i++) {
        if (recs[i].box > 0 && recs[i].docTop < gTop) gTop = recs[i].docTop;
      }
      st.nodeInfo.clear();
      anchored = true;
      if (gTop < 1e8) {
        st.ourPad = Math.max(0, Math.ceil(gTop - (wb.top + (window.scrollY || 0))));
      } else {
        var a0 = Math.max(0, Math.ceil(anchorOf(vm)));
        var lstV = Math.max(0, Math.round(vm.last_scrolltop || 0));
        if (lstV > 0 && Math.abs(a0 - lstV) > 200) a0 = lstV;
        st.ourPad = a0;
      }
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
        var wkey = it2.key || it2.el;
        st.nodeInfo.set(wkey, {col: c, row: it2.row, h: it2.h});
        if (it2.key) placeMem.set(it2.key, {col: c, row: it2.row, h: it2.h});
      }
    }
    /* 身份记忆只按条数修剪:窗口推进后旧卡可能又被站点回插,那时它该回到
       原来那一列那一行,而不是当新卡重排。 */
    if (placeMem.size > PLACE_MAX) {
      var over = placeMem.size - PLACE_MAX, it0 = placeMem.keys();
      while (over-- > 0) { var dk = it0.next(); if (dk.done) break; placeMem.delete(dk.value); }
    }
    // 离场节点清账(Map 迭代中删除是安全的)
    st.nodeInfo.forEach(function (info, node) {
      var alive = false;
      for (var q = 0; q < recs.length; q++) {
        if ((recs[q].key || recs[q].el) === node) { alive = true; break; }
      }
      if (!alive) st.nodeInfo.delete(node);
    });

    // —— padding-top 接管:内容文档坐标只由行号决定,站点的写值不再生效 ——
    // 重置判定:站点数据归零**且窗口真的回到已加载列表头部**(下拉刷新/切分组/大步上插回顶)。
    // 只按 padding_top===0 判不够 —— 站点在"回插拿不到
    // 条目"的分支里会把它直接写成 0(实测 fling 中触发),那时窗口还在列表中段,
    // 清行位会让文档高度塌回顶部、scrollY 被夹到 0(表现为"甩两下自己回到首页顶")。
    if (st.ourPad !== null && vm.padding_top === 0 &&
        Math.round(vm.last_scrolltop || 0) <= 2 &&
        (!(vm.list_cur && vm.list_all) || vm.list_all.indexOf(vm.list_cur[0]) === 0)) {
      /* 站点把账归零且窗口真的回到已加载列表头部:下拉刷新/切分组,以及大步上插
         的"回到列表头"分支(站点此时把 padding_top 清零并整窗替换为头部一页)。
         曾加过 (scrollY<60 || cur<5) 的额外保护 —— 实测挡住了后者:泵(节拍现读 s)
         之后硬甩回顶经常精确落进这个分支,y≈600 处 ourPad 仍钉在旧值(~2100px),
         网格整体被压到视口下方,顶部露出 1~2s 的整段空白(探针实测 1962ms)。
         "fling 中站点乱写 padding_top=0"的假重置窗口在列表中段(fi>0),已被
         indexOf===0 排除;但又实测到恢复会话(h5_feed_data)等状态下 padTop=0 而
         last_scrolltop≠0 的错位组合,此时清锚会把文档拽回去 —— 所以再加一道
         last_scrolltop≤2:账面窗口顶不在 0 就不算真正的"回到头"。 */
      /* 只在锚点确实钉在别处时,燃料才是脏的。这一支是**电平**条件:窗口停在
         已加载列表头部时它每轮都成立(实测 y=3337 / fi=0 / lst=0 / padTop=0 的
         常态),无条件清燃料就会和补燃料那一支对拍 —— 清成 0 → slack 少一屏 →
         伺服补回 744 → 写 style 就是变异 → 观察器再进这一支。实测单页自转
         41500 轮、燃料写回 82500 次,渲染主线程 97% 挂在微任务里,
         用户看到的就是"触底不加载新微博、往上滑也滑不回去"。
         锚点本来就是 0 时不动 DOM,回路自然断;真·下拉刷新/切组时 ourPad 是旧
         深处的值(>0),该清的照样清一次。 */
      /* 2026-09-30 同一道保护当时只加在了 setPadBottom 上,四行**账目清理留在门外**
         —— 而 ourPad 在首页头部本来就是 0,于是这一支每轮都成立、每轮都清空
         nodeInfo 与 placeMem:下一轮所有卡都算"新卡",整窗重新分栏。卡片高度一变
         (图片加载完、或刹停让重排落在肉眼可见的一帧)就成批换列 —— 实测刹停一次
         同帧 5 条换栏(3 张 2→1、2 张 1→2),而 reset 事件在浅处每轮都打(13 次手势
         138 条,ourPad 全是 0)。清理必须和 padding 那一行受同一个"锚确实钉在别处"的
         边沿保护,不然这里根本不是电平,是每轮都开火的自毁。 */
      if (Math.round(st.ourPad) > 0) {
        setPadBottom(wrap, 0);
        st.ourPad = null;
        st.nodeInfo.clear();
        contMem = null;   // 回顶是语义不是缺陷:别让按身份的记忆把校正做回来
        placeMem.clear(); // 重排同理:刷新/切分组之后没有"原来那一列"要保住
        placePad = null;
        /* 配套:刷新/切组后 DOM 上残留的旧列/行也必须抹掉 —— 否则下一轮
           domPlacement 那条兜底会把"上一批微博的位置"接给新卡片。 */
        for (var q = 0; q < wrap.children.length; q++) {
          var kid = wrap.children[q];
          if (kid.style.gridColumn) kid.style.gridColumn = '';
          if (kid.style.gridRow) kid.style.gridRow = '';
        }
      }
    }
    if (st.ourPad === null) {
      /* stFresh 只有一个来源:这份状态是刚建的 —— 容器节点换了人
         (实测:进正文再返回首页,feed 组件重建,feedStates 按新 wrap 取不到旧状态)。
         这时卡片上还挂着**上一份状态**写的行位与 padding,量出来的顶就是用户此刻
         看到的位置;按量取锚,内容原地不动。按站点账本起锚会跳 —— 实测同一张卡在
         同一个 scrollY=17910 下从文档 14747 被钉到 14983(账本 lst=14874 与行号表示
         差 236px),用户看到的就是"返回首页后不在原位"。
         重置分支(下拉刷新/切组)也走 ourPad=null,但它不带 stFresh,
         所以仍然按账本归零 —— 那里"跳回顶部"是语义,不是缺陷。 */
      var g0 = 1e9;
      if (st.stFresh) {
        for (i = 0; i < recs.length; i++) {
          if (recs[i].box > 0 && recs[i].docTop < g0) g0 = recs[i].docTop;
        }
        st.stFresh = false;
      }
      if (restored) {
        /* 行位是从身份记忆接过来的,那 padding 也必须用它当初被记录时的那一份 ——
           两者是同一套坐标系(内容文档坐标 = pad + 行号×UNIT)。这时若按站点写的
           padding_top 起锚,内容会整体被搬走:实测同一张卡的文档顶从 36596 变成
           44261(差 7665px),列虽然不换了,但页面看着像"返回首页后跳到别处"。 */
        anchored = true;
        st.ourPad = placePad === null ? Math.max(0, Math.ceil(vm.padding_top || 0)) : placePad;
      } else if (g0 < 1e8) {
        anchored = true;      // 容器换人:同样按测量起锚,交给下面的身份校正保连续
        st.ourPad = Math.max(0, Math.ceil(g0 - (wrap.getBoundingClientRect().top + (window.scrollY || 0))));
      } else {
        st.ourPad = Math.max(0, Math.ceil(vm.padding_top || 0));
      }
    }
    var wantPad = Math.ceil(st.ourPad) + 'px';
    if (wrap.style.paddingTop !== wantPad) wrap.style.paddingTop = wantPad;

    /* —— 落点校正:重锚这一轮把"记忆那张卡"拉回它原本的文档坐标 ——
       测量连续性等式钉的是**这一轮量到的**网格顶,而站点可能已经在我们之前
       把整棵树挪过(见上面 contMem 那段);按身份再补一次,用户盯着的那张卡才真的不动。
       行号已写完、padding 已写完,这里读一次 rect 会强制排版 —— 只在重锚这条罕见
       路径上发生(实测一整轮进/出首页 1~2 次),常态轮次 anchored=false 不付这笔钱。
       校正后按实际落点重写记忆:夹在 0 处吃不掉的部分不结转,免得误差累积。 */
    /* 从身份记忆复位 = 行位换了坐标系(状态重建/整窗换掉),与重锚同一种情形:
       站点在这期间可能已经把它自己的 padding_top 写进 DOM,内容整体被搬走过 ——
       实测只复位行位不做这一步时,同一张卡的文档顶从 36596 变成 44261(差 7665px),
       列是不换了,可整页看着就是"返回首页后跳到大老远之外"。 */
    if ((anchored || restored) && memIdx >= 0) {
      var gotDoc = recs[memIdx].el.getBoundingClientRect().top + (window.scrollY || 0);
      var errDoc = contMem.docTop - gotDoc;
      if (Math.abs(errDoc) > 2) {
        var fixPad = Math.max(0, Math.ceil(st.ourPad) + errDoc);
        if (Math.abs(fixPad - st.ourPad) > 0.5) {
          st.ourPad = fixPad;
          wrap.style.paddingTop = Math.ceil(fixPad) + 'px';
        }
      }
    }
    if (refIdx >= 0 && refKey) {
      var memDoc = refDoc;
      if (anchored || restored) {
        // 重锚轮:内容整体挪过,量过一次的落点才算数
        memDoc = recs[refIdx].el.getBoundingClientRect().top + (window.scrollY || 0);
      }
      contMem = {key: refKey, docTop: memDoc, y: window.scrollY || 0, at: Date.now()};
    }
    /* 行位与 padding 是一套坐标系,落到最后一并记一笔(落点校正可能又动过 padding) */
    placePad = st.ourPad;

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
    /* 燃料必须有上限,而且上限要由"将来真会被渲染出来的内容"撑:
       只按"还有已加载未渲染条目"放行是不够的 —— 实测断网下探时窗口停在
       fi=166/cur=27(all=196,余粮 3 条),每趟仍判"有余粮"继续补一屏,
       padding_bottom 从 744px 一路涨到 9672px、视口甩开网格、inView=0。
       所以上限 = 窗口之后所有已加载条目的记账高 + 一屏在途余量;超出就回收
       (每趟封顶 2400px、只回收视口之外的部分,不碰滚动位置)。
       余粮为 0 时上限正好是一屏 —— 与原版"滚到底等加载"的天然行为一致;
       翻页落地后条目进 list_all,上限自己抬高,不需要额外通知。 */
    var curFi = (vm.list_cur && vm.list_cur.length && vm.list_all)
      ? vm.list_all.indexOf(vm.list_cur[0]) : -1;
    var allL = vm.list_all || [], curL = vm.list_cur || [], sumH = 0, nH = 0;
    for (var mi = 0; mi < curL.length; mi++) {
      var mh = curL[mi] && curL[mi].hei;
      if (mh > 0) { sumH += mh; nH++; }
    }
    var meanH = nH ? sumH / nH : 0;          // 没量过高的条目按窗口均值估
    var tailH = 0;
    if (curFi >= 0) {
      for (var ti = curFi + curL.length; ti < allL.length; ti++) {
        tailH += (allL[ti] && allL[ti].hei) || meanH;
      }
    }
    var capH = tailH + vh2;
    var pbNum = parseFloat(wrap.style.paddingBottom) || 0;
    if (pbNum > capH) {
      setPadBottom(wrap, Math.max(0, Math.floor(pbNum - Math.min(2400, pbNum - capH))));
    } else if (slack < vh2) {
      setPadBottom(wrap, Math.min(capH, Math.ceil(pbNum + (vh2 - slack))));
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
      if (tail >= 0 && vm.list_all.length - tail <= LOAD_AHEAD) {
        /* 与泵的失败限流共用同一道闸(3s):网络失败时请求瞬断,re_do 只拦住本函数
           一拍,下一批变异又进来 —— 两个发起口一起限流才算数 */
        var nowLm = Date.now();
        if (!vm.__bwLmAt || nowLm - vm.__bwLmAt > 2500) {
          vm.__bwLmAt = nowLm;
          vm.load_more(vm.nextPageApi);
        }
      }
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
    /* 九宫格裁剪必须排在测量/落位**之前**:它会把第 9 张起的图收掉、把卡片高度
       改掉(实测 12 图卡 799→665,差 134px;15 图卡差 267px)。原先它只挂在
       refresh()(滚动事件 + 250ms 防抖)上,而排布跑在 MutationObserver 的微任务里
       —— 新卡先按"还没裁剪"的高度被量到、写上行位,~84ms 后裁剪才落地,卡片一矮,
       同列下方的卡片被 shift 整体顶上去 134~267px,用户看到的就是"滑动时上下乱跳"。
       实测(.rundata/nine_race2.py):新卡插入瞬间 row=8729/span 399,84ms 后变成
       span 333 —— 卡片顶没动、高矮了 134px,整列下方跟着挪。
       放到最前面,量到的就是终态高度;clampNineGrid 自身幂等,重复调用无副作用。 */
    try { clampNineGrid(); } catch (e) { /* ignore */ }
    /* 手机单列绝不接管:watchFeed / ResizeObserver 的回调也会直接走到这里,
       不设守卫的话单列同样会被写行位、.hei 被减半 —— 记账消耗快一倍,
       窗口推进过早,手机反而患上平板才有的病。归还交给 masonry() 的
       clearMasonry(refresh 每 250ms 会调到)。 */
    if (!WIDE.matches) return;
    /* 全屏看图浮层开着的时候不接管信息流:它盖住整屏,这一轮排布没有任何可见收益,
       而站点在浮层开合期间每帧都在重写这些卡片节点,我们每收到一批变异就同步排一轮
       (19 个 rect + 19 个 getComputedStyle)。实测一次"开图 → 上滑 → 收起"的路径上
       排布跑 1100+ 轮、渲染主线程 100%。
       收起时 syncGalleryOverlay 在换态那一支补排,不靠轮询。 */
    if (pswpOpen()) return;
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

  /** 窗口首卡在文档里的偏移,按站点自己的记账口径现算(Σ 窗口之前条目的 .hei)。
      不读 vm.padding_top:站点在"回插拿不到条目"的分支里会把它直接写成 0
      (实测 fling 中它的 else 分支会 padding_top=0),那时它并不等于真实偏移。 */
  function anchorOf(vm) {
    try {
      var all = vm.list_all, cur = vm.list_cur;
      if (!all || !cur || !cur.length) return 0;
      var fi = all.indexOf(cur[0]);
      if (fi < 0) return Math.max(0, vm.padding_top || 0);
      var t = 0;
      for (var i = 0; i < fi; i++) t += (all[i] && all[i].hei) || 0;
      return t;
    } catch (e) { return Math.max(0, vm.padding_top || 0); }
  }

  function clearMasonry() {
    contMem = null;      // 交还布局:按身份的记忆随之作废,单列世界由站点自己接管
    placeMem.clear();
    placePad = null;
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
  var masonEl = null, masonObs = null;
  /* 变异驱动的排布要限流:观察器回调是微任务,站点自己刷信息流时一批接一批,
     每轮都同步排布。实测风暴里一秒 380 轮,渲染主线程被这条"什么都没写"的路径吃满
     (CDP 120s 不回话,只剩合成器在滚,页面看着就是死的)。
     1 秒窗口内前 40 轮同步排 —— 冷启动首批与整窗替换要当帧落位,不然会先上一屏
     未定位的卡再整屏挪位(实测单卡 -185px);超过 40 轮说明遇上了风暴,改走
     masonry() 的 120ms 防抖,把每秒排布次数压回个位数,阵风过去自然恢复。 */
  var moPass = {n: 0, from: 0};
  function masonryFromMutation() {
    var now = Date.now();
    if (now - moPass.from > 1000) { moPass.from = now; moPass.n = 0; }
    if (++moPass.n <= 40) {
      try { layoutMasonry(); } catch (e) { /* ignore */ }
    } else {
      masonry();
    }
  }
  function watchFeed() {
    var el = document.querySelector('#app .main-wrap .pannelwrap');
    if (el === masonEl) return;
    if (masonObs) { try { masonObs.disconnect(); } catch (e) { /* ignore */ } masonObs = null; }
    masonEl = el;
    if (!el) return;
    try {
      masonObs = new MutationObserver(function () { masonryFromMutation(); });
      masonObs.observe(el, {attributes: true, childList: true, subtree: true});
      /* 挂上就立即排一次:冷启动首批卡(以及容器被整换后的幸存卡)不能再等
         refresh 的 250ms + masonry 的 120ms 节流 —— 那 ~370ms 里未定位的卡
         会先上屏,随后行位写入整屏挪位(实测 t=894 单卡 -185px)。同一微任务里
         排完,首个绘制帧就是定位后的位置。 */
      try { layoutMasonry(); } catch (e) { /* ignore */ }
    } catch (e) { masonObs = null; }
  }

  function masonry() {
    if (!WIDE.matches) {
      /* 交还只做"确实接管过"的那一次:clearMasonry 要跑一趟全文档查询
         (`.wb-item-wrap, .profile-header, .lite-btn-more`)、逐张卡读 offsetHeight
         (强制布局)并把站点账本里的 .hei 按实测重写一遍 —— 而 masonry() 挂在每个
         滚动事件上,窄屏下每个事件都重来一遍纯属浪费,还会反复覆盖站点自己的量值。
         `st.ourPad !== null` 正是"这套状态还攥在我们手里"的标记,交还后归 null,
         这里自然不再进;重新进入宽屏时 layoutPinned 又会把它置上。 */
      for (var q = 0; q < pinnedWraps.length; q++) {
        var stq = feedStates.get(pinnedWraps[q]);
        if (stq && stq.ourPad !== null) { clearMasonry(); break; }
      }
      return;
    }
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
  /* 转屏/分屏只改视口不改 DOM,变异观察器唤不醒 refresh —— 博主主页的
     "窄屏还原结构"就永远不跑(实测 1280→411 之后三颗按钮还卡在卡片的
     .bw-prof-acts 里、底栏空着,手机上那颗"关注"直接没了)。这里补一刀。 */
  try { window.addEventListener('resize', function () { masonry(); schedule(); }); } catch (e) { /* ignore */ }

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
      /* 编辑页(撰写/转发/讨论)整页是 .m-main 那种固定列,文档永远停在 y=0,
         下拉手势会被外层 SwipeRefreshLayout 整个抢走 —— 打字时往下拽就触发了刷新。
         SPA 换路由不重走页面加载,原生看不到 URL 变化,只能由这里报。 */
      if (window.BwNative && BwNative.setEditorOpen) {
        BwNative.setEditorOpen(/^\/compose/.test(p));
      }
      root.classList.toggle('bw-page-search', p.indexOf('/search') === 0 || p.indexOf('/s/') === 0);
      root.classList.toggle('bw-page-msg', p.indexOf('/msg') === 0 || p.indexOf('/message') === 0);
      root.classList.toggle('bw-page-me', p.indexOf('/profile') === 0 || p.indexOf('/my') === 0 || p.indexOf('/u/') === 0);
      root.classList.toggle('bw-page-home', !deep && !(p.indexOf('/search') === 0 || p.indexOf('/s/') === 0
        || p.indexOf('/msg') === 0 || p.indexOf('/message') === 0 || p.indexOf('/profile') === 0
        || p.indexOf('/my') === 0 || p.indexOf('/u/') === 0));
      /* 第四套页面架构:Tailwind 工具类写的超话/话题页 —— 根节点是
         `#app > div.root.w-full.max-w-[750px]`,既没有 .main-wrap 也没有 .m-top-bar,
         于是路由标记兜底落成 bw-page-home,条带/卡片/顶栏规则**一条都不命中**
         (实测 1280 下:根只有 797px 居中,而它的顶栏与底栏是
          `fixed top-0 w-full max-w-[750px]` —— fixed 的 100% 按视口算 1280,
          再被我们那条"内层 max-width 作废"抹掉 750 上限,于是宽 1280、起点 241.5,
          右侧 241px 直接甩出屏外)。
         按**结构**认这一族,不按路由字符串猜。判据用廉价的三条短路:
         根有 .root 类 + 类名里带 max-w- 前缀(Tailwind 特征) + 没有 .main-wrap;
         只有前两条都过才会去查 .main-wrap,所以信息流那些页不会多付查询成本。 */
      var appEl = document.getElementById('app');
      var firstEl = appEl && appEl.firstElementChild;
      var tw = !!(firstEl && firstEl.classList && firstEl.classList.contains('root') &&
        /(^|\s)max-w-/.test(firstEl.className) && !document.querySelector('.main-wrap'));
      root.classList.toggle('bw-tw', tw);
    } catch (e) { /* ignore */ }
  }
  syncRouteClasses();

  /* ===== 博主主页(/p/<uid> 那一族)大屏重排:左侧常驻资料卡 + 右侧微博流 ===== */
  /* 站点把这一页做成一整条竖列:头部(封面+头像+资料)、切换栏、微博卡片,
     三者都是同一个父容器下的**兄弟节点**。要在大屏上变成"左边一张常驻卡、
     右边微博流",得把它们分成两组 —— CSS 没有"包一层"的能力,所以这里挪节点,
     CSS 只负责两栏与卡片样式(见 theme.js 的 html.bw-prof 段)。
     只动结构、不复制内容、不改事件:按钮整颗搬进卡片,点击/菜单全由站点自己接。
     窄屏(<768px)会把结构还原,手机版式一点不动。 */
  /** 往上走到 container 的直接子节点(不在这一族里返回 null) */
  function upTo(container, node) {
    var cur = node;
    while (cur && cur.parentElement !== container) cur = cur.parentElement;
    return cur;
  }

  /* 拆掉旧版套出来的嵌套左列:每一层壳只装得下一棵子树,把子节点提上来再删壳 */
  function unwrapSides(side) {
    var shells = side.querySelectorAll('.bw-prof-side');
    for (var q = 0; q < shells.length; q++) {
      var sh = shells[q];
      if (!sh.isConnected) continue;
      while (sh.firstChild) sh.parentElement.insertBefore(sh.firstChild, sh);
      sh.remove();
    }
  }

  function profParts() {
    var nav = document.querySelector('nav.m-top-nav');
    var cov = document.querySelector('.profile-cover');
    if (!nav || !cov) return null;
    /* 容器不能按"切换栏往上数两级"来认:分组做完之后那两级正好落在我们自己造的
       .bw-prof-side 里,于是每一次 refresh 都往左列内部再套一层左列
       (实测一份文档里 310 层,而 side 的 gridRow 是按子节点数算的,套到第二层
       就只剩 span 3 —— 左列滚两屏就不再粘住)。先认已有的 side,容器取它的父级。 */
    var side = document.querySelector('.bw-prof-side');   // 树序第一个 = 最外那层
    if (side) unwrapSides(side);
    var W = side ? side.parentElement : (nav.parentElement && nav.parentElement.parentElement);
    if (!W || !W.children) return null;
    var A = upTo(side || W, cov) || upTo(W, cov);         // 头部那一块(里面是 .profile-cover)
    var B = upTo(side || W, nav) || upTo(W, nav);         // 切换栏那一行
    return (A && B && A !== B) ? {W: W, A: A, B: B, cov: cov, side: side} : null;
  }

  /** 底栏里要搬进卡片的三颗:关注/已关注 / 私信 / “的热门”弹出菜单里的“全部微博” */
  function profActions() {
    var bar = document.querySelector('.m-tab-bar.m-bar-panel');
    if (!bar) return [];
    var out = [];
    /* 只取操作行的**直接**子项:站点"私信"那颗里面还套着一颗同名 .m-diy-btn,
       全量扫会把里外两颗都抓走(实测多出一颗空按钮) */
    var btns = bar.querySelectorAll('.m-ctrl-box > .m-diy-btn');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].innerText || '').replace(/\s+/g, '');
      /* 关注那颗按站点自己的 .m-followBtn 认,不按文案:未关注时它写"关注"、
         已关注时写"已关注",只比"已关注"会把博主主页上唯一那颗关注按钮留在底栏里,
         而大屏档底栏整条 display:none —— 入口直接不见了 */
      if (btns[i].querySelector('.m-followBtn') || t === '关注' || t === '已关注') {
        btns[i].classList.add('bw-act-follow');
        out.push(btns[i]);
      } else if (t === '私信') {
        btns[i].classList.add('bw-act-dm');
        out.push(btns[i]);
      }
    }
    var all = null, els = bar.querySelectorAll('a, li, h4, span');
    for (var j = 0; j < els.length; j++) {
      if ((els[j].innerText || '').replace(/\s+/g, '') === '全部微博') { all = els[j]; break; }
    }
    if (all) {
      /* 站点那颗是菜单项(li/a),外面套一层才有按钮的排布与描边。
         已经套过就复用:这段每次 refresh 都会跑,套了新壳会出现重复按钮 */
      var host = all.parentElement;
      if (host && host.classList && host.classList.contains('bw-prof-act')) {
        out.push(host);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'bw-prof-act bw-prof-all';
        wrap.appendChild(all);
        out.push(wrap);
      }
    }
    return out;
  }

  /** 只给底栏那两颗打样式钩子,不挪不动 —— 窄屏档按钮本来就留在底栏里,
   *  CSS 要靠这两个类给"私信"补站点没画的图标。宽屏档它们已经被搬走,
   *  `.m-ctrl-box > .m-diy-btn` 自然扫不到,重复调用无害。 */
  function tagBarActions() {
    var bar = document.querySelector('.m-tab-bar.m-bar-panel');
    if (!bar) return;
    var btns = bar.querySelectorAll('.m-ctrl-box > .m-diy-btn');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].innerText || '').replace(/\s+/g, '');
      if (btns[i].querySelector('.m-followBtn') || t === '关注' || t === '已关注') {
        btns[i].classList.add('bw-act-follow');
      } else if (t === '私信') {
        btns[i].classList.add('bw-act-dm');
      }
    }
  }

  function layoutBlogger() {
    try {
      var root = document.documentElement;
      if (!root.classList.contains('bw-cardpage')) { return; }
      var pt = profParts();
      if (!pt) { return; }
      var W = pt.W, A = pt.A, B = pt.B;
      tagBarActions();
      /* 窄屏:还原结构(头部与切换栏回到原父容器,去掉常驻容器) */
      if (!WIDE.matches) {
        if (!root.classList.contains('bw-prof')) { return; }
        var s0 = W.querySelector(':scope > .bw-prof-side');
        if (s0) {
          if (A.parentElement === s0) W.insertBefore(A, s0);
          if (B.parentElement === s0) {
            W.insertBefore(B, A.nextSibling === s0 ? s0 : A.nextSibling);
          }
          /* 按钮一颗颗还回底栏的操作行(连同我们给“全部微博”套的那层壳) */
          var acts0 = pt.cov.querySelector('.bw-prof-acts');
          if (acts0) {
            var box = document.querySelector('.m-tab-bar.m-bar-panel .m-ctrl-box') ||
              document.querySelector('.m-tab-bar.m-bar-panel');
            if (box) { while (acts0.firstChild) box.appendChild(acts0.firstChild); }
            acts0.remove();
          }
          /* 封面带是我们在大屏档多画的一层,窄屏档用不到(站点那份内联图一直没动) */
          var band0 = pt.cov.querySelector(':scope > .bw-prof-band');
          if (band0) { band0.remove(); }
          s0.remove();
        }
        W.classList.remove('bw-prof-wrap');
        root.classList.remove('bw-prof');
        return;
      }
      /* 真正的容器是"切换栏的父节点"(头部/切换栏/微博卡都是它的子节点),
         外面还套着一层 —— CSS 选不到无类名的那一层,这里给它打个标记 */
      W.classList.add('bw-prof-wrap');
      var side = W.querySelector(':scope > .bw-prof-side');
      if (!side) {
        side = document.createElement('div');
        side.className = 'bw-prof-side';
        W.insertBefore(side, A);
      }
      if (A.parentElement !== side) side.appendChild(A);
      if (B.parentElement !== side) side.appendChild(B);
      /* sticky 的约束是这一项自己的网格区:要跨到最后一排,微博卡一多(无限下拉)
         就跟着加 —— 这一串都是同一个父容器的子节点,数一下就是行数 */
      var rows = Math.max(2, W.children.length + 2);
      if (side.style.gridRow !== '1 / span ' + rows) {
        side.style.gridRow = '1 / span ' + rows;
      }
      /* 封面带:站点把封面图作为元素自己的 background 内联写在 .profile-cover 上。
         大屏档这张卡是"上沿一条 150 的封面 + 下方资料",整卡 cover 会把图铺到文字底下,
         而 background-size 又只能按整卡算裁切基准 —— 所以抄一条自己的带子出来画,
         基准回到那 150(与手机档 211 高的封面格同一套)。theme.js 负责隐藏整卡那份。 */
      var band = pt.cov.querySelector(':scope > .bw-prof-band');
      if (!band) {
        band = document.createElement('div');
        band.className = 'bw-prof-band';
        pt.cov.insertBefore(band, pt.cov.firstChild);
      }
      var src = pt.cov.style.backgroundImage;
      if (!src || src === 'none') { src = getComputedStyle(pt.cov).backgroundImage; }
      if (src && src !== 'none' && band.style.backgroundImage !== src) {
        band.style.backgroundImage = src;
      }
      /* 操作按钮搬进卡片(卡片 = .profile-cover,它是两列网格,按钮那行由 CSS 跨列) */
      var acts = pt.cov.querySelector('.bw-prof-acts');
      if (!acts) {
        acts = document.createElement('div');
        acts.className = 'bw-prof-acts';
        pt.cov.appendChild(acts);
      }
      var wants = profActions();
      for (var k = 0; k < wants.length; k++) {
        if (wants[k].parentElement !== acts) acts.appendChild(wants[k]);
      }
      if (wants.length) root.classList.add('bw-prof');
    } catch (e) { /* ignore */ }
  }

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
      /* 出错页(404/500):站点服务端直出的 .h5-4box(标题"微博 - 出错了404"),
         既没有 #app 也不是 .module-topbar,标记会兜底落成 bw-server —— 而 bw-server
         那组是按"设置族列表页"排的(64px 顶距 + 通栏卡片),套到一页只有图和文字链的
         错误页上只是让它贴顶左对齐。theme.js 的 html.bw-404 单独成套(居中卡片)。 */
      root.classList.toggle('bw-404', !!document.querySelector('.h5-4box'));
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
      layoutBlogger();      /* 大屏两栏:先分组再让 masonry 认容器(这一族其实没有信息流网格,顺序只为稳妥) */
      masonry();
      watchFeed();
      paintComposeIcons();
      paintComposeCaret();
      watchComposeIcons();
      watchComposeFocus();
      syncComposeMirror();
      placeComposeAvatar();
      allowComposeThumbnails();
      syncGalleryOverlay();
      clampNineGrid();
      /* 悬浮导航与发博按钮只在四个主 tab 出现,其余一律收掉:
         正文页 / 私信会话(那条输入框在常规流里,胶囊压上去实测重叠 388x39) / 撰写 /
         设置族(老架构 #box + 服务端直出子页) / 头条文章 / 超话 / 热搜条目页
         都自然落在 !isMainTab() 里,不用再逐个枚举。
         全屏看图与全屏视频层即使在主 tab 上也要临时收掉(悬浮件 z 比它们高)。 */
      /* overlayOpen() 在这一次 refresh 里只算一遍：它内部是三个 querySelector +
         可能两次 getComputedStyle，而 refresh 挂在每个滚动事件上(profiler 里
         pswpOpen 一项就占 2.4%)。同一个同步批次里结果不可能变，算一次分给
         overlayEdge 与 syncOverlayChrome 共用。 */
      var ov = overlayOpen();
      lastHidden = hidden;
      /* 换态时 overlayEdge 会立刻自己摆一遍；没换态这一趟也照摆，
         路由/滚动带进来的变化同样要落回悬浮件上 */
      overlayEdge(ov);
      syncOverlayChrome(ov);
      var tb = document.querySelector('.lite-topbar.main-top');
      if (tb) {
        /* 玻璃底已在 theme.js 常驻(不再按滚动位置切换),这里只管上滑隐藏 */
        tb.classList.toggle('bw-hidden', hidden);
      }
      syncFloatChrome(deep, hidden);      syncDrop();
      fixSearchHint();
      syncSearchTabStrip();
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

  /* 换页这一刀不能等 250ms 节流:从正文页/个人页返回首页时,返回球要等下一次
     schedule 才收 —— 实测路由离开内页 +150ms,球到 +411ms 才消失(迟钝 261ms,
     正好是防抖的 250ms),用户看到的就是"球压在信息流上愣了一下才没"。
     路由键一变就在同一批变异里同步一次,并取消待执行的防抖,不再跑第二遍。 */
  var lastRoute = location.pathname + location.search;
  function routeChanged() {
    var now = location.pathname + location.search;
    if (now === lastRoute) return false;
    lastRoute = now;
    return true;
  }

  schedule();
  try {
    window.addEventListener('scroll', refresh, {passive: true});
    window.addEventListener('popstate', function () {
      /* 浏览器/系统返回不一定伴随 DOM 变异,路由变化也立刻同步一次 */
      syncRouteClasses();
      if (routeChanged()) {
        if (timer) { clearTimeout(timer); timer = null; }
        build();
        refresh();
      }
    }, {passive: true});
    new MutationObserver(function () {
      /* 快路径:宽屏下信息流容器一出现(或被整换)就立刻挂专守,
         不等 schedule 的 250ms 节流;挂上时 layoutMasonry 同步排首批。
         判空 + isConnected 两个检查都很轻,每次变异批次只多一次函数调用。 */
      if (WIDE.matches && (!masonEl || !masonEl.isConnected)) {
        try { watchFeed(); } catch (e) { /* ignore */ }
      }
      syncRouteClasses();
      if (routeChanged()) {
        if (timer) { clearTimeout(timer); timer = null; }
        try { build(); refresh(); } catch (e) { /* ignore */ }
      }
      schedule();
    }).observe(document.documentElement, {
      childList: true, subtree: true
    });
  } catch (e) { /* ignore */ }
})();
