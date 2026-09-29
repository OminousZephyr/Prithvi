export function normalizeLocalServiceUrl(value: string, label = 'service') {
  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error(`Enter a valid local ${label} address, such as http://192.168.1.20:8000`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Enter the base ${label} address without a path, query, or fragment.`);
  }
  return trimmed;
}

export function readImageDataUrlAsBlob(imageUri: string) {
  return fetch(imageUri).then(async (response) => {
    if (!response.ok) throw new Error('Captured image is no longer available. Capture it again.');
    return response.blob();
  });
}
