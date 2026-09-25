# pulse

m.weibo.cn 的安卓客户端：WebView 套壳 + 注入式样式与导航改造。跟随系统深浅色，
平板/横屏走双列，掐掉信息流广告，长按下载图片。

早期版本，`1.0.1-alpha.1`（预发布）。没有自动化测试，改动只在 Android 模拟器的手机
和平板上验证过，微博一改版它就有可能坏。

## 截图

| 手机 · 深色 · 首页 | 手机 · 浅色 · 首页 | 手机 · 深色 · 正文页 |
| --- | --- | --- |
| ![](docs/img/screenshot-phone-home-dark.png) | ![](docs/img/screenshot-phone-home-light.png) | ![](docs/img/screenshot-phone-detail-dark.png) |

| 平板 · 深色 · 双列首页 | 平板 · 浅色 · 双列首页 |
| --- | --- |
| ![](docs/img/screenshot-tablet-home-dark.png) | ![](docs/img/screenshot-tablet-home-light.png) |

截图内容全部是模拟数据：昵称、头像、正文、配图、时间、属地都是占位生成，与任何真实账号无关。
机身外框是合成的示意图，不代表具体机型。

## 安装

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

也可以把 APK 传到手机直接点开安装（需允许未知来源）。

## 构建

需要 JDK 17 和满足 `compileSdk 37` 的 Android SDK；`minSdk 24` / `targetSdk 34`。
Gradle 由 wrapper 提供，本机不用装。SDK 路径写在 `local.properties`（已 gitignore）：

```properties
sdk.dir=C\:/Users/you/AppData/Local/Android/Sdk
```

```bash
./gradlew assembleDebug
./gradlew assembleRelease
```

产物除 `app/build/outputs/apk/…` 外，还会按版本号复制到仓库同级的 `release/`
（`-Ppulse.outDir=<路径>` 可改）。

release 默认不签名，装不上，产物文件名会标 `-release-unsigned`。要签名就先生成密钥，
再在仓库根放一个 `keystore.properties`（与 `*.jks` 一起已被 gitignore，别提交）：

```bash
keytool -genkeypair -v -keystore pulse-release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias pulse
```

```properties
storeFile=../pulse-release.jks
storePassword=…
keyAlias=pulse
keyPassword=…
```

密钥丢了以后就再也无法覆盖升级，务必自己备份。

## 隐私

- 除了微博自己的域名，不发任何请求。没有统计、没有埋点、没有第三方 SDK。
- 登录 Cookie 存在应用私有目录，由系统 WebView 管理，本应用不上传也不导出。
- 应用只在 debug 构建里调用 `setWebContentsDebuggingEnabled(true)`，release 包不带
  `FLAG_DEBUGGABLE`。但注意：在可调试的系统镜像上（模拟器常见 `ro.debuggable=1`），
  WebView 会对**所有**应用开放 DevTools，与本应用无关。别拿模拟器上的表现当真机结论。
- 明文 http 只对微博系域名放行，其余禁止。
- `allowBackup="true"` 是现状，系统备份可能带上登录态。在意就关掉设备上的应用备份。

## 已知限制

- 样式和导航靠微博页面的类名定位，改版会立刻失效；站点同时有三套页面架构，
  只按一种写的规则在另一种上会安静地不生效。
- 平板双列在图片加载完成时仍有轻微跳动。
- 深色顶栏切换瞬间可能闪：代码改过，但拿不到可复现的证据，等于没验证。
- 只有中文界面。
- 一行自动化测试都没有，改 A 有可能坏 B。

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提 bug 请带上机型、系统版本、WebView 版本、
页面 URL 和截图。安全问题按 [SECURITY.md](SECURITY.md) 私下报，不要开公开 issue。

## 免责声明

本项目与新浪微博、新浪集团没有任何关系，"微博 / Weibo" 及相关标识归各自权利人所有。
应用通过网页界面访问微博，没有使用官方开放 API，这类用法可能不符合微博的服务条款，
账号风险由使用者自行承担。代码按原样提供，没有任何保证。

## 许可

[MIT](LICENSE) © 2026 Noyllopa
