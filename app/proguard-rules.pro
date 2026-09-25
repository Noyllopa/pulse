# 默认不启用混淆;若开启 minifyEnabled,WebView 相关回调需保留
-keepclassmembers class * extends android.webkit.WebViewClient {
    public *;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public *;
}
