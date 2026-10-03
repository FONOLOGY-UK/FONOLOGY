import { attempt, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { cardLimitCheckBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { writeShop } from '../../lib/shopScope.js';

export const posCardLimitsRouter = createRouter();
const router = posCardLimitsRouter;

/* ---------------------------------------------------------------------- */
/* Card machine limits (change request item 5)                              */
/* ---------------------------------------------------------------------- */

/**
 * Would taking this much on this machine breach a limit?
 *
 * Asks the database the same question its own trigger asks, through the same
 * `card_limit_breach()` function, so the sentence the till shows before the
 * card is run is word-for-word the one the write would have raised. Two
 * differently-worded refusals for one rule is how staff learn to distrust
 * both of them.
 */
router.post(
  '/card-limits/check',
  requireStaff,
  requirePermission('pos.operate'),
  async (req, res) => {
    const parsed = cardLimitCheckBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const shopId = await writeShop(req, res);
    if (!shopId) return;

    const { data, error } = await attempt(() =>
      rpc<string | null>('card_limit_breach', {
        p_shop_id: shopId,
        p_tender: parsed.data.tender,
        p_amount: parsed.data.amount,
      }),
    );
    if (error) return res.status(500).json({ error: 'Could not check the card limit.' });

    const message = data ?? null;
    return res.json({ allowed: message === null, message });
  },
);
