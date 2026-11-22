/**
 * Object storage for generated media (chapter videos) — Blomp via its S3-compatible API
 * (path-style URLs, region us-east-1). Configured only through environment variables:
 * BLOMP_S3_ENDPOINT, BLOMP_ACCESS_KEY_ID, BLOMP_SECRET_ACCESS_KEY, BLOMP_BUCKET (+ optional BLOMP_REGION, BLOMP_PREFIX).
 */
import fs from 'node:fs';
import type { Response } from 'express';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

const E = process.env;
export const blobConfigured = () => !!(E.BLOMP_S3_ENDPOINT && E.BLOMP_ACCESS_KEY_ID && E.BLOMP_SECRET_ACCESS_KEY && E.BLOMP_BUCKET);
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ endpoint: E.BLOMP_S3_ENDPOINT, region: E.BLOMP_REGION || 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: E.BLOMP_ACCESS_KEY_ID!, secretAccessKey: E.BLOMP_SECRET_ACCESS_KEY! } }));
export const blobKey = (k: string) => `${(E.BLOMP_PREFIX || 'p57-bi').replace(/\/+$/, '')}/${k}`;

export async function putFile(key: string, file: string, contentType: string) {
  const size = fs.statSync(file).size;
  await s3().send(new PutObjectCommand({ Bucket: E.BLOMP_BUCKET!, Key: key, Body: fs.createReadStream(file), ContentLength: size, ContentType: contentType }));
  return size;
}

/** Streams an object to the client, honouring Range so video seeking works. */
export async function streamTo(key: string, range: string | undefined, res: Response, contentType: string) {
  const r = await s3().send(new GetObjectCommand({ Bucket: E.BLOMP_BUCKET!, Key: key, ...(range ? { Range: range } : {}) }));
  res.status(range && r.ContentRange ? 206 : 200);
  res.setHeader('Content-Type', contentType); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'private, max-age=3600');
  if (r.ContentLength !== undefined) res.setHeader('Content-Length', String(r.ContentLength));
  if (r.ContentRange) res.setHeader('Content-Range', r.ContentRange);
  (r.Body as Readable).pipe(res);
}
