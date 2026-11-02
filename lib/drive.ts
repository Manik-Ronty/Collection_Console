import 'server-only';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { googleAuth } from './google';
import type { Attachment } from './gmail';

// Same Drive folder the Apps Script stores mail attachments in (PREVIEW_ATTACHMENTS_FOLDER_ID_).
export const ATTACHMENTS_FOLDER_ID = '1s-2YkvAoRwLbAtgdua-SVgD8PhPZwX_8';
const drive = () => google.drive({ version: 'v3', auth: googleAuth(['https://www.googleapis.com/auth/drive']) });

/** "/d/<id>/", "?id=<id>" or a bare id -> the id (driveFileIdFromUrl_). */
export function driveFileId(url: string) {
  const s = url.trim();
  const m = s.match(/\/d\/([-\w]{15,})/) || s.match(/[?&]id=([-\w]{15,})/);
  return m ? m[1] : /^[-\w]{15,}$/.test(s) ? s : '';
}

/** Uploads one file into the attachments folder; returns its Drive link. */
export async function uploadToFolder(name: string, mimeType: string, data: Buffer) {
  const res = await drive().files.create({
    requestBody: { name, parents: [ATTACHMENTS_FOLDER_ID] },
    media: { mimeType, body: Readable.from(data) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return res.data.webViewLink ?? `https://drive.google.com/file/d/${res.data.id}/view`;
}

/** The file's name, for an attachment chip ('' when it can't be read). */
export async function driveFileName(url: string) {
  const id = driveFileId(url);
  if (!id) return '';
  try { return (await drive().files.get({ fileId: id, fields: 'name', supportsAllDrives: true })).data.name ?? ''; }
  catch { return ''; }
}

/** Every saved attachment link (newline / comma list) as mail attachments, skipping ones that can't be read (resolveAttachmentBlobs_). */
export async function downloadAttachments(text: unknown): Promise<Attachment[]> {
  const links = String(text ?? '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const d = drive();
  const out: Attachment[] = [];
  for (const link of links) {
    const id = driveFileId(link);
    if (!id) continue;
    try {
      const meta = await d.files.get({ fileId: id, fields: 'name, mimeType', supportsAllDrives: true });
      const file = await d.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      out.push({ name: meta.data.name ?? 'file', mimeType: meta.data.mimeType ?? 'application/octet-stream', data: Buffer.from(file.data as ArrayBuffer) });
    } catch (e) {
      console.error('downloadAttachments: skipped', link, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
