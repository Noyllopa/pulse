# pulse

一个跑在安卓上的 m.weibo.cn 客户端：WebView 套壳 + 注入式样式与导航改造。
跟随系统深浅色、平板/横屏自适应双列、掐掉信息流广告、长按下载图片。

![pulse 在手机与平板上的深色模式](docs/img/hero.png)

> **这是早期版本。** 版本号 `1.0.1-alpha.1`，还在预发布阶段。
> 它是我为了自己刷微博不硌手写的，不是产品：没有自动化测试，改动基本只在
> Android 模拟器的手机和平板上验证过，真机覆盖很少，微博一改版它就有可能坏。
>
> 想要一个稳定、长期有人维护的微博客户端，这里没有。想看看给一个网页套壳能做到
> 哪一步，下面的实现笔记大概有点意思。

## 截图

| 手机 · 深色 · 首页 | 手机 · 浅色 · 首页 | 手机 · 深色 · 正文页 |
| --- | --- | --- |
| ![](docs/img/screenshot-phone-home-dark.png) | ![](docs/img/screenshot-phone-home-light.png) | ![](docs/img/screenshot-phone-detail-dark.png) |

| 平板 · 深色 · 双列首页 | 平板 · 浅色 · 双列首页 |
| --- | --- |
| ![](docs/img/screenshot-tablet-home-dark.png) | ![](docs/img/screenshot-tablet-home-light.png) |

**截图里的内容全部是模拟数据。** 昵称、头像、正文、配图、时间、属地都是占位生成，
与任何真实账号无关。机身外框是后期合成的示意图，不代表任何具体机型。

## 它做了什么

