import type { Request, Response } from 'express';
import { attempt, db } from '../../lib/db.js';
import type { JobStatus } from '../../db/types.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { smsTemplateBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { SMS_PLACEHOLDERS, unknownPlaceholders } from '../../lib/jobSms.js';
import { config } from '../../config.js';

export const adminNotificationsRouter = createRouter();
const router = adminNotificationsRouter;

/* ---------------------------------------------------------------------- */
/* Notifications — the repair-stage texts (0105)                            */
/* ---------------------------------------------------------------------- */
// One text per job stage. Each shop can have its own wording for any stage; a stage it hasn't
// changed uses the default. With the shop switcher on a shop you edit that shop's texts (a
// manager only ever their own); with it on "All shops" you edit the defaults, which only the
// owner may change. settings.manage, the same gate as the rest of a shop's set-up.

const STAGES: JobStatus[] = [
  'new',
  'in_progress',
  'waiting_approval',
  'done',
  'sent_back',
  'collected',
  'cancelled',
];

function isStage(value: unknown): value is JobStatus {
  return typeof value === 'string' && (STAGES as string[]).includes(value);
}

async function screen(shopId: string | null) {
  const [rows, shop] = await Promise.all([
    db
      .selectFrom('job_sms_templates')
      .select(['shop_id', 'status', 'enabled', 'body', 'updated_at'])
      .where((eb) =>
        shopId
          ? eb.or([eb('shop_id', '=', shopId), eb('shop_id', 'is', null)])
          : eb('shop_id', 'is', null),
      )
      .execute(),
    shopId
      ? db.selectFrom('shops').select(['id', 'name']).where('id', '=', shopId).executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  return {
    scope: shopId ? ('shop' as const) : ('default' as const),
    shopId: shop?.id ?? null,
    shopName: shop?.name ?? null,
    // What the API will actually do with a text right now, so the screen can say so.
    smsMode: config.smsMode,
    placeholders: [...SMS_PLACEHOLDERS],
    templates: STAGES.map((status) => {
      const own = shopId
        ? rows.find((r) => r.shop_id === shopId && r.status === status)
        : undefined;
      const fallback = rows.find((r) => r.shop_id === null && r.status === status);
      const row = own ?? fallback;
      return {
        status,
        enabled: row?.enabled ?? false,
        body: row?.body ?? '',
        source: own ? ('shop' as const) : ('default' as const),
        updatedAt: row?.updated_at ?? null,
      };
    }),
  };
}

/** The shop being edited, or null for the defaults. Sends the refusal itself when not allowed. */
async function targetShop(req: Request, res: Response): Promise<string | null | undefined> {
  if (req.query.scope === 'default' || readShop(req) === null) {
    if (req.user!.staffRole !== 'owner') {
      res
        .status(403)
        .json({ error: 'Only the owner can change the default texts every shop uses.' });
      return undefined;
    }
    return null;
  }
  const shopId = await writeShop(req, res);
  return shopId ?? undefined;
}

router.get(
  '/notifications/sms',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const shopId = req.query.scope === 'default' ? null : readShop(req);
    return res.json(await screen(shopId));
  },
);

router.put(
  '/notifications/sms/:status',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const status = req.params.status;
    if (!isStage(status)) return res.status(404).json({ error: 'Unknown job stage.' });
    const parsed = smsTemplateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const unknown = unknownPlaceholders(parsed.data.body);
    if (unknown.length > 0) {
      return res.status(400).json({
        error: `Unknown placeholder ${unknown.map((u) => `{${u}}`).join(', ')}. Use one of: ${SMS_PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}.`,
      });
    }
    const shopId = await targetShop(req, res);
    if (shopId === undefined) return;

    const { error } = await attempt(() =>
      db
        .insertInto('job_sms_templates')
        .values({
          shop_id: shopId,
          status,
          enabled: parsed.data.enabled,
          body: parsed.data.body,
          updated_by: req.user!.id,
        })
        .onConflict((oc) =>
          oc.constraint('job_sms_templates_shop_status_unique').doUpdateSet({
            enabled: parsed.data.enabled,
            body: parsed.data.body,
            updated_by: req.user!.id,
          }),
        )
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    return res.json(await screen(shopId));
  },
);

/** A shop goes back to the default text for a stage. */
router.delete(
  '/notifications/sms/:status',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const status = req.params.status;
    if (!isStage(status)) return res.status(404).json({ error: 'Unknown job stage.' });
    if (req.query.scope === 'default' || readShop(req) === null) {
      return res.status(400).json({ error: 'The default text can be edited, not removed.' });
    }
    const shopId = await writeShop(req, res);
    if (!shopId) return;
    await db
      .deleteFrom('job_sms_templates')
      .where('shop_id', '=', shopId)
      .where('status', '=', status)
      .execute();
    return res.json(await screen(shopId));
  },
);
