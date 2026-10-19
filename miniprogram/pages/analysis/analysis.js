const PERIOD_KEYS = ['morning', 'noon', 'evening'];
const PERIOD_LABELS = {
  morning: '早上',
  noon: '中午',
  evening: '晚上',
};

function pad2(num) {
  return String(num).padStart(2, '0');
}

function createEmptyStats() {
  return {
    total: 0,
    completed: 0,
    delayed: 0,
    missed: 0,
    completionRate: 0,
    adherenceScore: 0,
    avgDelay: 0,
    missedRate: 0,
  };
}

function createEmptyPeriodStats() {
  return {
    morning: { completed: 0, delayed: 0, missed: 0 },
    noon: { completed: 0, delayed: 0, missed: 0 },
    evening: { completed: 0, delayed: 0, missed: 0 },
  };
}

function getScoreLevel(score) {
  if (score >= 90) return '優秀';
  if (score >= 80) return '良好';
  if (score >= 65) return '普通';
  return '待加強';
}

function normalizeStatus(raw) {
  const text = String(raw || '').toLowerCase();

  if (text.includes('miss') || text.includes('漏') || text.includes('未') || text.includes('芣')) {
    return 'missed';
  }

  if (text.includes('delay') || text.includes('late') || text.includes('迟') || text.includes('遲') || text.includes('')) {
    return 'delayed';
  }

  if (text.includes('complete') || text.includes('finish') || text.includes('完成') || text.includes('撌脫')) {
    return 'completed';
  }

  return 'completed';
}

function normalizePeriod(raw) {
  const text = String(raw || '').toLowerCase();

  if (text.includes('morn') || text.includes('早') || text.includes('?拐')) {
    return 'morning';
  }
  if (text.includes('noon') || text.includes('mid') || text.includes('中') || text.includes('午') || text.includes('銝剖')) {
    return 'noon';
  }
  if (text.includes('even') || text.includes('night') || text.includes('晚') || text.includes('?')) {
    return 'evening';
  }

  return 'morning';
}

function parseDelayMinutes(record) {
  if (typeof record.delayMinutes === 'number') return Math.max(0, record.delayMinutes);

  const scheduled = String(record.scheduledTime || '');
  const actual = String(record.actualTime || '');
  if (!scheduled || !actual || scheduled.indexOf(':') === -1 || actual.indexOf(':') === -1) {
    return 0;
  }

  const [sh, sm] = scheduled.split(':').map(Number);
  const [ah, am] = actual.split(':').map(Number);

  if ([sh, sm, ah, am].some((n) => Number.isNaN(n))) return 0;

  const scheduledMin = sh * 60 + sm;
  const actualMin = ah * 60 + am;
  return Math.max(0, actualMin - scheduledMin);
}

function normalizeRecord(record) {
  const date = String(record.date || record.recordDate || '').slice(0, 10);
  if (!date) return null;

  return {
    date,
    period: normalizePeriod(record.period),
    status: normalizeStatus(record.status || record.aiResult),
    delayMinutes: parseDelayMinutes(record),
  };
}

function buildFallbackRecords(year, month, isDemoMode) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = Math.max(1, daysInMonth - 13);
  const records = [];

  for (let day = startDay; day <= daysInMonth; day += 1) {
    PERIOD_KEYS.forEach((period, index) => {
      const t = (day + index * 2) / 3;
      const stability = isDemoMode ? 0.84 : 0.88;
      const wave = 0.08 * Math.sin(t);
      const random = Math.random();
      const threshold = stability + wave;

      let status = 'completed';
      let delayMinutes = 0;

      if (random > threshold) {
        status = random > threshold + 0.1 ? 'missed' : 'delayed';
        delayMinutes = status === 'delayed' ? Math.floor(8 + Math.random() * 24) : 0;
      }

      records.push({
        date: `${year}-${pad2(month)}-${pad2(day)}`,
        period,
        status,
        delayMinutes,
      });
    });
  }

  return records;
}

function buildStats(records) {
  const total = records.length;
  const completed = records.filter((r) => r.status === 'completed').length;
  const delayed = records.filter((r) => r.status === 'delayed').length;
  const missed = records.filter((r) => r.status === 'missed').length;

  const delayedOnly = records.filter((r) => r.status === 'delayed');
  const avgDelay = delayedOnly.length
    ? Math.round(delayedOnly.reduce((sum, r) => sum + (r.delayMinutes || 0), 0) / delayedOnly.length)
    : 0;

  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const adherenceScore = total ? Math.round(((completed + delayed * 0.5) / total) * 100) : 0;
  const missedRate = total ? Number(((missed / total) * 100).toFixed(1)) : 0;

  return {
    total,
    completed,
    delayed,
    missed,
    completionRate,
    adherenceScore,
    avgDelay,
    missedRate,
  };
}

