import { defineMessages } from "../../../message";

export const messages = defineMessages("error.attachment", {
  // Attachment and file preview errors.
  "error.attachment.previewScope": "This preview belongs to a different connection. Reopen the chat.",
  "error.attachment.previewAuth": "Access to this image preview is no longer available. Reconnect and try again.",
  "error.attachment.previewNetwork": "The image preview could not be downloaded. Try again.",
  "error.attachment.previewMime": "The computer returned an unsupported preview format.",
  "error.attachment.previewSize": "The image preview exceeds the safe download limit.",
  "error.attachment.previewEmpty": "The computer returned an empty image preview.",
  "error.attachment.previewEncoding": "The image preview data is incomplete or damaged.",
  "error.attachment.previewFormat": "The image preview content does not match its format.",
  "error.attachment.previewDimensions": "The image preview exceeds the safe image dimensions.",
  "error.attachment.previewBusy": "Too many image previews are waiting. Try again.",
  "error.attachment.previewUnavailable": "This image preview is unavailable.",
  "error.attachment.previewDecode": "The image preview could not be opened on this device. Try again.",
  "error.attachment.notFound": "Attachment was not found.",
  "error.attachment.fileTooLarge": "A file exceeds the 100 MB limit.",
  "error.attachment.totalTooLarge": "Attachments exceed the 250 MB total limit.",
  "error.attachment.unavailable": "This file is no longer available.",
  "error.attachment.tooMany": "Choose at most {limit} files.",
  "error.attachment.mediaUnsupported":
    "This server does not support MP3 or MOV attachments. Update OpenBot on the host and retry.",
  "error.attachment.emlUnsupported":
    "This server does not support EML attachments. Update OpenBot on the host and retry.",
  "error.attachment.zipUnsupported":
    "This server does not support ZIP attachments. Update OpenBot on the host and retry.",
  "error.attachment.mp4Unsupported":
    "This server does not support MP4 attachments. Update OpenBot on the host and retry.",
  "error.attachment.previewTooLarge": "The file exceeds the 100 MB limit.",
});
