/**
 * pulse 深色模式图片修复脚本。
 *
 * WebView 算法加深(Algorithmic Darkening)会破坏带透明背景的图片:
 * 暗色像素被提亮(微博 logo 的黑色瞳孔因此消失)、饱和色被洗淡。
 * 实测其变换对中间调颜色(如 #E89214)不做处理。
 *
 * 因此对顶栏 logo(.unlogin-logo,CSS 背景图)注入官方 SVG 的定制版:
 * 透明背景(无任何底框)、瞳孔改为中间调灰色,使其在算法加深后
 * 尽量接近原色。其余大尺寸透明图片仍垫白色圆角底(不透明图片的
 * 提亮幅度有限,观感可接受)。
 *
 * 所有步骤失败时静默跳过:最坏情况等于没有修复,不会破坏页面。
 */
(function () {
  /* boot():onPageStarted 注入时 DOM 往往还没解析(documentElement 不存在),
     直接 return 的话全部修复要等 onPageFinished 才生效 —— 登录页的站标预隐藏
     就是死在这一拍上:卡片与站标先挂载、原图先画出来,预隐藏晚到,
     用户看到的就是"进登录页先闪一下黄底黑字的原图"。改成 boot() 模式:
     DOM 已在就立即跑;不在就 observe document,html 一出现立即补跑 ——
     预隐藏 CSS 从**首次绘制之前**就位,原图根本没有出场机会。 */
  function boot() {
    if (!document.documentElement || window.__bwDarkFixReady) return;
    window.__bwDarkFixReady = true;

    var MIN_SIZE = 36;   // 更小的图标交给算法加深处理即可
    var MAX_SIDE = 1200; // 超大图片(海报等)不做处理

    function hasAlpha(im) {
      try {
        var probe = document.createElement('canvas');
        probe.width = 48;
        probe.height = 48;
        var ctx = probe.getContext('2d');
        ctx.drawImage(im, 0, 0, 48, 48);
        var data = ctx.getImageData(0, 0, 48, 48).data;
        for (var i = 3; i < data.length; i += 4) {
          if (data[i] < 250) return true;
        }
      } catch (e) { /* 跨域无 CORS 等情况:放弃该图 */ }
      return false;
    }

    /* 垫圆角底要读像素,只能走 crossOrigin 那条路;而 sinaimg 这类 CDN 大多不发
       CORS 头 —— 发出去的请求**全部作废**(实测一次看图就积出 89 条
       "Access to image … blocked by CORS",source 正是 #&gid=… 那一页)。
       弱网下这些注定白跑的请求挤掉同域那 6 条连接,真正要显示的图片反而排不上队,
       用户看到的就是"网络不好时刷流/打开图片卡死"。
       所以三件事:①同一个地址只试一次(成/败都记账,失败也记 —— 别再试);
       ②同一个域名错一次就拉黑(要么它不发 CORS,要么它此刻根本不通);
       ③同一地址在飞时后来的元素排队等结果,不再各发一份。
       代价:被拉黑的这一档这次会话里没有圆角底,与"处理失败"同一种退化。 */
    var BADGE_DONE = Object.create(null);    // url -> dataURL | null(试过,不适用)
    var BADGE_BAD = Object.create(null);     // 不发 CORS / 取不到的源
    var BADGE_GOING = Object.create(null);   // url -> [回调]

    /* 微博的图片全在 sinaimg/sinajs 这一族 CDN 上,而它们**从不**发 CORS 头,
       探测每一条都会作废。下面那条按域名拉黑要等第一次失败回来才生效,而一批扫描
       是并发发出去的 —— 于是每次整页加载都要白跑十几条(实测一轮刷流积出 68 条
       "Access to image … blocked by CORS",每条还顺带把那张图重新下一遍,
       弱网下挤掉的正是同域那 6 条连接)。按域名先挡在门口,不给它发出去的机会。 */
    var NO_CORS_HOST = /(^|\.)(sinaimg\.cn|sinajs\.cn)$/;

    function settleBadge(url, data) {
      BADGE_DONE[url] = data || null;
      var cbs = BADGE_GOING[url] || [];
      delete BADGE_GOING[url];
      if (!data) return;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](data); } catch (e) { /* ignore */ }
      }
    }

    function badge(url, apply) {
      var origin, host;
      try {
        var u = new URL(url, location.href);
        origin = u.origin;
        host = u.hostname;
      } catch (e) { return; }
      if (NO_CORS_HOST.test(host) || BADGE_BAD[origin]) return;
      if (url in BADGE_DONE) {
        if (BADGE_DONE[url]) apply(BADGE_DONE[url]);
        return;
      }
      if (BADGE_GOING[url]) { BADGE_GOING[url].push(apply); return; }
      BADGE_GOING[url] = [apply];
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        try {
          var w = im.naturalWidth, h = im.naturalHeight;
          if (!w || !h || Math.max(w, h) > MAX_SIDE || !hasAlpha(im)) {
            settleBadge(url, null);
            return;
          }
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          var r = Math.min(28, Math.min(w, h) * 0.24);
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.arcTo(w, 0, w, h, r);
          ctx.arcTo(w, h, 0, h, r);
          ctx.arcTo(0, h, 0, 0, r);
          ctx.arcTo(0, 0, w, 0, r);
          ctx.closePath();
          ctx.fill();
          ctx.drawImage(im, 0, 0, w, h);
          settleBadge(url, c.toDataURL('image/png'));
        } catch (e) { settleBadge(url, null); }
      };
      im.onerror = function () {
        BADGE_BAD[origin] = 1;
        settleBadge(url, null);
      };
      im.src = url;
    }

    function bigEnough(el) {
      var rect = el.getBoundingClientRect();
      return Math.max(rect.width, rect.height) >= MIN_SIZE;
    }

    /**
     * 头像一律不处理:算法加深本身不动不透明图片,但"垫白色圆角底"会把
     * 圆形头像变成深色页面上的白方块。判据 = 近正方形 + 圆形裁切。
     */
    function isAvatar(el) {
      var node = el;
      for (var depth = 0; node && depth < 3; node = node.parentElement, depth++) {
        if (/face|avator|avatar/i.test(node.className || '')) return true;
        var rect = node.getBoundingClientRect();
        var side = Math.min(rect.width, rect.height);
        if (side <= 0 || Math.abs(rect.width - rect.height) / side > 0.15) continue;
        var radius = 0;
        try { radius = parseFloat(getComputedStyle(node).borderRadius) || 0; } catch (e) { continue; }
        if (radius >= side * 0.4) return true;
      }
      return false;
    }

    function fixImg(img) {
      var src = img.currentSrc || img.src || '';
      if (!src || /^data:/i.test(src) || /\.gif(\?|#|$)/i.test(src)) return;
      if (img.__bwSrc === src) return; // 同一地址只处理一次
      if (!bigEnough(img) || isAvatar(img)) return;
      img.__bwSrc = src;
      badge(src, function (data) { img.src = data; });
    }

    /**
     * 小图被算法加深误判成"图标"的通用兜底(theme.js 的 6x 规则之外的场景)。
     *
     * 两类命中:
     *  - **圆形小头像**:加深本身不动不透明图片,但"垫白色圆角底"会把圆形头像
     *    变成深色页面上的白方块。判据 = 近正方形 + 圆形裁切。
     *  - **方角微博缩略图**(消息列表右侧那格 50x50):整张被反相 —— 实测浅档均值
     *    灰 59 → 深档 250,白块压深底(2026-10-07 用户报"@我的/评论/赞 右侧缩略图
     *    部分被反色")。它没有圆角,按 CDN 归属认出(头像是 /crop.、表情在
     *    face.t.sinajs.cn、功能图标在 h5…/upload/)。
     *
     * theme.js 那条 `.m-avatar-box .m-img-box img` 只罩得住主流头像位;站点模板里
     * 还有不带 .m-avatar-box 的头像位(榜单卡 card71 的 span.m-img-box、
     * 搜索讨论条里的本人小头像等),以及这里的消息缩略图。
     * 加深的"图标档"阈值随设备/WebView 版本/dpr 变化(同一枚头像,一台设备反相、
     * 另一台正常,多台设备实测过),所以兜底不猜阈值、只按形状与来源认内容图。
     *
     * 父盒贴身的直接放大;**父盒不贴身的先包壳再放大**:壳与原图同尺寸、
     * 同圆角、同 display(inline 除外,升 inline-block),视觉零变化 ——
     * 600% 的布局盒被壳的 overflow 裁住,不会把 flex/流式布局撑变形。
     * 壳不是任何 vnode,Vue patch 属性仍落在 img 上;父级整块重建时壳随子树
     * 一起丢弃,MutationObserver 下个扫描周期(200ms)会对新 img 重新判定,自愈。
     * 判定全程不读像素(sinaimg 无 CORS 也读不到)、不换 src、不多发请求。
     */
    function fixSmallImg(img) {
      if (img.__bwAv) return;
      var r = img.getBoundingClientRect();
      var side = Math.min(r.width, r.height);
      if (side < 12 || side > 96) return;                       // 反相只发生在小图
      if (Math.abs(r.width - r.height) / side > 0.15) return;   // 非近正方
      if (img.closest('.m-avatar-box') && img.closest('.m-img-box')) return; // CSS 已管
      var rad = '50%';
      try { rad = getComputedStyle(img).borderRadius || '50%'; } catch (e) { /* ignore */ }
      var host = img.parentElement;
      if (!host) return;
      var hostRad = 0;
      try { hostRad = parseFloat(getComputedStyle(host).borderRadius) || 0; } catch (e) { /* ignore */ }
      var round = Math.max(parseFloat(rad) || 0, hostRad) >= side * 0.35;
      /* 方角的那一档:按 CDN 归属认内容图,不枚举派生图名 —— 站点的
         thumbnail/thumb180/orj360/orj480/mw690/bmiddle… 十几叫法,实测同一屏就同时
         出现 orj360 与 orj480、thumb180(只列几个会漏)。
         排除:头像的 /crop.、/square.,表情域 face.t.sinajs.cn,功能图标 h5…/upload/。 */
      var src = img.currentSrc || img.src || '';
      /* 站点静态资源域(d.sinaimg.cn/prd/…)上是 UI 图标而不是内容图 —— 它们本来就按
         浅色卡面画,交给浏览器的算法加深去适配才对。套壳等于把加深挡掉,登录页那两颗
         实测就坏了:扫码变成深灰一坨(图标与底同色)、微信露出一圈亮边(摘壳后是中性灰)。 */
      if (/^https?:\/\/d\.sinaimg\.[a-z.]+\//i.test(src)) return;
      var photo = /sinaimg\.[a-z.]+\//i.test(src) &&
        !/\/(crop\.|square\.)/i.test(src) &&
        !/face\.t\.sinajs|h5\.sinaimg\.[a-z.]+\/upload\//i.test(src);
      if (!round && !photo) return;
      img.__bwAv = true;
      var hr = host.getBoundingClientRect();
      var snug = Math.abs(hr.width - r.width) <= 4 && Math.abs(hr.height - r.height) <= 4;
      if (snug) {
        host.style.setProperty('overflow', 'hidden', 'important');
      } else {
        var shell = document.createElement('span');
        shell.setAttribute('data-bw-avshell', '');
        var disp = 'inline-block';
        try {
          var d = getComputedStyle(img).display;
          if (d && d !== 'inline' && d !== 'inline-block') disp = d;
        } catch (e) { /* ignore */ }
        shell.style.cssText =
          'display:' + disp + ';position:relative;flex:none;' +
          'width:' + r.width + 'px;height:' + r.height + 'px;' +
          'border-radius:' + rad + ';overflow:hidden;';
        host.insertBefore(shell, img);
        shell.appendChild(img);
      }
      img.style.setProperty('width', '600%', 'important');
      img.style.setProperty('height', '600%', 'important');
      img.style.setProperty('max-width', 'none', 'important');
      img.style.setProperty('max-height', 'none', 'important');
      img.style.setProperty('transform', 'scale(.16666667)', 'important');
      img.style.setProperty('transform-origin', '0 0', 'important');
    }

    function fixBg(el) {
      if (el.__bwBg) return;
      if (el.classList && el.classList.contains('unlogin-logo')) return; // 由内置徽章接管
      if (isAvatar(el)) return;
      var bg = '';
      try { bg = getComputedStyle(el).backgroundImage || ''; } catch (e) { return; }
      var m = bg.match(/url\(["']?([^"')]+)/);
      if (!m) return;
      if (!bigEnough(el)) return;
      el.__bwBg = true;
      var url;
      try { url = new URL(m[1], location.href).href; } catch (e) { url = m[1]; }
      if (/^data:/i.test(url) || /\.gif(\?|#|$)/i.test(url)) return;
      badge(url, function (data) {
        el.style.setProperty('background-image', 'url("' + data + '")', 'important');
      });
    }

    /**
     * 登录页(passport)的"微博"站标:深色下用覆盖层画深色版,不动 img.src。
     *
     * 原图是「黄底 app 图标 + 近黑"微博"字」(112x36,实测解码采样)。深色卡面上
     * 那截黑字读不出来,而两条直觉改法都实测走不通:
     * ① invert(1)+hue-rotate(180) 滤镜 —— 被算法加深的"图像反反相"撤销,原图照旧透出;
     * ② 直接换 img.src —— src 是 vnode 属性,站点下次 patch 回写成原图;平板上 src
     *    虽留得住,浅色文字版深色图又被加深按"未适配深色的图"再反相一次,颜色全错。
     * 落地:叠一个与 img 同位同尺寸的 span 画深色版(字转 #BFBFBF、黄底图标保留),
     * img 本体 opacity 归零(src 留给 Vue 随便改)。
     * ⚠ background-image **并不豁免**于算法加深 —— 它同样按显示尺寸判定要不要反相,
     *    所以 span 必须放大 6 倍再缩回(见 placePassportLogo 下方)。
     */
    var PASSPORT_LOGO_DARK = 'data:image/png;base64,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';

    /* 覆盖层落位:offsetLeft/Top 相对 offsetParent —— 手机档 header 被我们置 static
       (锚是 .bg-card),平板档 header 是站点自己的 absolute(锚是 header),两种坐标系里
       span 都挂在 host 下、与 img 同一锚,天然对齐。
       每次扫描都要重钉:手机档卡片是 w-full,img 的居中位置随视口变(实测转屏后
       覆盖层偏 94px,而"span 已存在就 return"的写法永远不会纠正它)。
       签名比对避免每 200ms 重写同样的 inline style。返回 false = 还没布局好。 */
    function placePassportLogo(img, span) {
      var r = img.getBoundingClientRect();
      if (r.width < 10 || r.height < 5) return false;
      var bw = Math.round(r.width), bh = Math.round(r.height);
      var sig = img.offsetLeft + ',' + img.offsetTop + ',' + bw + 'x' + bh;
      if (span.__bwAt === sig) return true;
      span.__bwAt = sig;
      span.style.left = img.offsetLeft + 'px';
      span.style.top = img.offsetTop + 'px';
      span.style.width = (bw * 6) + 'px';
      span.style.height = (bh * 6) + 'px';
      return true;
    }

    /* 登录页渲染完之后就再没有 DOM 变更了,观察器/resize 都不会再触发重扫。
       首扫常常赶在 img 布局之前(实测平板首启:覆盖层停在 0x0 一整轮),
       所以没落位就自己催一次,最多 6s,页面真没布局好就不空转。 */
    var placeRetries = 0;
    function retryPlace() {
      if (placeRetries++ > 30) return;
      setTimeout(scheduleScan, 200);
    }

    function fixPassportLogo(img) {
      var hit = false;
      try { hit = img.matches('div.bg-card > div[class*="top-10"] img'); } catch (e) { /* ignore */ }
      if (!hit) return;
      var host = img.parentElement;
      if (!host) return;
      var span = document.getElementById('bw-dark-passport-logo');
      if (!span) {
        span = document.createElement('span');
        span.id = 'bw-dark-passport-logo';
        /* **布局盒必须放大到 6 倍再用 transform 缩回**:算法加深是否反相一张图,
           判据是它的显示尺寸(设备 px),而门槛随 dpr/WebView 版本漂移(实测 105~158)。
           这颗站标 62 CSS px:手机 dpr2.625 = 163 设备 px 在门槛之上(正常),
           平板 dpr2 = 124 设备 px 落在门槛之下 —— 覆盖层自己也被反相(黄底压暗、
           眼白与瞳孔对调、"微博"字从 191 压成 117),表现为"平板深色 logo 仍不正常"。
           放大 6 倍后布局盒 372x120 CSS(平板 744 设备 px)远离门槛,transform 只改
           视觉尺寸、不参与加深判定,实测逐像素还原(1017/1088 与源图一致)。 */
        span.style.cssText = 'position:absolute;transform:scale(.16666667);transform-origin:0 0;' +
          'background:url("' + PASSPORT_LOGO_DARK + '") no-repeat center / contain;' +
          'pointer-events:none;z-index:1;';
        host.appendChild(span);
        // 原图隐掉:src 留着(Vue 要回写随它),opacity 是 inline style,站点没绑这个属性
        img.style.opacity = '0';
      } else if (span.parentElement !== host) {
        host.appendChild(span); // 宿主被 Vue 整块重建过
      }
      if (!placePassportLogo(img, span)) retryPlace();
    }

    var timer = null;
    function scheduleScan() {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        try {
          var imgs = document.images;
          for (var i = 0; i < imgs.length; i++) { fixImg(imgs[i]); fixSmallImg(imgs[i]); fixPassportLogo(imgs[i]); }
          // CSS 背景图只可能是叶子节点(如未登录页 logo),避免全量 getComputedStyle
          var leaves = document.querySelectorAll('i,span,div,a,em');
          for (var j = 0; j < leaves.length; j++) {
            if (leaves[j].firstChild === null) fixBg(leaves[j]);
          }
        } catch (e) { /* ignore */ }
      }, 200);
    }

    window.__bwDarkScan = scheduleScan;


    try {
      new MutationObserver(function () {
        // 登录页站标覆盖层:缺失时即时补,不等 200ms 防抖 —— 否则每次切回账密视图,
        // 新挂载的 logo 会空一拍(预隐藏已把它藏了,覆盖层晚到就是空白)。
        // 位置漂移交给 scheduleScan 里的重钉(每次求值要读矩形,不放这条热路径)
        try {
          if (!document.getElementById('bw-dark-passport-logo')) {
            var pim = document.querySelector('div.bg-card > div[class*="top-10"] img');
            if (pim) fixPassportLogo(pim);
          }
        } catch (e) { /* ignore */ }
        scheduleScan();
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'style']
      });
    } catch (e) { /* ignore */ }

    /* 转屏/分屏只改布局、不产生 DOM 变更,观察器不会因此重扫 —— 单独挂 resize
       让覆盖层跟上(实测视口 411→320 时 img 左移 46px，覆盖层原地不动) */
    try {
      window.addEventListener('resize', scheduleScan, true);
    } catch (e) { /* ignore */ }

    try {
      // 未登录页的微博 logo 是 CSS 背景图且小于尺寸阈值,直接用官方徽章覆盖。
      //
      // 顶栏 pulse. 字标:算法加深对这张图的处置**随元素状态而变**(实测)——
      // 登录态(.lite-iconf-profile)不反相,故要给浅色版才看得见;
      // 未登录态(.unlogin-logo)整张图会被反相,给浅色版反而变黑,必须给深色版。
      // 两条规则按状态分别给源图,最终两边都呈现浅色;
      // 选择器多加 div 限定,确保压过 theme.js 里的浅色版声明。
      // 同一个 document 里可能被注入两次(onPageStarted + onPageFinished),
      // 复用同名节点,别在 head 里堆重复层
      var style = document.getElementById('bw-dark-logo') || document.createElement('style');
      style.id = 'bw-dark-logo';
      style.textContent =
        '.unlogin-logo{background-image:url("data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSLlm77lsYJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCAxMDAgODEiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDEwMCA4MTsiIHhtbDpzcGFjZT0icHJlc2VydmUiPiA8c3R5bGUgdHlwZT0idGV4dC9jc3MiPiAuc3Qwe2ZpbGw6I0ZGRkZGRjt9IC5zdDF7ZmlsbDojRDYyQjJBO30gLnN0MntmaWxsOiNFODkyMTQ7fSAuc3Qze2ZpbGw6IzgwODA4MDt9IDwvc3R5bGU+IDx0aXRsZT5uYXZpZ2F0aW9uYmFyX3JlbGVhc2U8L3RpdGxlPiA8ZGVzYz5DcmVhdGVkIHdpdGggU2tldGNoLjwvZGVzYz4gPGcgaWQ9IlBhZ2UtMSI+IDxnIGlkPSLmnKrnmbvlvZVf6aaW6aG1IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTAuMDAwMDAwLCAtMjcuMDAwMDAwKSI+IDxnIGlkPSJ0YWIiPiA8ZyBpZD0ibmF2aWdhdGlvbmJhcl9yZWxlYXNlLWNvcHkiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEwLjAwMDAwMCwgMjcuMDAwMDAwKSI+IDxnIGlkPSJHcm91cCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMi41MDAwMDAsIDQuNTAwMDAwKSI+IDxwYXRoIGlkPSJTaGFwZSIgY2xhc3M9InN0MCIgZD0iTTkuMSw0OS44YzAsMTAuNCwxMy43LDE5LDMwLjQsMTljMTYuOSwwLDMwLjQtOC41LDMwLjQtMTlTNTYuMiwzMC43LDM5LjUsMzAuNyBTOS4xLDM5LjMsOS4xLDQ5LjgiLz4gPHBhdGggaWQ9IlNoYXBlXzFfIiBjbGFzcz0ic3QxIiBkPSJNNzAsMzQuN2MtMS4zLTAuNC0yLjItMC42LTEuNC0yLjJjMS40LTMuNiwxLjUtNi43LDAtOC45Yy0zLTQuMS0xMS00LTIwLjEtMC4xIGMwLDAtMi45LDEuMy0yLjItMS4xYzEuNC00LjUsMS4yLTguMy0xLTEwLjZDNDAuNCw2LjgsMjcuMywxMiwxNS45LDIzLjJDNy41LDMxLjcsMi41LDQwLjcsMi41LDQ4LjYgYzAsMTQuOCwxOS4yLDIzLjksMzcuOCwyMy45YzI0LjUsMCw0MC44LTE0LjMsNDAuOC0yNS41QzgxLDQwLjEsNzUuMSwzNi4zLDcwLDM0Ljd6IE00MC4yLDY3LjFDMjUuNCw2OC42LDEyLjQsNjEuOSwxMS40LDUyIGMtMS05LjcsMTAuMy0xOC45LDI1LjItMjAuM3MyNy44LDUuMiwyOC44LDE1LjFDNjYuNSw1Ni41LDU1LjEsNjUuNyw0MC4yLDY3LjF6Ii8+IDxwYXRoIGlkPSJTaGFwZV8yXyIgY2xhc3M9InN0MiIgZD0iTTg2LjMsNy40Yy01LjktNi41LTE0LjYtOS0yMi43LTcuM2wwLDBjLTEuOSwwLjQtMy4xLDIuMi0yLjYsNGMwLjQsMS45LDIuMiwzLjEsNCwyLjYgYzUuNy0xLjIsMTEuOSwwLjYsMTYuMiw1LjJjNC4xLDQuNyw1LjMsMTEuMSwzLjYsMTYuNmwwLDBjLTAuNiwxLjgsMC40LDMuOCwyLjIsNC40YzEuOCwwLjYsMy44LTAuNCw0LjQtMi4ybDAsMCBDOTMuOCwyMi45LDkyLjIsMTQsODYuMyw3LjQiLz4gPHBhdGggaWQ9IlNoYXBlXzNfIiBjbGFzcz0ic3QyIiBkPSJNNzcuMiwxNS43Yy0yLjktMy4yLTcuMS00LjQtMTEuMS0zLjZjLTEuNSwwLjQtMi42LDEuOS0yLjIsMy42YzAuNCwxLjUsMS45LDIuNiwzLjYsMi4yIGwwLDBjMS45LTAuNCw0LDAuMyw1LjMsMS44YzEuNCwxLjUsMS44LDMuNywxLjIsNS42bDAsMGMtMC40LDEuNSwwLjQsMy4yLDEuOSwzLjdjMS41LDAuNCwzLjItMC40LDMuNy0xLjkgQzgwLjksMjMuMSw4MC4yLDE4LjgsNzcuMiwxNS43Ii8+IDxwYXRoIGlkPSJTaGFwZV80XyIgY2xhc3M9InN0MyIgZD0iTTQxLjcsMzkuM2MtNy4xLTEuOS0xNS4xLDEuNi0xOC4yLDhzLTAuMSwxMy40LDcsMTUuOGM3LjQsMi4zLDE2LjItMS4zLDE5LjMtOC4yIEM1Mi44LDQ4LjEsNDkuMSw0MS4yLDQxLjcsMzkuM3ogTTM2LjMsNTUuNWMtMS40LDIuMi00LjUsMy4zLTYuOSwyLjJjLTIuMi0xLjEtMy0zLjctMS41LTUuOWMxLjQtMi4yLDQuNC0zLjIsNi43LTIuMiBDMzcsNTAuNiwzNy43LDUzLjIsMzYuMyw1NS41eiBNNDEsNDkuNGMtMC40LDEtMS42LDEuMy0yLjYsMWMtMC44LTAuNC0xLjItMS4zLTAuNy0yLjJjMC40LTAuOCwxLjYtMS4zLDIuNS0xIEM0MS4zLDQ3LjUsNDEuNSw0OC42LDQxLDQ5LjR6Ii8+IDwvZz4gPC9nPiA8L2c+IDwvZz4gPC9nPiA8L3N2Zz4=") !important}' +
        '#app .main-wrap .lite-topbar div.nav-left{background-image:url("data:image/png;base64,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") !important}' +
        '#app .main-wrap .lite-topbar div.nav-left.unlogin-logo{background-image:url("data:image/png;base64,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") !important}' +
        /* 关于页顶部那张 `微博` 字标和 App 图标在同一张 PNG 里,深色下系统加深
           不动图片内容:字标仍是近黑,压在 #111 上几乎看不见(2026-10-24 用户报)。
           原图不动,只在深色档换一张把字标提亮到 #BFBFBF 的同尺寸版本。 */
        'html.bw-setup .lite-logo{background-image:url("data:image/png;base64,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") !important}';
      /* 必须每次都 appendChild(已存在的节点会被**移到末尾**):深色令牌要压在
         theme.js 的 #bw-theme 之后才赢得过它。之前写成"已挂载就不动",一旦
         theme.js 在 onPageFinished 里把自己重挂到末尾,浅色 :root 就反过来覆盖了
         深色令牌 —— 实测系统深色下 --bw-line 仍是 #F2F2F2、页面底渲成 35 一档
         (即表现为"四条颜色全对不上") */
      (document.head || document.documentElement).appendChild(style);

      /* 深色下的"发丝线"问题:算法加深会改写 border 的颜色,深色下这两条细线
         成为突兀亮带。它的映射不可预测且非单调(同一张卡上实测 rgba(16,24,40,.05)→亮度 21、
         #3A3A3A→46、#E5E7EB→65、#555555→97、#454545→116 —— 输入更暗的渲染得更亮),
         所以深色下想要一条确定的线不能用 border。浅色模式的发丝线维持原样
         (本文件只在深色注入);深色下撤掉转评赞区这两条,统计条与评论区交界依旧干净
         (两档断点都覆盖:手机 ≤767 与平板 ≥768)。
         深色档的表面对色:把 theme.js :root 那套令牌换掉,全站一起转深(页面底 / 卡面 /
         转发引用区 / 楼中楼 / 卡外框线 / 按压态 / 顶栏玻璃)。两个实测前提:
         ① 算法加深不改写 box-shadow(声明即渲染),所以卡外那 1px 框线走 box-shadow;
         ② background-color 给深色实色同样原值直穿(声明 #191919 → 渲染 rgb(25,25,25)),
            不必反推映射结果。顶栏玻璃给 rgba(17,17,17,.72) —— 与页面底同色,
            页面顶部的合成值正好等于页面底(分界 0),内容滚到栏下才透出来;
            之前这里跟着浅色档用 rgba(255,255,255,.5),被加深成 26 一档,
            压在 35 一档的页面底上就是一条横向分界线。 */
      var lineStyle = document.getElementById('bw-dark-token') || document.createElement('style');
      lineStyle.id = 'bw-dark-token';
      lineStyle.textContent =
        ':root{--bw-page:#111111;--bw-card:#191919;--bw-rp:#131313;--bw-line:#222222;' +
        '--bw-card-active:#1F1F1F;--bw-glass:rgba(17,17,17,.72);' +
        /* 悬浮件(底部导航胶囊/返回球/设置胶囊/右侧动作栏)统一给**卡面实色 #191919**:
           2026-09-25 需求明确为"平板端导航栏、返回按钮、我的页面右上角设置按钮等
           背景色改为 #191919,并与其他元素一样带 1px #222222 的边框"。
           之前给的是 rgba(17,17,17,.78) 玻璃态 —— 静态合成值等于页面底(17),
           悬浮件因此与页面底"融"在一起,只在滚到内容上时才看得出边界。
           改实色后与卡片完全同材质,靠 --bw-chip-line 的 1px 线界定边界。 */
        '--bw-chip:#191919;' +
        /* 悬浮件描边:与全站卡框同色(--bw-line=#222222)。outline 原值直穿,
           实测声明 #222222 渲染即 34,34,34 */
        '--bw-chip-line:#222222;' +
        /* 遮罩换成纯黑:浅色列的 rgba(16,24,40,.34) 是蓝调的,深色下压在全页上
           实测整页主色变成 rgb(18,21,27)(蓝-绿 +6)= 表现为「点更多后整页变蓝」 */
        '--bw-scrim:rgba(0,0,0,.62);' +
        /* "+x" 面牌(超过 9 图的微博第 9 格)的深色档,两个值都有实测支撑:
           ① 罩沿用浅色档那条 rgba(19,19,19,.94) 时,与 #191919 卡面合成到同一档:
              实测牌 31,30,27 / 卡底 25,25,25 → 对比 1.06:1,整块读作"没图的空格子"。
              换成中性灰 rgba(92,92,92,.84) → 实测牌 107,104,98(其中 16% 是第 9 格
              那张图透出来的底),对卡底 3.2:1,图的轮廓也还在。
           ② 发丝线跟着从半透明白降到 191 灰:罩本身已经托得住,这条线只剩收边的作用,
              不必再留一条比罩还亮的白。
           取值边界(往这块牌上临时写颜色、逐张截图量出来的):#191919→25、
           #5C5C5C→92、#BFBFBF→191 原值直穿,只有纯白被打到 18。
           字形**不拆令牌**:加深映射搬 background、不搬 color —— 同一块牌上写
           color:#FFFFFF 实测仍渲染 255,所以两档都用白字。 */
        '--bw-more-veil:rgba(92,92,92,.84);' +
        '--bw-more-line:rgba(191,191,191,.35);' +
        /* 悬浮件(底部导航胶囊)的投影:浅色档那条 rgba(16,24,40,.10) 四向外扩 16px,
           压在 #111111 页面底上会把胶囊周边一整圈压到 16 一档,并在胶囊上下缘
           留下两条硬边 —— 表现为"悬浮导航栏玻璃态有断层"。
           深色下换成"只向下、更短、纯黑"的一条,不让投影横向外扩去改页面底。 */
        '--bw-chip-shadow:0 1px 4px rgba(0,0,0,.22);' +
        /* 深色主文字统一到 #BFBFBF。实测加深**不改写这一档**:
           声明 #BFBFBF → 渲染 191.0、#9E9E9E→158、#AEAEAE→174(全是原值直穿),
           而站点自己的 #333 会被反成 223、#222→246 —— 同一页里三种「白」。
           只罩正文级文字;来源/转评赞计数/占位符这些故意做弱的不动。 */
        /* "编辑个人资料"按钮的深色档:theme.js 那份 :root 是**浅色档**
           (#e5e6eb 底 + #1C1C1E 字,2026-09-26 按需求;边框 #f2f2f2 由
           --bw-line 的浅色档给出)。这里只把两个令牌换回深色档,
           与 --bw-line 的深色档 #222222 一起,深色下仍是 #2c2c2c 底 + #BFBFBF 字。 */
        '--bw-btn-neutral:#2c2c2c;--bw-btn-neutral-text:#BFBFBF;' +
        /* 悬浮导航胶囊的玻璃底(2026-09-26 按需求改回玻璃态)。
           取"卡面色 #191919 略提一档 + 0.70 透明":压在卡面(25)上合成 ≈30、
           压在页面底(17)上合成 ≈27 —— 两种底上都托得住,再靠 --bw-chip-line
           的 1px outline(34)收边。不用页面底色做透明底:那会让胶囊
           在页面底上完全隐形(曾表现为"融在一起")。 */
        '--bw-nav-glass:rgba(32,32,32,.70);' +
        /* 悬浮件文字:设置胶囊的"设置"二字不再用品牌蓝,深色档跟正文同档 #BFBFBF */
        '--bw-chip-text:#BFBFBF;' +
        /* 消息页四个入口(@我的/评论/赞/未关注人私信)的 iconfont 字形:
           theme.js 在浅色把白字形反成弱化墨色(那里圆底被盖成 #F9F9F9,白字不可见);
           深色圆底是 --bw-rp=#131313,字形必须回白色才可见 —— 与站点原状一致 */
        '--bw-msg-glyph:#FFFFFF;' +
        /* 二级页顶栏标题(卡片页 /p/… 的 .m-top-bar h3):浅色档是深墨 #1C1C1E,
           深色下必须换浅色,否则深墨压深底直接看不见 */
        '--bw-page-title:#BFBFBF;' +
        '}' +
        '.weibo-text,.name,.f-art-tit,.cmt-wrapper .txt,.cmt-sub-txt,.weibo-rp .txt' +
        '{color:#BFBFBF !important;}' +
        /* pulse 字标 PNG 本身就是「近白字 + 蓝点」(实测像素 (245,246,248) 与 (124,163,244))。
           原来用 brightness(0) invert(.749) 压档,把整个字标洗成单一灰,蓝点跟着没了。
           改成只降明度、不动色相:brightness(.78) → 245*.78=191(与正文同档),
           蓝点 124,163,244 → 97,127,190 仍是蓝的。 */
        '#app .main-wrap .lite-topbar .nav-left{filter:brightness(.78) !important;}' +
        /* 登录页(passport)站标:深色版由上方 fixPassportLogo 的覆盖层(background-image)
           绘制 —— invert 滤镜会被算法加深"反反相"撤销、换 src 会被 Vue 回写/再反相,
           两条路都实测走不通。这条规则负责**首帧预隐藏**:覆盖层要等扫描周期才落地,
           不预隐藏的话每次进登录页都先闪一下原图(黄底图标 + 近黑字压深底)。
           img 被隐藏后布局尺寸不变,覆盖层按 img 的 offsetLeft/Top 精确落位。
           注意:本注释块**不能以"注释结束符 + 加号"收尾** —— 那样字符串拼接里的第二个
           加号会被解析成一元正号,字符串取正得 NaN,拼进 CSS 就是字面量 "NaN",
           整条规则静默消失(语法合法,node --check 查不出)。 */
        'div.bg-card > div[class*="top-10"] img{opacity:0 !important;}' +
        'html.bw-deep #app .lite-page-wrap .lite-page-tab{border-bottom:0 !important;}' +
        '.comment-content .lite-line{border-top:0 !important;}' +
        /* 站点在列表行上写了 **透明** 的 1px 边框(私信行 .lite-li、右侧栏 .lite-line,
           实测 border-top:1px rgba(0,0,0,0)),算法加深会把它画成一条不透明亮灰 ——
           私信页每行顶部实测亮度 175(页面底 17),就是那条亮线。
           浅色下这层边框本来就是透明的,所以深色下把宽度归零不会丢任何分隔信息。 */
        '#app .lite-line,#app .lite-li{border-top:0 !important;border-bottom:0 !important;}' +
        /* 表情面板底部分类导航的选中态:站点写的是实心 #F6F6F6 药丸(实测
           `.nav li.cur` computed = rgb(246,246,246)),浅色档是"比卡面略暗一档",
           深色档压在卡面 #191919 上就成了一块白。换类时站点用 background-color
           过渡(实测 alpha 从 .07 逐帧爬到 1,同时旧项从 .93 退到 0),
           中途两枚药丸同时发白 —— 用户看到的就是"翻到下一类时标签条闪一下白"。
           这里改成浅色半透明:压在卡面(25)上合成约 48,托得住又不出白块。 */
        '#app .emotionGroups .nav li.cur{background:rgba(255,255,255,.10) !important;}' +
        /* 表情面板的雪碧图被算法加深**按格**改了颜色(同一张图,21 格里只有个别格被改)。
           实测 default 类:微笑/黑线/可爱三格的蓝通道被压掉一半
           (真值 156,134,65 → 画上 125,109,29,ΔB-36),同类的汗/哼/挤眼 只降 6~13 ——
           黄色表情变成发暗的"芥末黄",用户看到的就是"部分表情被反色"。
           给面板这一棵子树声明 `color-scheme:dark`(= 告诉加深"这块作者自己管深色"),
           三格的 ΔB 回到 -6~-10,与同类一致,黄色恢复。
           **只写在面板上,不写 :root**:根上写 dark 会让整个页面的算法加深停摆,
           而我们这套深色底本来就是"我们自己填色 + 算法加深补背景"两套合起来的。 */
        '#app .emotionGroups{color-scheme:dark !important;}' +
        /* 上面那句的连带后果:子树既然自己管深色,算法加深就不再替我们兜
           "站点写死的浅色底"。实测两处会露出来(手机端 2026-10-07 直接看到分类栏整条白):
             .nav        背景写死 #FFF     —— 加深时约 #18,现在原样白
             .dots .dot  背景写死 #E2E2E2  —— 加深后实测 (49,49,49),现在 (226,226,226)
           所以这两处必须自己给:分类条直接透明(卡面本就是 #191919),
           圆点给 10% 白 —— 压在卡面(25)上合成约 49,与加深那一版实测值同档。
           当前页的橙色圆点 (#FF8200) 两版实测都是 (255,130,0),本来就不受加深影响,
           这里不动 —— 它由 theme.js 统一换成主题蓝(深浅两档同色)。 */
        '#app .emotionGroups .nav{background:transparent !important;}' +
        /* 圆点要**只改非当前页**的那几颗:当前页那颗由 theme.js 换成主题蓝,
           写成 `.dot` 会连它一起盖掉(实测亮点直接没了,2026-10-07 用户报)。 */
        '#app .emotionGroups .dots .dot:not(.cur){background:rgba(255,255,255,.10) !important;}' +
        /* 按住表情的选中底:站点用 v-mactive 给 .face-wrap 挂 .m-active 类,
           底色写死 #E6E6E6(实测按住时 computed = rgb(230,230,230))。
           浅色档它是"比白卡暗 25",深色档照搬就是黑卡上一块亮灰。
           给同档的反差:10% 白压在卡面(25)上 ≈ 49,与浅档的 230/255 同一距离。 */
        '#app .emotionGroups .face-wrap.m-active{background:rgba(255,255,255,.105) !important;}' +
        /* 设置族的开关:蓝色胶囊是主题色,里面的白色圆钮是 .woo-switch__main::after。
           白底会被算法加深打到 18 一档,压在蓝胶囊上就变成"蓝圈里一个黑洞"。
           这棵子树里只有我们自己给的两档色 + 白钮,声明 color-scheme:dark 让加深
           停在这一层,白钮才能保持白色。关态轨道同步换 #222(浅色档 #E9E9EA 在
           深色下会让白钮浮在一块亮灰上)。 */
        '.woo-switch__main{color-scheme:dark !important;}' +
        '.woo-switch__main:not(.is-checked){background:#222222 !important;}';
      /* ===== 层叠顺序自愈(必须保留) =====
         深色令牌要压在 theme.js 的 #bw-theme **之后**才赢。必须每次都
         appendChild(已存在的节点会被移到末尾);写成"已挂载就不动"的话,
         一旦 theme.js 把自己重挂/重建到末尾,浅色 :root 又会反过来覆盖
         深色令牌(实测 --bw-line 仍是 #F2F2F2、页面底渲成 35 一档)。
         同时把 #bw-theme 一并确保排在自己前面 —— theme.js 的延迟 apply()
         是竞态触发点,这里兜住另一侧,两边任一侧先跑都能收敛到正确顺序。 */
      (document.head || document.documentElement).appendChild(lineStyle);
      var themeStyle = document.getElementById('bw-theme');
      if (themeStyle && themeStyle.compareDocumentPosition(lineStyle) & Node.DOCUMENT_POSITION_PRECEDING) {
        (document.head || document.documentElement).insertBefore(themeStyle, lineStyle);
      }
    } catch (e) { /* ignore */ }
  }

  /* DOM 已在(正常的 onPageFinished 注入/重注入):立即跑。
     不在(onPageStarted):observe document,html 一出现立即 boot;
     readystatechange 兜底(极端情况下 observer 建失败的退路)。 */
  if (document.documentElement) {
    boot();
  } else {
    try {
      var mo = new MutationObserver(function () {
        if (document.documentElement) { mo.disconnect(); boot(); }
      });
      mo.observe(document, { childList: true });
    } catch (e) { /* ignore */ }
    document.addEventListener('readystatechange', function () { boot(); });
  }
  if (window.__bwDarkScan) window.__bwDarkScan();
})();
