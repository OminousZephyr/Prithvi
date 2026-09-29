export const MODEL_IMAGE_SIZE = 224;
export const MODEL_CHANNELS = 3;

export interface RGBImage { width: number; height: number; data: Uint8Array }

/**
 * Bilinear stretch resize matching the training pipeline's 224x224 RGB input.
 * Values stay raw 0..255: the selected model embeds MobileNetV3 preprocessing.
 */
export function resizeRGBToFloat32(image: RGBImage, width = MODEL_IMAGE_SIZE, height = MODEL_IMAGE_SIZE) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data.length !== image.width * image.height * MODEL_CHANNELS) {
    throw new Error('Decoded image has an invalid RGB shape.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Model image dimensions are invalid.');

  const tensor = new Float32Array(width * height * MODEL_CHANNELS);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, (y + 0.5) * image.height / height - 0.5);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(y0 + 1, image.height - 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, (x + 0.5) * image.width / width - 0.5);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(x0 + 1, image.width - 1);
      const xWeight = sourceX - x0;
      const target = (y * width + x) * MODEL_CHANNELS;
      const topLeft = (y0 * image.width + x0) * MODEL_CHANNELS;
      const topRight = (y0 * image.width + x1) * MODEL_CHANNELS;
      const bottomLeft = (y1 * image.width + x0) * MODEL_CHANNELS;
      const bottomRight = (y1 * image.width + x1) * MODEL_CHANNELS;
      for (let channel = 0; channel < MODEL_CHANNELS; channel += 1) {
        const top = image.data[topLeft + channel] * (1 - xWeight) + image.data[topRight + channel] * xWeight;
        const bottom = image.data[bottomLeft + channel] * (1 - xWeight) + image.data[bottomRight + channel] * xWeight;
        tensor[target + channel] = top * (1 - yWeight) + bottom * yWeight;
      }
    }
  }
  return tensor;
}
