const request = require('./request.js');
const { SERVER_CONFIG } = require('./config.js');

// Mock Data Definitions
const mockMedicationStatus = {
  update_time: "2026-02-06 14:43:26",
  period: "中午",
  check_count: 1,
  status: "已服药"
};

const mockHistoryData = [
  {
    date: "2026-02-06",
    list: [
      { id: 1, time: "08:05", status: "completed", title: "早上药物", description: "正常服用" },
      { id: 2, time: "12:20", status: "delayed", title: "中午药物", description: "推迟20分钟" },
      { id: 3, time: "20:03", status: "missed", title: "晚上药物", description: "漏服" }
    ]
  },
  {
    date: "2026-02-05",
    list: [
      { id: 4, time: "08:10", status: "completed", title: "早上药物", description: "正常服用" },
      { id: 5, time: "12:05", status: "completed", title: "中午药物", description: "正常服用" },
      { id: 6, time: "19:55", status: "completed", title: "晚上药物", description: "正常服用" }
    ]
  }
];

const mockAlarmConfig = {
  "早上": { "h": 8, "m": 0 },
  "中午": { "h": 12, "m": 30 },
  "晚上": { "h": 19, "m": 0 }
};

// API Definitions
const api = {
  // 获取用药状态
  getMedicationStatus: () => {
    return request.get(`${SERVER_CONFIG.API_PREFIX}/status`, {}, { loading: false })
      .catch(err => {
        console.log('getMedicationStatus失败，使用Mock数据');
        return {
          update_time: new Date().toLocaleString(),
          period: "早上",
          check_count: 1,
          status: "暂无数据（演示模式）"
        };
      });
  },

  // 获取闹钟配置
  getAlarmConfig: () => {
    return request.get(`${SERVER_CONFIG.API_PREFIX}/config`, {}, { loading: false })
      .catch(err => {
        console.log('getAlarmConfig失败，使用Mock数据');
        return {
          "早上": { "h": 8, "m": 0 },
          "中午": { "h": 12, "m": 0 },
          "晚上": { "h": 20, "m": 0 }
        };
      });
  },

  // 更新闹钟配置
  updateAlarmConfig: (config) => {
    return request.post(`${SERVER_CONFIG.API_PREFIX}/config`, config)
      .catch(err => {
        // console.warn('API /config update failed, mocking success', err);
        return { status: "success" };
      });
  },

  // 获取监控数据
  getMonitorData: () => {
    return request.get(`${SERVER_CONFIG.API_PREFIX}/status`, {}, { loading: false })
      .then(res => {
        // 转换数据格式，适配小程序预期结构
        return {
          data: {
            last_update: res.update_time ?
              res.update_time.split(' ')[1] :
              new Date().toLocaleTimeString(),
            image_base64: "",
            status: res.status || "暂无数据",
            device_online: true,
            battery: 85
          }
        };
      })
      .catch(err => {
        console.log('使用Mock数据');
        return {
          data: {
            last_update: new Date().toLocaleTimeString(),
            image_base64: "",
            status: "监测中（演示模式）",
            device_online: false,
            battery: 85
          }
        };
      });
  },

  // 获取历史记录 (Mock Only for now)
  getHistory: (params) => {
    // Simulate async request
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Using Mock History Data');
        resolve(mockHistoryData);
      }, 500);
    });
  },

  /**
   * ==================== 语音管理相关 ====================
   */

  /**
   * 纯语音转文字（不含AI对话和TTS）
   * @param {String} audioBase64 - base64编码的音频数据
   * @returns {Promise<{status: string, text: string}>}
   */
  speechToText: (audioBase64) => {
    return request.post(`${SERVER_CONFIG.API_PREFIX}/stt`, {
      audio: audioBase64
    }).catch(err => {
      console.log('API /stt failed');
      return { status: 'error', text: '' };
    });
  },

  /** 
   * NLP 解析语音文本为结构化排班数据（支持多轮追问上下文） 
   * @param {String} text - 语音识别后的文本（或追问的回答） 
   * @param {String} context - 可选，多轮追问时的上下文字符串 
   * @returns {Promise<{status: string, schedules: Array, ask_user: string}>} 
   */ 
  parseMedSchedule: (text, context) => { 
    const payload = { text: text }; 
    if (context) payload.context = context; 
    return request.post(`${SERVER_CONFIG.API_PREFIX}/parse_med_schedule`, payload)
      .then(res => {
         // 確保返回數據格式正確
         if (res.status === 'success' || res.schedules) {
             return res;
         }
         // 如果 res 本身就是數據對象（某些 request 封裝會解包 data）
         return res;
      })
      .catch(err => { 
        console.log('API /parse_med_schedule failed', err); 
        return { status: 'error', schedules: [], ask_user: '' }; 
      }); 
  },

  /**
   * 上传语音进行识别
   * @param {String} audioBase64 - base64编码的音频数据
   */
  uploadVoiceForRecognition: (audioBase64) => {
    return request.post(`${SERVER_CONFIG.API_PREFIX}/voice`, {
      audio: audioBase64
    }).catch(err => {
      // Mock success for demo purposes if server is down
      console.log('API /voice failed, mocking success for demo');
      return { status: 'success', text: 'Mocked Recognition Text' };
    });
  },

  /**
   * 文本转语音（用于预览）
   * @param {String} text - 要转换的文本
   */
  textToSpeech: (text) => {
    return request.post(`${SERVER_CONFIG.API_PREFIX}/tts_text`, {
      text: text
    }).then(res => {
        // 确保返回正确的数据结构
        // 有些request封装可能会直接返回res.data，有些返回完整res
        if (res.status === 'success' || res.data?.status === 'success') {
             return res.data || res;
        }
        return res;
    }).catch(err => {
      console.error('TTS API错误:', err);
      throw err;
    });
  },

  /**
   * ==================== 图片和AI分析相关 ====================
   */

  /**
   * 获取最新的药格照片
   */
  getLatestPillboxImage: () => {
    // API /get_monitor 不存在，直接返回空图片
    return Promise.resolve({ image_base64: "" });
  },

  /**
   * 上传药格照片进行AI分析（通常由M10调用，小程序端主要是查看结果）
   * @param {String} imageBase64 - base64编码的图片
   * @param {String} period - 时间段（早上/中午/晚上）
   * @param {Number} checkCount - 检查次数
   */
  uploadPillboxImage: (imageBase64, period, checkCount) => {
    return request.post(`${SERVER_CONFIG.API_PREFIX}/upload`, {
      image: imageBase64,
      period: period,
      check_count: checkCount
    });
  },

  /**
   * ==================== 库存管理相关 ====================
   */

  /**
   * 获取库存信息
   */
  getInventoryStatus: () => {
    // 注意：这个接口可能需要后端补充实现
    // 暂时使用本地mock数据
    return Promise.resolve({
      data: {
        slots: [
          { id: 'red-morning', color: '红色', period: '早上', remaining: 2, total: 7 },
          { id: 'blue-morning', color: '蓝色', period: '早上', remaining: 5, total: 7 },
          { id: 'green-morning', color: '绿色', period: '早上', remaining: 7, total: 7 },
          { id: 'red-noon', color: '红色', period: '中午', remaining: 3, total: 7 },
          { id: 'blue-noon', color: '蓝色', period: '中午', remaining: 4, total: 7 },
          { id: 'green-noon', color: '绿色', period: '中午', remaining: 6, total: 7 },
          { id: 'red-evening', color: '红色', period: '晚上', remaining: 1, total: 7 },
          { id: 'blue-evening', color: '蓝色', period: '晚上', remaining: 2, total: 7 },
          { id: 'green-evening', color: '绿色', period: '晚上', remaining: 7, total: 7 }
        ]
      }
    });
  },

  /**
   * 重置单个药格库存
   * @param {String} slotId - 药格ID
   * @param {Number} quantity - 补充数量
   */
  resetSlotInventory: (slotId, quantity) => {
    // 本地存储实现
    return new Promise((resolve) => {
      const inventory = wx.getStorageSync('pillboxInventory') || {};
      inventory[slotId] = {
        total: quantity || 7,
        remaining: quantity || 7,
        lastReset: new Date().toISOString()
      };
      wx.setStorageSync('pillboxInventory', inventory);
      resolve({ status: 'success' });
    });
  },

  /**
   * 批量重置所有药格库存
   * @param {Array} slots - 药格ID数组
   */
  resetAllInventory: (slots) => {
    // 本地存储实现
    return new Promise((resolve) => {
      const inventory = {};
      slots.forEach(slotId => {
        inventory[slotId] = {
          total: 7,
          remaining: 7,
          lastReset: new Date().toISOString()
        };
      });
      wx.setStorageSync('pillboxInventory', inventory);
      resolve({ status: 'success' });
    });
  },

  /**
   * 扣减库存（每次服药后调用）
   * @param {String} slotId - 药格ID
   */
  decrementInventory: (slotId) => {
    return new Promise((resolve) => {
      const inventory = wx.getStorageSync('pillboxInventory') || {};
      if (inventory[slotId] && inventory[slotId].remaining > 0) {
        inventory[slotId].remaining--;
        wx.setStorageSync('pillboxInventory', inventory);
      }
      resolve({ status: 'success' });
    });
  }
};

module.exports = api;
