/**
 * 日志工具
 * 提供统一的日志记录功能，支持不同级别的日志输出
 */

const logger = {
  info: (message, ...args) => {
    // 使用 console.error 而不是 console.log，避免干扰 MCP 标准输出协议
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[INFO] ${message}`, ...args);
    }
  },

  error: (message, error) => {
    if (error && error.stack) {
      console.error(`[ERROR] ${message}\n${error.stack}`);
    } else {
      console.error(`[ERROR] ${message}`, error || '');
    }
  },

  debug: (message, ...args) => {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },

  warn: (message, ...args) => {
    console.error(`[WARN] ${message}`, ...args);
  }
};

export default logger;