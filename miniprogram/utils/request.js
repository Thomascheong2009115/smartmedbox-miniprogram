const { SERVER_CONFIG } = require('./config.js');

const request = (options) => {
  return new Promise((resolve, reject) => {
    if (options.loading !== false) {
      wx.showLoading({
        title: 'Loading...',
        mask: true
      });
    }

    const url = options.url.startsWith('http') 
      ? options.url 
      : `${SERVER_CONFIG.BASE_URL}${options.url}`;

    if (SERVER_CONFIG.DEBUG) {
      console.log(`[Request] ${options.method || 'GET'} ${url}`, options.data);
    }

    wx.request({
      url: url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        ...options.header
      },
      timeout: SERVER_CONFIG.TIMEOUT,
      success: (res) => {
        if (SERVER_CONFIG.DEBUG) {
          console.log(`[Response] ${url}`, res);
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        if (res.statusCode === 404) {
          console.warn(`API 404: ${url}`);
          // 404 交由调用方处理，保留演示数据回退。
          reject({
            statusCode: 404,
            errMsg: 'API不存在',
            url: url
          });
          return;
        }

        const errorMsg = res.data.msg || res.data.message || 'Request failed';
        wx.showToast({
          title: errorMsg,
          icon: 'none'
        });
        reject(new Error(errorMsg));
      },
      fail: (err) => {
        console.error(`[Request Error] ${url}`, err);
        wx.showToast({
          title: 'Network Error',
          icon: 'none'
        });
        reject(err);
      },
      complete: () => {
        if (options.loading !== false) {
          wx.hideLoading();
        }
      }
    });
  });
};

module.exports = {
  request,
  get: (url, data, options = {}) => request({ ...options, url, method: 'GET', data }),
  post: (url, data, options = {}) => request({ ...options, url, method: 'POST', data }),
  put: (url, data, options = {}) => request({ ...options, url, method: 'PUT', data }),
  delete: (url, data, options = {}) => request({ ...options, url, method: 'DELETE', data })
};
