/**
 * Product media validation and storage.
 *
 * The browser sends the original file bytes; this module checks the magic
 * number (not the extension), parses the intrinsic dimensions, and only then
 * writes a uniquely named file. Uploaded filenames never come from the client,
 * so a request cannot traverse directories or replace another product's image.
 *
 * Local development writes to UPLOAD_DIR. Production writes to a public
 * Supabase Storage bucket, because the Render free filesystem is ephemeral.
 * The database stores only the public URL and metadata, never the bytes.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  IS_PROD,
  STORE_MODE,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_URL,
  UPLOAD_DIR,
} from './config.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 300;
export const MAX_IMAGE_SIDE = 8000;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

const FORMATS = {
  'image/jpeg': { extension: 'jpg', label: 'JPG' },
  'image/png': { extension: 'png', label: 'PNG' },
  'image/webp': { extension: 'webp', label: 'WEBP' },
};

let storageClient = null;

function usesRemoteStorage() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET);
}

function getStorageClient() {
  if (!usesRemoteStorage()) return null;
  if (!storageClient) {
    storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return storageClient;
}

function storagePrefix() {
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    if (startOfFrame.has(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

/**
 * Returns `{ mime, extension, width, height }` for a valid JPG/PNG/WEBP buffer.
 * Throws a 400 error with a customer-readable message otherwise.
 */
export function inspectProductImage(buffer, declaredMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fail('Unsupported image format. Please upload JPG, PNG, or WEBP.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw fail('Image exceeds the 4 MB limit.');
  }

  let mime = '';
  let dimensions = null;
  const png = pngSize(buffer);
  if (png) {
    mime = 'image/png';
    dimensions = png;
  }
  if (!mime) {
    const jpeg = jpegSize(buffer);
    if (jpeg) {
      mime = 'image/jpeg';
      dimensions = jpeg;
    }
  }
  if (!mime) {
    const webp = webpSize(buffer);
    if (webp) {
      mime = 'image/webp';
      dimensions = webp;
    }
  }

  if (!mime || !FORMATS[mime]) {
    const looksLikeKnownImage =
      (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ||
      (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) ||
      (buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP');
    if (looksLikeKnownImage) {
      throw fail('This image file is damaged or cannot be opened. Please select another image.');
    }
    throw fail('Unsupported image format. Please upload JPG, PNG, or WEBP.');
  }

  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw fail('This image file is damaged or cannot be opened. Please select another image.');
  }
  if (dimensions.width < MIN_IMAGE_SIDE || dimensions.height < MIN_IMAGE_SIDE) {
    throw fail('Image dimensions must be at least 300 × 300 pixels.');
  }
  if (dimensions.width > MAX_IMAGE_SIDE || dimensions.height > MAX_IMAGE_SIDE) {
    throw fail(`The image must be no larger than ${MAX_IMAGE_SIDE} × ${MAX_IMAGE_SIDE} pixels.`);
  }

  return {
    mime,
    extension: FORMATS[mime].extension,
    width: dimensions.width,
    height: dimensions.height,
    bytes: buffer.length,
  };
}

/**
 * Returns `{ mime, extension, bytes }` for a valid MP4/WEBM buffer. The browser
 * plays the file from a public URL, so the container is checked from its magic
 * bytes rather than trusting the upload's Content-Type or filename.
 */
export function inspectProductVideo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fail('Unsupported video format. Please upload MP4 or WEBM.');
  }
  if (buffer.length > MAX_VIDEO_BYTES) {
    throw fail('Video exceeds the 25 MB limit.');
  }

  const isMp4 =
    buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && buffer.readUInt32BE(0) >= 12;
  const isWebm =
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;

  if (!isMp4 && !isWebm) {
    throw fail('Unsupported video format. Please upload MP4 or WEBM.');
  }

  return {
    mime: isMp4 ? 'video/mp4' : 'video/webm',
    extension: isMp4 ? 'mp4' : 'webm',
    bytes: buffer.length,
  };
}

