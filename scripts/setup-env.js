import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const password = randomBytes(24).toString("hex");
const secret = randomBytes(48).toString("hex");
const content = `NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:3000
POSTGRES_USER=mesto
POSTGRES_PASSWORD=${password}
POSTGRES_DB=mesto
DATABASE_URL=postgresql://mesto:${password}@localhost:54329/mesto
TEST_DATABASE_URL=postgresql://mesto:${password}@localhost:54329/mesto_test
SESSION_SECRET=${secret}
UPLOAD_DIR=./uploads
TRUST_PROXY=0
`;
try {
  await writeFile(new URL("../.env", import.meta.url), content, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Создан .env со случайными локальными секретами. Теперь выполните docker compose up -d db",
  );
} catch (err) {
  if (err.code === "EEXIST")
    console.log(".env уже существует — оставлен без изменений.");
  else throw err;
}
try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "ignore",
  });
  console.log("Git-хуки включены: core.hooksPath = .githooks");
} catch {
  // Не git-репозиторий или git недоступен — настройка не обязательна.
}
