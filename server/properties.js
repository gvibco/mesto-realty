import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool, transaction } from "./db.js";
import { requireAuth, notFound, isAdminUser } from "./security.js";
import { id, parse, propertySchema, searchSchema } from "./validation.js";
import {
  publicColumns,
  imageColumns,
  propertyView,
  imageView,
  listProperties,
} from "./property-data.js";
import { removeFiles } from "./uploads.js";
import { queueRoomModel, removeModelFiles } from "./room-models.js";
import { removeArchitecturalFiles } from "./architectural-store.js";

const propertyKeys = [
  "title",
  "deal",
  "category",
  "city",
  "district",
  "address",
  "price",
  "area",
  "buildingClass",
  "floor",
  "ceilingHeight",
  "powerKw",
  "parking",
  "tax",
  "description",
  "contactName",
  "contactPhone",
  "status",
];
const sqlKeys = [
  "title",
  "deal",
  "category",
  "city",
  "district",
  "address",
  "price",
  "area",
  "building_class",
  "floor",
  "ceiling_height",
  "power_kw",
  "parking",
  "tax",
  "description",
  "contact_name",
  "contact_phone",
  "status",
];
export async function owned(client, propertyId, userId, admin = false) {
  const row = (
    await client.query(
      admin
        ? "SELECT * FROM properties WHERE id=$1 FOR UPDATE"
        : "SELECT * FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      admin ? [propertyId] : [propertyId, userId],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}
export function propertiesRouter() {
  const router = Router();
  router.get("/properties", async (req, res) =>
    res.json(
      await listProperties(parse(searchSchema, req.query), req.session.userId),
    ),
  );
  router.get("/me/properties", requireAuth, async (req, res) =>
    res.json(
      await listProperties(
        parse(searchSchema, req.query),
        req.session.userId,
        "own",
      ),
    ),
  );
  router.get("/favorites", requireAuth, async (req, res) =>
    res.json(
      await listProperties(
        parse(searchSchema, req.query),
        req.session.userId,
        "favorites",
      ),
    ),
  );
  router.post("/favorites/:id", requireAuth, async (req, res) => {
    const result = await pool.query(
      `INSERT INTO favorites(user_id,property_id) SELECT $1,id FROM properties WHERE id=$2 AND status='published' ON CONFLICT DO NOTHING RETURNING property_id`,
      [req.session.userId, id(req.params.id)],
    );
    if (
      !result.rowCount &&
      !(
        await pool.query(
          "SELECT 1 FROM properties WHERE id=$1 AND status='published'",
          [id(req.params.id)],
        )
      ).rowCount
    )
      throw notFound();
    res.status(201).json({ isFavorite: true });
  });
  router.delete("/favorites/:id", requireAuth, async (req, res) => {
    await pool.query(
      "DELETE FROM favorites WHERE user_id=$1 AND property_id=$2",
      [req.session.userId, id(req.params.id)],
    );
    res.sendStatus(204);
  });
  const contactLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Слишком много запросов контактов. Подождите минуту." },
  });
  router.get("/properties/:id/contact", contactLimit, async (req, res) => {
    const admin = await isAdminUser(req.session.userId);
    const row = (
      await pool.query(
        "SELECT contact_phone,contact_name FROM properties WHERE id=$1 AND ($3 OR status='published' OR owner_id=$2)",
        [id(req.params.id), req.session.userId || null, admin],
      )
    ).rows[0];
    if (!row) throw notFound();
    res.json({ phone: row.contact_phone, contactName: row.contact_name });
  });
  router.get("/properties/:id", async (req, res) => {
    const admin = await isAdminUser(req.session.userId);
    const row = (
      await pool.query(
        `SELECT ${publicColumns},${imageColumns},EXISTS(SELECT 1 FROM favorites WHERE property_id=p.id AND user_id=$2) AS is_favorite FROM properties p WHERE p.id=$1 AND ($3 OR p.status='published' OR p.owner_id=$2)`,
        [id(req.params.id), req.session.userId || null, admin],
      )
    ).rows[0];
    if (!row) throw notFound();
    if (admin || row.owner_id === req.session.userId)
      row.contact_phone = (
        await pool.query("SELECT contact_phone FROM properties WHERE id=$1", [
          row.id,
        ])
      ).rows[0].contact_phone;
    const owner = (
      await pool.query(
        "SELECT id,name,bio,avatar_filename,company,business_role FROM users WHERE id=$1",
        [row.owner_id],
      )
    ).rows[0];
    const images = (
      await pool.query(
        "SELECT id,filename,position FROM property_images WHERE property_id=$1 ORDER BY position,id",
        [row.id],
      )
    ).rows.map(imageView);
    const others = (
      await pool.query(
        `SELECT ${publicColumns},${imageColumns},EXISTS(SELECT 1 FROM favorites f WHERE f.property_id=p.id AND f.user_id=$3) AS is_favorite FROM properties p WHERE p.owner_id=$1 AND p.id<>$2 AND p.status='published' ORDER BY p.created_at DESC,p.id DESC LIMIT 3`,
        [row.owner_id, row.id, req.session.userId || null],
      )
    ).rows.map(propertyView);
    res.json({
      property: propertyView(row),
      owner: {
        id: owner.id,
        name: owner.name,
        company: owner.company,
        businessRole: owner.business_role,
        bio: owner.bio,
        avatar: owner.avatar_filename
          ? `/media/${owner.avatar_filename}`
          : null,
      },
      images,
      otherProperties: others,
    });
  });
  router.post("/properties", requireAuth, async (req, res) => {
    const data = parse(propertySchema, req.body);
    if (data.status === "published")
      return res.status(422).json({
        error: "Сначала сохраните черновик и загрузите хотя бы одну фотографию",
        fields: { images: "Добавьте фотографию" },
      });
    const values = [req.session.userId, ...propertyKeys.map((k) => data[k])];
    const row = (
      await pool.query(
        `INSERT INTO properties(owner_id,${sqlKeys.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        values,
      )
    ).rows[0];
    res.status(201).json({ property: propertyView(row) });
  });
  router.patch("/properties/:id", requireAuth, async (req, res) => {
    let oldModel;
    const admin = await isAdminUser(req.session.userId);
    const row = await transaction(async (client) => {
      const current = await owned(
        client,
        id(req.params.id),
        req.session.userId,
        admin,
      );
      const data = parse(propertySchema, {
        ...propertyView(current),
        ...req.body,
      });
      if (
        data.status === "published" &&
        !(
          await client.query(
            "SELECT 1 FROM property_images WHERE property_id=$1 LIMIT 1",
            [current.id],
          )
        ).rowCount
      ) {
        throw Object.assign(
          new Error("Для публикации добавьте хотя бы одну фотографию"),
          { status: 422, fields: { images: "Добавьте фотографию" } },
        );
      }
      const values = propertyKeys.map((k) => data[k]);
      values.push(current.id);
      const updated = (
        await client.query(
          `UPDATE properties SET ${sqlKeys.map((k, i) => `${k}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${values.length} RETURNING *`,
          values,
        )
      ).rows[0];
      if (data.category !== current.category)
        oldModel = await queueRoomModel(client, current.id);
      return updated;
    });
    await removeModelFiles([oldModel]);
    res.json({ property: propertyView(row) });
  });
  router.delete("/properties/:id", requireAuth, async (req, res) => {
    let modelFile;
    let architecturalFiles;
    const admin = await isAdminUser(req.session.userId);
    const files = await transaction(async (client) => {
      const current = await owned(
        client,
        id(req.params.id),
        req.session.userId,
        admin,
      );
      const images = (
        await client.query(
          "SELECT filename FROM property_images WHERE property_id=$1",
          [current.id],
        )
      ).rows;
      modelFile = (
        await client.query(
          "SELECT filename FROM property_models WHERE property_id=$1 FOR UPDATE",
          [current.id],
        )
      ).rows[0]?.filename;
      const architectural = (
        await client.query(
          "SELECT filename,previous_filename FROM architectural_models WHERE property_id=$1 FOR UPDATE",
          [current.id],
        )
      ).rows[0];
      const plan = (
        await client.query(
          "SELECT plan_filename FROM architectural_inputs WHERE property_id=$1",
          [current.id],
        )
      ).rows[0];
      architecturalFiles = {
        models: [architectural?.filename, architectural?.previous_filename],
        plans: [plan?.plan_filename],
      };
      await client.query("DELETE FROM properties WHERE id=$1", [current.id]);
      return images.map((i) => i.filename);
    });
    await removeFiles(files);
    await removeModelFiles([modelFile]);
    await removeArchitecturalFiles(architecturalFiles);
    res.sendStatus(204);
  });
  return router;
}
