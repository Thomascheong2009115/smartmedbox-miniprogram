const api = require('../../utils/api.js');

Page({
  data: {
    // Year Selection
    currentYear: new Date().getFullYear(),
    yearRange: [],

    alarms: {
      morning: '08:00',
      noon: '12:30',
      evening: '19:00'
    },
    
    // Internal state for layout (red/blue/green slots)
    pillboxLayout: [
      // Morning
      { id: 'red-morning', color: 'red', colorName: '红色', period: 'morning', periodName: '早上', medicines: [] },
      { id: 'blue-morning', color: 'blue', colorName: '蓝色', period: 'morning', periodName: '早上', medicines: [] },
      { id: 'green-morning', color: 'green', colorName: '绿色', period: 'morning', periodName: '早上', medicines: [] },
      // Noon
      { id: 'red-noon', color: 'red', colorName: '红色', period: 'noon', periodName: '中午', medicines: [] },
      { id: 'blue-noon', color: 'blue', colorName: '蓝色', period: 'noon', periodName: '中午', medicines: [] },
      { id: 'green-noon', color: 'green', colorName: '绿色', period: 'noon', periodName: '中午', medicines: [] },
      // Evening
      { id: 'red-evening', color: 'red', colorName: '红色', period: 'evening', periodName: '晚上', medicines: [] },
      { id: 'blue-evening', color: 'blue', colorName: '蓝色', period: 'evening', periodName: '晚上', medicines: [] },
      { id: 'green-evening', color: 'green', colorName: '绿色', period: 'evening', periodName: '晚上', medicines: [] },
    ],

    // Derived data for display
    morningMeds: [],
    noonMeds: [],
    eveningMeds: [],

    // Edit Dialog
    showEditDialog: false,
    currentEditSlotId: null,
    isEditing: false, // 是否是編輯模式（false為添加，true為修改）
    
    // Temp Data for Form
    tempDrugName: '',
    tempDose: '',
    tempTime: '',
    tempDate: '',
    tempFrequency: 'daily'
  },

  onLoad() {
    // Init Year Range
    const nowYear = new Date().getFullYear();
    const startYear = 2025;
    const years = [];
    for (let y = nowYear; y >= startYear; y--) {
        years.push(y);
    }
    this.setData({ 
        currentYear: nowYear,
        yearRange: years
    });

    // Load local storage first
    const savedLayout = wx.getStorageSync('pillboxLayout');
    if (savedLayout) {
      this.setData({ pillboxLayout: savedLayout });
    }
    this.updateDerivedData();
    
    this.loadInventory();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateSelected(1);
    }
    // 重新加載 pillboxLayout（語音排班可能已更新）
    const savedLayout = wx.getStorageSync('pillboxLayout');
    if (savedLayout && savedLayout.length > 0) {
      this.setData({ pillboxLayout: savedLayout });
    }
    this.updateDerivedData();
    this.loadInventory();
  },

  // ===== Data Loading =====

  async loadInventory() {
    try {
      const result = await api.getInventoryStatus();
      const inventory = result.data.slots; // [{id, remaining, total}, ...]
      
      const newLayout = this.data.pillboxLayout.map(slot => {
        const inv = inventory.find(i => i.id === slot.id) || {};
        return {
          ...slot,
          remaining: inv.remaining !== undefined ? inv.remaining : 7,
          total: inv.total || 7
        };
      });
      
      this.setData({ pillboxLayout: newLayout });
      this.updateDerivedData();
    } catch (error) {
      console.error('加载库存失败', error);
    }
  },

  updateDerivedData() {
        const layout = this.data.pillboxLayout;
        
        const processSlot = (slot) => {
            // Parse startDate
            let dateLabel = '';
            if (slot.startDate) {
                const d = new Date(slot.startDate);
                dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
            }

            // 解析 medicines 數組，分離出藥名和劑量
            // 語音識別存儲格式為 "藥名 劑量" 字符串數組
            let drugName = '';
            let dose = '';
            
            if (slot.medicines && slot.medicines.length > 0) {
                const fullStr = slot.medicines[0]; // 暫時只取第一個藥展示
                const parts = fullStr.split(' ');
                if (parts.length > 1) {
                    drugName = parts[0];
                    dose = parts.slice(1).join(' ');
                } else {
                    drugName = fullStr;
                }
            }

            return {
                ...slot,
                name: slot.medicines && slot.medicines.length > 0 ? slot.medicines.join(', ') : '', // 兼容舊邏輯判斷是否為空
                drugName: drugName,
                dose: dose,
                scheduleTime: slot.scheduleTime || '',
                frequency: slot.frequency || 'daily',
                dateLabel: dateLabel
            };
        };

    this.setData({
      morningMeds: layout.filter(s => s.period === 'morning').map(processSlot),
      noonMeds: layout.filter(s => s.period === 'noon').map(processSlot),
      eveningMeds: layout.filter(s => s.period === 'evening').map(processSlot)
    });
  },

  onYearChange(e) {
      const idx = e.detail.value;
      const year = this.data.yearRange[idx];
      this.setData({ currentYear: year });
      wx.showToast({ title: `已切換至 ${year} 年`, icon: 'none' });
      // Future: Load historical data based on year?
      // For now, pillboxLayout is current state. 
      // This year selector might be for viewing logs or filtering.
      // But user asked to "add a year option", implying maybe setting year for startDate?
      // The requirement says: "在左上角添加一个年份选项... 默认是显示今年... 也可以手动去选择往年的数据"
      // This sounds like a filter for viewing.
      // However, "給每個藥格增加設置日期的功能(日和月)" implies editing.
      // If we edit "Month/Day", what Year is it? Defaults to currentYear probably.
  },

  onGridDateChange(e) {
      const id = e.currentTarget.dataset.id;
      const val = e.detail.value; // "MM-DD" or full date?
      // Picker mode="date" returns "YYYY-MM-DD". 
      // But user wants "日和月". We can use mode="date" and just display MM/DD.
      // But we need to respect the selected Year?
      // If user picks a date from picker, it includes Year.
      // Let's assume standard date picker is fine, but we default to currentYear.
      
      const newLayout = this.data.pillboxLayout.map(s => {
          if (s.id === id) return { ...s, startDate: val };
          return s;
      });
      
      this.setData({ pillboxLayout: newLayout });
      wx.setStorageSync('pillboxLayout', newLayout);
      this.updateDerivedData();
  },

  // ===== Grid Item Interaction =====
  
  noop() {}, 

  onMedTap(e) {
    const { period, index } = e.currentTarget.dataset;
    let targetSlot;
    if (period === 'morning') targetSlot = this.data.morningMeds[index];
    else if (period === 'noon') targetSlot = this.data.noonMeds[index];
    else if (period === 'evening') targetSlot = this.data.eveningMeds[index];

    if (!targetSlot) return;

    // 判斷是編輯還是添加
    const isEditing = !!targetSlot.name;
    
    // 獲取當前日期字符串
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    this.setData({
      showEditDialog: true,
      currentEditSlotId: targetSlot.id,
      isEditing: isEditing,
      
      // 表單初始化
      tempDrugName: targetSlot.drugName || '',
      tempDose: targetSlot.dose || '',
      tempTime: targetSlot.scheduleTime || this.data.alarms[period] || '08:00', // 使用默認或現有時間
      tempDate: targetSlot.startDate || todayStr,
      tempFrequency: targetSlot.frequency || 'daily'
    });
  },

  // Form Input Handlers
  onDrugNameChange(e) { this.setData({ tempDrugName: e.detail.value }); },
  onDoseChange(e) { this.setData({ tempDose: e.detail.value }); },
  onTimeChange(e) { this.setData({ tempTime: e.detail.value }); },
  onDateChange(e) { this.setData({ tempDate: e.detail.value }); },
  onFreqChange(e) { this.setData({ tempFrequency: e.currentTarget.dataset.value }); },

  onEditCancel() {
    this.setData({ showEditDialog: false, currentEditSlotId: null });
  },

  onEditConfirm() {
    const slotId = this.data.currentEditSlotId;
    const drugName = this.data.tempDrugName.trim();
    const dose = this.data.tempDose.trim();
    
    if (!drugName) {
        wx.showToast({ title: '請輸入藥名', icon: 'none' });
        return;
    }

    // 構造標準格式字符串 "藥名 劑量"
    // 注意：語音識別邏輯是 "drug_name dose"，我們保持一致
    const medStr = dose ? `${drugName} ${dose}` : drugName;
    const medicines = [medStr]; // 目前一個格子只支持顯示一種主藥，保持數組結構兼容

    // 更新 pillboxLayout
    const newLayout = this.data.pillboxLayout.map(slot => {
      if (slot.id === slotId) {
        const updatedSlot = { 
            ...slot, 
            medicines: medicines,
            scheduleTime: this.data.tempTime,
            startDate: this.data.tempDate,
            frequency: this.data.tempFrequency
        };
        
        // 如果是單次，自動計算過期時間（參考語音邏輯）
        if (updatedSlot.frequency === 'once') {
            const start = new Date(updatedSlot.startDate);
            const expire = new Date(start);
            expire.setDate(expire.getDate() + 1);
            updatedSlot.expireDate = `${expire.getFullYear()}-${String(expire.getMonth() + 1).padStart(2, '0')}-${String(expire.getDate()).padStart(2, '0')}`;
        } else {
            delete updatedSlot.expireDate;
        }
        
        return updatedSlot;
      }
      return slot;
    });

    this.setData({
      pillboxLayout: newLayout,
      showEditDialog: false,
      currentEditSlotId: null
    });
    wx.setStorageSync('pillboxLayout', newLayout);
    this.updateDerivedData();

    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onClearSlot() {
      const slotId = this.data.currentEditSlotId;
      wx.showModal({
          title: '確認清空',
          content: '確定要清空此藥格嗎？',
          success: (res) => {
              if (res.confirm) {
                  const newLayout = this.data.pillboxLayout.map(slot => {
                      if (slot.id === slotId) {
                          return { 
                              ...slot, 
                              medicines: [], // 清空藥品
                              // 保留基礎屬性，重置可變屬性
                              frequency: 'daily',
                              scheduleTime: '', 
                              startDate: ''
                          };
                      }
                      return slot;
                  });
                  
                  this.setData({ pillboxLayout: newLayout, showEditDialog: false });
                  wx.setStorageSync('pillboxLayout', newLayout);
                  this.updateDerivedData();
                  wx.showToast({ title: '已清空', icon: 'success' });
              }
          }
      });
  },

  // ===== Refill Logic =====

  onRefill(e) {
    const { period, index } = e.currentTarget.dataset;
    let targetSlot;
    if (period === 'morning') targetSlot = this.data.morningMeds[index];
    else if (period === 'noon') targetSlot = this.data.noonMeds[index];
    else if (period === 'evening') targetSlot = this.data.eveningMeds[index];

    if (!targetSlot) return;

    wx.showModal({
      title: '確認補充',
      content: `確認已補充 ${targetSlot.periodName} 的 ${targetSlot.colorName} 藥格？`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '補充中...' });
          try {
            await api.resetSlotInventory(targetSlot.id, 7);
            wx.hideLoading();
            wx.showToast({ title: '補充成功', icon: 'success' });
            this.loadInventory();
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: '補充失敗', icon: 'none' });
          }
        }
      }
    });
  }
});
