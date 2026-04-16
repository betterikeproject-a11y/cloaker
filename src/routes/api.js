const express = require('express');
const db = require('../db');

const router = express.Router();

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Stats ────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const row = db.prepare(`
    SELECT
      COUNT(*)                          AS total,
      SUM(CASE WHEN approved=1 THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN approved=0 THEN 1 ELSE 0 END) AS blocked
    FROM requests
    WHERE created_at >= ?
  `).get(today + ' 00:00:00');

  const total = row.total || 0;
  const approved = row.approved || 0;
  const blocked = row.blocked || 0;
  const rate = total > 0 ? ((approved / total) * 100).toFixed(1) : '0.0';

  res.json({ total, approved, blocked, approval_rate: rate });
});

// ── Campaigns ────────────────────────────────────────────────────────────────

router.get('/campaigns', (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  const parsed = campaigns.map(c => ({ ...c, filters: JSON.parse(c.filters || '{}') }));
  res.json(parsed);
});

router.get('/campaigns/:id', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ...campaign, filters: JSON.parse(campaign.filters || '{}') });
});

router.post('/campaigns', (req, res) => {
  const { name, network, slug: rawSlug, status, safe_url, offer_url, filters } = req.body;

  if (!name || !safe_url || !offer_url) {
    return res.status(400).json({ error: 'name, safe_url and offer_url are required' });
  }

  const slug = rawSlug ? slugify(rawSlug) : slugify(name);
  if (!slug) return res.status(400).json({ error: 'Invalid slug' });

  const existing = db.prepare('SELECT id FROM campaigns WHERE slug = ?').get(slug);
  if (existing) return res.status(400).json({ error: `Slug "${slug}" is already in use` });

  const filtersJson = JSON.stringify(filters || {});

  try {
    const info = db.prepare(`
      INSERT INTO campaigns (name, network, slug, status, safe_url, offer_url, filters)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      network || 'Other',
      slug,
      status !== undefined ? (status ? 1 : 0) : 1,
      safe_url,
      offer_url,
      filtersJson
    );

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ ...campaign, filters: JSON.parse(campaign.filters) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { name, network, slug: rawSlug, status, safe_url, offer_url, filters } = req.body;

  const slug = rawSlug ? slugify(rawSlug) : campaign.slug;

  // Check slug uniqueness (excluding self)
  if (slug !== campaign.slug) {
    const existing = db.prepare('SELECT id FROM campaigns WHERE slug = ? AND id != ?').get(slug, campaign.id);
    if (existing) return res.status(400).json({ error: `Slug "${slug}" is already in use` });
  }

  const filtersJson = JSON.stringify(filters !== undefined ? filters : JSON.parse(campaign.filters));

  try {
    db.prepare(`
      UPDATE campaigns
      SET name=?, network=?, slug=?, status=?, safe_url=?, offer_url=?, filters=?
      WHERE id=?
    `).run(
      name || campaign.name,
      network || campaign.network,
      slug,
      status !== undefined ? (status ? 1 : 0) : campaign.status,
      safe_url || campaign.safe_url,
      offer_url || campaign.offer_url,
      filtersJson,
      campaign.id
    );

    const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign.id);
    res.json({ ...updated, filters: JSON.parse(updated.filters) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', (req, res) => {
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Requests ─────────────────────────────────────────────────────────────────

router.get('/requests', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const campaignId = req.query.campaign_id;

  let where = '';
  const params = [];

  if (campaignId) {
    where = 'WHERE campaign_id = ?';
    params.push(campaignId);
  }

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM requests ${where}`).get(...params).cnt;

  const rows = db.prepare(
    `SELECT * FROM requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

module.exports = router;
