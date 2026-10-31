import { randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { pool } from "./db.js";

export const newToken = () => randomBytes(32).toString("hex");
export function requireAuth(req, res, next) {
  if (!req.session.userId)
    return res
      .status(401)
      .json({ error: "Войдите в аккаунт, чтобы продолжить" });
  next();
}
export function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== config.origin)
    return res.status(403).json({ error: "Недопустимый источник запроса" });
  const supplied = req.get("X-CSRF-Token");
  const expected = req.session.csrfToken;
  if (
    !supplied ||
    !expected ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return res.status(403).json({
      error: "Сессия формы истекла. Обновите страницу и повторите действие.",
    });
  }
  next();
}
export async function startSession(req, userId) {
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
  req.session.userId = userId;
  req.session.csrfToken = newToken();
  await new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
}
export const notFound = () =>
  Object.assign(new Error("Объект не найден"), { status: 404 });
export async function isAdminUser(userId) {
  if (!userId || !config.adminEmail) return false;
  const row = (
    await pool.query("SELECT email FROM users WHERE id=$1", [userId])
  ).rows[0];
  return !!row && row.email.toLowerCase() === config.adminEmail;
}
export async function requireAdmin(req, res, next) {
  if (!req.session.userId)
    return res
      .status(401)
      .json({ error: "Войдите в аккаунт, чтобы продолжить" });
  if (!(await isAdminUser(req.session.userId)))
    return res.status(403).json({ error: "Недостаточно прав" });
  next();
}
