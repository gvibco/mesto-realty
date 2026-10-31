ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings(key,value) VALUES
  ('heroTitle','Подберём помещение под ваш бизнес за 48 часов — платите только 1% при покупке'),
  ('heroText','Офисы, склады и торговые площади напрямую от собственников. Размещение и аренда — бесплатно, комиссия 1% — только когда сделка продажи состоялась.'),
  ('commissionTitle','Как мы зарабатываем'),
  ('commissionText','Комиссия сервиса — 1% только с успешной продажи объекта. Размещение объявлений и аренда — бесплатно.')
ON CONFLICT (key) DO NOTHING;
