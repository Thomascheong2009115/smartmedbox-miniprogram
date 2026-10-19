const api = require('../../utils/api.js');

Page({
  data: {
    deviceOnline: false,
    greetingText: '早上好',
    dateStr: '',
    doneCount: 0,
    totalMedsCount: 0,
    todayProgress: 0,
    nextAlarmText: '',
    alarms: { 
      morning: { time: '08:00', name: '暫無藥品', prefix: '' }, 
      noon: { time: '14:42', name: '暫無藥品', prefix: '' }, 
      afternoon: { time: '16:00', name: '暫無藥品', prefix: '' },
      evening: { time: '20:16', name: '暫無藥品', prefix: '' } 
    },
    morningTheme: 'warning', morningVariant: 'light', morningDone: false, morningLabel: '待服用',
    noonTheme: 'warning', noonVariant: 'light', noonDone: false, noonLabel: '待服用',
    eveningTheme: 'warning', eveningVariant: 'light', eveningDone: false, eveningLabel: '待服用',
    
    // Yesterday's Meds
    yesterdayAlarms: {
        morning: { time: '08:00', name: '暫無藥品', prefix: '' }, 
        noon: { time: '14:42', name: '暫無藥品', prefix: '' }, 
        afternoon: { time: '16:00', name: '暫無藥品', prefix: '' },
        evening: { time: '20:16', name: '暫無藥品', prefix: '' } 
    },
    yesterdayMorningTheme: 'disabled', yesterdayMorningLabel: '昨日無藥', yesterdayMorningDone: false,
    yesterdayNoonTheme: 'disabled', yesterdayNoonLabel: '昨日無藥', yesterdayNoonDone: false,
    yesterdayAfternoonTheme: 'disabled', yesterdayAfternoonLabel: '昨日無藥', yesterdayAfternoonDone: false,
    yesterdayEveningTheme: 'disabled', yesterdayEveningLabel: '昨日無藥', yesterdayEveningDone: false,
    
    hasNotice: false,
    noticeTheme: 'primary',
    noticeIcon: 'info-circle',
    noticeText: '暫無最新通知',
    warningCount: 0,
    timer: null,
    
    // Siri 錄音相關 
    isHomeRecording: false, 
    homeRecordTime: 0, 
    
    // 语音识别相关
    finalText: '',
    showConfirmModal: false,
    isRecognizing: false,
    pendingAudioPath: '',
    pendingDuration: 0,
    
    // 排班确认卡相关 
    showScheduleModal: false,    // 是否显示排班确认卡 
    parsedSchedules: [],         // NLP 解析出的排班数据数组 
    isParsing: false,            // 是否正在解析中 
    
    // ===== 槽位填充追问 ===== 
    showFollowUpModal: false,   // 是否显示追问弹窗 
    followUpQuestion: '',        // AI 追问的问题文本 
    followUpAnswer: '',          // 用户输入的回答 
    pendingContext: '',          // 多轮追问的上下文（累积的对话历史） 
    pendingPartialSchedules: [], // AI 已部分识别的排班（缺少 dose 等） 
    
    // 昨日未服藥提示
    yesterdayMissedText: ''
  },

  onLoad() {
    this.updateGreetingAndDate();
    this.initHomeRecorder(); 
    this.loadHomeData();
    this.checkYesterdayMissed();
    // Refresh every 30 seconds
    this.data.timer = setInterval(() => {
      this.loadHomeData();
    }, 30000);
  },

  checkYesterdayMissed() {
      // 1. 計算昨天的日期字符串
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      
      // 2. 獲取通知列表
      const notifications = wx.getStorageSync('notifications') || [];
      
      // 3. 過濾出昨天的未服藥警告
      // ID 格式: notif_YYYY-MM-DD_內容
      const missed = notifications.filter(n => 
          n.id.startsWith(`notif_${yesterdayStr}`) && 
          n.type === 'warning'
      );
      
      if (missed.length > 0) {
          let text = '';
          if (missed.length === 1) {
              // 嘗試從內容中提取時間 "早上 08:00 藥品"
              const content = missed[0].content; 
              // 匹配時間 HH:mm
              const timeMatch = content.match(/(\d{2}:\d{2})/);
              const time = timeMatch ? timeMatch[1] : '';
              text = `昨日 ${time} 未服藥`;
          } else {
              text = '昨日有多次未服藥';
          }
          this.setData({ yesterdayMissedText: text });
      } else {
          this.setData({ yesterdayMissedText: '' });
      }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateSelected(0);
    }
    this.updateGreetingAndDate();
    this.loadHomeData();
    this.checkYesterdayMissed();
  },

  onUnload() {
    if (this.data.timer) {
      clearInterval(this.data.timer);
    }
  },

  onPullDownRefresh() {
    this.loadHomeData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onShareAppMessage() {
    return {
      title: '智能藥箱 - 您的貼心用藥助手',
      path: '/pages/home/home'
    };
  },

  updateGreetingAndDate() {
    const now = new Date();
    const hour = now.getHours();
    let greeting = '早上好 ☀';
    if (hour >= 11 && hour < 14) greeting = '中午好 ☼';
    else if (hour >= 14 && hour < 18) greeting = '下午好';
    else if (hour >= 18) greeting = '晚上好 ☾';

    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]}`;

    this.setData({
      greetingText: greeting,
      dateStr: dateStr
    });
  },

  getTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  async loadHomeData() {
    try {
      const [statusRes, configRes, monitorRes] = await Promise.allSettled([
        api.getMedicationStatus(),
        api.getAlarmConfig(),
        api.getMonitorData()
      ]);

      // 1. Config / Alarms
      let alarmsConfig = {};
      if (configRes.status === 'fulfilled') {
        alarmsConfig = configRes.value;
      }
      
      // 2. Monitor / Online Status
      let isOnline = false;
      if (monitorRes.status === 'fulfilled') {
        isOnline = true;
      }

      // 3. Medication Status (Local Cache + Latest Update)
      const todayStr = this.getTodayStr();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      
      let dailyStatus = wx.getStorageSync('todayMedStatus') || {};
      let yesterdayStatus = wx.getStorageSync('yesterdayMedStatus') || { date: yesterdayStr }; // Default empty if not found
      
      // Reset if date changed
      if (dailyStatus.date !== todayStr) {
        // If dailyStatus was from yesterday, move it to yesterdayStatus
        if (dailyStatus.date === yesterdayStr) {
            yesterdayStatus = dailyStatus;
            wx.setStorageSync('yesterdayMedStatus', yesterdayStatus);
        } else {
            // If it was even older, yesterday is also empty/missed
            yesterdayStatus = { date: yesterdayStr };
            wx.setStorageSync('yesterdayMedStatus', yesterdayStatus);
        }
        
        dailyStatus = {
          date: todayStr,
          morning: { status: 'pending' },
          noon: { status: 'pending' },
          evening: { status: 'pending' }
        };
      }

      // Update with latest status if available — 必須校驗日期是否今天
      if (statusRes.status === 'fulfilled' && statusRes.value) {
        const latest = statusRes.value;
        const periodMap = { '早上': 'morning', '中午': 'noon', '晚上': 'evening' };
        const key = periodMap[latest.period];
        if (key && latest.update_time) {
          // 提取後端返回的日期部分 "2026-02-18 14:43:26" → "2026-02-18"
          const statusDate = latest.update_time.split(' ')[0];
          // 只有日期匹配今天才更新
          if (statusDate === todayStr) {
            dailyStatus[key].status = latest.status;
            dailyStatus[key].time = latest.update_time;
          } else {
            console.log(`[忽略] 後端狀態日期 ${statusDate} 不是今天 ${todayStr}，跳過`);
          }
        }
      }
      
      // Save updated cache
      wx.setStorageSync('todayMedStatus', dailyStatus);

      this.setData({
        nextAlarmText: this.calculateNextAlarm(alarmsConfig),
        deviceOnline: isOnline
      });

      this.updateTodayMeds(alarmsConfig, dailyStatus);
      this.updateYesterdayMeds(alarmsConfig, yesterdayStatus);
      
      // Check last read timestamp for notification badge
      // If warningCount > 0, we check if user has read notifications AFTER the latest warning time
      // But for simplicity: if warningCount > 0, we always show red dot unless user clears it?
      // User requirement: "如果下次有新通知的話首頁的通知按鈕鈴鐺會有紅色的提示標記"
      // This implies if I read it, it should go away.
      
      // Implementation: Store 'lastNotificationReadTime' in storage.
      // Compare 'lastNotificationReadTime' with current time? No.
      // Compare with the time of the warnings?
      // Since warnings are dynamic (based on current time), we can store the 'lastReadWarningCount' or similar.
      // Better: When entering Notification page, save 'lastReadTimestamp'.
      // Here, if we have warnings, we check if they are 'new' since last read.
      // However, warnings are persistent until resolved (taken meds).
      // So if I see them, come back, they are still 'active warnings'.
      // User says: "目前是有通知的狀態，我已經打開過通知界面查看過通知了... 如果下次有新通知的話..."
      // So: persistent warnings should NOT show red dot if already seen.
      
      const lastReadTime = wx.getStorageSync('lastNotificationReadTime') || 0;
      // We need a way to identify if current warnings are 'newer' than lastReadTime.
      // Since our warnings are generated on the fly, we can use the current timestamp as 'warningGenerationTime'
      // But that changes every second.
      // Let's use a simple heuristic: if count > 0 and user just read it, hide badge.
      // If a NEW warning appears (count increases, or status changes), show badge.
      
      // Actually, simplest is:
      // On notification page unload: set 'lastKnownWarningCount' = current warning count.
      // On home page: if current warning count > lastKnownWarningCount, show badge.
      // BUT if I have 1 warning, read it, then later have 2 warnings, count > lastKnown -> show. Correct.
      // If I have 1 warning, read it, then later still 1 warning -> count == lastKnown -> hide. Correct.
      
      // Wait, what if the 1 warning changed? (e.g. Morning resolved, Noon new warning). Count is same (1).
      // Ideally we track IDs. But we don't have IDs.
      // Let's stick to Count for now as a robust enough proxy for "New Notification".
      
      const lastKnownCount = wx.getStorageSync('lastKnownWarningCount') || 0;
      const currentCount = this.data.warningCount; // Set in updateTodayMeds
      
      // Force update warningCount logic in updateTodayMeds to respect this
      // Actually updateTodayMeds sets warningCount based on array length.
      // We should override it based on read status.
      
      if (currentCount <= lastKnownCount) {
          this.setData({ warningCount: 0 }); // Hide badge if no *new* warnings
      } else {
          this.setData({ warningCount: currentCount - lastKnownCount }); // Show only new count? Or total? Standard is total.
          // User wants "red mark". Usually badge shows total count. 
          // If I read them, badge should disappear.
          // So if currentCount == lastKnownCount, badge = 0.
          // If currentCount > lastKnownCount, badge = currentCount (or just dot).
      }

    } catch (err) {
      console.error('Load home data error', err);
    }
  },

  updateTodayMeds(alarmsConfig, dailyStatus) {
    // 1. 定義四個時段
    const periods = ['morning', 'noon', 'afternoon', 'evening'];
    const periodNames = { 
        'morning': '早上', 
        'noon': '中午', 
        'afternoon': '下午', 
        'evening': '晚上' 
    };
    
    // 2. 定義時段範圍（用於判斷當前處於哪個時段，以及計算未服藥狀態）
    // 早上: 00:00-11:59 (0-719 min)
    // 中午: 12:00-13:59 (720-839 min)
    // 下午: 14:00-18:29 (840-1109 min)
    // 晚上: 18:30-23:59 (1110-1439 min)
    const periodRanges = {
        'morning': { start: 0, end: 719 },
        'noon': { start: 720, end: 839 },
        'afternoon': { start: 840, end: 1109 },
        'evening': { start: 1110, end: 1439 }
    };
    
    let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
    
    let state = {};
    let doneCount = 0;

    const now = new Date();
    const todayStr = this.getTodayStr();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const newAlarms = {};
    let overdueWarnings = [];

    // === 新邏輯開始 ===
    
    // 1. 收集所有今天的藥品任務
    let allTodayMeds = [];
    const legacyPeriods = ['morning', 'noon', 'evening']; // 原始數據只有這三個
    
    legacyPeriods.forEach(lp => {
        const periodSlots = pillboxLayout.filter(s => s.period === lp);
        periodSlots.forEach(s => {
             if (!s.medicines || s.medicines.length === 0) return;
             if (s.startDate && s.startDate > todayStr) return;
             if (s.frequency === 'once' && s.startDate < todayStr) return;
             
             // 確定時間
             let minutes = 0;
             let timeStr = '--:--';
             
             // 優先使用自定義時間
             if (s.scheduleTime) {
                 const [h, m] = s.scheduleTime.split(':').map(Number);
                 minutes = h * 60 + m;
                 timeStr = s.scheduleTime;
             } else {
                 // 回退到全局配置
                 const config = alarmsConfig[periodNames[lp]];
                 if (config) {
                     minutes = (config.h || 0) * 60 + (config.m || 0);
                     timeStr = `${String(config.h).padStart(2,'0')}:${String(config.m).padStart(2,'0')}`;
                 }
             }
             
             allTodayMeds.push({
                 ...s,
                 originalPeriod: lp, // 保留原始時段key以便查找狀態
                 minutes,
                 timeStr,
                 medName: s.medicines.join('、')
             });
        });
    });
    
    // 2. 將藥品分配到新定義的 4 個時段
    const medBuckets = { 'morning': [], 'noon': [], 'afternoon': [], 'evening': [] };
    
    allTodayMeds.forEach(med => {
        if (med.minutes >= periodRanges.morning.start && med.minutes <= periodRanges.morning.end) {
            medBuckets.morning.push(med);
        } else if (med.minutes >= periodRanges.noon.start && med.minutes <= periodRanges.noon.end) {
            medBuckets.noon.push(med);
        } else if (med.minutes >= periodRanges.afternoon.start && med.minutes <= periodRanges.afternoon.end) {
            medBuckets.afternoon.push(med);
        } else {
            medBuckets.evening.push(med);
        }
    });
    
    // 3. 處理每個時段的顯示狀態
    periods.forEach(p => {
        const meds = medBuckets[p].sort((a, b) => a.minutes - b.minutes);
        const range = periodRanges[p];
        
        let isAllDone = false;
        let hasMeds = meds.length > 0;
        
        if (hasMeds) {
            // 檢查是否所有藥都已服
            isAllDone = meds.every(m => {
                const status = dailyStatus[m.originalPeriod];
                return status && status.status === '已服药';
            });
        }
        
        // 設置顯示內容
        let displayMed = null;
        let displayTime = '--:--';
        let medNamesStr = '';
        let isNextDay = false;
        let prefixStr = '';
        
        if (hasMeds) {
            if (isAllDone) {
                 displayMed = meds[meds.length - 1]; // 顯示最後一個
            } else {
                 // 顯示最早一個未過期（或未來）的藥
                 const futureMed = meds.find(m => m.minutes > currentMinutes);
                 displayMed = futureMed || meds[0];
            }
            if (displayMed) {
                displayTime = displayMed.timeStr;
                medNamesStr = displayMed.medName;
            }
        } else {
            // === 無用藥情況處理 ===
            // 查找最近的未來用藥
            let candidates = [];
            
            for (const s of pillboxLayout) {
                 if (!s.medicines || s.medicines.length === 0) continue;
                 
                 let m = 0;
                 if (s.scheduleTime) {
                     const [hh, mm] = s.scheduleTime.split(':').map(Number);
                     m = hh * 60 + mm;
                 } else {
                     const config = alarmsConfig[periodNames[s.period]];
                     if (config) m = (config.h || 0) * 60 + (config.m || 0);
                 }
                 
                 // 必須在當前時段範圍內
                 if (m >= range.start && m <= range.end) {
                     // 檢查生效日期 > 今天
                     if (s.startDate && s.startDate > todayStr) {
                         candidates.push({
                             ...s,
                             minutes: m,
                             timeStr: s.scheduleTime || (alarmsConfig[periodNames[s.period]] ? `${String(alarmsConfig[periodNames[s.period]].h).padStart(2,'0')}:${String(alarmsConfig[periodNames[s.period]].m).padStart(2,'0')}` : '--:--')
                         });
                     }
                 }
            }
            
            if (candidates.length > 0) {
                // 按日期排序 (最近的優先)，如果日期相同按時間排序
                candidates.sort((a, b) => {
                    const dateDiff = a.startDate.localeCompare(b.startDate);
                    if (dateDiff !== 0) return dateDiff;
                    return a.minutes - b.minutes;
                });
                
                const nextMed = candidates[0];
                medNamesStr = nextMed.medicines.join('、');
                displayTime = nextMed.timeStr;
                isNextDay = true;
                
                // 計算前綴
                const parseDate = (str) => {
                    const [y, m, d] = str.split('-').map(Number);
                    return new Date(y, m - 1, d);
                };
                const tDate = parseDate(nextMed.startDate);
                const nDate = parseDate(todayStr);
                const diffTime = tDate.getTime() - nDate.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) {
                    prefixStr = '明日 ';
                } else if (diffDays === 2) {
                    prefixStr = '後天 ';
                } else {
                    prefixStr = `${tDate.getMonth() + 1}/${tDate.getDate()} `;
                }
            } else {
                medNamesStr = '暫無藥品';
                displayTime = '';
            }
        }
        
        // 設置 UI 狀態
        let theme = 'warning';
        let variant = 'light';
        let label = '待服用';
        let done = false;
        
        if (isAllDone) {
            theme = 'success';
            label = '已服用 ✓';
            done = true;
            doneCount++; 
        } else if (!hasMeds) {
            if (isNextDay) {
                theme = 'info'; // 改為藍色
                label = '今日無藥';
            } else {
                theme = 'disabled';
                label = '今日無藥';
            }
        } else {
            // 有藥且未完成
            if (currentMinutes > range.end) {
                theme = 'danger';
                label = '未服用';
                meds.forEach(m => {
                    overdueWarnings.push(`${periodNames[m.originalPeriod] || '藥品'} ${m.timeStr} ${m.medName}`);
                });
            } else if (currentMinutes < range.start) {
                theme = 'disabled'; // 還沒到該時段
                label = '未到時間';
            } else {
                const firstUndone = meds.find(m => dailyStatus[m.originalPeriod]?.status !== '已服药');
                if (firstUndone && currentMinutes > firstUndone.minutes) {
                    theme = 'warning'; 
                } else {
                    theme = 'warning';
                }
            }
        }
        
        state[`${p}Theme`] = theme;
        state[`${p}Label`] = label;
        state[`${p}Done`] = done;
        
        newAlarms[p] = {
            time: displayTime,
            name: medNamesStr,
            prefix: prefixStr
        };
    });
    
    // 生成通知 (去重)
    const uniqueWarnings = [...new Set(overdueWarnings)];
    this.generateNotifications(uniqueWarnings);

    // 計算今日總藥量次數 (只計算今天有藥的時段)
    const activePeriodsCount = periods.filter(p => medBuckets[p].length > 0).length;
    
    // 計算已完成次數
    const completedCount = Object.keys(newAlarms).filter(k => state[`${k}Done`]).length;

    this.setData({
        ...state,
        alarms: newAlarms,
        doneCount: completedCount,
        totalMedsCount: activePeriodsCount,
        todayProgress: activePeriodsCount > 0 ? Math.round((completedCount / activePeriodsCount) * 100) : 0
    });
  },

  updateYesterdayMeds(alarmsConfig, dailyStatus) {
      // 1. 定義四個時段
      const periods = ['morning', 'noon', 'afternoon', 'evening'];
      const periodNames = { 
          'morning': '早上', 
          'noon': '中午', 
          'afternoon': '下午', 
          'evening': '晚上' 
      };
      const periodRanges = {
          'morning': { start: 0, end: 719 },
          'noon': { start: 720, end: 839 },
          'afternoon': { start: 840, end: 1109 },
          'evening': { start: 1110, end: 1439 }
      };
      
      let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
      
      let state = {};
      
      const now = new Date();
      now.setDate(now.getDate() - 1); // Yesterday
      const yesterdayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      const newAlarms = {};
      
      // 1. 收集所有昨天的藥品任務
      let allYesterdayMeds = [];
      const legacyPeriods = ['morning', 'noon', 'evening'];
      
      legacyPeriods.forEach(lp => {
          const periodSlots = pillboxLayout.filter(s => s.period === lp);
          periodSlots.forEach(s => {
               if (!s.medicines || s.medicines.length === 0) return;
               
               // 檢查日期
               // 1. startDate > yesterdayStr -> 未來藥，不顯示
               if (s.startDate && s.startDate > yesterdayStr) return;
               
               // 2. once 任務: startDate != yesterdayStr -> 不是昨天，不顯示
               if (s.frequency === 'once' && s.startDate !== yesterdayStr) return;
               
               // 3. daily 任務: 昨天有效 (startDate <= yesterdayStr) -> 顯示
               
               let minutes = 0;
               let timeStr = '--:--';
               
               if (s.scheduleTime) {
                   const [h, m] = s.scheduleTime.split(':').map(Number);
                   minutes = h * 60 + m;
                   timeStr = s.scheduleTime;
               } else {
                   const config = alarmsConfig[periodNames[lp]];
                   if (config) {
                       minutes = (config.h || 0) * 60 + (config.m || 0);
                       timeStr = `${String(config.h).padStart(2,'0')}:${String(config.m).padStart(2,'0')}`;
                   }
               }
               
               allYesterdayMeds.push({
                   ...s,
                   originalPeriod: lp,
                   minutes,
                   timeStr,
                   medName: s.medicines.join('、')
               });
          });
      });
      
      const medBuckets = { 'morning': [], 'noon': [], 'afternoon': [], 'evening': [] };
      
      allYesterdayMeds.forEach(med => {
          if (med.minutes >= periodRanges.morning.start && med.minutes <= periodRanges.morning.end) {
              medBuckets.morning.push(med);
          } else if (med.minutes >= periodRanges.noon.start && med.minutes <= periodRanges.noon.end) {
              medBuckets.noon.push(med);
          } else if (med.minutes >= periodRanges.afternoon.start && med.minutes <= periodRanges.afternoon.end) {
              medBuckets.afternoon.push(med);
          } else {
              medBuckets.evening.push(med);
          }
      });
      
      periods.forEach(p => {
          const meds = medBuckets[p].sort((a, b) => a.minutes - b.minutes);
          
          let isAllDone = false;
          let hasMeds = meds.length > 0;
          
          if (hasMeds) {
              isAllDone = meds.every(m => {
                  const status = dailyStatus[m.originalPeriod];
                  return status && status.status === '已服药';
              });
          }
          
          let displayMed = null;
          let displayTime = '--:--';
          let medNamesStr = '';
          
          if (hasMeds) {
              if (isAllDone) {
                   displayMed = meds[meds.length - 1];
              } else {
                   // 顯示最早一個
                   displayMed = meds[0];
              }
              if (displayMed) {
                  displayTime = displayMed.timeStr;
                  medNamesStr = displayMed.medName;
              }
          } else {
              medNamesStr = '昨日無藥';
              displayTime = '';
          }
          
          let theme = 'disabled';
          let label = '昨日無藥';
          let done = false;
          
          if (isAllDone) {
              theme = 'success';
              label = '已服用 ✓';
              done = true;
          } else if (!hasMeds) {
              theme = 'disabled';
              label = '昨日無藥';
          } else {
              // 有藥且未完成 -> 既然是昨天，那就是未服用（過期）
              theme = 'danger';
              label = '未服用';
          }
          
          // Capitalize P for consistency with data fields: yesterdayMorningTheme
          const P = p.charAt(0).toUpperCase() + p.slice(1);
          
          state[`yesterday${P}Theme`] = theme;
          state[`yesterday${P}Label`] = label;
          state[`yesterday${P}Done`] = done;
          
          newAlarms[p] = {
              time: displayTime,
              name: medNamesStr,
              prefix: '昨日 '
          };
      });
      
      this.setData({
          ...state,
          yesterdayAlarms: newAlarms
      });
  },

  generateNotifications(warnings) {
    let notifications = wx.getStorageSync('notifications') || [];
    const today = this.getTodayStr();
    let added = false;

    warnings.forEach(w => {
        // ID 構造：日期 + 內容 (確保唯一性)
        const id = `notif_${today}_${w.replace(/\s+/g, '')}`;
        const exists = notifications.some(n => n.id === id);
        
        if (!exists) {
            notifications.unshift({
                id: id,
                type: 'warning',
                title: '服藥提醒',
                content: w,
                timestamp: Date.now(),
                status: 'unread'
            });
            added = true;
        }
    });

    if (added) {
        wx.setStorageSync('notifications', notifications);
    }

    // 更新 Badge：只計算 unread 數量
    const unreadCount = notifications.filter(n => n.status === 'unread').length;
    this.setData({ warningCount: unreadCount });
  },

  goNotification() {
      wx.navigateTo({ url: '/sub_lib/pages/notification/notification' });
  },

  updateAlerts(currentStatus) {
    if (!currentStatus) {
        this.setData({ hasNotice: false });
        return;
    }

    const isDone = currentStatus.status === '已服药';
    const time = currentStatus.update_time || '';
    
    this.setData({
        hasNotice: true,
        noticeTheme: isDone ? 'success' : 'error',
        noticeIcon: isDone ? 'check-circle' : 'error-circle',
        noticeText: `${currentStatus.period}藥: ${currentStatus.status} ${time}`
    });
  },

  calculateNextAlarm(alarmConfig) {
    // 1. 讀取藥品布局，找出所有有效的藥品時間
    let pillboxLayout = wx.getStorageSync('pillboxLayout') || [];
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const todayStr = this.getTodayStr();
    
    // 如果沒有任何藥品配置，返回暫無用藥
    const hasAnyMeds = pillboxLayout.some(s => s.medicines && s.medicines.length > 0);
    if (!hasAnyMeds) return '暫無用藥';

    // 2. 收集所有未來的藥品時間點
    let futureAlarms = [];
    const periodNames = { 'morning': '早上', 'noon': '中午', 'evening': '晚上' };
    
    // 檢查今天剩餘的時間點
    pillboxLayout.forEach(s => {
         if (!s.medicines || s.medicines.length === 0) return;
         if (s.startDate && s.startDate > todayStr) return; // 未來才開始
         if (s.frequency === 'once' && s.startDate < todayStr) return; // 已過期
         
         let m = 0;
         if (s.scheduleTime) {
             const [hh, mm] = s.scheduleTime.split(':').map(Number);
             m = hh * 60 + mm;
         } else {
             const config = alarmConfig[periodNames[s.period]];
             if (config) m = (config.h || 0) * 60 + (config.m || 0);
         }
         
         // 只加入未來的時間點
         if (m > currentMinutes) {
             futureAlarms.push({
                 minutes: m,
                 period: periodNames[s.period],
                 timeStr: `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
                 isTomorrow: false
             });
         }
    });
    
    // 如果今天還有未來的藥，排序並返回最近的一個
    if (futureAlarms.length > 0) {
        futureAlarms.sort((a, b) => a.minutes - b.minutes);
        return `${futureAlarms[0].period} ${futureAlarms[0].timeStr}`;
    }
    
    // 如果今天都過完了，找最近的未來藥品（不限明天）
    // 重新掃描所有藥品，找出所有 startDate > todayStr 的候選
    
    let candidates = [];
    pillboxLayout.forEach(s => {
         if (!s.medicines || s.medicines.length === 0) return;
         
         // 必須是未來的藥
         if (s.startDate && s.startDate > todayStr) {
             let m = 0;
             if (s.scheduleTime) {
                 const [hh, mm] = s.scheduleTime.split(':').map(Number);
                 m = hh * 60 + mm;
             } else {
                 const config = alarmConfig[periodNames[s.period]];
                 if (config) m = (config.h || 0) * 60 + (config.m || 0);
             }
             
             candidates.push({
                 startDate: s.startDate,
                 minutes: m,
                 period: periodNames[s.period],
                 timeStr: `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
             });
         }
    });
    
    if (candidates.length > 0) {
        // 按日期排序，日期相同按時間排序
        candidates.sort((a, b) => {
            const dateDiff = a.startDate.localeCompare(b.startDate);
            if (dateDiff !== 0) return dateDiff;
            return a.minutes - b.minutes;
        });
        
        const next = candidates[0];
        
        // 計算前綴
        const parseDate = (str) => {
            const [y, m, d] = str.split('-').map(Number);
            return new Date(y, m - 1, d);
        };
        const tDate = parseDate(next.startDate);
        const nDate = parseDate(todayStr);
        const diffTime = tDate.getTime() - nDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        let prefix = '';
        if (diffDays === 1) prefix = '明天 ';
        else if (diffDays === 2) prefix = '後天 ';
        else prefix = `${tDate.getMonth() + 1}/${tDate.getDate()} `;
        
        return `${prefix}${next.period} ${next.timeStr}`;
    }

    return '暫無用藥';
  },

  onPeriodTap(e) {
      const period = e.currentTarget.dataset.period;
      console.log('Tapped period:', period);
  },

  goVoiceManager() {
    wx.navigateTo({ url: '/pages/voice-recorder/voice-recorder' });
  },

  // ===== Siri 風格長按錄音 =====

  initHomeRecorder() {
    this._recorderManager = wx.getRecorderManager();
    
    this._recorderManager.onStart(() => {
      console.log('[首頁] 錄音開始');
      this.setData({ isHomeRecording: true, homeRecordTime: 0 });
      this._recordTimer = setInterval(() => {
        const t = this.data.homeRecordTime + 1;
        this.setData({ homeRecordTime: t });
        if (t >= 15) {
          this._recorderManager.stop();
        }
      }, 1000);
    });

    this._recorderManager.onStop(async (res) => {
      console.log('[首頁] 錄音結束', res);
      this.setData({ isHomeRecording: false });
      if (this._recordTimer) {
        clearInterval(this._recordTimer);
        this._recordTimer = null;
      }
      
      if (!res.tempFilePath || this.data.homeRecordTime < 1) {
        wx.showToast({ title: '錄音太短', icon: 'none' });
        return;
      }

      // 暂存录音信息
      this.setData({
        pendingAudioPath: res.tempFilePath,
        pendingDuration: this.data.homeRecordTime,
        isRecognizing: true
      });

      try {
        // 读取音频并识别
        const base64 = await this.readAudioAsBase64(res.tempFilePath);
        const result = await api.speechToText(base64);

        if (result.status === 'success') {
          this.setData({
            finalText: result.text,
            showConfirmModal: true,
            isRecognizing: false
          });
        } else {
          throw new Error('识别失败');
        }
      } catch (err) {
        console.error('语音识别错误', err);
        wx.showToast({ title: '识别失败，请重试', icon: 'none' });
        this.setData({ isRecognizing: false });
      }
    });

    this._recorderManager.onError((err) => {
      console.error('[首頁] 錄音錯誤', err);
      this.setData({ isHomeRecording: false });
      if (this._recordTimer) {
        clearInterval(this._recordTimer);
        this._recordTimer = null;
      }
    });
  },

  onSiriLongPress() {
    if (this.data.isRecognizing) return; // 识别中不可再次录音

    wx.authorize({
      scope: 'scope.record',
      success: () => {
        // 觸發震動反饋
        wx.vibrateShort({ type: 'heavy' });
        this._recorderManager.start({
          duration: 15000,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 96000,
          format: 'wav'
        });
      },
      fail: () => {
        wx.showModal({
          title: '需要錄音權限',
          content: '請在設置中開啟錄音權限',
          success: (res) => { if (res.confirm) wx.openSetting(); }
        });
      }
    });
  },

  onSiriTouchEnd() {
    if (this.data.isHomeRecording) {
      this._recorderManager.stop();
      wx.vibrateShort({ type: 'medium' });
    }
  },
  
  /**
   * 读取音频文件为base64
   */
  readAudioAsBase64(filePath) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      
      // PC端兼容
      if (filePath.startsWith('http://tmp/') || filePath.startsWith('wxfile://tmp_')) {
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
                        reject(new Error('下载临时文件失败 code:' + downRes.statusCode));
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

  async onConfirmVoice() { 
    const text = this.data.finalText; 
  
    // 1. 暫不保存語音，等到排班確認後再保存
    // this.autoSaveVoice(this.data.pendingAudioPath, this.data.pendingDuration, text); 
    // wx.setStorageSync('lastVoiceCommand', text); 
  
    // 2. 关闭文字确认弹窗，但保留 pendingAudioPath 等待後續保存
    this.setData({ 
      showConfirmModal: false, 
      // finalText: '', // 暫不清除
      // pendingAudioPath: '', // 暫不清除
      // pendingDuration: 0, // 暫不清除
      isParsing: true, 
      pendingContext: text  // 初始化上下文为用户原始语句 
    }); 
  
    // 3. 调用 NLP 解析 
    await this._doParseMedSchedule(text, ''); 
  }, 

  async _doParseMedSchedule(text, context) { 
    try { 
      wx.showLoading({ title: '智能解析中...', mask: true }); 
      const result = await api.parseMedSchedule(text, context); 
      wx.hideLoading(); 
  
      if (result.status === 'missing_info' && result.ask_user) { 
        // ===== 槽位填充：信息不全，需要追问 ===== 
        this.setData({ 
          isParsing: false, 
          showFollowUpModal: true, 
          followUpQuestion: result.ask_user, 
          followUpAnswer: '', 
          pendingPartialSchedules: result.schedules || [], 
          // 累积上下文：把之前说的 + AI 的追问拼起来 
          pendingContext: `${this.data.pendingContext}。AI追问：${result.ask_user}` 
        }); 
      } else if (result.schedules && result.schedules.length > 0) { 
        // ===== 信息完整，进入网格分配 + 排班确认 ===== 
        const processedSchedules = this._assignGridAndProcess(result.schedules); 
        
        if (processedSchedules === null) { 
          // 药盒已满 
          this.setData({ isParsing: false }); 
          wx.showModal({ 
            title: '藥盒已滿', 
            content: '9 個藥格已全部佔用，請先在「藥品管理」中清理空間後重試。', 
            showCancel: false 
          }); 
        } else { 
          this.setData({ 
            parsedSchedules: processedSchedules, 
            showScheduleModal: true, 
            isParsing: false 
          }); 
        } 
      } else { 
        // 沒有排班信息，直接保存語音並提示
        this.autoSaveVoice(this.data.pendingAudioPath, this.data.pendingDuration, this.data.finalText);
        wx.setStorageSync('lastVoiceCommand', this.data.finalText);

        this.setData({ 
            isParsing: false,
            finalText: '',
            pendingAudioPath: '',
            pendingDuration: 0
        }); 
        wx.showToast({ title: '語音已保存（未識別到排班信息）', icon: 'none', duration: 2000 }); 
      } 
    } catch (err) { 
      wx.hideLoading(); 
      console.error('NLP解析失败', err); 
      
      // 出錯也保存一下語音
      this.autoSaveVoice(this.data.pendingAudioPath, this.data.pendingDuration, this.data.finalText);

      this.setData({ 
          isParsing: false,
          finalText: '',
          pendingAudioPath: '',
          pendingDuration: 0
      }); 
      wx.showToast({ title: '語音已保存', icon: 'success' }); 
    } 
  }, 

  _assignGridAndProcess(schedules) { 
    // 读取当前药盒布局 
    let pillboxLayout = wx.getStorageSync('pillboxLayout') || []; 
    if (pillboxLayout.length === 0) { 
      pillboxLayout = this._getDefaultPillboxLayout(); 
    } 
  
    // 格子编号映射 
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
  
      // 检查是否已有相同药品 
      const periodSlots = pillboxLayout.filter(slot => slot.period === periodKey); 
      const existingSlot = periodSlots.find(slot => 
        (slot.medicines || []).some(m => m.includes(s.drug_name)) 
      ); 
  
      let assignedGrid = 0; 
      let assignedSlotId = ''; 
  
      if (existingSlot) { 
        // 药品已存在，更新同一个格子 
        assignedSlotId = existingSlot.id; 
        assignedGrid = gridMap[existingSlot.id] || 0; 
      } else { 
        // 找该时段第一个空格 
        const emptySlot = periodSlots.find(slot => !slot.medicines || slot.medicines.length === 0); 
        if (emptySlot) { 
          assignedSlotId = emptySlot.id; 
          assignedGrid = gridMap[emptySlot.id] || 0; 
        } else { 
          // 该时段满了，尝试找全局任意空格 
          const anyEmpty = pillboxLayout.find(slot => !slot.medicines || slot.medicines.length === 0); 
          if (anyEmpty) { 
            assignedSlotId = anyEmpty.id; 
            assignedGrid = gridMap[anyEmpty.id] || 0; 
          } else { 
            // 9格全满 
            return null; 
          } 
        } 
      } 
  
        // 默認「明天」還是「今天」？
        // 簡單規則：如果 text 包含「明天」，則 startDate = 明天
        // 否則默認 startDate = 今天
        // 注意：這裡的 s 是 NLP 原始結果，可能沒有 original_text，但我們有 pendingContext 或 text
        // 暫時默認：daily = 今天開始；once = 如果包含 "明天" 則明天，否則今天
        // 由於我們沒法簡單判斷 text，這裡先默認今天，但在確認卡中允許修改日期
        
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        let targetDate = todayStr;
        let targetDateStr = '今天';
        
        // 簡單啟發式：檢測語音文本中的日期關鍵詞
        const fullText = (this.data.finalText || this.data.pendingContext || '').replace(/\s+/g, '');
        
        if (fullText.includes('後天') || fullText.includes('后天')) {
             const d = new Date(now); 
             d.setDate(d.getDate() + 2);
             targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
             targetDateStr = `後天 (${d.getMonth() + 1}/${d.getDate()})`;
        } else if (fullText.includes('明天') || fullText.includes('明日')) {
             const d = new Date(now); 
             d.setDate(d.getDate() + 1);
             targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
             targetDateStr = `明天 (${d.getMonth() + 1}/${d.getDate()})`;
        }
        
        processedSchedules.push({
            ...s,
            timeStr: `${String(s.time_h).padStart(2, '0')}:${String(s.time_m).padStart(2, '0')}`,
            gridNumber: assignedGrid,
            gridSlotId: assignedSlotId,
            frequencyLabel: s.frequency === 'once' ? '單次' : '每日',
            startDate: targetDate, // 新增：生效日期
            startDateStr: targetDateStr
        });
    }

    return processedSchedules;
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
  }, 

  // 追问弹窗：用户输入回答 
  onFollowUpInput(e) { 
    this.setData({ followUpAnswer: e.detail.value }); 
  }, 
  
  // 追问弹窗：确认提交回答 
  async onFollowUpConfirm() { 
    const answer = this.data.followUpAnswer.trim(); 
    if (!answer) { 
      wx.showToast({ title: '請輸入回答', icon: 'none' }); 
      return; 
    } 
  
    this.setData({ showFollowUpModal: false }); 
  
    // 把用户的回答和之前的上下文合并，重新调用 NLP 
    const newContext = `${this.data.pendingContext}。用户回答：${answer}`; 
    this.setData({ pendingContext: newContext }); 
  
    await this._doParseMedSchedule(answer, newContext); 
  }, 
  
  // 追问弹窗：取消（跳过追问，使用默认值强制完成） 
  onFollowUpSkip() { 
    const partials = this.data.pendingPartialSchedules; 
  
    // 给缺失的 dose 填默认值 "1粒" 
    const filled = partials.map(s => ({ 
      ...s, 
      dose: s.dose || '1粒', 
      frequency: s.frequency || 'daily' 
    })); 
  
    this.setData({ 
      showFollowUpModal: false, 
      followUpQuestion: '', 
      followUpAnswer: '', 
      pendingPartialSchedules: [] 
    }); 
  
    // 走正常的网格分配流程 
    const processed = this._assignGridAndProcess(filled); 
    if (processed === null) { 
      wx.showModal({ 
        title: '藥盒已滿', 
        content: '9 個藥格已全部佔用，請先清理後重試。', 
        showCancel: false 
      }); 
    } else { 
      this.setData({ 
        parsedSchedules: processed, 
        showScheduleModal: true 
      }); 
    } 
  }, 

  async onConfirmSchedule() { 
    const schedules = this.data.parsedSchedules; 
    if (!schedules || schedules.length === 0) return; 
  
    wx.showLoading({ title: '更新排班中...', mask: true }); 
  
    try { 
      // 1. 读取当前闹钟配置 
      let currentConfig; 
      try { 
        currentConfig = await api.getAlarmConfig(); 
      } catch (e) { 
        currentConfig = { "早上": { h: 8, m: 0 }, "中午": { h: 12, m: 30 }, "晚上": { h: 19, m: 0 } }; 
      } 
  
      // 2. 用 NLP 结果覆盖对应时段的闹钟时间（只有 daily 类型才更新全局闹钟） 
      schedules.forEach(s => { 
        if (s.frequency !== 'once' && currentConfig[s.period]) { 
          currentConfig[s.period] = { h: s.time_h, m: s.time_m }; 
        } 
      }); 
  
      // 3. 上传新的闹钟配置到后端 
      await api.updateAlarmConfig(currentConfig); 
  
      // 4. 更新本地药品配置（pillboxLayout） 
      let pillboxLayout = wx.getStorageSync('pillboxLayout') || []; 
      if (pillboxLayout.length === 0) { 
        pillboxLayout = this._getDefaultPillboxLayout(); 
      } 
  
      schedules.forEach(s => { 
        const idx = pillboxLayout.findIndex(slot => slot.id === s.gridSlotId); 
        if (idx === -1) return; 
  
        const medText = `${s.drug_name} ${s.dose}`.trim(); 
  
        // 检查该格子是否已有此药 
        const existingMeds = pillboxLayout[idx].medicines || []; 
        const alreadyHas = existingMeds.some(m => m.includes(s.drug_name)); 
  
        if (alreadyHas) { 
          // 更新已有药品的剂量 
          pillboxLayout[idx].medicines = existingMeds.map(m => 
            m.includes(s.drug_name) ? medText : m 
          ); 
        } else { 
          pillboxLayout[idx].medicines = [...existingMeds, medText]; 
        } 
  
        // 存储 frequency 到每个格子 
        pillboxLayout[idx].frequency = s.frequency || 'daily'; 
        
        // 新增：存儲具體時間和生效日期
        pillboxLayout[idx].scheduleTime = `${String(s.time_h).padStart(2,'0')}:${String(s.time_m).padStart(2,'0')}`;
        pillboxLayout[idx].startDate = s.startDate;

        // 如果是一次性任务，记录过期日期（startDate + 1天） 
        if (s.frequency === 'once') { 
          const start = new Date(s.startDate);
          const expire = new Date(start);
          expire.setDate(expire.getDate() + 1);
          const expireDate = `${expire.getFullYear()}-${String(expire.getMonth() + 1).padStart(2, '0')}-${String(expire.getDate()).padStart(2, '0')}`; 
          pillboxLayout[idx].expireDate = expireDate; 
        } else {
            // daily 任務，清除过期时间
            delete pillboxLayout[idx].expireDate;
        }
      }); 
  
      wx.setStorageSync('pillboxLayout', pillboxLayout); 
  
      // 5. 保存語音到歷史記錄（延遲到確認後保存）
      this.autoSaveVoice(this.data.pendingAudioPath, this.data.pendingDuration, this.data.finalText);
      wx.setStorageSync('lastVoiceCommand', this.data.finalText);

      wx.hideLoading(); 
  
      // 6. 构建成功提示（含格子编号） 
      const gridMessages = schedules.map(s => 
        `${s.drug_name} → 第${s.gridNumber}格（${s.frequencyLabel}）` 
      ).join('\n'); 
  
      this.setData({ 
        showScheduleModal: false, 
        parsedSchedules: [], 
        pendingContext: '', 
        pendingPartialSchedules: [],
        finalText: '',
        pendingAudioPath: '',
        pendingDuration: 0
      }); 
  
      wx.showModal({ 
        title: '排班成功 ✓', 
        content: gridMessages, 
        showCancel: false 
      }); 
  
      this.loadHomeData(); 
  
    } catch (err) { 
      wx.hideLoading(); 
      console.error('更新排班失败', err); 
      wx.showToast({ title: '更新失敗，請手動設置', icon: 'none' }); 
      // 失敗時不清除數據，允許用戶重試或取消
      // this.setData({ showScheduleModal: false, parsedSchedules: [] }); 
    } 
  }, 

  onCancelSchedule() { 
    this.setData({ 
      showScheduleModal: false, 
      parsedSchedules: [],
      // 清除語音數據，捨棄錄音
      finalText: '',
      pendingAudioPath: '',
      pendingDuration: 0
    }); 
    wx.showToast({ title: '已取消設置', icon: 'none' }); 
  }, 

  // ===== 排班確認卡：手動編輯 =====

  onEditDrugName(e) { 
    const idx = e.currentTarget.dataset.idx; 
    const val = e.detail.value; 
    const key = `parsedSchedules[${idx}].drug_name`; 
    this.setData({ [key]: val }); 
  }, 

  onEditDose(e) { 
    const idx = e.currentTarget.dataset.idx; 
    const val = e.detail.value; 
    const key = `parsedSchedules[${idx}].dose`; 
    this.setData({ [key]: val }); 
  }, 

  onEditScheduleTimePicker(e) {
    const idx = e.currentTarget.dataset.idx;
    const val = e.detail.value; // "HH:mm"
    const [h, m] = val.split(':').map(Number);
    
    // 根據時間自動調整時段 
    let period = '早上'; 
    if (h >= 11 && h < 17) period = '中午'; 
    else if (h >= 17) period = '晚上'; 

    this.setData({ 
      [`parsedSchedules[${idx}].time_h`]: h, 
      [`parsedSchedules[${idx}].time_m`]: m, 
      [`parsedSchedules[${idx}].timeStr`]: val, 
      [`parsedSchedules[${idx}].period`]: period 
    }); 
    
    // 重新分配格子 
    this._reassignGrid(idx); 
  }, 

  onEditSchedulePeriod(e) { 
    const idx = e.currentTarget.dataset.idx; 
    wx.showActionSheet({ 
      itemList: ['早上', '中午', '晚上'], 
      success: (res) => { 
        const periods = ['早上', '中午', '晚上']; 
        this.setData({ 
          [`parsedSchedules[${idx}].period`]: periods[res.tapIndex] 
        }); 
        this._reassignGrid(idx); 
      } 
    }); 
  }, 

  onEditScheduleFreq(e) { 
    const idx = e.currentTarget.dataset.idx; 
    wx.showActionSheet({ 
      itemList: ['每日', '單次'], 
      success: (res) => { 
        const freq = res.tapIndex === 0 ? 'daily' : 'once'; 
        const label = res.tapIndex === 0 ? '每日' : '單次'; 
        this.setData({ 
          [`parsedSchedules[${idx}].frequency`]: freq, 
          [`parsedSchedules[${idx}].frequencyLabel`]: label 
        }); 
      } 
    }); 
  }, 

  onEditScheduleDate(e) {
      const idx = e.currentTarget.dataset.idx;
      const currentVal = this.data.parsedSchedules[idx].startDate;
      // Use WeChat date picker via a hidden picker or just show current date
      // Since we need to pick a date, we can use a picker in the WXML.
      // Here we just handle the change event from the picker.
      const val = e.detail.value; // "YYYY-MM-DD"
      
      const d = new Date(val);
      const str = `${d.getMonth() + 1}/${d.getDate()}`;
      // Calculate "Tomorrow" or "Today"
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = (target - today) / (1000 * 60 * 60 * 24);
      
      let label = str;
      if (diff === 0) label = `今天 (${str})`;
      else if (diff === 1) label = `明天 (${str})`;
      else label = `${val}`;

      this.setData({
          [`parsedSchedules[${idx}].startDate`]: val,
          [`parsedSchedules[${idx}].startDateStr`]: label
      });
  }, 

  // 重新分配格子（改了時段後需要重新找空格） 
  _reassignGrid(idx) { 
    const schedules = this.data.parsedSchedules; 
    const s = schedules[idx]; 
    const periodKeyMap = { "早上": "morning", "中午": "noon", "晚上": "evening" }; 
    const gridMap = { 
      'red-morning': 1, 'blue-morning': 2, 'green-morning': 3, 
      'red-noon': 4, 'blue-noon': 5, 'green-noon': 6, 
      'red-evening': 7, 'blue-evening': 8, 'green-evening': 9 
    }; 
    const periodKey = periodKeyMap[s.period]; 
    let pillboxLayout = wx.getStorageSync('pillboxLayout') || this._getDefaultPillboxLayout(); 
    const periodSlots = pillboxLayout.filter(slot => slot.period === periodKey); 
    const emptySlot = periodSlots.find(slot => !slot.medicines || slot.medicines.length === 0); 
    
    if (emptySlot) { 
      this.setData({ 
        [`parsedSchedules[${idx}].gridNumber`]: gridMap[emptySlot.id] || 0, 
        [`parsedSchedules[${idx}].gridSlotId`]: emptySlot.id 
      }); 
    } 
  }, 

  onCancelVoice() {
    this.setData({
      showConfirmModal: false,
      finalText: '',
      pendingAudioPath: '',
      pendingDuration: 0
    });
  },
  
  // Empty handler to prevent event bubbling
  doNothing() {},

  autoSaveVoice(filePath, duration, transcriptText) {
    const voiceId = `voice_${Date.now()}`;
    const voiceInfo = {
      id: voiceId,
      createTime: new Date().toLocaleString(),
      audioPath: filePath,
      duration: duration,
      transcriptText: transcriptText || ''
    };

    let savedVoices = wx.getStorageSync('savedVoices') || [];
    savedVoices.unshift(voiceInfo);
    if (savedVoices.length > 10) savedVoices = savedVoices.slice(0, 10);
    wx.setStorageSync('savedVoices', savedVoices);

    wx.showToast({ title: '語音已保存', icon: 'success' });
  },

  toggleRecording() {
    wx.navigateTo({ url: '/pages/voice-recorder/voice-recorder' });
  }
});
