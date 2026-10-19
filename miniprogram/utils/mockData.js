// utils/mockData.js - Mock数据生成器

/**
 * 生成指定月份的模拟用药数据
 * @param {Number} year - 年份
 * @param {Number} month - 月份（1-12）
 * @returns {Object} 包含完整月度数据
 */
function generateMonthlyMockData(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyRecords = [];
  
  // 生成每天的服药记录
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // 早上
    dailyRecords.push(generateSingleRecord(date, '早上', '08:00', day));
    
    // 中午
    dailyRecords.push(generateSingleRecord(date, '中午', '12:00', day));
    
    // 晚上
    dailyRecords.push(generateSingleRecord(date, '晚上', '20:00', day));
  }
  
  return {
    year,
    month,
    records: dailyRecords,
    statistics: calculateStatistics(dailyRecords)
  };
}

/**
 * 生成单条服药记录
 */
function generateSingleRecord(date, period, scheduledTime, dayOfMonth) {
  // 模拟真实场景：大部分按时，偶尔漏服或推迟
  const random = Math.random();
  
  let status, actualTime, delayMinutes = 0;
  
  if (random < 0.85) {
    // 85%的概率按时服药
    status = 'completed';
    delayMinutes = Math.floor(Math.random() * 10); // 0-10分钟延迟
    actualTime = addMinutes(scheduledTime, delayMinutes);
  } else if (random < 0.95) {
    // 10%的概率推迟服药
    status = 'delayed';
    delayMinutes = 10 + Math.floor(Math.random() * 30); // 10-40分钟延迟
    actualTime = addMinutes(scheduledTime, delayMinutes);
  } else {
    // 5%的概率漏服
    status = 'missed';
    actualTime = null;
  }
  
  return {
    id: `${date}_${period}`,
    date,
    period,
    scheduledTime,
    actualTime,
    status,
    delayMinutes,
    hasImage: status !== 'missed', // 漏服的没有照片
    aiResult: status === 'missed' ? '未服药' : '已服药'
  };
}

/**
 * 时间加减（简单实现）
 */
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * 计算月度统计数据
 */
function calculateStatistics(records) {
  const total = records.length;
  const completed = records.filter(r => r.status === 'completed').length;
  const delayed = records.filter(r => r.status === 'delayed').length;
  const missed = records.filter(r => r.status === 'missed').length;
  
  // 计算平均推迟时间
  const delayedRecords = records.filter(r => r.status === 'delayed');
  const avgDelay = delayedRecords.length > 0
    ? Math.round(delayedRecords.reduce((sum, r) => sum + r.delayMinutes, 0) / delayedRecords.length)
    : 0;
  
  // 计算依从性评分（0-100）
  const adherenceScore = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Calculate formatted rates
  const missedRate = total > 0 ? (missed / total * 100).toFixed(1) : '0.0';
  
  // 按日期分组，计算每日完成度
  const dailyCompletion = {};
  records.forEach(record => {
    if (!dailyCompletion[record.date]) {
      dailyCompletion[record.date] = { total: 0, completed: 0 };
    }
    dailyCompletion[record.date].total++;
    if (record.status === 'completed') {
      dailyCompletion[record.date].completed++;
    }
  });
  
  // 转换为数组格式
  const dailyCompletionArray = Object.keys(dailyCompletion).map(date => ({
    date,
    completionRate: Math.round((dailyCompletion[date].completed / dailyCompletion[date].total) * 100)
  }));
  
  // 按时段统计
  const periodStats = {
    '早上': { completed: 0, missed: 0, delayed: 0 },
    '中午': { completed: 0, missed: 0, delayed: 0 },
    '晚上': { completed: 0, missed: 0, delayed: 0 }
  };
  
  records.forEach(record => {
    periodStats[record.period][record.status]++;
  });
  
  return {
    total,
    completed,
    delayed,
    missed,
    missedRate,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    adherenceScore,
    avgDelay,
    dailyCompletion: dailyCompletionArray,
    periodStats
  };
}

/**
 * 获取最近N天的趋势数据
 */