function buildPeriodStats(records) {
  const stats = createEmptyPeriodStats();

  records.forEach((record) => {
    const period = PERIOD_KEYS.includes(record.period) ? record.period : 'morning';
    const status = ['completed', 'delayed', 'missed'].includes(record.status) ? record.status : 'completed';
    stats[period][status] += 1;
  });

  return stats;
}

function getLast7Dates(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = Math.max(1, daysInMonth - 6);

  const dateList = [];
  for (let day = startDay; day <= daysInMonth; day += 1) {
    dateList.push(`${year}-${pad2(month)}-${pad2(day)}`);
  }

  return dateList;
}

function createWeeklySeries(records, year, month) {
  const byDate = {};

  records.forEach((record) => {
    if (!byDate[record.date]) byDate[record.date] = { total: 0, completed: 0 };
    byDate[record.date].total += 1;
    if (record.status === 'completed') byDate[record.date].completed += 1;
  });

  const dates = getLast7Dates(year, month);
  const values = dates.map((date) => {
    const item = byDate[date];
    if (!item || !item.total) return 0;
    return Math.round((item.completed / item.total) * 100);
  });

  const labels = dates.map((date) => {
    const day = new Date(`${date}T00:00:00`).getDay();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
  });

  return { labels, values };
}

function createMedicationEfficiency(periodStats) {
  return {
    labels: PERIOD_KEYS.map((k) => PERIOD_LABELS[k]),
    primary: PERIOD_KEYS.map((k) => periodStats[k].completed),
    secondary: PERIOD_KEYS.map((k) => periodStats[k].delayed + periodStats[k].missed),
  };
}

function createAiAdvices(stats) {
  const list = [];

  if (stats.adherenceScore >= 90) {
    list.push({
      id: 'a1',
      title: '依從率表現優秀',
      desc: '本期服藥一致性表現穩定，請持續保持目前節奏。',
      icon: 'thumb-up',
      color: '#7BB9FF',
      bg: '#EAF2FF',
    });
  }

  if (stats.missed > 0) {
    list.push({
      id: 'a2',
      title: '漏服提醒',
      desc: `本期偵測到 ${stats.missed} 次漏服，建議為高風險時段加入提醒。`,
      icon: 'error-circle',
      color: '#EF4444',
      bg: '#FEECEC',
    });
  }

  if (stats.avgDelay >= 12) {
    list.push({
      id: 'a3',
      title: '延遲模式提醒',
      desc: `平均延遲 ${stats.avgDelay} 分鐘，建議調整到更容易執行的時段。`,
      icon: 'time',
      color: '#F97316',
      bg: '#FFF4E8',
    });
  }

  if (!list.length) {
    list.push({
      id: 'a0',
      title: '整體穩定',
      desc: '本期未發現明顯高風險模式，建議持續觀察每週趨勢。',
      icon: 'info-circle',
      color: '#7BB9FF',
      bg: '#EEF5FF',
    });
  }

  return list;
}

function createWeeklyLineOption(series) {
  return {
    grid: { left: '5%', right: '4%', top: '10%', bottom: '8%', containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: series.labels,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', formatter: '{value}%', fontSize: 11 },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        data: series.values,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: '#7BB9FF', width: 4 },
        itemStyle: { color: '#7BB9FF' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(123,185,255,0.42)' },
              { offset: 1, color: 'rgba(123,185,255,0)' },
            ]
          },
        },
      },
    ],
  };
}

function createEfficiencyBarOption(series) {
  return {
    grid: { left: '5%', right: '4%', top: '12%', bottom: '10%', containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: series.labels,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
    },
    series: [
      {
        name: '已完成',
        type: 'bar',
        barWidth: '30%',
        data: series.primary,
        itemStyle: {
          borderRadius: [12, 12, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#60A5FA' },
              { offset: 1, color: '#2563EB' },
            ]
          },
        },
      },
      {
        name: '待改善',
        type: 'bar',
        barWidth: '30%',
        data: series.secondary,
        itemStyle: {
          borderRadius: [12, 12, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#BFDBFE' },
              { offset: 1, color: '#93C5FD' },
            ]
          },
        },
      },
    ],
  };
}

function createWeeklyBarOption(series) {
  return {
    grid: { left: '5%', right: '4%', top: '12%', bottom: '10%', containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: series.labels,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#94A3B8', formatter: '{value}%', fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        barWidth: '30%',
        data: series.values,
        itemStyle: {
          borderRadius: [12, 12, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#60A5FA' },
              { offset: 1, color: '#2563EB' },
            ]
          },
        },
      },
    ],
  };
}

