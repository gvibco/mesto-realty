import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
import { requireAdmin, notFound } from "./security.js";
import { parse, id } from "./validation.js";
import { CONTENT_FIELDS, DEFAULT_CONTENT } from "./content-fields.js";

const contentKeys = CONTENT_FIELDS.map((field) => field.key);
const contentSchema = z
  .object(
    Object.fromEntries(
      CONTENT_FIELDS.map((field) => [
        field.key,
        z
          .string()
          .trim()
          .min(
            field.min ?? 1,
            `${field.label}: минимум ${field.min ?? 1} символов`,
          )
          .max(field.max, `${field.label}: максимум ${field.max} символов`),
      ]),
    ),
  )
  .strict();
const userPatchSchema = z
  .object({
    blocked: z.boolean().optional(),
    admin: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.blocked !== undefined || data.admin !== undefined, {
    message: "Нет изменений",
  });
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
        `SELECT u.id,u.name,u.email,u.company,u.business_role,u.is_blocked,u.is_admin,u.created_at,
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
        admin:
          r.is_admin ||
          (!!config.adminEmail && r.email.toLowerCase() === config.adminEmail),
        bootstrap:
          !!config.adminEmail && r.email.toLowerCase() === config.adminEmail,
        createdAt: r.created_at,
        propertyCount: r.property_count,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const data = parse(userPatchSchema, req.body);
    const userId = id(req.params.id);
    const row = (
      await pool.query(
        "SELECT id,email,is_blocked,is_admin FROM users WHERE id=$1",
        [userId],
      )
    ).rows[0];
    if (!row) throw notFound();
    const isSelf = userId === req.session.userId;
    const isBootstrap =
      !!config.adminEmail && row.email.toLowerCase() === config.adminEmail;
    // Все проверки выполняются до записи, чтобы 422 не оставлял частичных
    // изменений.
    if (data.blocked && isSelf)
      return res.status(422).json({ error: "Нельзя заблокировать себя" });
    if (data.blocked && isBootstrap)
      return res
        .status(422)
        .json({ error: "Нельзя заблокировать основного администратора" });
    if (data.admin !== undefined && isSelf)
      return res
        .status(422)
        .json({ error: "Нельзя изменить собственные права админа" });
    if (data.admin === false && isBootstrap)
      return res.status(422).json({
        error: "Нельзя снять права с основного администратора",
      });
    if (data.blocked && !row.is_blocked)
      await pool.query(
        "DELETE FROM sessions WHERE sess::jsonb->>'userId'=$1::text",
        [String(userId)],
      );
    if (data.blocked !== undefined)
      await pool.query("UPDATE users SET is_blocked=$2 WHERE id=$1", [
        userId,
        data.blocked,
      ]);
    if (data.admin !== undefined)
      await pool.query("UPDATE users SET is_admin=$2 WHERE id=$1", [
        userId,
        data.admin,
      ]);
    res.json({
      blocked: data.blocked ?? row.is_blocked,
      admin: data.admin ?? (row.is_admin || isBootstrap),
      bootstrap: isBootstrap,
    });
  });

  router.get("/content", async (req, res) => res.json(await readContent()));

  router.get("/content-fields", (req, res) =>
    res.json(
      CONTENT_FIELDS.map(({ key, group, label, max, min, multiline }) => ({
        key,
        group,
        label,
        max,
        min: min ?? 1,
        multiline: !!multiline,
      })),
    ),
  );

  router.put("/content", async (req, res) => {
    const data = parse(contentSchema, req.body);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO site_settings(key,value)
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [contentKeys, contentKeys.map((key) => data[key])],
      );
    });
    res.json(await readContent());
  });

  return router;
}
