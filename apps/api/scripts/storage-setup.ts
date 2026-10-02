/**
 * Creates the three storage buckets in Garage and makes ONLY product-images
 * public. Idempotent — safe to run on every deploy.
 *
 *   product-images  website access on: anyone can read a photo by its URL
 *   id-documents    private (signed links only)
 *   buy-in-forms    private (signed links only)
 *
 * Done through Garage's admin API rather than S3 CreateBucket: a bucket made
 * over S3 only gets a name private to the key that made it, and Garage's web
 * endpoint finds buckets by their GLOBAL name. The API's key (S3_ACCESS_KEY_ID)
 * is then allowed to read and write all three.
 *
 * Photos are served from STORAGE_PUBLIC_URL. The web endpoint picks the bucket
 * from the request's host name, so product-images also gets that host as a
 * global alias (`localhost` locally, `files.fonology.co.uk` on the server).
 *
 * GARAGE_ADMIN_URL / GARAGE_ADMIN_TOKEN default to the local stack's when
 * STORAGE_PUBLIC_URL is on localhost.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/storage-setup.ts
 */
import { config } from '../src/config.js';
import { BUCKETS } from '../src/lib/storage.js';

const publicHost = new URL(config.storagePublicUrl).hostname;
const isLocal = publicHost === 'localhost';
const adminUrl = process.env.GARAGE_ADMIN_URL ?? (isLocal ? 'http://localhost:3903' : undefined);
const adminToken =
  process.env.GARAGE_ADMIN_TOKEN ?? (isLocal ? 'fonology-dev-admin-token' : undefined);

interface BucketInfo {
  id: string;
  globalAliases: string[];
  websiteAccess: boolean;
}

async function admin<T>(path: string, body?: unknown): Promise<T | null> {
  const response = await fetch(`${adminUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Garage admin ${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function ensureBucket(name: string): Promise<BucketInfo> {
  let info = await admin<BucketInfo>(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(name)}`);
  if (!info) {
    info = await admin<BucketInfo>('/v2/CreateBucket', { globalAlias: name });
    console.log(`  [storage] ${name}: created`);
  }
  await admin('/v2/AllowBucketKey', {
    bucketId: info!.id,
    accessKeyId: config.s3.accessKeyId,
    permissions: { read: true, write: true, owner: false },
  });
  return info!;
}

async function main() {
  if (!adminUrl || !adminToken) {
    throw new Error('Set GARAGE_ADMIN_URL and GARAGE_ADMIN_TOKEN (the server’s Garage admin API).');
  }

  for (const name of [BUCKETS.idDocuments, BUCKETS.buyInForms]) {
    const info = await ensureBucket(name);
    // Never public — if one ever was, close it.
    if (info.websiteAccess) {
      await admin(`/v2/UpdateBucket?id=${info.id}`, { websiteAccess: { enabled: false } });
      console.log(`  [storage] ${name}: public reads turned OFF`);
    }
  }

  const images = await ensureBucket(BUCKETS.productImages);
  if (!images.websiteAccess) {
    await admin(`/v2/UpdateBucket?id=${images.id}`, {
      websiteAccess: { enabled: true, indexDocument: 'index.html' },
    });
    console.log(`  [storage] ${BUCKETS.productImages}: public reads on`);
  }
  if (!images.globalAliases.includes(publicHost)) {
    await admin('/v2/AddBucketAlias', { bucketId: images.id, globalAlias: publicHost });
  }
  console.log(`  [storage] photos served at ${config.storagePublicUrl}/<key>`);
}

main().catch((err) => {
  console.error('[storage] setup failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
