// pages/voice-recorder/voice-recorder.js
const api = require('../../utils/api.js');
const recorderManager = wx.getRecorderManager();
const innerAudioContext = wx.createInnerAudioContext();

Page({
  data: {
    savedVoices: [],
    currentVoiceId: null,
    lastCommand: '',
    showEditDialog: false,
    currentEditIndex: -1,
    tempTranscript: '',
    
    // Rerecord
    showRerecordModal: false,
    rerecordIndex: -1,
    isRerecording: false,
    rerecordDuration: 0,

    // Main Record Button
    isRecording: false,
    recordDuration: 0,
    
    // Confirm Modal
    showConfirmModal: false,
    finalText: '',
    pendingAudioPath: '',
    pendingDuration: 0,
    
    // Manual Input
    showManualInputModal: false,
    manualInputText: ''
  },

  // ===== Manual Input Logic =====

  openManualInput() {
      this.setData({
          showManualInputModal: true,
          manualInputText: ''
      });
  },

  closeManualInput() {
      this.setData({
          showManualInputModal: false,
          manualInputText: ''
      });
  },

  onManualInputChange(e) {
      this.setData({ manualInputText: e.detail.value });
  },

  async submitManualInput() {
      const text = this.data.manualInputText.trim();
      if (!text) {
          wx.showToast({ title: '請輸入內容', icon: 'none' });
          return;
      }

      this.setData({ showManualInputModal: false });

      // 1. Save as a "text-only" voice record (no audio path)
      const voiceId = `text_${Date.now()}`;
      const voiceInfo = {
          id: voiceId,
          createTime: new Date().toLocaleString(),
          audioPath: '', // Empty for manual text
          duration: 0,
          transcriptText: text
      };

      let savedVoices = this.data.savedVoices || [];
      savedVoices.unshift(voiceInfo);
      if (savedVoices.length > 20) savedVoices = savedVoices.slice(0, 20);
      
      this.setData({ 
          savedVoices,
          lastCommand: text 
      });
      wx.setStorageSync('savedVoices', savedVoices);
      wx.setStorageSync('lastVoiceCommand', text);

      // 2. Process schedule using same logic as voice
      await this._reprocessSchedule(text);
  },

  onLoad() {
    this.loadSavedVoices();
    this.initRecorder();
    this._lastStopTimestamp = 0; // 防止頻繁錄音
  },

  initRecorder() {
    // 監聽錄音結束事件 (用於主錄音按鈕)
    recorderManager.onStop((res) => {
        this._lastStopTimestamp = Date.now(); // 更新停止時間戳

        if (this.data.isRerecording) {
            // 重錄邏輯
            clearInterval(this._rerecordTimer);
            if (this.data.showRerecordModal) {
                this.handleRerecordSuccess(res);
            }
        } else if (this.data.isRecording) {
            // 主錄音邏輯
            this.handleRecordStop(res);
        }
    });

    recorderManager.onError((err) => {
        this._lastStopTimestamp = Date.now(); // 更新停止時間戳
        console.error('錄音錯誤', err);
        this.setData({ isRecording: false, isRerecording: false });
        wx.showToast({ title: '錄音失敗', icon: 'none' });
    });
  },

  // ===== 主錄音按鈕邏輯 =====

  startRecord() {
    this._isTouching = true;

    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.record']) {
          this._doStartRecord();
        } else {
          wx.authorize({
            scope: 'scope.record',
            success: () => {
              this._doStartRecord();
            },
            fail: () => {
              this._isTouching = false; // Reset
              wx.showModal({
                title: '需要錄音權限',
                content: '請在設置中開啟錄音權限',
                success: (res) => { if (res.confirm) wx.openSetting(); }
              });
            }
          });
        }
      },
      fail: (err) => {
        console.error('getSetting failed', err);
      }
    });
  },

  _doStartRecord() {
    if (!this._isTouching) return; // User released before auth/check finished
    if (this.data.isRecording) return; // Already recording

    const now = Date.now();
    if (now - this._lastStopTimestamp < 1000) {
        wx.showToast({ title: '操作太頻繁，請稍後', icon: 'none' });
        return;
    }

    wx.vibrateShort({ type: 'heavy' });
    this.setData({ isRecording: true, recordDuration: 0 });
    
    const options = {
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
    };
    
    try {
        recorderManager.start(options);
    } catch (e) {
        console.error('Start record failed', e);
        this.setData({ isRecording: false });
        this._lastStopTimestamp = Date.now(); // 發生錯誤也冷卻一下
    }
    
    this._recordTimer = setInterval(() => {
        this.setData({ recordDuration: this.data.recordDuration + 1 });
    }, 1000);
  },

  stopRecord() {
    this._isTouching = false;
    if (this.data.isRecording) {
        recorderManager.stop();
        wx.vibrateShort({ type: 'medium' });
        clearInterval(this._recordTimer);
        // isRecording 將在 onStop 回調中設為 false
    }
  },

  async handleRecordStop(res) {
    this.setData({ isRecording: false });
    
    if (this.data.recordDuration < 1) {
        wx.showToast({ title: '錄音太短', icon: 'none' });
        return;
    }

    wx.showLoading({ title: '識別中...', mask: true });

    try {
        const base64 = await this.readAudioAsBase64(res.tempFilePath);
        const result = await api.speechToText(base64);

        if (result.status === 'success' && result.text) {
            const text = result.text;
            
            // 彈出確認框，讓用戶確認或修改識別結果
            this.setData({
                finalText: text,
                showConfirmModal: true,
                pendingAudioPath: res.tempFilePath,
                pendingDuration: this.data.recordDuration
            });

        } else {
            throw new Error('識別失敗');
        }
    } catch (err) {
        console.error('語音處理失敗', err);
        wx.hideLoading();
        wx.showToast({ title: '識別失敗，請重試', icon: 'none' });
    }
  },

  onConfirmVoice() {
      const text = this.data.finalText;
      const audioPath = this.data.pendingAudioPath;
      const duration = this.data.pendingDuration;

      // 1. 保存到語音庫
      this.autoSaveVoice(audioPath, duration, text);
      
      // 2. 更新最後指令顯示
      this.setData({ 
          lastCommand: text,
          showConfirmModal: false,
          finalText: '',
          pendingAudioPath: '',
          pendingDuration: 0
      });
      wx.setStorageSync('lastVoiceCommand', text);

      // 3. 自動解析排班
      wx.showToast({ title: '識別成功，正在解析...', icon: 'none' });
      this._reprocessSchedule(text);
  },

  onCancelVoice() {
      this.setData({
          showConfirmModal: false,
          finalText: '',
          pendingAudioPath: '',
          pendingDuration: 0
      });
      wx.showToast({ title: '已取消', icon: 'none' });
  },
  
  onVoiceTextChange(e) {
      this.setData({ finalText: e.detail.value });
  },

  autoSaveVoice(filePath, duration, transcriptText) {
      const voiceId = `voice_${Date.now()}`;
      const voiceInfo = {
        id: voiceId,
        createTime: new Date().toLocaleString(),
        audioPath: filePath,
        duration: duration,
        transcriptText: transcriptText || ''
      };
  
      let savedVoices = this.data.savedVoices || [];
      savedVoices.unshift(voiceInfo);
      if (savedVoices.length > 20) savedVoices = savedVoices.slice(0, 20);
      
      this.setData({ savedVoices });
      wx.setStorageSync('savedVoices', savedVoices);
  },

  readAudioAsBase64(filePath) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      // PC端兼容 (僅開發者工具模擬器需要 wx.request)
      if (filePath.startsWith('http://tmp/')) {
        wx.request({
          url: filePath,
          responseType: 'arraybuffer',
          success: (res) => {
            if (res.statusCode === 200 && res.data) {
              const base64 = wx.arrayBufferToBase64(res.data);
              resolve(base64);
            } else {
              reject(new Error(`获取临时文件失败: ${res.statusCode}`));
            }
          },
          fail: (reqErr) => {
             // 嘗試下載
             wx.downloadFile({
                 url: filePath,
                 success: (downRes) => {
                     if (downRes.statusCode === 200) {
                         fs.readFile({
                             filePath: downRes.tempFilePath,
                             encoding: 'base64',
                             success: (readRes) => resolve(readRes.data),
                             fail: reject
                         });
                     } else {
                         reject(new Error('下載失敗'));
                     }
                 },
                 fail: reject
             });
          }
        });
        return;
      }
      // 普通情况
      fs.readFile({
        filePath: filePath,
        encoding: 'base64',
        success: (res) => resolve(res.data),
        fail: reject
      });
    });
  },

  onShow() {
    this.loadSavedVoices();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateSelected(2);
    }
  },

  // goBack removed as it is now a tab page
  
  /**
   * 加载已保存的语音列表
   */
  loadSavedVoices() {
    const savedVoices = wx.getStorageSync('savedVoices') || [];
    const currentVoiceId = wx.getStorageSync('currentVoiceId') || null;
    const lastCommand = wx.getStorageSync('lastVoiceCommand') || '';
    
    this.setData({
      savedVoices: savedVoices,
      currentVoiceId: currentVoiceId,
      lastCommand: lastCommand
    });
  },

  /**
   * 设置为提醒语音
   */
  setAsReminderVoice(e) {
    const voiceId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认设置',
      content: '将此语音设置为提醒音？',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('currentVoiceId', voiceId);
          this.setData({ currentVoiceId: voiceId });
          
          wx.showToast({
            title: '设置成功',
            icon: 'success'
          });
          
          // TODO: 将语音ID同步到服务器
          // 需要后端提供接口保存用户选择的语音ID
        }
      }
    });
  },

  /**
   * 播放已保存的语音
   */
  playSavedVoice(e) {
    const index = e.currentTarget.dataset.index;
    const voice = this.data.savedVoices[index];
    
    innerAudioContext.src = voice.audioPath;
    innerAudioContext.play();
  },

  /**
   * 删除语音
   */
  deleteVoice(e) {
    const index = e.currentTarget.dataset.index;
    const voice = this.data.savedVoices[index];
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条语音吗？',
      success: (res) => {
        if (res.confirm) {
          // 删除本地文件
          try {
            // PC端临时文件路径(http://tmp/...)无法直接unlink，也无需手动删除(系统会自动清理)
            // 仅尝试删除非临时路径的文件
            if (voice.audioPath && 
                !voice.audioPath.startsWith('http://tmp/') && 
                !voice.audioPath.startsWith('wxfile://tmp_')) {
                
                const fs = wx.getFileSystemManager();
                fs.unlink({
                  filePath: voice.audioPath,
                  success: () => console.log('文件删除成功'),
                  fail: (err) => console.warn('文件删除失败(非关键错误)', err)
                });
            }
          } catch (e) {
            console.warn('删除文件异常(非关键错误)', e);
          }

          const savedVoices = this.data.savedVoices;
          savedVoices.splice(index, 1);
          
          wx.setStorageSync('savedVoices', savedVoices);
          this.setData({ savedVoices: savedVoices });
          
          // 如果删除的是当前使用的语音，清除设置
          if (voice.id === this.data.currentVoiceId) {
            wx.removeStorageSync('currentVoiceId');
            this.setData({ currentVoiceId: null });
          }
          
          wx.showToast({
            title: '已删除',
            icon: 'success'
          });
        }
      }
    });
  },

  /**
   * 使用预设文本生成语音
   */
  /*
  async usePresetText(e) {
    // ... removed ...
  },
  */

  onUnload() {
    // 页面卸载时停止播放
    innerAudioContext.stop();
  },

  // ===== 編輯與重新解析 =====

  onEditVoice(e) {
    const index = e.currentTarget.dataset.index;
    const voice = this.data.savedVoices[index];
    this.setData({
      showEditDialog: true,
      currentEditIndex: index,
      tempTranscript: voice.transcriptText || ''
    });
  },

  onEditCancel() {
    this.setData({
      showEditDialog: false,
      currentEditIndex: -1,
      tempTranscript: ''
    });
  },

  onTranscriptChange(e) {
    this.setData({ tempTranscript: e.detail.value });
  },

  async onEditConfirm() {
    const index = this.data.currentEditIndex;
    const newText = this.data.tempTranscript.trim();
    
    if (!newText) {
      wx.showToast({ title: '內容不能為空', icon: 'none' });
      return;
    }

    this.setData({ showEditDialog: false });

    // 1. 更新本地列表顯示，並標記為已修改 (isModified)
    const savedVoices = [...this.data.savedVoices];
    
    // 刪除舊的音頻文件（因為文字變了，舊音頻不匹配了）
    const oldVoice = savedVoices[index];
    if (oldVoice.audioPath) {
        try {
            const fs = wx.getFileSystemManager();
            // 嘗試刪除舊文件，忽略錯誤
            fs.unlink({ filePath: oldVoice.audioPath, fail: () => {} });
        } catch (e) {}
    }

    savedVoices[index].transcriptText = newText;
    savedVoices[index].isModified = true; // 標記為已修改
    savedVoices[index].audioPath = '';    // 清空舊音頻路徑
    
    this.setData({ savedVoices });
    wx.setStorageSync('savedVoices', savedVoices);
    
    // 如果是最新的一條，更新 lastVoiceCommand
    if (index === 0) {
        wx.setStorageSync('lastVoiceCommand', newText);
        this.setData({ lastCommand: newText });
    }

    // 2. 調用 NLP 重新解析並覆蓋排班
    await this._reprocessSchedule(newText);
  },

  // ===== 重錄功能 =====

  rerecordVoice(e) {
      const index = e.currentTarget.dataset.index;
      this.setData({
          showRerecordModal: true,
          rerecordIndex: index,
          isRerecording: false,
          rerecordDuration: 0
      });
  },

  closeRerecordModal() {
      if (this.data.isRerecording) {
          recorderManager.stop();
      }
      this.setData({
          showRerecordModal: false,
          rerecordIndex: -1,
          isRerecording: false,
          rerecordDuration: 0
      });
  },

  startRerecord() {
      const now = Date.now();
      if (now - this._lastStopTimestamp < 1000) {
          wx.showToast({ title: '操作太頻繁，請稍後', icon: 'none' });
          return;
      }

      this.setData({ isRerecording: true, rerecordDuration: 0 });
      
      const options = {
          duration: 60000,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3'
      };
      
      recorderManager.start(options);
      
      this._rerecordTimer = setInterval(() => {
          this.setData({ rerecordDuration: this.data.rerecordDuration + 1 });
      }, 1000);

      // onStop logic moved to initRecorder global handler
  },

  stopRerecord() {
      recorderManager.stop(); // 會觸發 onStop
  },

  handleRerecordSuccess(res) {
      const index = this.data.rerecordIndex;
      const savedVoices = [...this.data.savedVoices];
      const filePath = res.tempFilePath;
      
      savedVoices[index].audioPath = filePath;
      savedVoices[index].duration = Math.ceil(res.duration / 1000);
      savedVoices[index].isModified = false; // 重錄完成，恢復正常狀態
      
      this.setData({ 
          savedVoices,
          showRerecordModal: false,
          isRerecording: false,
          rerecordIndex: -1
      });
      wx.setStorageSync('savedVoices', savedVoices);
      
      wx.showToast({ title: '重錄成功', icon: 'success' });
  },

  async _reprocessSchedule(text) {
    wx.showLoading({ title: '重新解析中...', mask: true });
    try {
      // 調用 API 解析
      const result = await api.parseMedSchedule(text, '');
      console.log('Reprocess result:', result); // Debug log

      // 兼容後端返回格式：可能是 result.data.schedules 或 result.schedules
      const schedules = result.schedules || (result.data && result.data.schedules);

      if (schedules && schedules.length > 0) {
        // 執行排班邏輯 (复用 home.js 的逻辑)
        const processed = this._assignGridAndProcess(schedules, text);
        
        if (processed) {
            // 保存排班
            this._saveSchedulesToPillbox(processed);
            wx.hideLoading();
            wx.showToast({ title: '排班已更新', icon: 'success' });
        } else {
            wx.hideLoading();
            wx.showModal({
                title: '藥盒已滿',
                content: '無法分配新藥格，請先清理藥盒空間。',
                showCancel: false
            });
        }
      } else {
        wx.hideLoading();
        wx.showToast({ title: '未能識別排班信息', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('重新解析失败', err);
      wx.showToast({ title: '解析失敗，請重試', icon: 'none' });
    }
  },

  // 复用 home.js 的逻辑 (简化版)
  _assignGridAndProcess(schedules, fullText) {
    let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
    if (pillboxLayout.length === 0) {
      pillboxLayout = this._getDefaultPillboxLayout();
    }
    
    const gridMap = { 
      'red-morning': 1, 'blue-morning': 2, 'green-morning': 3, 
      'red-noon': 4, 'blue-noon': 5, 'green-noon': 6, 
      'red-evening': 7, 'blue-evening': 8, 'green-evening': 9 
    }; 
    const periodKeyMap = { "早上": "morning", "中午": "noon", "晚上": "evening" };

    const processedSchedules = [];

    for (const s of schedules) {
      const periodKey = periodKeyMap[s.period];
      if (!periodKey) continue;

      const medText = `${s.drug_name} ${s.dose}`.trim();
      
      // Check existing
      const periodSlots = pillboxLayout.filter(slot => slot.period === periodKey);
      const existingSlot = periodSlots.find(slot => 
        (slot.medicines || []).some(m => m.includes(s.drug_name))
      );

      let assignedGrid = 0;
      let assignedSlotId = '';

      if (existingSlot) {
        assignedSlotId = existingSlot.id;
        assignedGrid = gridMap[existingSlot.id] || 0;
      } else {
        const emptySlot = periodSlots.find(slot => !slot.medicines || slot.medicines.length === 0);
        if (emptySlot) {
          assignedSlotId = emptySlot.id;
          assignedGrid = gridMap[emptySlot.id] || 0;
        } else {
          const anyEmpty = pillboxLayout.find(slot => !slot.medicines || slot.medicines.length === 0);
          if (anyEmpty) {
            assignedSlotId = anyEmpty.id;
            assignedGrid = gridMap[anyEmpty.id] || 0;
          } else {
            return null; // Full
          }
        }
      }

      // Date Logic
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      let targetDate = todayStr;
      
      const txt = (fullText || '').replace(/\s+/g, '');
      if (txt.includes('後天') || txt.includes('后天')) {
           const d = new Date(now); 
           d.setDate(d.getDate() + 2);
           targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else if (txt.includes('明天') || txt.includes('明日')) {
           const d = new Date(now); 
           d.setDate(d.getDate() + 1);
           targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      processedSchedules.push({
        ...s,
        timeStr: `${String(s.time_h).padStart(2, '0')}:${String(s.time_m).padStart(2, '0')}`,
        gridNumber: assignedGrid,
        gridSlotId: assignedSlotId,
        frequencyLabel: s.frequency === 'once' ? '單次' : '每日',
        startDate: targetDate
      });
    }

    return processedSchedules;
  },

  _saveSchedulesToPillbox(schedules) {
      let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
      if (pillboxLayout.length === 0) pillboxLayout = this._getDefaultPillboxLayout();

      schedules.forEach(s => {
        const idx = pillboxLayout.findIndex(slot => slot.id === s.gridSlotId);
        if (idx === -1) return;

        const medText = `${s.drug_name} ${s.dose}`.trim();
        const existingMeds = pillboxLayout[idx].medicines || [];
        const alreadyHas = existingMeds.some(m => m.includes(s.drug_name));

        if (alreadyHas) {
          pillboxLayout[idx].medicines = existingMeds.map(m => 
            m.includes(s.drug_name) ? medText : m 
          );
        } else {
          pillboxLayout[idx].medicines = [...existingMeds, medText];
        }

        pillboxLayout[idx].frequency = s.frequency || 'daily';
        pillboxLayout[idx].scheduleTime = `${String(s.time_h).padStart(2,'0')}:${String(s.time_m).padStart(2,'0')}`;
        pillboxLayout[idx].startDate = s.startDate;

        if (s.frequency === 'once') { 
          const start = new Date(s.startDate);
          const expire = new Date(start);
          expire.setDate(expire.getDate() + 1);
          const expireDate = `${expire.getFullYear()}-${String(expire.getMonth() + 1).padStart(2, '0')}-${String(expire.getDate()).padStart(2, '0')}`; 
          pillboxLayout[idx].expireDate = expireDate; 
        } else {
            delete pillboxLayout[idx].expireDate;
        }
      });

      wx.setStorageSync('pillboxLayout', pillboxLayout);
  },

  _getDefaultPillboxLayout() {
    const colors = ['red', 'blue', 'green']; 
    const colorNames = ['红色', '蓝色', '绿色']; 
    const periods = [ 
      { key: 'morning', name: '早上' }, 
      { key: 'noon', name: '中午' }, 
      { key: 'evening', name: '晚上' } 
    ]; 
    const layout = []; 
    periods.forEach(p => { 
      colors.forEach((c, i) => { 
        layout.push({ 
          id: `${c}-${p.key}`, color: c, colorName: colorNames[i], 
          period: p.key, periodName: p.name, medicines: [] 
        }); 
      }); 
    }); 
    return layout; 
  }
});
