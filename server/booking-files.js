/**
 * Customer design and reference files: validation, private storage, and access.
 *
 * The browser sends the original bytes plus a filename header; this module
 * decides what the file really is from its magic number, not from the extension
 * or the declared MIME type. Accepted files are written under a generated name
 * in a private location keyed by customer and booking, and are only ever served
 * through an authenticated route that mints short-lived signed URLs. File bytes
 * never go into the database — only metadata and the storage path do.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BOOKING_FILE_DIR,
  BOOKING_FILE_MAX_BYTES,
  SUPABASE_BOOKING_BUCKET,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from './config.js';

export const DESIGN_KINDS = ['reference', 'final'];
export const DESIGN_STATUSES = ['for_review', 'in_progress', 'for_approval', 'approved'];

export const DESIGN_STATUS_LABELS = {
  for_review: 'For review',
  in_progress: 'Design in progress',
  for_approval: 'For customer approval',
  approved: 'Approved for printing',
};

export const DESIGN_KIND_LABELS = {
  reference: 'Reference',
  final: 'Final design',
};

// Extension -> the only MIME type that extension may resolve to. `.ai` files are
// either PDF-based or EPS-based, which is why it accepts two detected types.
const EXTENSIONS = {
  jpg: { mime: 'image/jpeg', detected: ['image/jpeg'] },
  jpeg: { mime: 'image/jpeg', detected: ['image/jpeg'] },
  png: { mime: 'image/png', detected: ['image/png'] },
  webp: { mime: 'image/webp', detected: ['image/webp'] },
  pdf: { mime: 'application/pdf', detected: ['application/pdf'] },
  psd: { mime: 'image/vnd.adobe.photoshop', detected: ['image/vnd.adobe.photoshop'] },
  ai: { mime: 'application/illustrator', detected: ['application/pdf', 'application/illustrator'] },
  svg: { mime: 'image/svg+xml', detected: ['image/svg+xml'] },
};

let storageClient = null;

function usesRemoteStorage() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_BOOKING_BUCKET);
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

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Keeps the customer's filename readable but never usable as a path. */
export function originalFileName(value) {
  const base = path.basename(String(value || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').trim();
  return (cleaned || 'design-file').slice(0, 180);
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function detectedMime(buffer) {
  const head = buffer.subarray(0, 4096);
  if (head.length >= 8 && head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (head.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (head.toString('ascii', 0, 4) === '8BPS') return 'image/vnd.adobe.photoshop';
  if (head.toString('ascii', 0, 4) === '%!PS') return 'application/illustrator';
  const text = head.toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<?xml') || text.startsWith('<svg')) {
    return text.includes('<svg') ? 'image/svg+xml' : '';
  }
  return '';
}

function looksExecutable(buffer) {
  const head = buffer.subarray(0, 4);
  if (head.length < 2) return false;
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // MZ / Windows PE
  if (head.length === 4) {
    const hex = head.toString('hex');
    if (hex === '7f454c46') return true; // ELF
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(hex)) return true; // Mach-O
  }
  return false;
}

function svgProblem(buffer) {
  const text = buffer.toString('utf8');
  const lower = text.toLowerCase();
  if (!lower.includes('<svg')) return 'That SVG does not contain a drawing. Export it again and upload the new file.';
  if (/<script|onload\s*=|onerror\s*=|javascript:|<foreignobject|<!entity/.test(lower)) {
    return 'SVG files that contain scripts or embedded code are not accepted. Save a flattened copy and upload it again.';
  }
  return '';
}

/**
 * Validates one upload and returns its canonical metadata.
 *
 * Throws a 400/413 error with a message written for the customer, never a stack
 * trace. `declaredMime` is only used to catch a renamed file: the bytes decide.
 */
export function inspectDesignFile(buffer, { name = '', declaredMime = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fail(400, 'Choose a file to upload.');
  }
  if (buffer.length > BOOKING_FILE_MAX_BYTES) {
    const mb = Math.round(BOOKING_FILE_MAX_BYTES / (1024 * 1024));
    throw fail(413, `That file is larger than ${mb} MB. Compress it or split it into smaller files.`);
  }
  if (looksExecutable(buffer)) {
    throw fail(415, 'Executable files are not accepted. Upload a design, image, or PDF instead.');
  }

  const extension = extensionOf(name);
  const format = EXTENSIONS[extension];
  if (!format) {
    throw fail(
      415,
      'Unsupported file type. Upload a JPG, JPEG, PNG, WEBP, PDF, PSD, AI, or SVG file.'
    );
  }

  const detected = detectedMime(buffer);
  if (!detected || !format.detected.includes(detected)) {
    throw fail(415, `That file does not look like a real ${extension.toUpperCase()} file. Choose the original file.`);
  }
  if (detected === 'image/svg+xml') {
    const problem = svgProblem(buffer);
    if (problem) throw fail(415, problem);
  }

  // A PNG renamed to .jpg is rejected; unknown/octet-stream declarations are
  // allowed because browsers report PSD and AI inconsistently.
  const declared = String(declaredMime).toLowerCase().split(';')[0].trim();
  const aliases = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' };
  const normalisedDeclared = aliases[declared] || declared;
  if (normalisedDeclared.startsWith('image/') && normalisedDeclared !== format.mime && !format.detected.includes(normalisedDeclared)) {
    throw fail(415, 'The file contents do not match the file type. Choose the original file.');
  }

  return {
    mime: format.mime,
    extension: extension === 'jpeg' ? 'jpg' : extension,
    bytes: buffer.length,
  };
}

function keyPart(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Writes one validated file to private storage and returns where it went.
 * The stored path is `<customer>/<booking>/<uuid>.<ext>`, so one booking's
 * references are never mixed into a shared flat folder.
 */
export async function saveBookingFile({ customerId, bookingId, buffer, mime, extension }) {
  const relative = `${keyPart(customerId)}/${keyPart(bookingId)}/${crypto.randomUUID()}.${extension}`;
  const client = getStorageClient();
  if (client) {
    const { error } = await client.storage.from(SUPABASE_BOOKING_BUCKET).upload(relative, buffer, {
      contentType: mime,
      cacheControl: '0',
      upsert: false,
    });
    if (error) throw new Error(`Design storage failed: ${error.message}`);
    return { storage: 'supabase', path: relative };
  }

  const target = path.join(BOOKING_FILE_DIR, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return { storage: 'local', path: relative };
}

/**
 * Resolves one stored file for an authorized reader: a short-lived signed URL
 * in production, or an absolute path inside BOOKING_FILE_DIR locally.
 */
export async function openBookingFile(file, downloadName = '') {
  const client = getStorageClient();
  if (client && file.storage !== 'local') {
    const options = downloadName ? { download: downloadName } : undefined;
    const { data, error } = await client.storage
      .from(SUPABASE_BOOKING_BUCKET)
      .createSignedUrl(file.storage_path, 300, options);
    if (error || !data?.signedUrl) throw new Error('Could not prepare that file for viewing.');
    return { url: data.signedUrl, expires_in: 300 };
  }
  const absolute = path.resolve(BOOKING_FILE_DIR, String(file.storage_path || ''));
  if (!absolute.startsWith(BOOKING_FILE_DIR + path.sep)) {
    throw fail(404, 'That file could not be found.');
  }
  return { absolutePath: absolute };
}

/** Removes a stored file. Missing storage objects are treated as already gone. */
export async function removeBookingFile(file) {
  const client = getStorageClient();
  if (client && file.storage !== 'local') {
    const { error } = await client.storage.from(SUPABASE_BOOKING_BUCKET).remove([file.storage_path]);
    if (error) throw new Error(`Design storage delete failed: ${error.message}`);
    return;
  }
  const absolute = path.resolve(BOOKING_FILE_DIR, String(file.storage_path || ''));
  if (!absolute.startsWith(BOOKING_FILE_DIR + path.sep)) return;
  await fs.unlink(absolute).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
