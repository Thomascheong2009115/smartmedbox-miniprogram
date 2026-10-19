const api = require('../../utils/api.js');
const mockData = require('../../utils/mockData.js');

Page({
  data: {
    records: [],
    filterDate: 'today',
    today: '',
    statusOptions: [
      { label: '全部', value: 'all' },
      { label: '已服用', value: 'completed' },
      { label: '漏服', value: 'missed' }
    ],
    statusLabel: '全部',
    filterStatus: 'all',
    
    // 統計數據
    completedCount: 0,
    missedCount: 0,
    
    // 用于显示大图
    showImageModal: false,
    currentImage: ''
  },

  onLoad() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    this.setData({ 
      today: todayStr,
      filterDate: 'today'
    });
    
    this.loadHistory();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateSelected(4);
    }
    // 每次显示时刷新数据
    this.loadHistory();
  },

  async loadHistory() {
    wx.showLoading({ title: '加载中...' });

    try {
      // 1. 获取用药状态
      const statusResult = await api.getMedicationStatus();
      
      // 2. 获取最新照片
      let imageResult = {};
      try {
        imageResult = await api.getLatestPillboxImage();
      } catch (e) {
        console.warn('Failed to fetch image', e);
      }
      
      // 3. 组合最新记录
      // 注意：这里的 statusResult.update_time 格式如 "2026-02-06 14:43:26"
      const updateTime = statusResult.update_time || '';
      const [datePart, timePart] = updateTime.split(' ');
      
      const latestRecord = {
        id: Date.now(),
        date: datePart || this.data.today,
        time: timePart || '刚刚',
        period: statusResult.period || '未知',
        status: statusResult.status || '未知',
        checkCount: statusResult.check_count || 1,
        imageBase64: imageResult.image_base64 || '',
        hasImage: !!imageResult.image_base64
      };

      // 4. 从本地存储获取历史记录 (Mock History + Local Storage History)
      let allRecords = wx.getStorageSync('medicationHistory') || [];
      
      // 如果本地數據是 Analysis 頁面生成的示範數據（格式不同），需要轉換
      // Analysis 頁面生成的格式：{ date: 'YYYY-MM-DD', period: 'morning', status: 'completed', delayMinutes: 0 }
      // History 頁面需要的格式：{ id: ..., date: 'YYYY-MM-DD', time: 'HH:mm', period: '早上', status: '已服药', ... }
      if (allRecords.length > 0 && !allRecords[0].period.match(/早上|中午|晚上/)) {
          // 檢測到可能是 Analysis 頁面的原始數據格式，進行轉換
          const periodMap = { 'morning': '早上', 'noon': '中午', 'evening': '晚上' };
          const statusMap = { 'completed': '已服药', 'delayed': '已服药', 'missed': '未服药' };
          
          allRecords = allRecords.map((r, index) => ({
              id: r.date + '_' + r.period + '_' + index,
              date: r.date,
              time: r.status === 'missed' ? '--:--' : (r.actualTime || '08:00'), // 簡單模擬時間
              period: periodMap[r.period] || r.period,
              status: statusMap[r.status] || '未服药',
              checkCount: 1,
              hasImage: false,
              imageBase64: ''
          })).reverse(); // Analysis 生成的是正序（舊到新），History 需要倒序（新到舊）
      }
      
      // 简单的去重逻辑：如果最近的一条记录和当前获取的状态完全一致（时间、状态、时段），则不重复添加
      // 实际生产中应该用唯一ID判断
      const lastStored = allRecords[0];
      const isDuplicate = lastStored && 
                          lastStored.date === latestRecord.date && 
                          lastStored.period === latestRecord.period &&
                          lastStored.status === latestRecord.status &&
                          lastStored.time === latestRecord.time;

      if (!isDuplicate && latestRecord.period !== '未知') {
         // 只有有效的新状态才存入
         allRecords.unshift(latestRecord);
         // 限制本地存储数量，例如只存最近50条
         if (allRecords.length > 50) allRecords = allRecords.slice(0, 50);
         wx.setStorageSync('medicationHistory', allRecords);
      }
      
      // 如果本地没有数据（首次运行），可以使用 Mock 数据填充展示效果
      if (allRecords.length === 0) {
        // 使用 api.getHistory 返回的 mock 数据
        const mockData = await api.getHistory();
        
        const flatMock = [];
        mockData.forEach(day => {
            day.list.forEach(item => {
                flatMock.push({
                    id: item.id,
                    date: day.date,
                    time: item.time,
                    period: item.title.replace('药物', ''), // "早上"
                    status: item.status === 'completed' ? '已服药' : '未服药',
                    checkCount: 1,
                    imageBase64: '', // Mock data usually no image
                    hasImage: false
                });
            });
        });
        allRecords = flatMock;
      }

      // 5. 过滤记录
      let filteredRecords = this.filterRecords(allRecords);
      
      // 計算統計 
      // 這裡 allLocal 應該是我們處理過的 allRecords
      const allLocal = allRecords; 
      const completedCount = allLocal.filter(r => r.status === '已服药' || r.status === '完成').length; 
      const missedCount = allLocal.filter(r => r.status !== '已服药' && r.status !== '完成').length; 
      
      this.setData({ 
        records: filteredRecords, 
        completedCount, 
        missedCount 
      });

      wx.hideLoading();

    } catch (err) {
      console.error('Failed to load history', err);
      wx.hideLoading();
      
      // 降级：只显示本地数据
      let localRecords = wx.getStorageSync('medicationHistory') || [];

      // 再次檢查格式轉換（降級情況）
      if (localRecords.length > 0 && !localRecords[0].period.match(/早上|中午|晚上/)) {
          const periodMap = { 'morning': '早上', 'noon': '中午', 'evening': '晚上' };
          const statusMap = { 'completed': '已服药', 'delayed': '已服药', 'missed': '未服药' };
          
          localRecords = localRecords.map((r, index) => ({
              id: r.date + '_' + r.period + '_' + index,
              date: r.date,
              time: r.status === 'missed' ? '--:--' : (r.actualTime || '08:00'),
              period: periodMap[r.period] || r.period,
              status: statusMap[r.status] || '未服药',
              checkCount: 1,
              hasImage: false,
              imageBase64: ''
          })).reverse();
      }

      const filteredRecords = this.filterRecords(localRecords);
      
      // 計算統計 
      const completedCount = localRecords.filter(r => r.status === '已服药' || r.status === '完成').length; 
      const missedCount = localRecords.filter(r => r.status !== '已服药' && r.status !== '完成').length; 
      
      this.setData({ 
        records: filteredRecords,
        completedCount,
        missedCount
      });
    }
  },

  filterRecords(records) {
    let filtered = [...records];
    
    // 按日期筛选
    const now = new Date();
    // Simple date comparison strings
    const today = this.formatDate(now);
    
    if (this.data.filterDate === 'today') {
      filtered = filtered.filter(r => r.date === today);
    } else if (this.data.filterDate === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekAgoStr = this.formatDate(weekAgo);
      filtered = filtered.filter(r => r.date >= weekAgoStr && r.date <= today);
    } else if (this.data.filterDate === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const monthAgoStr = this.formatDate(monthAgo);
      filtered = filtered.filter(r => r.date >= monthAgoStr && r.date <= today);
    }
    
    // 按状态筛选
    if (this.data.filterStatus === 'completed') {
      filtered = filtered.filter(r => r.status === '已服药');
    } else if (this.data.filterStatus === 'missed') {
      filtered = filtered.filter(r => r.status === '未服药' || r.status === '漏服' || r.status === '未服');
    }
    
    return filtered;
  },

  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  changeFilter(e) {
    const type = e.currentTarget.dataset.type;
    const value = e.detail.value;
    
    if (type === 'date') {
      // Picker returns index, map to value
      const options = ['today', 'week', 'month', 'all'];
      this.setData({ filterDate: options[value] });
    } else {
      // Picker returns index, map to value
      const options = ['all', 'completed', 'missed'];
      this.setData({ filterStatus: options[value] });
    }
    
    // Re-filter current all records (ideally should reload or just re-filter)
    // For simplicity, reload which triggers filter
    this.loadHistory();
  },
  
  onDateFilter(e) { 
    const value = e.currentTarget.dataset.value; 
    this.setData({ filterDate: value }); 
    this.loadHistory(); 
  }, 
  
  onStatusFilter(e) { 
    const value = e.currentTarget.dataset.value; 
    this.setData({ filterStatus: value }); 
    this.loadHistory(); 
  },

  /**
   * 查看大图
   */
  viewImage(e) {
    const imageBase64 = e.currentTarget.dataset.image;
    
    if (!imageBase64) {
      wx.showToast({
        title: '暂无照片',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showImageModal: true,
      currentImage: `data:image/jpeg;base64,${imageBase64}`
    });
  },

  /**
   * 关闭图片弹窗
   */
  closeImageModal() {
    this.setData({
      showImageModal: false,
      currentImage: ''
    });
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.loadHistory().then(() => {
      wx.stopPullDownRefresh();
    });
  },
  
  // Empty handler to prevent event bubbling
  doNothing() {}
});
