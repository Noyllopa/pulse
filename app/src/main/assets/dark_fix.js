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
  if (!document.documentElement) return;

  if (!window.__bwDarkFixReady) {
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

    function badge(url, apply) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        try {
          var w = im.naturalWidth, h = im.naturalHeight;
          if (!w || !h || Math.max(w, h) > MAX_SIDE || !hasAlpha(im)) return;
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
          apply(c.toDataURL('image/png'));
        } catch (e) { /* ignore */ }
      };
      im.onerror = function () { /* ignore */ };
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
     * 圆形小头像反相的通用兜底(theme.js 的 6x 规则之外的场景)。
     *
     * theme.js 那条 `.m-avatar-box .m-img-box img` 只罩得住主流头像位;站点模板里
     * 还有不带 .m-avatar-box 的头像位(榜单卡 card71 的 span.m-img-box、
     * 搜索讨论条里的本人小头像等)。反相阈值随设备/WebView 版本/dpr 变化
     * (同一枚头像,一台设备反相、另一台正常,两台模拟器+真机均实测过),
     * 所以兜底不猜阈值、只按形状判定:小 + 近正方 + 圆形裁切,命中即上 6x 躲法。
     *
     * 父盒贴身的直接放大;**父盒不贴身的先包壳再放大**:壳与原图同尺寸、
     * 同圆角、同 display(inline 除外,升 inline-block),视觉零变化 ——
     * 600% 的布局盒被壳的 overflow 裁住,不会把 flex/流式布局撑变形。
     * 壳不是任何 vnode,Vue patch 属性仍落在 img 上;父级整块重建时壳随子树
     * 一起丢弃,MutationObserver 下个扫描周期(200ms)会对新 img 重新判定,自愈。
     * 判定全程不读像素(sinaimg 无 CORS 也读不到)、不换 src、不多发请求。
     */
    function fixAvatarImg(img) {
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
      if (Math.max(parseFloat(rad) || 0, hostRad) < side * 0.35) return; // 不是圆形裁切
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

    var timer = null;
    function scheduleScan() {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        try {
          var imgs = document.images;
          for (var i = 0; i < imgs.length; i++) { fixImg(imgs[i]); fixAvatarImg(imgs[i]); }
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
      new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'style']
      });
    } catch (e) { /* ignore */ }

    try {
      // 未登录页的微博 logo 是 CSS 背景图且小于尺寸阈值,直接用官方徽章覆盖。
      //
      // 顶栏 pulse. 字标:算法加深对这张图的处置**随元素状态而变**(两台模拟器实测)——
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
        '#app .main-wrap .lite-topbar div.nav-left.unlogin-logo{background-image:url("data:image/png;base64,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") !important}';
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
        'html.bw-deep #app .lite-page-wrap .lite-page-tab{border-bottom:0 !important;}' +
        '.comment-content .lite-line{border-top:0 !important;}' +
        /* 站点在列表行上写了 **透明** 的 1px 边框(私信行 .lite-li、右侧栏 .lite-line,
           实测 border-top:1px rgba(0,0,0,0)),算法加深会把它画成一条不透明亮灰 ——
           私信页每行顶部实测亮度 175(页面底 17),就是那条亮线。
           浅色下这层边框本来就是透明的,所以深色下把宽度归零不会丢任何分隔信息。 */
        '#app .lite-line,#app .lite-li{border-top:0 !important;border-bottom:0 !important;}';
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

  if (window.__bwDarkScan) window.__bwDarkScan();
})();
