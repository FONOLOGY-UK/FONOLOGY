import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

/**
 * File storage — S3-compatible (Garage), replacing Supabase Storage. This
 * API is the only thing holding the key; browsers get either a public URL
 * (product photos) or a short-lived signed link (everything else).
 *
 *   product-images  public reads, through the bucket's website endpoint
 *                   (STORAGE_PUBLIC_URL) — photos on the shop
 *   id-documents    private — number-plate V5C / driving licence
 *   buy-in-forms    private — signed supplier buy-in forms
 *
 * scripts/storage-setup.ts creates the three and turns on website access for
 * product-images only.
 */

export const BUCKETS = {
  productImages: 'product-images',
  idDocuments: 'id-documents',
  buyInForms: 'buy-in-forms',
} as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

function client(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    // Garage serves buckets by path (http://host:3900/<bucket>/<key>), not by
    // DNS-style bucket subdomains.
    forcePathStyle: true,
  });
}

export const s3 = client(config.s3.endpoint);
// Signed links are opened by a browser, so they must name the host a browser
// can reach. Same credentials; signing is local, nothing is sent from here.
const signer =
  config.s3.publicEndpoint === config.s3.endpoint ? s3 : client(config.s3.publicEndpoint);

export async function putObject(
  bucket: Bucket,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Deleting an object that isn't there succeeds, as S3 defines it. */
export async function deleteObject(bucket: Bucket, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function objectExists(bucket: Bucket, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Every object under a prefix, with when it was written. */
export async function listObjects(
  bucket: Bucket,
  prefix: string,
): Promise<{ key: string; lastModified: Date | null }[]> {
  const out: { key: string; lastModified: Date | null }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) out.push({ key: object.Key, lastModified: object.LastModified ?? null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** A link that opens one private file for `seconds`, then stops working. */
export function signedGetUrl(bucket: Bucket, key: string, seconds: number): Promise<string> {
  return getSignedUrl(signer, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: seconds,
  });
}

/** The public URL of a product photo. */
export function publicImageUrl(key: string): string {
  return `${config.storagePublicUrl}/${key}`;
}