function renderChart(component, optionFactory) {
  if (!component) return;

  // Reuse existing chart instance if available
  if (component.chart) {
    try {
      component.chart.setOption(optionFactory(), true);
    } catch (e) {
      console.error('更新圖表失敗', e);
    }
    return;
  }

  if (typeof component.init !== 'function') return;

  component.init((canvas, width, height, dpr, echarts) => {
    const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
    chart.setOption(optionFactory());
    return chart;
  });
}

Page({
  data: {
    mode: 'real',
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    monthOptions: [],
    statistics: createEmptyStats(),
    scoreLevel: '待加強',
    starCount: 0,
    periodStats: createEmptyPeriodStats(),
    aiAdvices: [],
    dailyChart: { lazyLoad: true },
    periodChart: { lazyLoad: true },
    trendChart: { lazyLoad: true },
  },

  onLoad() {
    this.initMonthOptions();
    this.initCharts();
    this.loadAnalysisData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateSelected(3);
    }
  },

  initMonthOptions() {
    const now = new Date();
    const options = [];

    for (let i = 0; i < 6; i += 1) {
      let year = now.getFullYear();
      let month = now.getMonth() + 1 - i;

      while (month <= 0) {
        month += 12;
        year -= 1;
      }

      options.push({ year, month, label: `${year}/${month}` });
    }

    this.setData({ monthOptions: options });
  },

  initCharts() {
    this.setData({
      dailyChart: { lazyLoad: true },
      periodChart: { lazyLoad: true },
      trendChart: { lazyLoad: true },
    });
  },

  onModeChange(e) {
    this.setData({ mode: e.detail.value }, () => {
      this.loadAnalysisData();
    });
  },

  openMonthPicker() {
    const itemList = this.data.monthOptions.map((item) => item.label);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = this.data.monthOptions[res.tapIndex];
        if (!selected) return;

        this.setData(
          {
            currentYear: selected.year,
            currentMonth: selected.month,
          },
          () => this.loadAnalysisData(),
        );
      },
    });
  },

  loadAnalysisData() {
    wx.showLoading({ title: '載入中...' });

    try {
      const { currentYear, currentMonth, mode } = this.data;
      let records = [];

      if (mode === 'demo') {
        // 示範模式：顯示隨機生成的示範數據
        records = buildFallbackRecords(currentYear, currentMonth, true);
      } else {
        // 真實模式：只顯示真實數據，如果沒有數據則為空
        const raw = wx.getStorageSync('medicationHistory') || [];
        records = Array.isArray(raw)
          ? raw
              .map(normalizeRecord)
              .filter(Boolean)
              .filter((item) => item.date.startsWith(`${currentYear}-${pad2(currentMonth)}-`))
          : [];
      }

      const stats = buildStats(records);
      const periodStats = buildPeriodStats(records);
      const weeklySeries = createWeeklySeries(records, currentYear, currentMonth);
      const efficiencySeries = createMedicationEfficiency(periodStats);
      const weeklyBars = { labels: weeklySeries.labels, values: weeklySeries.values };

      this.chartPayload = { weeklySeries, efficiencySeries, weeklyBars };

      this.setData({
        statistics: stats,
        periodStats: periodStats,
        scoreLevel: getScoreLevel(stats.adherenceScore),
        starCount: Math.max(1, Math.min(5, Math.round(stats.adherenceScore / 20))),
        aiAdvices: createAiAdvices(stats),
      });

      // Update charts after data set
      setTimeout(() => {
          this.updateCharts();
      }, 100);

    } catch (error) {
      console.error('載入分析資料失敗:', error);
      wx.showToast({ title: '載入失敗', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  updateCharts() {
    if (!this.chartPayload) return;

    const { weeklySeries, efficiencySeries, weeklyBars } = this.chartPayload;

    renderChart(this.selectComponent('#dailyChart'), () => createWeeklyLineOption(weeklySeries));
    renderChart(this.selectComponent('#periodChart'), () => createEfficiencyBarOption(efficiencySeries));
    renderChart(this.selectComponent('#trendChart'), () => createWeeklyBarOption(weeklyBars));
  },

  exportReport() {
    wx.showToast({ title: '報告已產生', icon: 'success' });
  },

  shareToDoctor() {
    wx.showShareMenu({
      withShareTicket: true,
      success: () => {
        wx.showToast({ title: '已開啟分享選單', icon: 'none' });
      },
    });
  },

  onShareAppMessage() {
    return {
      title: `${this.data.currentYear}/${this.data.currentMonth} 服藥分析報告`,
      path: `/pages/analysis/analysis?year=${this.data.currentYear}&month=${this.data.currentMonth}`,
    };
  },
});
