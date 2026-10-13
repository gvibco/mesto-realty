import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
export const architectureDir = path.join(config.uploadDir, "architecture");
export const plansDir = path.join(config.uploadDir, "plans");
export async function ensureArchitecturalDirectories() {
  await Promise.all([
    mkdir(architectureDir, { recursive: true }),
    mkdir(plansDir, { recursive: true }),
  ]);
}
export async function removeArchitecturalFiles({ models = [], plans = [] }) {
  for (const [directory, names, pattern] of [
    [architectureDir, models, /^[a-f0-9-]{36}\.json$/],
    [plansDir, plans, /^[a-f0-9-]{36}\.webp$/],
  ])
    for (const name of names.filter(Boolean)) {
      if (!pattern.test(name)) continue;
      try {
        await unlink(path.join(directory, name));
      } catch (error) {
        if (error.code !== "ENOENT")
          console.error("Architecture cleanup failed:", error.code);
      }
    }
}
// Call with the property row already locked, in the photo/input transaction.
export async function queueArchitecturalModel(client, propertyId) {
  const p = (
    await client.query("SELECT category FROM properties WHERE id=$1", [
      propertyId,
    ])
  ).rows[0];
  const input = (
    await client.query(
      "SELECT * FROM architectural_inputs WHERE property_id=$1",
      [propertyId],
    )
  ).rows[0];
  const images = (
    await client.query(
      "SELECT id FROM property_images WHERE property_id=$1 ORDER BY position,id",
      [propertyId],
    )
  ).rows.map((row) => row.id);
  const ready =
    p?.category !== "commercial_land" &&
    input?.plan_filename &&
    input.width &&
    input.depth &&
    input.height;
  const dimensions =
    input?.width && input.depth && input.height
      ? JSON.stringify({
          width: input.width,
          depth: input.depth,
          height: input.height,
        })
      : null;
  await client.query(
    `INSERT INTO architectural_models(property_id,state,image_ids,plan_filename,dimensions,available_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second') ON CONFLICT(property_id) DO UPDATE SET revision=architectural_models.revision+1,state=EXCLUDED.state,image_ids=EXCLUDED.image_ids,plan_filename=EXCLUDED.plan_filename,dimensions=EXCLUDED.dimensions,available_at=EXCLUDED.available_at,attempts=0,lease_token=NULL,lease_until=NULL,started_at=NULL,previous_filename=COALESCE(architectural_models.filename,architectural_models.previous_filename),filename=NULL,error_code=NULL,warnings='[]',updated_at=now()`,
    [
      propertyId,
      ready ? "queued" : "needs_inputs",
      images,
      input?.plan_filename || null,
      dimensions,
      config.roomModel.debounceSeconds,
    ],
  );
}
