import { Router } from "express";
import { pool } from "./db.js";

const VALID_TARIFFS = new Set(["Базовый", "Бизнес", "Премиум"]);

export function subscriptionsRouter() {
  const router = Router();

  router.post("/subscriptions", async (req, res) => {
    const { name, phone, email, tariff } = req.body ?? {};

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 80
    )
      return res
        .status(422)
        .json({ error: "Введите корректное имя (2–80 символов)" });

    if (
      typeof phone !== "string" ||
      phone.trim().length < 5 ||
      phone.trim().length > 30
    )
      return res
        .status(422)
        .json({ error: "Введите корректный номер телефона" });

    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      return res
        .status(422)
        .json({ error: "Введите корректный адрес электронной почты" });

    if (!VALID_TARIFFS.has(tariff))
      return res.status(422).json({ error: "Некорректный тариф" });

    await pool.query(
      "INSERT INTO subscription_requests(name, phone, email, tariff) VALUES($1,$2,$3,$4)",
      [name.trim(), phone.trim(), email.trim(), tariff],
    );

    res.json({ ok: true });
  });

  return router;
}
