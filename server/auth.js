import { Router } from "express";
import bcrypt from "bcrypt";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";
import { config } from "./config.js";
import { loginSchema, registrationSchema, parse } from "./validation.js";
import { newToken, startSession } from "./security.js";

export const userColumns =
  "id, name, email, phone, bio, avatar_filename, company, business_role, is_blocked";
const asAdmin = (email) =>
  !!config.adminEmail && String(email).toLowerCase() === config.adminEmail;
export function privateUser(row) {
  return row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        bio: row.bio,
        company: row.company,
        businessRole: row.business_role,
        avatar: row.avatar_filename ? `/media/${row.avatar_filename}` : null,
      }
    : null;
}
const dummyHash = await bcrypt.hash("not-a-valid-user-password", 12);
export function authRouter() {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Слишком много попыток. Попробуйте через 15 минут." },
  });
  router.get("/session", async (req, res) => {
    req.session.csrfToken ||= newToken();
    const user = req.session.userId
      ? (
          await pool.query(`SELECT ${userColumns} FROM users WHERE id=$1`, [
            req.session.userId,
          ])
        ).rows[0]
      : null;
    if (!user || user.is_blocked) {
      // Сессия заблокированного/удалённого пользователя уничтожается:
      // regenerate удаляет старую запись из стора и выдаёт новый id.
      if (req.session.userId) {
        await new Promise((resolve, reject) =>
          req.session.regenerate((err) => (err ? reject(err) : resolve())),
        );
      }
      req.session.csrfToken ||= newToken();
      return res.json({
        user: null,
        isAdmin: false,
        csrfToken: req.session.csrfToken,
      });
    }
    res.json({
      user: privateUser(user),
      isAdmin: asAdmin(user.email),
      csrfToken: req.session.csrfToken,
    });
  });
  router.post("/register", limiter, async (req, res) => {
    const data = parse(registrationSchema, req.body);
    const hash = await bcrypt.hash(data.password, 12);
    let row;
    try {
      row = (
        await pool.query(
          `INSERT INTO users(name,email,password_hash,company,business_role) VALUES($1,$2,$3,$4,$5) RETURNING ${userColumns}`,
          [data.name, data.email, hash, data.company, data.businessRole],
        )
      ).rows[0];
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({
          error: "Этот email уже зарегистрирован",
          fields: { email: "Этот email уже зарегистрирован" },
        });
      throw err;
    }
    await startSession(req, row.id);
    res.status(201).json({
      user: privateUser(row),
      isAdmin: asAdmin(row.email),
      csrfToken: req.session.csrfToken,
    });
  });
  router.post("/login", limiter, async (req, res) => {
    const data = parse(loginSchema, req.body);
    const row = (
      await pool.query(
        `SELECT ${userColumns},password_hash FROM users WHERE email=$1`,
        [data.email],
      )
    ).rows[0];
    const valid = await bcrypt.compare(
      data.password,
      row?.password_hash || dummyHash,
    );
    if (!valid || !row)
      return res.status(401).json({ error: "Неверный email или пароль" });
    if (row.is_blocked)
      return res.status(403).json({ error: "Аккаунт заблокирован" });
    await startSession(req, row.id);
    res.json({
      user: privateUser(row),
      isAdmin: asAdmin(row.email),
      csrfToken: req.session.csrfToken,
    });
  });
  router.post("/logout", async (req, res) => {
    await new Promise((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    res.clearCookie("mesto.sid", { path: "/" });
    res.sendStatus(204);
  });
  return router;
}