function getRecentTrend(days = 7) {
  const now = new Date();
  const records = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = formatDate(date);
    
    // 每天3次用药
    records.push(generateSingleRecord(dateStr, '早上', '08:00', date.getDate()));
    records.push(generateSingleRecord(dateStr, '中午', '12:00', date.getDate()));
    records.push(generateSingleRecord(dateStr, '晚上', '20:00', date.getDate()));
  }
  
  return {
    records,
    statistics: calculateStatistics(records)
  };
}

/**
 * 格式化日期
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 生成演示用的完整数据集（过去30天）
 */
function generateDemoDataSet() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  // 生成上个月的完整数据
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastYear = month === 1 ? year - 1 : year;
  
  const lastMonthData = generateMonthlyMockData(lastYear, lastMonth);
  
  // 生成本月到今天的数据
  const currentDay = now.getDate();
  const currentMonthRecords = [];
  
  for (let day = 1; day <= currentDay; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    currentMonthRecords.push(generateSingleRecord(date, '早上', '08:00', day));
    currentMonthRecords.push(generateSingleRecord(date, '中午', '12:00', day));
    currentMonthRecords.push(generateSingleRecord(date, '晚上', '20:00', day));
  }
  
  const currentMonthData = {
    year,
    month,
    records: currentMonthRecords,
    statistics: calculateStatistics(currentMonthRecords)
  };
  
  // 合并所有数据
  const allRecords = [...lastMonthData.records, ...currentMonthRecords];
  
  return {
    lastMonth: lastMonthData,
    currentMonth: currentMonthData,
    allRecords,
    overallStatistics: calculateStatistics(allRecords)
  };
}

/**
 * 保存演示数据到本地存储
 */
function saveDemoDataToStorage() {
  const demoData = generateDemoDataSet();
  
  // 保存到本地存储
  wx.setStorageSync('demoMode', true);
  wx.setStorageSync('medicationHistory', demoData.allRecords);
  wx.setStorageSync('monthlyStatistics', {
    lastMonth: demoData.lastMonth.statistics,
    currentMonth: demoData.currentMonth.statistics
  });
  
  console.log('✅ 演示数据已生成并保存');
  return demoData;
}

/**
 * 清除演示数据
 */
function clearDemoData() {
  wx.removeStorageSync('demoMode');
  wx.removeStorageSync('medicationHistory');
  wx.removeStorageSync('monthlyStatistics');
  console.log('✅ 演示数据已清除');
}

/**
 * 检查是否为演示模式
 */
function isDemoMode() {
  return wx.getStorageSync('demoMode') || false;
}

/**
 * 生成適合 history 頁面顯示的記錄列表
 */
function generateHistoryRecordsForSync() {
  const demoData = generateDemoDataSet();
  // 按照 history.js 中的 loadHistory 邏輯，轉換數據格式
  // history.js 期望格式：
  // {
  //   id: ...,
  //   date: "2026-02-06",
  //   time: "08:05",
  //   period: "早上",
  //   status: "已服药" | "未服药",
  //   checkCount: 1,
  //   hasImage: boolean,
  //   imageBase64: ""
  // }
  
  // demoData.allRecords 格式：
  // {
  //   id: "2026-02-06_早上",
  //   date: "2026-02-06",
  //   period: "早上",
  //   status: "completed" | "delayed" | "missed",
  //   actualTime: "08:05",
  //   ...
  // }
  
  return demoData.allRecords.map(r => {
      let statusText = '未服药';
      if (r.status === 'completed') statusText = '已服药';
      else if (r.status === 'delayed') statusText = '已服药'; // 延遲也算已服
      
      return {
          id: r.id,
          date: r.date,
          time: r.actualTime || r.scheduledTime, // 如果漏服，顯示計劃時間？或者空？
          period: r.period,
          status: statusText,
          checkCount: 1,
          hasImage: r.hasImage,
          imageBase64: '' // Mock no image content
      };
  }).reverse(); // 最新的在前面
}

// 导出所有函数
module.exports = {
  generateMonthlyMockData,
  generateDemoDataSet,
  getRecentTrend,
  saveDemoDataToStorage,
  clearDemoData,
  isDemoMode,
  generateHistoryRecordsForSync
};