深浅色跟随系统。用的是 androidx.webkit 的算法加深，没有另写一套暗色样式。代价是算法加深
会把小图当图标反相、把饱和色洗淡，所以配了一整套补偿：头像靠"布局盒放大 6 倍再用
`transform` 缩回"躲开反相阈值，顶栏 logo 换成定制 SVG，纯黑改成中间调灰。
细节在[深色模式实现](#深色模式实现)。

宽屏（≥768px）下信息流走双列，正文页限宽居中，底部那颗悬浮导航胶囊改成左侧竖排。
悬浮导航和发博球都是注入出来的，替代站点原来贴在页面最底下的导航，下滑时自动收起，
免得压在内容上。

广告拦截只掐信息流里百度联盟槽位的三层请求（`/status/baiduad`、`/status/banner`、
`cpro.baidustatic.com` 等），主文档导航不动。

长按图片可以下载或复制地址，用 WebView 自带的命中测试加系统 `DownloadManager`，
没有为此另开一条 JS 桥。

剩下的是些零碎：视频滑动快进快退、下拉刷新、返回键走网页历史、全屏视频交给原生容器。

所有 http/https 都在应用内加载，`sinaweibo://` 之类的自定义协议一律拦截，
登录过程不会把你甩到外部浏览器。

## 已知限制

按严重程度排。下面这些是现状，不是待办清单。

1. 注入的样式和导航改造靠微博页面里的类名定位（`.card9`、`.weibo-top`、`#box`、
   Vue 的 `.m-box` 等），微博改版会立刻让一部分规则失效。而且站点同时存在三套页面架构：
   新版 SPA、老版 `#box` 服务端直出、`card.weibo.com` 的头条文章页。同一类页面在不同架构下
   类名不一样，只按一种架构写的规则在另一种上会安静地不生效。

2. 平板双列还是会跳。站点自己用虚拟列表记账，每张卡渲染后量一次 `offsetHeight` 存进 `.hei`；
   双列下每次回收顶部卡片，`padding_top` 的增量约是列内实际腾空量的两倍，于是加载新微博时
   页面往上飞。现在的做法是按双列口径重写它的账本（行位固定 + 滚动空间伺服）。实测平板长程
   40 次滑动 0.28 次/万像素，收官 12 次滑动 1.04 次/万像素（判据：同一张卡在 `|ΔscrollY|≤2`
   的帧里屏幕位置变化 >6px 记一次）。残留的那几次基本都落在冷启动首屏图片加载完成时的
   单列内部重排。要彻底消掉得给图片预留宽高比占位，还没做。

3. 深色顶栏切换的瞬间可能闪。代码按"给 `backdrop-filter` 预热、消除切换瞬间新建表面"改过
   也装机了，但在模拟器上四套仪器（截屏流、图层树事件、CPU 降频）都拿不到可复现的证据。
   所以这条只能算"改了、没验证"。真机如果还闪，先分清亮的是"整条一起泛白"还是
   "跟着内容走的局部亮晕"，这两种成因的修法完全不同。

4. 没有测试。一行自动化测试都没有，所有结论来自模拟器和 CDP 实测。改 A 有可能坏 B。

5. 只有中文界面。字符串全在 `res/values/strings.xml`，没做多语言。

6. 发布版未签名。仓库里不放任何密钥，`assembleRelease` 出来的是装不上的 APK，
   要自己配签名。

## 隐私与安全

- 没有统计、没有埋点、没有第三方 SDK。除了微博自己的域名，不发任何请求。
- 登录凭据是微博下发的 Cookie，存在应用私有目录里由系统 WebView 管着，本应用不上传也不导出。
- DevTools 只在 debug 构建开放（按 `FLAG_DEBUGGABLE` 判定），release 包挂不上 `chrome://inspect`。
- 明文 http 只对微博系域名放行，其余域名禁止（见 `res/xml/network_security_config.xml`）。
- `allowBackup="true"` 是现状，意味着系统备份可能带上登录态。**在意就关掉设备上的应用备份。**

## 环境要求

- JDK 17
- Android SDK：`compileSdk 37`（`minSdk 24` / `targetSdk 34`）。build-tools 由 AGP 自选，
  项目里不固定版本
- Gradle 由 wrapper 提供（9.7.1），本机不用装

`local.properties` 里写你的 SDK 路径（该文件已被 gitignore）：

```properties
sdk.dir=C\:/Users/you/AppData/Local/Android/Sdk
```

依赖仓库优先走阿里云镜像、失败回落官方源（见 `settings.gradle.kts`）。
镜像不可达的环境里构建会慢一些，但不会失败。

## 构建

```bash
./gradlew assembleDebug        # 或 Windows 下 gradlew.bat assembleDebug
./gradlew assembleRelease
```

产物除了默认的 `app/build/outputs/apk/…`，还会按版本号复制到仓库**外**的产物目录
（默认与仓库同级的 `../release`，可用 `-Ppulse.outDir=<路径>` 改）：

```
release/pulse-1.0.1-alpha.1-debug.apk
release/pulse-1.0.1-alpha.1-release.apk   # 未签名
```

## 安装

开启「USB 调试」后：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

也可以把 APK 传到手机直接点开安装（需允许未知来源）。

## 深色模式实现

算法加深（`WebSettingsCompat.setAlgorithmicDarkeningAllowed`）会把颜色映射到暗色区间。
它对三类东西的处理是有害的，`assets/dark_fix.js` 和 `assets/theme.js` 分别补偿。

**小图被当图标反相。** 判据是显示尺寸，不是原图尺寸：同一张 180px 头像塞进 15 格矩阵实测，
布局盒 24/32/48 CSS px 一律被施加 `invert(1) hue-rotate(180deg)`，64/96/128px 一律正常，
门槛落在约 105–158 设备 px 之间，还会随 dpr 和 WebView 版本漂移。微博头像恰好都是
32–50px 的圆图，全在反相区里。补偿办法是把布局盒放大到 6 倍，再用
`transform: scale(.16666667)` 缩回原视觉尺寸，视觉尺寸、圆角、位置都不变，也不加滤镜、
不读像素、不多发一次请求。

本来有更直接的办法：叠一层补偿滤镜。实测 `invert(1) hue-rotate(180deg)` 能精确还原，
但 CSS 滤镜和 Blink 的事后滤镜是叠加关系而不是互斥，给没被反相的图加上就会把好的弄坏，
于是必须逐图判定；判定要读像素，而 `*.sinaimg.cn` 不发 CORS 头，根本读不到。这条路整个放弃。

**logo 被破坏。** 顶栏 logo 换成官方 SVG 的定制版：透明背景，瞳孔用中间调灰 `#808080`。
算法加深不改变中间调，所以暗色下它仍然认得出来。

**头像不垫白底。** 早期给大尺寸透明图垫过白色圆角底，头像一律排除（判据：近正方形加圆形裁切，
或类名含 `face`/`avator`）。垫白底只会把圆形头像变成深色页面上的一个白方块。

## 目录结构

```
app/src/main/
  java/com/noyllopa/pulse/MainActivity.java   WebView 容器、系统栏避让、广告拦截、下载
  assets/theme.js        注入样式：卡片化、顶栏与悬浮导航改造、平板双列与字号
  assets/nav.js          悬浮导航、分组选择框、返回球、发博球
  assets/dark_fix.js     深色下的图片/玻璃态补偿
  assets/swipe_seek.js   视频滑动快进快退
docs/img/                演示截图（模拟数据）
```

## 版本号规则

`主版本.次版本.修订号[-预发布标识]`，正式版不带任何后缀。

`versionCode` 由版本号编码而来：主×10⁶ + 次×10⁴ + 修订×100 + 预发布槽位，正式版占同一修订号的
最高槽 99。所以 `1.0.1-alpha.1`（1000101）能直接升级到 `1.0.1`（1000199）。
改版本只需要动 `app/build.gradle.kts` 里的 `pulseVersion` 一行。

## 参与

先读 [CONTRIBUTING.md](CONTRIBUTING.md)。提 bug 请尽量带上机型、系统版本、WebView 版本、
微博页面 URL 和截图。这个项目里"看起来一样"的现象往往有好几个不同成因，缺环境信息基本只能
回一句复现不了。

安全问题按 [SECURITY.md](SECURITY.md) 私下报，不要开公开 issue。

## 免责声明

- 本项目与新浪微博、新浪集团没有任何关系。"微博 / Weibo" 及相关标识归各自权利人所有。
- 本应用通过网页界面访问微博，**没有用官方开放 API**。这类用法可能不符合微博的服务条款，
  账号风险由使用者自己承担。
- 代码按 MIT 许可提供，没有任何形式的保证。

## 许可

[MIT](LICENSE) © 2026 Noyllopa
