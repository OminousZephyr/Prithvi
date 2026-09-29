import jpeg from 'jpeg-js';
import { resizeRGBToFloat32, type RGBImage } from './mobilenetv3-preprocess.ts';

export async function loadJpegBytes(imageUri: string): Promise<Uint8Array> {
  const response = await fetch(imageUri);
  if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export function decodeJpegToRGB(bytes: Uint8Array): RGBImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Image is not a supported JPEG.');
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 20, maxMemoryUsageInMB: 96, tolerantDecoding: false });
  if (decoded.width < 96 || decoded.height < 96) throw new Error('Image quality too low: use a clear image at least 96 × 96 pixels.');
  if (decoded.width > 4096 || decoded.height > 4096 || decoded.data.length !== decoded.width * decoded.height * 4) throw new Error('JPEG dimensions or decoded pixel data are invalid.');
  const rgb = new Uint8Array(decoded.width * decoded.height * 3);
  for (let src = 0, dst = 0; src < decoded.data.length; src += 4, dst += 3) {
    rgb[dst] = decoded.data[src];
    rgb[dst + 1] = decoded.data[src + 1];
    rgb[dst + 2] = decoded.data[src + 2];
  }
  return { width: decoded.width, height: decoded.height, data: rgb };
}

export async function prepareJpegTensor(imageUri: string) {
  const bytes = await loadJpegBytes(imageUri);
  return resizeRGBToFloat32(decodeJpegToRGB(bytes));
}
