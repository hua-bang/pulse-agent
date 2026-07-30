import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { ChatImageAttachment } from '../types';
import { buildAttachmentFileName } from './attachmentFileName';
import {
  cancelAttachmentWork,
  enqueueAttachmentUpload,
  forgetAttachmentRetryFile,
  getAttachmentRetryFile,
  reconcileAttachmentRuntime,
  reserveAttachmentFiles,
} from './chatAttachmentRuntime';
import { useI18n } from '../../../i18n';

interface UseChatAttachmentsOptions {
  scopeId: string;
  attachments: ChatImageAttachment[];
  setAttachments: Dispatch<SetStateAction<ChatImageAttachment[]>>;
}

const fileToBase64 = async (file: File, fallbackError: string): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(fallbackError));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error(fallbackError);
  return base64;
};

export const useChatAttachments = ({
  scopeId,
  attachments,
  setAttachments,
}: UseChatAttachmentsOptions) => {
  const { t } = useI18n();

  useEffect(() => {
    reconcileAttachmentRuntime(scopeId, attachments);
  }, [attachments, scopeId]);

  const updateAttachment = useCallback((
    id: string,
    patch: Partial<ChatImageAttachment>,
  ) => {
    setAttachments(previous => previous.map(attachment => (
      attachment.id === id ? { ...attachment, ...patch } : attachment
    )));
  }, [setAttachments]);

  const uploadAttachment = useCallback(async (
    id: string,
    file: File,
    isCancelled: () => boolean,
  ) => {
    if (isCancelled()) return;
    updateAttachment(id, { status: 'uploading', error: undefined, retryable: undefined });
    try {
      const base64 = await fileToBase64(file, t('chat.attachmentReadFailed'));
      if (isCancelled()) return;
      const ext = file.type.replace('image/', '').split(';')[0] || 'png';
      const saved = await window.canvasWorkspace.file.saveImage(scopeId, base64, ext);
      if (isCancelled()) {
        if (saved.ok && saved.filePath) {
          await window.canvasWorkspace.file
            .deleteSavedImage?.(scopeId, saved.filePath)
            .catch(() => undefined);
        }
        return;
      }
      if (!saved.ok || !saved.filePath) {
        throw new Error(saved.error ?? t('chat.attachmentSaveFailed'));
      }
      forgetAttachmentRetryFile(scopeId, id);
      updateAttachment(id, {
        path: saved.filePath,
        status: 'ready',
        error: undefined,
        retryable: undefined,
      });
    } catch (error) {
      if (isCancelled()) return;
      updateAttachment(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryable: Boolean(getAttachmentRetryFile(scopeId, id)),
      });
    }
  }, [scopeId, t, updateAttachment]);

  const enqueueUpload = useCallback((id: string) => {
    enqueueAttachmentUpload(scopeId, id, (file, isCancelled) => (
      uploadAttachment(id, file, isCancelled)
    ));
  }, [scopeId, uploadAttachment]);

  const handleAttachFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const reservations = reserveAttachmentFiles(
      scopeId,
      attachments,
      imageFiles,
      index => `attachment-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const pending = reservations.map((reservation): ChatImageAttachment => {
      const { accepted, exceedsCountLimit, exceedsFileLimit, exceedsTotalLimit, file, id } = reservation;
      const ext = file.type.replace('image/', '').split(';')[0] || 'png';
      return {
        id,
        path: '',
        fileName: buildAttachmentFileName(file, ext),
        mimeType: file.type || `image/${ext}`,
        sizeBytes: file.size,
        status: accepted ? 'uploading' : 'failed',
        error: exceedsFileLimit
          ? t('chat.attachmentTooLarge')
          : exceedsTotalLimit
            ? t('chat.attachmentsTooLarge')
            : exceedsCountLimit
              ? t('chat.attachmentFailed')
              : undefined,
        retryable: accepted ? undefined : false,
      };
    });
    // One append preserves the user's selection order even when saves settle
    // out of order.
    setAttachments(previous => [...previous, ...pending]);
    for (const attachment of pending) {
      if (attachment.status === 'uploading') enqueueUpload(attachment.id);
    }
  }, [attachments, enqueueUpload, scopeId, setAttachments, t]);

  const retryAttachment = useCallback((id: string) => {
    if (getAttachmentRetryFile(scopeId, id)) {
      enqueueUpload(id);
      return;
    }
    updateAttachment(id, {
      status: 'failed',
      error: t('chat.attachmentFailed'),
      retryable: false,
    });
  }, [enqueueUpload, scopeId, t, updateAttachment]);

  const removeAttachment = useCallback((id: string) => {
    const savedPath = attachments.find(item => item.id === id)?.path;
    cancelAttachmentWork(scopeId, id);
    setAttachments(previous => previous.filter(item => item.id !== id));
    if (savedPath) {
      void window.canvasWorkspace.file.deleteSavedImage?.(scopeId, savedPath)
        .catch(() => undefined);
    }
  }, [attachments, scopeId, setAttachments]);

  const sendBlocked = useMemo(() => attachments.some(attachment => (
    attachment.status === 'uploading' || attachment.status === 'failed'
  )), [attachments]);

  return {
    attachments,
    handleAttachFiles,
    removeAttachment,
    retryAttachment,
    sendBlocked,
  };
};
