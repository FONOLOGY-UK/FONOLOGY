import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { labelTemplateBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { deletedCount } from './helpers.js';

export const adminLabelsRouter = createRouter();
const router = adminLabelsRouter;

/* ---------------------------------------------------------------------- */
/* Label templates — the label designer's saveable shelf/price labels       */
/* ---------------------------------------------------------------------- */
// Table from 0009_settings.sql — these are the label designer's routes.

function toApiLabelTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    lines: row.lines,
    barcode: row.barcode_value,
    updatedAt: row.updated_at,
  };
}

router.get('/labels', requireStaff, requirePermission('labels.manage'), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db.selectFrom('label_templates').selectAll().orderBy('updated_at', 'desc').execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load label templates.' });
  return res.json(data.map(toApiLabelTemplate));
});

router.post('/labels', requireStaff, requirePermission('labels.manage'), async (req, res) => {
  const parsed = labelTemplateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('label_templates')
      .values({
        name: body.name,
        // jsonb array — sent as JSON text (see the settings PATCH above).
        lines: JSON.stringify(body.lines),
        barcode_value: body.barcode,
        created_by: req.user!.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiLabelTemplate(row));
});

router.put('/labels/:id', requireStaff, requirePermission('labels.manage'), async (req, res) => {
  const parsed = labelTemplateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .updateTable('label_templates')
      .set({ name: body.name, lines: JSON.stringify(body.lines), barcode_value: body.barcode })
      .where('id', '=', req.params.id ?? '')
      .returningAll()
      .executeTakeFirst(),
  );
  if (error) return res.status(400).json({ error: error.message });
  if (!row)
    return res.status(404).json({ error: 'Template not found — it may have been deleted.' });
  return res.json(toApiLabelTemplate(row));
});

router.delete('/labels/:id', requireStaff, requirePermission('labels.manage'), async (req, res) => {
  const { data: deleted, error } = await attempt(() =>
    db
      .deleteFrom('label_templates')
      .where('id', '=', req.params.id ?? '')
      .execute(),
  );
  if (error) return res.status(400).json({ error: error.message });
  if (!deletedCount(deleted))
    return res.status(404).json({ error: 'Template not found — it may already be deleted.' });
  return res.status(204).end();
});
