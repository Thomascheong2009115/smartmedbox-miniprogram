// const tFontSource = require('./assets/fonts/tfont-base64');

App({
  onLaunch() {
    console.log('Smart Box app launched');
    // this.loadIconFont();

    const hasLogin = wx.getStorageSync('hasLogin');
    if (!hasLogin) {
      console.log('Initialize first-login state');
      wx.setStorageSync('hasLogin', true);
    }

    const systemInfo = this.collectSystemInfo();
    this.globalData.systemInfo = systemInfo;

    this.cleanExpiredSchedules();
  },

  loadIconFont() {
    if (typeof wx.loadFontFace !== 'function') {
      return;
    }

    wx.loadFontFace({
      family: 't',
      source: tFontSource,
      global: true,
      success: () => {
        console.log('[font] icon font loaded');
      },
      fail: (error) => {
        console.warn('[font] icon font load failed', error);
      },
    });
  },

  collectSystemInfo() {
    const info = {
      deviceInfo: null,
      windowInfo: null,
      appBaseInfo: null,
      systemSetting: null,
      appAuthorizeSetting: null,
    };

    try {
      if (typeof wx.getDeviceInfo === 'function') {
        info.deviceInfo = wx.getDeviceInfo();
      }

      if (typeof wx.getWindowInfo === 'function') {
        info.windowInfo = wx.getWindowInfo();
      }

      if (typeof wx.getAppBaseInfo === 'function') {
        info.appBaseInfo = wx.getAppBaseInfo();
      }

      if (typeof wx.getSystemSetting === 'function') {
        info.systemSetting = wx.getSystemSetting();
      }

      if (typeof wx.getAppAuthorizeSetting === 'function') {
        info.appAuthorizeSetting = wx.getAppAuthorizeSetting();
      }

      if (!info.deviceInfo && typeof wx.getSystemInfoSync === 'function') {
        // Fallback for old base libs.
        const legacy = wx.getSystemInfoSync();
        info.deviceInfo = legacy;
        info.windowInfo = legacy;
        info.appBaseInfo = legacy;
      }
    } catch (error) {
      console.warn('[system-info] collect failed', error);
    }

    return info;
  },

  cleanExpiredSchedules() {
    const todayStr = (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();

    let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
    let changed = false;

    pillboxLayout = pillboxLayout.map((slot) => {
      if (slot.frequency === 'once' && slot.expireDate && slot.expireDate <= todayStr) {
        console.log(`[schedule-expire] clear slot ${slot.id}`);
        changed = true;
        return { ...slot, medicines: [], frequency: '', expireDate: '' };
      }
      return slot;
    });

    if (changed) {
      wx.setStorageSync('pillboxLayout', pillboxLayout);
      console.log('[schedule-expire] saved cleaned schedule');
    }
  },

  globalData: {
    serverUrl: 'http://127.0.0.1:5000',
    version: '1.0.0',
    systemInfo: null,
    userInfo: null,
  },
});
