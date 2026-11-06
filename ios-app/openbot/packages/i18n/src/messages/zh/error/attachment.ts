import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.previewCapacity": "图片预览暂时繁忙，请稍候或重试。",
  "error.attachment.previewScope": "此预览属于其他连接，请重新打开聊天。",
  "error.attachment.previewAuth": "此图片预览的访问权限已失效，请重新连接后重试。",
  "error.attachment.previewNetwork": "图片预览下载失败，请重试。",
  "error.attachment.previewMime": "电脑返回了不支持的预览格式。",
  "error.attachment.previewSize": "图片预览超过安全下载上限。",
  "error.attachment.previewEmpty": "电脑返回的图片预览为空。",
  "error.attachment.previewEncoding": "图片预览数据不完整或已损坏。",
  "error.attachment.previewFormat": "图片预览内容与格式不符。",
  "error.attachment.previewDimensions": "图片预览尺寸超过安全上限。",
  "error.attachment.previewBusy": "等待加载的图片预览过多，请重试。",
  "error.attachment.previewUnavailable": "此图片预览暂不可用。",
  "error.attachment.previewDecode": "此设备无法打开图片预览，请重试。",
  "error.attachment.notFound": "未找到该附件。",
  "error.attachment.fileTooLarge": "某个文件超过了 100 MB 上限。",
  "error.attachment.totalTooLarge": "附件总量超过了 250 MB 上限。",
  "error.attachment.unavailable": "该文件已不可用。",
  "error.attachment.tooMany": "最多只能选择 {limit} 个文件。",
  "error.attachment.mediaUnsupported": "该服务器不支持 MP3 或 MOV 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.emlUnsupported": "该服务器不支持 EML 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.zipUnsupported": "该服务器不支持 ZIP 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.mp4Unsupported": "该服务器不支持 MP4 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.previewTooLarge": "该文件超过了 100 MB 上限。",
} as const satisfies PartialTranslation<typeof source>;
