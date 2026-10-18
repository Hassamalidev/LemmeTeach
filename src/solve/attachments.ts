/**
 * Turning what the learner attached into something the model can read.
 *
 * A screenshot or photo is shrunk before it is sent: a phone photo is several
 * megabytes and the model reads a 1600-pixel image just as well, for a
 * fraction of the upload. A PDF goes as it is. A text file is not an
 * attachment at all — it is simply more of the question.
 *
 * Nothing here touches the network. Files are read in the browser and travel
 * only inside the request to the model.
 */
import type { Attachment } from '../providers/types';

export const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_SIDE = 1600;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

export type Reading =
  | { ok: true; attachment: Attachment }
  /** A text file: appended to the question rather than attached. */
  | { ok: true; text: string; name: string }
  | { ok: false; message: string };

const IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;

export function kindOf(file: { name: string; type: string }): 'image' | 'pdf' | 'text' | null {
  if (IMAGE.test(file.type)) return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('text/') || /\.(txt|md|csv|tex)$/i.test(file.name)) return 'text';
  return null;
}

export async function readAttachment(file: File): Promise<Reading> {
  const kind = kindOf(file);
  const name = file.name || 'pasted image';

  if (!kind) {
    return {
      ok: false,
      message: `${name} is not something it can read. Use an image, a PDF or a text file.`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `${name} is over 8 MB. Crop it or send just the page you need.` };
  }

  try {
    if (kind === 'text') {
      const text = (await file.text()).slice(0, MAX_TEXT_CHARS);
      return { ok: true, text, name };
    }
    const dataUrl = await toDataUrl(file);
    if (kind === 'pdf') return { ok: true, attachment: { kind: 'file', name, dataUrl } };
    return { ok: true, attachment: { kind: 'image', name, dataUrl: await shrink(dataUrl) } };
  } catch {
    return { ok: false, message: `${name} could not be read. Try saving it again, or paste a screenshot.` };
  }
}

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Scale an image so its longest side is at most MAX_IMAGE_SIDE. */
async function shrink(dataUrl: string): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest || longest <= MAX_IMAGE_SIDE) return dataUrl;

    const scale = MAX_IMAGE_SIDE / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    // White behind a transparent screenshot, or it turns black as a JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    // No canvas, or an image the browser cannot decode: send it as it came.
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/** Files on a paste or drop event, images first. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out.length ? out : Array.from(data.files ?? []);
}
