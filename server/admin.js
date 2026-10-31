import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { requireAdmin, notFound } from "./security.js";
import { parse, id } from "./validation.js";

export const DEFAULT_CONTENT = {
  heroTitle:
    "Подберём помещение под ваш бизнес за 48 часов — платите только 1% при покупке",
  heroText:
    "Офисы, склады и торговые площади напрямую от собственников. Размещение и аренда — бесплатно, комиссия 1% — только когда сделка продажи состоялась.",
  commissionTitle: "Как мы зарабатываем",
  commissionText:
    "Комиссия сервиса — 1% только с успешной продажи объекта. Размещение объявлений и аренда — бесплатно.",
};
const contentKeys = Object.keys(DEFAULT_CONTENT);
const contentSchema = z
  .object({
    heroTitle: z
      .string()
      .trim()
      .min(5, "Заголовок: минимум 5 символов")
      .max(300, "Заголовок: максимум 300 символов"),
    heroText: z
      .string()
      .trim()
      .min(10, "Подзаголовок: минимум 10 символов")
      .max(1000, "Подзаголовок: максимум 1000 символов"),
    commissionTitle: z
      .string()
      .trim()
      .min(3, "Название блока: минимум 3 символа")
      .max(300, "Название блока: максимум 300 символов"),
    commissionText: z
      .string()
      .trim()
      .min(10, "Текст блока: минимум 10 символов")
      .max(1000, "Текст блока: максимум 1000 символов"),
  })
  .strict();
const blockedSchema = z.object({ blocked: z.boolean() }).strict();
const statuses = new Set(["draft", "published", "archived"]);
const deals = new Set(["sale", "rent"]);
const pageParams = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(query.limit) || 12));
  return { page, limit, offset: (page - 1) * limit };
};

async function readContent() {
  const rows = (
    await pool.query(
      "SELECT key,value FROM site_settings WHERE key = ANY($1::text[])",
      [contentKeys],
    )
  ).rows;
  const content = { ...DEFAULT_CONTENT };
  for (const row of rows) content[row.key] = row.value;
  return content;
}

// Публичные тексты главной — без авторизации.
export function contentRouter() {
  const router = Router();
  router.get("/content", async (req, res) => res.json(await readContent()));
  return router;
}

export function adminRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get("/stats", async (req, res) => {
    const row = (
      await pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE is_blocked) AS blocked_users,
        (SELECT count(*)::int FROM properties) AS properties,
        (SELECT count(*)::int FROM properties WHERE status='published') AS published,
        (SELECT count(*)::int FROM properties WHERE status='draft') AS drafts,
        (SELECT count(*)::int FROM properties WHERE status='archived') AS archived,
        (SELECT count(*)::int FROM properties WHERE deal='sale') AS sale,
        (SELECT count(*)::int FROM properties WHERE deal='rent') AS rent`)
    ).rows[0];
    res.json({
      users: row.users,
      blockedUsers: row.blocked_users,
      properties: row.properties,
      published: row.published,
      drafts: row.drafts,
      archived: row.archived,
      sale: row.sale,
      rent: row.rent,
    });
  });

  router.get("/properties", async (req, res) => {
    const { page, limit, offset } = pageParams(req.query);
    const q =
      typeof req.query.q === "string" && req.query.q.trim()
        ? req.query.q.trim()
        : null;
    const status = statuses.has(req.query.status) ? req.query.status : null;
    const deal = deals.has(req.query.deal) ? req.query.deal : null;
    const where = `WHERE ($1::text IS NULL OR p.title ILIKE '%'||$1||'%' OR p.city ILIKE '%'||$1||'%' OR p.address ILIKE '%'||$1||'%') AND ($2::text IS NULL OR p.status=$2) AND ($3::text IS NULL OR p.deal=$3)`;
    const params = [q, status, deal];
    const total = Number(
      (await pool.query(`SELECT count(*) FROM properties p ${where}`, params))
        .rows[0].count,
    );
    const rows = (
      await pool.query(
        `SELECT p.id,p.title,p.deal,p.category,p.city,p.price,p.area,p.status,p.created_at,u.name AS owner_name,u.company AS owner_company,u.email AS owner_email
         FROM properties p JOIN users u ON u.id=p.owner_id
         ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5`,
        [...params, limit, offset],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        deal: r.deal,
        category: r.category,
        city: r.city,
        price: r.price,
        area: r.area,
        status: r.status,
        createdAt: r.created_at,
        ownerName: r.owner_name,
        ownerCompany: r.owner_company,
        ownerEmail: r.owner_email,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.get("/users", async (req, res) => {
    const { page, limit, offset } = pageParams(req.query);
    const total = Number(
      (await pool.query("SELECT count(*) FROM users")).rows[0].count,
    );
    const rows = (
      await pool.query(
        `SELECT u.id,u.name,u.email,u.company,u.business_role,u.is_blocked,u.created_at,
          (SELECT count(*)::int FROM properties p WHERE p.owner_id=u.id) AS property_count
         FROM users u ORDER BY u.created_at DESC,u.id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        company: r.company,
        businessRole: r.business_role,
        blocked: r.is_blocked,
        createdAt: r.created_at,
        propertyCount: r.property_count,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const data = parse(blockedSchema, req.body);
    const userId = id(req.params.id);
    if (userId === req.session.userId)
      return res.status(422).json({ error: "Нельзя заблокировать себя" });
    const row = (
      await pool.query("SELECT id,is_blocked FROM users WHERE id=$1", [userId])
    ).rows[0];
    if (!row) throw notFound();
    if (data.blocked && !row.is_blocked)
      await pool.query(
        "DELETE FROM sessions WHERE sess::jsonb->>'userId'=$1::text",
        [String(userId)],
      );
    await pool.query("UPDATE users SET is_blocked=$2 WHERE id=$1", [
      userId,
      data.blocked,
    ]);
    res.json({ blocked: data.blocked });
  });

  router.get("/content", async (req, res) => res.json(await readContent()));

  router.put("/content", async (req, res) => {
    const data = parse(contentSchema, req.body);
    for (const key of contentKeys)
      await pool.query(
        "INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()",
        [key, data[key]],
      );
    res.json(await readContent());
  });

  return router;
}
