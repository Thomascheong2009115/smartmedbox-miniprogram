const api = require('../../../utils/api.js');

Page({
  data: {
    unreadList: [],
    readList: [],
    showDetail: false,
    currentNotif: null
  },

  onShow() {
    this.loadNotifications();
  },

  goBack() {
    wx.navigateBack();
  },

  loadNotifications() {
    const notifications = wx.getStorageSync('notifications') || [];
    
    // Format timestamp
    const formatTime = (ts) => {
        const d = new Date(ts);
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    const formatted = notifications.map(n => ({
        ...n,
        timeStr: formatTime(n.timestamp)
    }));

    this.setData({
        unreadList: formatted.filter(n => n.status === 'unread'),
        readList: formatted.filter(n => n.status === 'read')
    });
  },

  onTapNotification(e) {
      const item = e.currentTarget.dataset.item;
      this.setData({
          currentNotif: item,
          showDetail: true
      });
  },

  onConfirmRead() {
      const item = this.data.currentNotif;
      if (item) {
          this.markAsRead(item.id);
      }
      this.setData({
          showDetail: false,
          currentNotif: null
      });
  },

  markAsRead(id) {
      let notifications = wx.getStorageSync('notifications') || [];
      const idx = notifications.findIndex(n => n.id === id);
      if (idx !== -1) {
          notifications[idx].status = 'read';
          wx.setStorageSync('notifications', notifications);
          this.loadNotifications(); // Reload UI
      }
  },

  onDeleteNotification(e) {
      const id = e.currentTarget.dataset.id;
      wx.showModal({
          title: '刪除通知',
          content: '確定要刪除這條通知嗎？',
          success: (res) => {
              if (res.confirm) {
                  let notifications = wx.getStorageSync('notifications') || [];
                  notifications = notifications.filter(n => n.id !== id);
                  wx.setStorageSync('notifications', notifications);
                  this.loadNotifications();
                  wx.showToast({ title: '已刪除', icon: 'none' });
              }
          }
      });
  }
});
