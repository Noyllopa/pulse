package com.noyllopa.pulse;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.view.ContextMenu;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * m.weibo.cn 的 WebView 套壳。
 *
 * 深色模式:应用使用 DayNight 主题 + 沉浸式系统栏;网页内容使用
 * androidx.webkit 的算法加深,并在深色时注入 assets/dark_fix.js,
 * 把大尺寸透明图片(如微博 logo)垫成白色徽章、避免被反色破坏。
 * 系统栏不再由框架自动避让(部分平板横屏下状态栏是悬浮层),
 * 统一由 configureSystemBars() 以内边距形式让网页避开状态栏/导航栏/键盘。
 * 平板等宽屏设备的布局差异由注入的 theme.js 处理。
 *
 * 所有 http/https 链接一律在应用内打开,自定义协议一律拦截,
 * 登录等流程不会跳出到外部浏览器。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "pulse";

    private static final String HOME_URL = "https://m.weibo.cn/";
    private static final String LOGIN_URL = "https://passport.weibo.cn/signin/login";

    /**
     * 内置广告规则(子资源请求一律掐掉,主文档导航不动)。
     *
     * 正文页会内联一段百度联盟槽位:`<div class="ad-wrap">` + `cpro/ui/cm.js` +
     * `slotbydup.push({id:'u6731129',container:'_xxxx'})`。实测三层都真的在发请求:
     * `m.weibo.cn/status/baiduad`、`m.weibo.cn/status/banner?position=5`(问服务端
     * "这条位置投不投")、`cpro.baidustatic.com/cpro/ui/cm.js`(拉创意)。
     * 掐断前两个组件就不激活,DOM 里只剩一个 0 高的空容器(theme.js 再收一次);
     * 掐断后三个是兜底,免得站点换配置源又长出来。
     * wn.pos.baidu.com / eclick 等子域都落在对应前缀里,不必单列。
     */
    private static final String[] AD_HOSTS = {
            "m.weibo.cn/status/baiduad",
            "m.weibo.cn/status/banner",
            "cpro.baidustatic.com",
            "pos.baidu.com",
            "eclick.baidu.com",
    };

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    /** 网页 nav.js 报上来的分组弹层展开状态,只在展开期间禁掉下拉刷新 */
    private boolean groupDropOpen = false;
    private ProgressBar progressBar;
    private View errorView;
    private ValueCallback<Uri[]> filePathCallback;
    private String darkFixJs;
    private String seekJs;
    private String themeJs;
    private String navJs;
    private FrameLayout fullscreenContainer;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private boolean loginSkipped;
    private boolean loginCorrected;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                ValueCallback<Uri[]> callback = filePathCallback;
                filePathCallback = null;
                if (callback == null) {
                    return;
                }
                Uri[] uris = WebChromeClient.FileChooserParams.parseResult(
                        result.getResultCode(), result.getData());
                callback.onReceiveValue(uris == null ? new Uri[0] : uris);
            });

    /** 分区存储之前(≤28)存公共目录要先拿写权限,批准后补存这一张 */
    private String[] pendingDownload;
    private final ActivityResultLauncher<String> permissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
                String[] job = pendingDownload;
                pendingDownload = null;
                if (granted && job != null) {
                    enqueueDownload(job[0], job[1], job[2], job[3]);
                } else if (!granted) {
                    Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
                }
            });

    private static final int MENU_SAVE_IMAGE = 1;
    private static final int MENU_COPY_URL = 2;

    /**
     * 长按图片的菜单项。
     *
     * WebView 不像 Chrome 那样自带"下载图片"菜单 —— 它把 {@code onCreateContextMenu}
     * 留给应用自己填,所以光 {@code registerForContextMenu} 是空的。
     * 这里用平台现成的命中测试({@link WebView#getHitTestResult()})取图片直链,
     * 不经过网页脚本,也不新增 JS 桥。
     */
    @Override
    public void onCreateContextMenu(ContextMenu menu, View v,
                                    ContextMenu.ContextMenuInfo menuInfo) {
        super.onCreateContextMenu(menu, v, menuInfo);
        if (v != webView) {
            return;
        }
        WebView.HitTestResult hit = webView.getHitTestResult();
        if (hit == null) {
            return;
        }
        int type = hit.getType();
        if (type != WebView.HitTestResult.IMAGE_TYPE
                && type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
                && type != WebView.HitTestResult.SRC_ANCHOR_TYPE) {
            return;
        }
        final String url = hit.getExtra();
        if (TextUtils.isEmpty(url) || !url.startsWith("http")) {
            return;
        }
        final boolean image = type != WebView.HitTestResult.SRC_ANCHOR_TYPE;
        if (image) {
            menu.add(0, MENU_SAVE_IMAGE, 0, R.string.menu_save_image)
                    .setOnMenuItemClickListener(item -> {
                        saveWithDownloadManager(url, null, guessType(url));
                        return true;
                    });
        }
        menu.add(0, MENU_COPY_URL, 1, R.string.menu_copy_image_url)
                .setOnMenuItemClickListener(item -> {
                    getSystemService(ClipboardManager.class)
                            .setPrimaryClip(ClipData.newPlainText("pulse", url));
                    Toast.makeText(this, R.string.menu_copied, Toast.LENGTH_SHORT).show();
                    return true;
                });
    }

    private static String guessType(String url) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(Uri.parse(url).getPath());
        String mime = ext == null ? null
                : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));
        return TextUtils.isEmpty(mime) ? "image/jpeg" : mime;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        progressBar = findViewById(R.id.progress_bar);
        errorView = findViewById(R.id.error_view);

        swipeRefresh.setColorSchemeColors(0xFF2563EB);
        swipeRefresh.setOnRefreshListener(this::reloadPage);
        // WebView 被包进卡片容器后,SwipeRefreshLayout 无法自行判断是否滚到顶部
        swipeRefresh.setOnChildScrollUpCallback((parent, child) -> webView.canScrollVertically(-1));

        findViewById(R.id.btn_retry).setOnClickListener(v -> reloadPage());

        /* 长按图片要能"下载图片"。WebView 的上下文菜单(下载图片 / 复制图片地址 / 打开图片)
           默认是死的:View.showContextMenu() 在没有注册过的菜单时直接返回 false,
           所以长按图片什么都不发生。注册之后 Chromium 会按命中类型(HIT_TEST 的
           SRC_IMAGE_ANCHOR_TYPE / IMAGE_ANCHOR_TYPE)自己填菜单项,不另造一套长按逻辑。 */
        registerForContextMenu(webView);

        configureSystemBars();
        configureWebView();
        configureClients();
        configureBackNavigation();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else if (isLoggedIn()) {
            webView.loadUrl(HOME_URL);
        } else {
            // 未登录:直接进入登录界面
            webView.loadUrl(LOGIN_URL);
        }
    }

    private boolean isDarkTheme() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /**
     * 自行按系统栏内边距避让:部分设备(尤其平板横屏)状态栏是悬浮层,
     * 框架不会把网页顶下去,导致顶栏 logo 压进状态栏。
     * 键盘弹出时同样以底部内边距收缩 WebView,等效 adjustResize。
     */
    private void configureSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(R.id.content_holder);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        updateBarAppearance();
    }

    /** 系统栏图标深浅色跟随应用主题(状态栏透明后只能靠 appearance 控制) */
    private void updateBarAppearance() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!isDarkTheme());
        controller.setAppearanceLightNavigationBars(!isDarkTheme());
    }

    /**
     * 私信会话页的滚动条不在文档上:实测 /message/chat 的 document 是
     * scrollHeight 858 / clientHeight 838(基本不滚),真正的历史列表在内部容器
     * div.main-wrap(overflow-y:scroll、1270/658)。而 SwipeRefreshLayout 的
     * canChildScrollUp 用的是 webView.canScrollVertically(-1) —— 文档位置,
     * 这类页面恒为"已在顶部",于是每次下拉都被刷新手势截走,聊天记录翻不动
     * (实测一次系统级下拉直接触发了 reload)。会话页的"刷新"本身也没有语义
     * (新消息自己会推),所以这条路由关掉下拉刷新,离开时恢复。
     */
    private static boolean isInnerScrollerPage(String url) {
        return url != null && url.contains("/message/chat");
    }

    /**
     * 首页分组下拉展开期间也要让出手势:弹层是 position:fixed 的内部滚动列表,文档始终
     * 停在 y=0,于是 canChildScrollUp 恒为「已在顶部」——用户在弹层里往上翻回列表头时手指
     * 是向下拖的,正好命中下拉刷新(实测手势被截走、弹层滚不回去,还顺手触发 reload)。
     * 两个条件取与:离开弹层时不能把 /message/chat 那条规则一起放开。
     */
    private void syncRefreshGesture() {
        swipeRefresh.setEnabled(!isInnerScrollerPage(webView.getUrl()) && !groupDropOpen);
    }

    /** 通过会话 Cookie(MLOGIN=1 / SUB)判断微博登录态 */
    private boolean isLoggedIn() {
        String cookie = CookieManager.getInstance().getCookie("https://m.weibo.cn/");
        if (cookie == null) {
            return false;
        }
        for (String pair : cookie.split(";")) {
            String p = pair.trim();
            if ("MLOGIN=1".equals(p) || (p.startsWith("SUB=") && p.length() > 4)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 兜底:本地 Cookie 判定为已登录、但服务端会话实际已失效时,
     * 由页面脚本查 /api/config 后回调,本次会话内纠正一次到登录页
     * (用户按返回键跳过后不再强制)。
     * 跳转前先清掉 Cookie:残留的访客 SUB 会让 passport 认为已有会话,
     * 直接 302 回首页,登录界面根本停不住。
     */
    private void redirectToLogin() {
        if (loginSkipped || loginCorrected || isOnLoginPage()) {
            return;
        }
        loginCorrected = true;
        CookieManager.getInstance().removeAllCookies(
                ignored -> runOnUiThread(() -> webView.loadUrl(LOGIN_URL)));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        // 登录需要跨域 SSO(weibo.cn / weibo.com / sina.com.cn),必须允许第三方 Cookie
        cookies.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 跟随系统深色模式:应用主题为深色时,WebView 自动对网页做算法加深
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true);
        }

        // 网页通过该桥调起原生视频播放器(仅暴露带 @JavascriptInterface 的方法)
        webView.addJavascriptInterface(new NativeBridge(), "BwNative");

        // 加载期间 WebView 的背景色与主题一致,避免深色模式下启动白屏闪烁
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.web_surface));

        /* 关掉 WebView 自己的边缘光晕:下拉刷新已经由外层 SwipeRefreshLayout 承担,
           再叠一层 Android 光晕是最响的"这是内嵌网页"信号(触顶时还会和刷新圈打架)。
           这只影响过度滚动的绘制,canChildScrollUp() 仍按滚动位置判定,刷新不受影响 */
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // 仅调试包开放 DevTools,便于用 chrome://inspect 核对注入样式与布局
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        /* 上下文菜单里的"下载图片"最终落到这里。不接的话点了菜单项静默无事发生
           —— 站点自己的图片链接是带签名参数的直链,交给系统 DownloadManager,
           进度与完成通知由系统出,存到相册的 Pictures/ 下 */
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                saveWithDownloadManager(url, contentDisposition, mimeType));
    }

    private static boolean isAdUrl(String url) {
        String u = url.toLowerCase(Locale.ROOT);
        for (String ad : AD_HOSTS) {
            if (u.contains(ad)) {
                return true;
            }
        }
        return false;
    }

    /** 用系统 DownloadManager 把网页文件存进公共目录(相册 / 下载) */
    private void saveWithDownloadManager(String url, String contentDisposition, String mimeType) {
        if (TextUtils.isEmpty(url) || url.startsWith("data:")) {
            Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_SHORT).show();
            return;
        }
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        String type = !TextUtils.isEmpty(mimeType) ? mimeType
                : MimeTypeMap.getSingleton().getMimeTypeFromExtension(
                        MimeTypeMap.getFileExtensionFromUrl(name));
        if (TextUtils.isEmpty(type)) {
            type = "application/octet-stream";
        }
        // 图片进相册目录,其余进"下载"
        String dir = type.startsWith("image/")
                ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            // 分区存储之前,写公共目录要运行时权限;先要权限,这一张等用户批准后再存
            pendingDownload = new String[]{url, name, type, dir};
            permissionLauncher.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
            return;
        }
        enqueueDownload(url, name, type, dir);
    }

    private void enqueueDownload(String url, String name, String mimeType, String dir) {
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle(name);
        req.setMimeType(mimeType);
        req.addRequestHeader("Referer", HOME_URL);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (!TextUtils.isEmpty(cookie)) {
            req.addRequestHeader("Cookie", cookie);
        }
        req.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        try {
            // API 29+ 由分区存储放行公共目录;更早的版本在上面那道权限检查里已经拿到写权限
            req.setDestinationInExternalPublicDir(dir,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? "pulse/" + name : name);
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) {
                throw new IllegalStateException("no DownloadManager");
            }
            dm.enqueue(req);
            Toast.makeText(this, getString(R.string.download_started, name),
                    Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.w(TAG, "download failed: " + url, e);
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void configureClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                // http/https 一律在应用内加载(包括登录过程的 passport/SSO 跳转);
                // 自定义协议(intent://、sinaweibo:// 等,登录成功后常用来唤起微博 App)
                // 一律拦截,杜绝任何跳出外部浏览器的行为
                return !"http".equals(scheme) && !"https".equals(scheme);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                errorView.setVisibility(View.GONE);
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(5);
                syncRefreshGesture();
                injectPageScripts(view);
            }

            /**
             * 站点是 Vue SPA,路由跳转走 pushState,不会触发 onPageStarted/Finished,
             * 进/出私信会话页时要在这里同步下拉刷新的开关
             */
            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                syncRefreshGesture();
            }

            /**
             * 广告请求按 AD_HOSTS 掐断,其余一律 return null 交回 WebView 自己走
             * (网络栈、HTTP 缓存、Range 请求都不受影响)。
             * 被掐的两条 /status/* 是站点自己的 JSON 接口,给回一个空 JSON 而不是 404:
             * 站点的回调会去读返回体,报错不如"今天不投放"。
             */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                              WebResourceRequest request) {
                if (!request.isForMainFrame() && isAdUrl(request.getUrl().toString())) {
                    boolean json = request.getUrl().toString().contains("/status/");
                    return new WebResourceResponse(json ? "application/json" : "text/javascript",
                            "utf-8", new ByteArrayInputStream(
                            (json ? "{}" : "").getBytes(StandardCharsets.UTF_8)));
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                syncRefreshGesture();
                if (resetScrollOnFinish) {
                    resetScrollOnFinish = false;
                    view.post(scrollToTop);
                    view.postDelayed(scrollToTop, 400);
                    view.postDelayed(scrollToTop, 900);
                }
                // Cookie 竞态自愈:实际已登录却被停在登录页时回主页
                if (isOnLoginPage() && isLoggedIn()) {
                    view.loadUrl(HOME_URL);
                    return;
                }
                injectPageScripts(view);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    CharSequence detail = error == null ? null : error.getDescription();
                    showError(detail == null ? null : detail.toString());
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            /** 网页视频全屏:交给原生容器渲染 */
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenContainer != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenContainer = new FrameLayout(MainActivity.this);
                fullscreenContainer.setBackgroundColor(Color.BLACK);
                fullscreenContainer.addView(view,
                        new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));
                ((ViewGroup) getWindow().getDecorView()).addView(
                        fullscreenContainer,
                        new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));
                fullscreenCallback = callback;
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                        .hide(WindowInsetsCompat.Type.systemBars());
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    fileChooserLauncher.launch(params.createIntent());
                } catch (Exception e) {
                    // 设备上没有能处理该请求的选择器时,放弃本次上传
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void showError(String detail) {
        TextView desc = errorView.findViewById(R.id.error_desc);
        if (detail == null || detail.isEmpty()) {
            desc.setText(R.string.error_desc);
        } else {
            desc.setText(getString(R.string.error_desc_with_detail, detail));
        }
        errorView.setVisibility(View.VISIBLE);
        progressBar.setVisibility(View.GONE);
        swipeRefresh.setRefreshing(false);
    }

    /**
     * 下拉刷新 / 出错重试都是整页 reload,而 WebView 会把 reload 前的滚动位置**恢复**回去 ——
     * 实测刷新后停在 scrollY=1767 而不是顶部(信息流本身是全新的、撑高层为 0,
     * 于是用户看到的是"刷新完卡在中间")。刷新的语义就是回到顶部看新内容,
     * 所以加载完成后显式归零。
     * 不能用 history.scrollRestoration='manual' 一刀切:那会连带破坏
     * "从正文返回信息流时回到上次位置"。恢复动作可能落在 load 事件之后,故补三次,
     * 已经在顶部时后续每次都是空操作。
     */
    private boolean resetScrollOnFinish = false;

    private final Runnable scrollToTop = new Runnable() {
        @Override
        public void run() {
            if (webView != null) {
                webView.evaluateJavascript("try{window.scrollTo(0,0)}catch(e){}", null);
            }
        }
    };

    private void reloadPage() {
        resetScrollOnFinish = true;
        errorView.setVisibility(View.GONE);
        String url = webView.getUrl();
        if (url == null || url.startsWith("about:")) {
            webView.loadUrl(HOME_URL);
        } else {
            webView.reload();
        }
    }

    /** 注入页面增强脚本:网页主题 + 悬浮导航 + 深色图片修复 + 视频滑动快进快退;幂等 */
    private void injectPageScripts(WebView view) {
        if (themeJs == null) {
            themeJs = readAsset("theme.js");
        }
        if (!themeJs.isEmpty()) {
            view.evaluateJavascript(themeJs, null);
        }
        if (navJs == null) {
            navJs = readAsset("nav.js");
        }
        if (!navJs.isEmpty()) {
            // 顺带告诉页面当前登录态:第三方授权页上的返回入口按此决定去向
            view.evaluateJavascript("window.__bwLoggedIn=" + isLoggedIn() + ";" + navJs, null);
        }
        if (isDarkTheme()) {
            if (darkFixJs == null) {
                darkFixJs = readAsset("dark_fix.js");
            }
            if (!darkFixJs.isEmpty()) {
                view.evaluateJavascript(darkFixJs, null);
            }
        }
        if (seekJs == null) {
            seekJs = readAsset("swipe_seek.js");
        }
        if (!seekJs.isEmpty()) {
            view.evaluateJavascript(seekJs, null);
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    /** 退出网页全屏视频 */
    private void exitFullscreen() {
        if (fullscreenContainer == null) {
            return;
        }
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.removeView(fullscreenContainer);
        fullscreenContainer = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .show(WindowInsetsCompat.Type.systemBars());
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    /** 提供给网页 JS 的原生能力桥 */
    private class NativeBridge {

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        /** 页面脚本查到服务端登录态为"未登录"时回调,由原生决定跳登录页 */
        @JavascriptInterface
        public void needLogin() {
            runOnUiThread(() -> redirectToLogin());
        }

        /** 首页分组下拉的开/合:展开时把下拉刷新手势让给弹层自己的滚动 */
        @JavascriptInterface
        public void setGroupDrop(final boolean open) {
            runOnUiThread(() -> {
                if (groupDropOpen == open) {
                    return;
                }
                groupDropOpen = open;
                syncRefreshGesture();
            });
        }
    }

    private void configureBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (fullscreenContainer != null) {
                    exitFullscreen(); // 先退出全屏视频
                } else if (webView.canGoBack()) {
                    webView.goBack();
                } else if (isOnLoginPage()) {
                    // 未登录暂不登录:允许返回信息流浏览
                    loginSkipped = true;
                    webView.loadUrl(HOME_URL);
                } else {
                    finish();
                }
            }
        });
    }

    private boolean isOnLoginPage() {
        String url = webView.getUrl();
        // 登录流程会在 passport.weibo.cn / passport.weibo.com(SSO) 之间跳转
        return url != null && (url.contains("passport.weibo.cn")
                || url.contains("passport.weibo.com") || url.contains("/sso/signin"));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
