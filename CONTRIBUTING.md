# 参与开发

先说清楚现状，免得你花时间之后觉得被辜负：这是一个早期阶段的单人业余项目，
没有自动化测试，主要验证环境是 Android 模拟器的手机与平板各一台。
它的能力上限基本就是"给一个网页套壳 + 注入样式"能做到的事。

## 环境

1. JDK 17；Android SDK 满足 `compileSdk 37`（build-tools 版本由 AGP 自选，不固定）。
2. `local.properties` 写 `sdk.dir=…`（该文件不会进仓库）。
3. `./gradlew assembleDebug` 能通过就算环境就绪。产物会同时出现在
   `app/build/outputs/apk/debug/` 与仓库同级的 `release/` 下。
4. 想出能安装的 release 包按 README 的「构建」配 `keystore.properties`。
   仓库只有一个 tag 触发的发布工作流：推一个 `v*` 标签，它会用 GitHub Secrets 里的密钥
   签名构建，校验产物确实被签名，然后建 Release 并挂上 APK 与 sha256。
   PR 上没有编译检查，别人提的改动要自己拉下来编一遍再决定合不合。

## 怎么读代码

只有一个 Activity：`app/src/main/java/com/noyllopa/pulse/MainActivity.java`。
其余逻辑全在四个注入脚本里，按职责分：

| 文件 | 负责 |
| --- | --- |
| `assets/theme.js` | 卡片化样式、顶栏与页面骨架改造、平板双列与字号 |
| `assets/nav.js` | 悬浮导航、分组选择框、返回球、发博球 |
| `assets/dark_fix.js` | 深色下的图片与玻璃态补偿 |
| `assets/swipe_seek.js` | 视频滑动快进快退 |

改样式前必须知道的两件事：

- **站点同时存在三套页面架构**：新版 Vue SPA、老版服务端直出（`#box` 作用域）、
  以及 `card.weibo.com` 的头条文章页。同一类页面在不同架构下类名不同
  （例如设置族在直出页是 `#box` 里的老类名，在 SPA 里是 Vue 组件；
  账号安全页在 `security.weibo.com` 用的是更老的一套）。
  只按一种架构写的规则，在另一种上会静默不生效。
- **注入是幂等的**。脚本会在 `onPageStarted` 与 `onPageFinished` 各跑一次，
  SPA 内部路由跳转还会再跑。任何"append 一个节点"的写法都要先查是否已存在，
  否则会出现叠两层控件、多颗返回球这类问题。

## 自测

debug 构建才开放 DevTools（`FLAG_DEBUGGABLE`），所以：

```bash
adb shell pidof com.noyllopa.pulse                       # 拿 pid
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

然后 `chrome://inspect` 挂载，或用 CDP 直接跑 JS 取 DOM 矩形与像素。
深浅色切换用 `adb shell cmd uimode night yes|no`（会重建 Activity，属正常）。

判断"颜色对不对"请**按像素采样**而不是肉眼看截图：算法加深和半透明叠加在截图压缩后
很容易看错，这个项目里好几条结论是靠"量出来的 RGB 值"翻案的。

## 版本号与更新日志

- 版本号规则见 README；改版本只改 `app/build.gradle.kts` 里的 `pulseVersion` 一行，
  `versionCode` 由它编码得出，不要手写。
- 用户可见的改动要在 `CHANGELOG.md` 的 `[Unreleased]` 下记一笔
  （`Added` / `Changed` / `Fixed`，破坏性变更进 `Removed` 或单独说明）。
- 发版时把 `[Unreleased]` 的内容移到新版本号下，写清日期。
  正式版不允许带预发布后缀。

## 提交

- 一个提交只做一件事。样式类改动请在提交信息里写清**症状**（"平板双列回看整屏空白"）
  而不是只写动作（"改 grid"）。
- PR 里请附上验证方式：哪台设备、深浅色、哪个页面。
  这个项目的现象高度依赖设备与页面架构，没写环境的截图很难判断。
- 不要顺手重构不相关的代码。

## 许可

提交即表示你同意你的贡献按本仓库的 [MIT](LICENSE) 许可发布。
