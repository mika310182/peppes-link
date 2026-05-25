window.PeppeNotifications = (function () {
  var _swReg = null;
  var _vapidKey = null;

  function canNotify() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  function requestPermission() {
    if (!('Notification' in window)) return Promise.resolve('denied');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    return Notification.requestPermission();
  }

  function notify(title, options) {
    if (!canNotify()) return false;
    try {
      var opts = Object.assign({
        icon: '/assets/peppe_listo.png',
        badge: '/assets/peppe_listo.png',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag: 'peppes-general'
      }, options || {});
      var n = new Notification(title, opts);
      if (opts.onClick) { n.onclick = opts.onClick; }
      return true;
    } catch (e) {
      return false;
    }
  }

  function registerSW(path) {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (_swReg) return Promise.resolve(_swReg);
    return navigator.serviceWorker.register(path || '/sw.js')
      .then(function (reg) { _swReg = reg; return reg; })
      .catch(function () { return null; });
  }

  function setVapidKey(key) { _vapidKey = key; }

  function subscribePush() {
    if (!_swReg) return Promise.resolve(null);
    if (!_vapidKey) return Promise.resolve(null);
    return _swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(_vapidKey)
    }).catch(function () { return null; });
  }

  function getSubscription() {
    if (!_swReg) return Promise.resolve(null);
    return _swReg.pushManager.getSubscription();
  }

  function saveSubscription(subscription, scope) {
    if (!subscription) return Promise.resolve(false);
    return fetch('/api/save-push-subscription.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON ? subscription.toJSON() : subscription, scope: scope })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function _urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var output = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) { output[i] = rawData.charCodeAt(i); }
    return output;
  }

  return {
    canNotify: canNotify,
    requestPermission: requestPermission,
    notify: notify,
    registerSW: registerSW,
    setVapidKey: setVapidKey,
    subscribePush: subscribePush,
    getSubscription: getSubscription,
    saveSubscription: saveSubscription
  };
})();
