import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';
import UPNG from 'upng-js';

const RASTER_DOTS_58 = 384;
const RASTER_DOTS_80 = 576;
const MAX_HEIGHT = 192;

type RgbaImage = { width: number; height: number; data: Uint8Array };

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

async function loadImageBytes(url: string): Promise<Uint8Array | null> {
  const raw = url.trim();
  if (!raw) return null;
  if (raw.startsWith('data:image')) {
    const comma = raw.indexOf(',');
    if (comma < 0) return null;
    return Uint8Array.from(Buffer.from(raw.slice(comma + 1), 'base64'));
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const res = await fetch(raw);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function decodeImage(bytes: Uint8Array): RgbaImage | null {
  if (bytes.length < 4) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const copy = new Uint8Array(bytes).buffer;
      const png = UPNG.decode(copy);
      const frames = UPNG.toRGBA8(png);
      if (!frames[0] || png.width < 1 || png.height < 1) return null;
      return { width: png.width, height: png.height, data: new Uint8Array(frames[0]) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const jpg = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4 });
      if (!jpg.width || !jpg.height) return null;
      return { width: jpg.width, height: jpg.height, data: new Uint8Array(jpg.data) };
    }
  } catch {
    return null;
  }
  return null;
}

function resizeNearest(src: RgbaImage, targetW: number, targetH: number): RgbaImage {
  const data = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / targetH));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / targetW));
      const si = (sy * src.width + sx) * 4;
      const di = (y * targetW + x) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = src.data[si + 3];
    }
  }
  return { width: targetW, height: targetH, data };
}

function toEscPosRaster(img: RgbaImage): Uint8Array {
  const bytesPerRow = Math.ceil(img.width / 8);
  const rows = new Uint8Array(bytesPerRow * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let byteCol = 0; byteCol < bytesPerRow; byteCol++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteCol * 8 + bit;
        if (x >= img.width) continue;
        const idx = (y * img.width + x) * 4;
        const r = img.data[idx];
        const g = img.data[idx + 1];
        const b = img.data[idx + 2];
        const a = img.data[idx + 3];
        const gray = a < 140 ? 255 : (r + g + b) / 3;
        if (gray < 168) byte |= 1 << (7 - bit);
      }
      rows[y * bytesPerRow + byteCol] = byte;
    }
  }
  return new Uint8Array([0x1d, 0x76, 0x30, 0x00, ...u16le(bytesPerRow), ...u16le(img.height), ...rows]);
}

/** Bitmap ESC/POS (GS v 0) depuis une data URL ou une URL http(s). */
export async function escPosRasterFromUrl(
  url: string | null | undefined,
  paperWidth: 58 | 80,
): Promise<Uint8Array | null> {
  if (!url?.trim()) return null;
  const bytes = await loadImageBytes(url);
  if (!bytes) return null;
  const decoded = decodeImage(bytes);
  if (!decoded) return null;

  const maxDots = paperWidth === 80 ? RASTER_DOTS_80 : RASTER_DOTS_58;
  let targetW = Math.min(maxDots, decoded.width);
  let targetH = Math.max(1, Math.round((decoded.height * targetW) / decoded.width));
  if (targetH > MAX_HEIGHT) {
    targetH = MAX_HEIGHT;
    targetW = Math.max(1, Math.round((decoded.width * targetH) / decoded.height));
    targetW = Math.min(maxDots, targetW);
  }
  const sized =
    targetW === decoded.width && targetH === decoded.height
      ? decoded
      : resizeNearest(decoded, targetW, targetH);
  return toEscPosRaster(sized);
}