/** Writes a validated image and returns its public URL. */
export async function saveProductImage(buffer, image) {
  const filename = `${crypto.randomUUID()}.${image.extension}`;
  const client = getStorageClient();
  if (client) {
    const { error } = await client.storage.from(SUPABASE_STORAGE_BUCKET).upload(filename, buffer, {
      contentType: image.mime,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      console.error('Product image storage failed:', error.message);
      throw Object.assign(new Error('Unable to upload the image. Please check your connection and try again.'), {
        status: 502,
      });
    }
    const { data } = client.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filename);
    if (!data?.publicUrl) {
      console.error('Product image storage did not return a public URL.');
      throw Object.assign(new Error('Unable to upload the image. Please check your connection and try again.'), {
        status: 502,
      });
    }
    return data.publicUrl;
  }

  if (IS_PROD || STORE_MODE === 'supabase') {
    console.error(
      'Product image storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.'
    );
    throw Object.assign(
      new Error('Image storage is not configured. Please contact the studio owner.'),
      { status: 503 }
    );
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const target = path.join(UPLOAD_DIR, filename);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o644 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return `/uploads/products/${filename}`;
}

/** Deletes only images this app created, in local storage or its own bucket. */
export async function removeProductImage(publicPath) {
  const value = String(publicPath || '');
  const prefix = storagePrefix();
  if (usesRemoteStorage() && value.startsWith(prefix)) {
    const key = decodeURIComponent(value.slice(prefix.length));
    if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(key)) return;
    const { error } = await getStorageClient().storage.from(SUPABASE_STORAGE_BUCKET).remove([key]);
    if (error) throw new Error(`Image storage delete failed: ${error.message}`);
    return;
  }
  if (!value.startsWith('/uploads/products/')) return;
  const filename = path.basename(value);
  if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) return;
  await fs.unlink(path.join(UPLOAD_DIR, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

/** Writes a validated booth video and returns its public URL. */
export async function saveProductVideo(buffer, video) {
  const filename = `videos/${crypto.randomUUID()}.${video.extension}`;
  const client = getStorageClient();
  if (client) {
    const { error } = await client.storage.from(SUPABASE_STORAGE_BUCKET).upload(filename, buffer, {
      contentType: video.mime,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      console.error('Product video storage failed:', error.message);
      throw Object.assign(new Error('Unable to upload the video. Please check your connection and try again.'), {
        status: 502,
      });
    }
    const { data } = client.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filename);
    if (!data?.publicUrl) {
      console.error('Product video storage did not return a public URL.');
      throw Object.assign(new Error('Unable to upload the video. Please check your connection and try again.'), {
        status: 502,
      });
    }
    return data.publicUrl;
  }

  if (IS_PROD || STORE_MODE === 'supabase') {
    console.error(
      'Product video storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.'
    );
    throw Object.assign(
      new Error('Video storage is not configured. Please contact the studio owner.'),
      { status: 503 }
    );
  }

  const directory = path.join(UPLOAD_DIR, 'videos');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, path.basename(filename));
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o644 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return `/uploads/products/${filename}`;
}

/** Deletes only videos this app created, in local storage or its own bucket. */
export async function removeProductVideo(publicPath) {
  const value = String(publicPath || '');
  const prefix = storagePrefix();
  if (usesRemoteStorage() && value.startsWith(`${prefix}videos/`)) {
    const key = decodeURIComponent(value.slice(prefix.length));
    if (!/^videos\/[a-f0-9-]+\.(mp4|webm)$/i.test(key)) return;
    const { error } = await getStorageClient().storage.from(SUPABASE_STORAGE_BUCKET).remove([key]);
    if (error) throw new Error(`Video storage delete failed: ${error.message}`);
    return;
  }
  if (!value.startsWith('/uploads/products/videos/')) return;
  const filename = path.basename(value);
  if (!/^[a-f0-9-]+\.(mp4|webm)$/i.test(filename)) return;
  await fs.unlink(path.join(UPLOAD_DIR, 'videos', filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
