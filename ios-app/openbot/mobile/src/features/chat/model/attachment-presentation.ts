import type {AttachmentSummary} from '@openbot/contracts/ipc';
/** Client presentation only; these fields do not change the upstream Team wire contract. */
export type PresentedAttachment=AttachmentSummary & {
 downloadMode?:'preview'|'unavailable';
 originalFile?:{name:string;size:number};
};
