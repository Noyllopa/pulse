/**
 * 原生能力的上行通道。
 *
 * 页面脚本一律写 window.BwNative.xxx(...),由这里决定它怎么送到原生:
 *  - 新 WebView:原生用 addWebMessageListener 挂了一个带来源白名单的对象
 *    (window.BwBridge),这里把调用编成 JSON 数组 ["方法名", 参数…] 发过去。
 *    来源与"是不是主框架"由原生在收到每一条时判定。
 *  - 老 WebView(没有 WEB_MESSAGE_LISTENER):原生退回 addJavascriptInterface,
 *    window.BwNative 已经是真桥,这里什么都不做。
 *
 * 两样都没有(第三方页面上 BwBridge 不会被注入)时不造空壳:
 * 页面脚本本来就到处判 window.BwNative 是否存在,缺了就走它自己的降级分支。
 */
(function () {
  if (window.BwNative || !window.BwBridge) return;

  var METHODS = ['toast', 'mediaMenu', 'setVideoAspect', 'needLogin', 'requestLogin',
    'setGroupDrop', 'setGalleryOpen', 'setMediaBars', 'setEditorOpen', 'setPanelGesture'];

  var api = {};
  METHODS.forEach(function (name) {
    api[name] = function () {
      var args = [name];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      try { window.BwBridge.postMessage(JSON.stringify(args)); } catch (e) { /* ignore */ }
    };
  });
  window.BwNative = api;
})();