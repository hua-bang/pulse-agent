const GENERIC_CLIPBOARD_NAME = /^image\.[a-z0-9]+$/i;

export const buildAttachmentFileName = (file: File, ext: string): string => {
  if (file.name && !GENERIC_CLIPBOARD_NAME.test(file.name)) return file.name;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + ` ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
};
