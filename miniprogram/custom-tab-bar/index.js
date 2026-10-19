Component({
  data: {
    selected: '0',
    // Five-tab config: 首頁, 藥品管理, 錄音, 數據分析, 記錄
    list: [
      { key: 'home', text: '首頁', icon: 'home', path: '/pages/home/home' },
      { key: 'plan', text: '藥品', icon: 'edit-1', path: '/pages/med-manage/med-manage' },
      { key: 'voice', text: '錄音', icon: 'microphone', path: '/pages/voice-recorder/voice-recorder' },
      { key: 'stats', text: '分析', icon: 'chart-bar', path: '/pages/analysis/analysis' },
      { key: 'history', text: '記錄', icon: 'user', path: '/pages/history/history' }
    ]
  },

  methods: {
    onChange(e) {
      const value = e.detail.value;
      const item = this.data.list[value];
      const url = item && item.path;
      if (!url) return;

      this.setData({ selected: value });
      wx.switchTab({ url });
    },

    updateSelected(idx) {
      const selected = idx.toString();
      if (this.data.selected !== selected) {
        this.setData({ selected });
      }
    }
  },

  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (currentPage) {
        const url = `/${currentPage.route}`;
        const tabPages = [
          '/pages/home/home',
          '/pages/med-manage/med-manage',
          '/pages/voice-recorder/voice-recorder',
          '/pages/analysis/analysis',
          '/pages/history/history'
        ];
        const index = tabPages.indexOf(url);
        if (index !== -1) {
          this.setData({ selected: index.toString() });
        }
      }
    }
  }
});
