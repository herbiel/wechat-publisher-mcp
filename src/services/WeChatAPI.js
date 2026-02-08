import axios from 'axios';
import FormData from 'form-data';
import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { validateFilePath } from '../utils/validator.js';

/**
 * 微信公众号API服务
 * 封装微信公众平台的API调用，包括access_token管理、图片上传、文章发布等
 */
class WeChatAPI {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.accessToken = null;
    this.tokenExpireTime = 0;

    logger.debug('WeChatAPI initialized', { appId });
  }

  /**
   * 获取访问令牌(Access Token)
   * 自动处理token缓存和刷新
   * @returns {Promise<string>} Access Token
   */
  async getAccessToken() {
    const now = Date.now();

    // 如果token还没过期，直接返回缓存的token
    if (this.accessToken && now < this.tokenExpireTime) {
      return this.accessToken;
    }

    try {
      logger.info('正在获取微信 Access Token...');
      const response = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
        params: {
          grant_type: 'client_credential',
          appid: this.appId,
          secret: this.appSecret
        }
      });

      if (response.data.access_token) {
        this.accessToken = response.data.access_token;
        // token有效期通常为7200秒，我们提前10分钟刷新
        this.tokenExpireTime = now + (response.data.expires_in - 600) * 1000;
        logger.info('Access Token 获取成功', { expiresIn: response.data.expires_in });
        return this.accessToken;
      } else {
        throw new Error(`获取Access Token失败: ${response.data.errmsg || '未知错误'}`);
      }
    } catch (error) {
      if (error.response) {
        throw new Error(`Access Token网络请求失败: ${error.response.data.errmsg || error.message}`);
      }
      throw new Error(`Access Token网络请求失败: ${error.message}`);
    }
  }

  /**
   * 上传封面图片到微信素材库
   * @param {string} imagePath 图片文件路径
   * @returns {Promise<string>} 封面图media_id
   */
  async uploadCoverImage(imagePath) {
    // 安全验证：检查文件路径
    const pathValidation = validateFilePath(imagePath);
    if (!pathValidation.valid) {
      throw new Error(`封面图路径不安全: ${pathValidation.errors.join(', ')}`);
    }

    const accessToken = await this.getAccessToken();

    try {
      // 检查文件是否存在
      const stats = await fs.stat(imagePath);
      if (!stats.isFile()) {
        throw new Error('指定路径不是有效文件');
      }

      // 检查文件大小
      if (stats.size > 1024 * 1024) {
        throw new Error('图片文件过大，请使用小于1MB的图片');
      }

      const formData = new FormData();
      const content = await fs.readFile(imagePath);
      const filename = path.basename(imagePath);
      const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

      formData.append('media', content, {
        filename,
        contentType
      });

      logger.debug('开始上传封面图到永久素材库...', {
        path: imagePath,
        size: stats.size,
        contentType
      });

      // 微信草稿箱 API 强制要求封面图必须是【永久素材】
      const response = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=thumb`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 60000 // 永久素材上传可能较慢
        }
      );

      logger.debug('永久素材上传响应', response.data);

      if (response.data.media_id) {
        logger.info('封面图上传成功（永久素材）', {
          mediaId: response.data.media_id,
          url: response.data.url
        });
        return response.data.media_id;
      } else {
        throw new Error(`封面图上传失败: ${response.data.errmsg || '未知错误'} (代码: ${response.data.errcode})`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`图片文件不存在: ${imagePath}`);
      } else if (error.response) {
        const errorData = error.response.data;
        throw new Error(`封面图上传失败: ${errorData.errmsg || error.message}`);
      } else {
        throw new Error(`封面图上传请求失败: ${error.message}`);
      }
    }
  }

  /**
   * 发布一篇文章（创建草稿并发布）
   * @param {Object} articleData 文章数据
   * @returns {Promise<Object>} 发布结果
   */
  async publishArticle(articleData) {
    const { title, content, author, thumbMediaId, previewMode, previewOpenId } = articleData;
    const accessToken = await this.getAccessToken();

    try {
      // 验证必填字段
      if (!thumbMediaId) {
        throw new Error('发布文章必须提供封面图media_id');
      }

      // 1. 创建草稿
      const draftItem = {
        title,
        author: author || '',
        digest: this.extractDigest(content),
        content,
        content_source_url: '',
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0
      };

      const draftData = {
        articles: [draftItem]
      };

      logger.info('📝 正在创建草稿...');
      const draftResponse = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`,
        draftData,
        { timeout: 30000 }
      );

      if (draftResponse.data.errcode && draftResponse.data.errcode !== 0) {
        throw new Error(`创建草稿失败: ${draftResponse.data.errmsg}`);
      }

      const mediaId = draftResponse.data.media_id;
      logger.info('✅ 草稿创建成功', { mediaId });

      // 如果是预览模式，则调用预览接口
      if (previewMode && previewOpenId) {
        logger.info('👁️ 正在发送预览请求...');
        const previewResponse = await axios.post(
          `https://api.weixin.qq.com/cgi-bin/message/mass/preview?access_token=${accessToken}`,
          {
            touser: previewOpenId,
            mpnews: { media_id: mediaId },
            msgtype: "mpnews"
          }
        );

        if (previewResponse.data.errcode && previewResponse.data.errcode !== 0) {
          throw new Error(`发送预览失败: ${previewResponse.data.errmsg}`);
        }

        return {
          success: true,
          previewMode: true,
          mediaId,
          message: '预览消息已发送成功，请在微信手机端查看'
        };
      }

      // 2. 发布草稿
      logger.info('🚀 正在尝试发布草稿到微信公众号...');
      try {
        const publishResponse = await axios.post(
          `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${accessToken}`,
          { media_id: mediaId },
          { timeout: 30000 }
        );

        if (publishResponse.data.errcode === 0) {
          const publishId = publishResponse.data.publish_id;
          logger.info('文章发布成功', { publishId, mediaId });
          return {
            success: true,
            mediaId,
            publishId,
            message: '🚀 文章发布任务已提交成功！您的文章正在队列中处理。'
          };
        } else {
          // 如果发布接口返回错误，只要草稿创建成功了就告诉用户
          logger.warn('发布失败，但草稿已保留', publishResponse.data);
          return {
            success: true,
            mediaId,
            message: `✅ 草稿已成功存入后台！\n但自动发布失败 (${publishResponse.data.errmsg || '权限不足'})。\n请登录微信公众号后台手动点击【素材库/草稿箱】进行发布。`
          };
        }
      } catch (publishError) {
        logger.error('发布接口调用异常', publishError);
        return {
          success: true,
          mediaId,
          message: `✅ 草稿已成功存入后台！\n但无法通过 API 自动发布 (可能因账号权限或频率限制)。\n请进入公众号后台手动点击发布。`
        };
      }
    } catch (error) {
      if (error.response) {
        const errorData = error.response.data;
        throw new Error(`微信接口调用失败: ${errorData.errmsg || error.message}`);
      }
      throw error;
    }
  }

  /**
   * 预览文章
   * @param {Object} options 预览选项
   * @returns {Promise<Object>} 预览结果
   */
  async previewArticle({ title, content, author, thumbMediaId, previewOpenId }) {
    const accessToken = await this.getAccessToken();

    try {
      // 1. 先上传图文素材
      const newsData = {
        articles: [{
          title,
          author: author || '',
          digest: this.extractDigest(content),
          content,
          content_source_url: '',
          thumb_media_id: thumbMediaId
        }]
      };

      const uploadResponse = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/media/uploadnews?access_token=${accessToken}`,
        newsData
      );

      if (!uploadResponse.data.media_id) {
        throw new Error(`素材上传失败: ${uploadResponse.data.errmsg}`);
      }

      const mediaId = uploadResponse.data.media_id;

      // 2. 发送预览消息
      const previewResponse = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/message/mass/preview?access_token=${accessToken}`,
        {
          touser: previewOpenId,
          mpnews: { media_id: mediaId },
          msgtype: 'mpnews'
        }
      );

      if (previewResponse.data.errcode === 0) {
        return {
          success: true,
          msgId: previewResponse.data.msg_id,
          mediaId
        };
      } else {
        throw new Error(`预览失败: ${previewResponse.data.errmsg}`);
      }
    } catch (error) {
      const msg = error.response ? error.response.data.errmsg : error.message;
      throw new Error(`预览请求失败: ${msg}`);
    }
  }

  /**
   * 查询发布状态
   * @param {string} publishId 发布ID
   * @returns {Promise<Object>} 状态信息
   */
  async getPublishStatus(publishId) {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${accessToken}`,
        { publish_id: publishId }
      );

      if (response.data.errcode === 0) {
        return response.data;
      } else {
        throw new Error(`查询失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      const msg = error.response ? error.response.data.errmsg : error.message;
      throw new Error(`查询状态失败: ${msg}`);
    }
  }

  /**
   * 从内容中提取摘要
   * @param {string} content 文章内容
   * @returns {string} 摘要
   */
  extractDigest(content) {
    // 移除所有HTML标签、CSS样式和Markdown标记
    let digest = content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[#*`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (digest.length > 60) {
      digest = digest.substring(0, 60) + '...';
    }

    return digest;
  }
}

export default WeChatAPI;