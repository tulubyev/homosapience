# WORKLOG — журнал работ по шагам

> Ведётся по ходу сессии. Каждый блок — что сделали, команды, результат, статус прода.

---

## R2 — Risk Engine (пассивный детект ботов/ИИ + статистика атак)

**Статус: в проде, активно.**

Реализовано (коммиты в main):
1. `services/feature_flags.py` — добавлен флаг `STATS_COLLECT`.
2. `services/ip_intel.py` — оффлайн MaxMind GeoLite2-ASN (S1: datacenter ASN), graceful degrade без `.mmdb`.
3. `services/risk_engine.py` — агрегатор S1–S6 → `risk_score ∈ [0,1]` + классификация `human/suspicious/bot/ai_agent` + жёсткие оверрайды.
4. `services/db_service.py` — таблицы `risk_events` + `attack_stats_daily`; `record_risk_event()`, `get_attack_stats()`, `get_attack_stats_by_day()`.
5. `routers/risk.py` — `POST /api/risk/assess`, `GET /api/risk/stats`.
6. `routers/verify.py` — RISK_GATE-гейтированный адаптивный жест (3/8/10с/блок) + STATS_COLLECT запись события.
7. `frontend/src/lib/riskSignals.ts` — клиентские сигналы S2/S3/S4 (webdriver, headless, canvas/audio-аномалии, mouse-entropy).
8. Интеграция `riskSignals` в `verify/page.tsx`.
9. `middleware/firewall.py` — `/api/features`, `/api/risk/assess`, `/api/risk/stats` в публичные пути.

Деплой:
- GeoLite2-ASN.mmdb (~12MB) скачан на сервер в `backend/data/`, проверен (Google/CF/AWS → datacenter).
- `maxminddb` в requirements.txt, контейнер пересобран.

Флаги на проде сейчас: `STATS_COLLECT=true` (копит `risk_events`), `RISK_GATE=false`, `STATS_PAGE=false`.

---

## R1 A+B — Embed API + assertion-токены + org API-ключи

**Статус: в проде, «тёмный» по умолчанию → активирован (EMBED_API=true).**

Дизайн: `docs/superpowers/specs/2026-05-23-r1-embed-api-design.md`
План: `docs/superpowers/plans/2026-05-23-r1-embed-api.md`

Сборка (ветка `r1-embed-api`, 9 задач TDD, влита в main, ветка удалена):
1. pytest-инфра (`backend/tests/`, conftest, pytest.ini, requirements-dev.txt).
2. `services/server_key.py` — серверный Ed25519, JWT EdDSA, JWKS. (6 тестов)
3. `services/api_keys.py` — генерация `pk_live_*`/`sk_live_*`, SHA-256 хеш секрета. (5)
4. `services/db_service.py` — таблицы `api_keys` + `usage_counters` + методы. (5)
5. `services/embed_service.py` — nonce (Redis+fallback), `trust_band`, canonical assert-сообщение. (5)
6. `routers/embed.py` — `challenge`/`assert`/`verify`/`jwks`. (8)
7. `routers/console_keys.py` — CRUD ключей (admin-auth). (4)
8. Подключение в `main.py` за флагом `EMBED_API` + firewall `/api/embed` публичный + env-доки.
9. Полный прогон: **33 теста зелёные**.
- `backend/scripts/embed_smoke.py` — end-to-end smoke (challenge→assert→verify, `--insecure` для macOS).

Деплой и активация (Шаг 4):
- Сгенерирован `APTOGON_JWT_PRIVATE_KEY`, добавлен в `.env`, `FEATURE_EMBED_API=true`.
- Подтверждено: `/api/embed/jwks` отдаёт Ed25519-ключ (`kid 7d45ccaaa757df0b`), `EMBED_API: true`.
- Создан первый org-ключ: `pk_live_3AhexRMGxcZLArWp3fiZ0hwahVSxVdN9` (origin `https://homosapience.org`).
- Проверено против прода: challenge ✓, подпись принимается/отвергается ✓, origin-allowlist ✓, console+admin ✓.
- **Не пройдено:** финальный `verify` с реальным credential — assert вернул 401 (вставленный ключ не дал валидную подпись для DID; вероятно ключ от другого/старого DID, НЕ баг сервера). Перепроверить правильным ключом.

---

## Операционные правки сервера

- **Дубликат `.env`:** обнаружено два файла. Авторитетный — корневой `/var/www/aptogon/.env` (его читает `env_file: .env`), а правили по ошибке `backend/.env`.
  - Перенесли в корневой `.env`: `ADMIN_PASSWORD_HASH`, `GOLD_MEMBER_DIDS`, `NETWORK_START_TS`. `ADMIN_TOKEN` намеренно оставлен за бортом (легаси, есть в бэкапе `~/backend.env.backup-20260523-1101`).
  - `backend/.env` удалён. Теперь конфиг в одном корневом файле.
- **Памятка:** правим ТОЛЬКО `/var/www/aptogon/.env`. Деплой backend: `git pull` → `stop && rm -f api && kill $(lsof -ti:8000) && up -d api` (порт 8000 периодически висит зомби-привязкой).

---

## R1-C — Виджет `aptogon.js` (drop-in для сайтов) — В ПРОЦЕССЕ (брейнсторм)

Зафиксированные решения:
1. Механизм подписи — **hosted popup signer** (ключ остаётся на origin homosapience.org).
2. **Popup** (не iframe) — first-party контекст, обходит storage-partitioning, тихая подпись работает везде.
3. Новый юзер — **жест прямо в попапе** (переиспользуем `GestureCanvas`).
4. API виджета — **оба**: декларативный (`data-aptogon-verify`) + программный (`Aptogon.verify()`).

**Спека:** `docs/superpowers/specs/2026-05-23-r1-widget-design.md` (подтверждена).
**План:** `docs/superpowers/plans/2026-05-23-r1-widget.md` (6 задач).

План R1-C (6 задач):
1. Backend: origin body-first + `/assert` возвращает `trust_band` (для попап-флоу). (pytest, +2 теста)
2. `aptogon.js` — чистые хелперы (`buildSignerUrl`, `isValidMessage`) + Node-тест (UMD-lite).
3. `aptogon.js` — полный loader (verify + декларативная авто-кнопка).
4. `embedSigner.ts` — клиентский хелпер challenge→sign→assert.
5. signer-страница `/embed/signer` (chrome-less, silent + gesture пути).
6. middleware-исключение `/embed` + demo.html + полная проверка (pytest/node/tsc/build).

Найдено при планировании: A+B `_resolve_origin` брал Origin-заголовок первым → в попап-флоу это homosapience.org вместо customer-origin → сломало бы `aud`. Фикс — body-first (Task 1).

**Реализация (Subagent-Driven, ветка `r1-widget`, 5 коммитов):**
- Task 1 — backend body-first origin + `/assert` отдаёт `trust_band` (+2 теста). `29490e0`
- Task 2 — `aptogon.js` loader + Node-тест хелперов. `507c7be`
- Task 3 — `embedSigner.ts` (challenge/sign/assert). `0596ab9`
- Task 4 — signer-страница `/embed/signer`. `25534b9`
- Task 5 — middleware `/embed` exempt + demo.html. `7226984`
- Task 6 — проверка: 35 backend-тестов ✓, Node helper-тест ✓, tsc clean ✓, `npm run build` ✓ (`/embed/signer` в роутах).
- Финальное ревью: **APPROVED_WITH_NITS** (нет security/correctness блокеров; нит-замечания — наблюдения).

**Слито в main, задеплоено, проверено end-to-end на проде ✅**
- Backend + frontend задеплоены; `aptogon.js` отдаётся как статика (200), `/embed/signer` 200 без locale-редиректа.
- Body-first origin подтверждён на проде: challenge с обманным `Origin: evil.example.com` + body `homosapience.org` → 200 (тело победило).
- Браузерный smoke `/embed/demo.html`: `Aptogon.verify()` → popup → тихая подпись → `{token, trust_band}`. JWT claims корректны: `aud=homosapience.org` (customer origin), `trust_band` проброшен, TTL 300с, `kid` = серверный ключ.

**Инцидент при проверке:** тестовый ключ `pk_live_3Ahex…` оказался `active=False` (вероятно случайный DELETE при тестировании) → `invalid_key`. Реактивирован через UPDATE. Backend на host-PostgreSQL (персистентность ок, `risk_events` копятся — было 2). `aptogon-postgres` — orphan-контейнер, не используется. На сервере `demo.html` правится sed-ом с реальным pk (в репо остаётся плейсхолдер).

**Возможный follow-up (R1-D):** `PATCH /api/console/keys/{id}` для реактивации ключа через API (сейчас только UPDATE в БД).

---

## ИТОГ: R1 A+B+C — в проде

| Слой | Статус |
|---|---|
| R2 Risk Engine | `STATS_COLLECT=true`, risk_events копятся |
| R1 A+B Embed API | `EMBED_API=true`, эндпоинты живы |
| R1-C Widget | `aptogon.js` + signer popup, end-to-end проверен |

Дальше по роадмапу: **R1-D** (консоль `/console`) или **R1-E** (биллинг).

---

## R1-D — Консоль (декомпозиция на 4 цикла)

Решения брейнсторма: self-serve для verified людей **+ ограждения** (домен-владение, free-cap, кап ключей, алертинг). Циклы: **D1** domain-ownership (backend) → **D2** self-serve+caps (backend) → **D3** консоль UI → **D4** алертинг. Self-serve флаг включаем только когда готовы D1+D2.

### R1-D1 — Domain-ownership verification — ГОТОВО (ветка r1d-domain-ownership)

Спека: `docs/superpowers/specs/2026-05-23-r1d-domain-ownership-design.md`
План: `docs/superpowers/plans/2026-05-23-r1d-domain-ownership.md`

Subagent-Driven, 7 задач, 62 backend-теста зелёные:
1. Флаг `REQUIRE_DOMAIN_VERIFICATION` (default OFF) + `dnspython`.
2–3. `services/domain_verify.py` — normalize_origin, token, proof-билдеры, SSRF-guard, `verify_origin` (DNS-first, метод на выбор).
4. `domain_verifications` таблица + DB-методы.
5. `routers/domain.py` — 3 эндпоинта `/api/console/domains` (verified-DID auth).
6. Enforcement-хук в embed `challenge` (флаг-гейт + admin-bypass).
7. Подключение роутера за `EMBED_API`.

Методы proof: **DNS-TXT (рекомендуемый) + well-known файл**, выбор за оргом. Enforcement за флагом OFF → прод не тронут; admin-ключи bypass.

Финальное ревью: APPROVED_WITH_NITS. Исправлено: CGNAT (100.64/10) в SSRF-guard (Py<3.11), нормализация origin перед `is_origin_verified`, чистка dead-кода. Принято как есть: bypass распространяется на любую admin_dids-роль (вкл. gold) — set малый и доверенный, уточним в D2.

Осталось: merge → деплой (`dnspython` → пересборка контейнера); `REQUIRE_DOMAIN_VERIFICATION` остаётся OFF до D2.

**Задеплоено и проверено на проде:** `/api/console/domains` живой; auth-гейт корректен (плейсхолдер→403, реальный verified DID→200); create отдаёт token+оба метода.

**Реальный DNS-тест — ПРОЙДЕН ✅:** домен `lastmiles.ru` (id:2). TXT добавлена (через панель обернулась как `google-site-verification=aptogon-domain-verification=<token>`), `POST /api/console/domains/2/verify {method:dns_txt}` → `verified/dns_txt`. Substring-матч устойчив к обёртке провайдера. Полный путь D1 подтверждён на реальном домене.

### R1-D2 — Self-serve + caps — ГОТОВО (ветка r1d2-self-serve)

Спека: `docs/superpowers/specs/2026-05-23-r1d2-self-serve-design.md`
План: `docs/superpowers/plans/2026-05-23-r1d2-self-serve.md`

Subagent-Driven, 6 задач, 71 backend-тест зелёный:
1. Флаг `SELF_SERVE_KEYS` (default OFF).
2. DRY-рефактор: общий `routers/_auth_helpers.py` (`extract_did`, `require_verified_did`) — domain.py + console_keys.py переключены (admin.py не тронут).
3. DB: `count_active_api_keys`, `reactivate_api_key` (owner-scoped).
4. console_keys: `_require_key_owner` (admin при OFF / verified-DID при ON) + кап ключей (`MAX_KEYS_PER_OWNER`=5) + `POST /keys/{id}/reactivate`.
5. embed: per-key free-cap в `/verify` (429 `quota_exceeded`, env `FREE_VERIFY_CAP`=1000, admin exempt) + сцепка challenge-enforcement с `SELF_SERVE_KEYS`.
6. Полный прогон + flag-off регрессия (admin-only сохранён).

Матрица: `SELF_SERVE_KEYS` OFF → текущий прод; ON → self-serve + капы + домен-enforcement активен (авто-сцепка, foot-gun исключён).

Финальное ревью: APPROVED_WITH_NITS. Принято без правок: TOCTOU на капах (soft cap, безвредно, owner-scoped — advisory lock на масштабе); `MAX_KEYS_PER_OWNER` читается на импорте (тест монкипатчит атрибут, прод требует рестарта). Follow-up: консолидировать `_extract_did` в admin.py.

Осталось: merge → деплой (без новых деков, только рестарт). `SELF_SERVE_KEYS` OFF до готовности D3 UI.

### R1-D3 — Console UI

**Статус: реализовано, ожидает деплой.**

Frontend: `app/[locale]/console/page.tsx` + 3 компонента секций + `lib/consoleApi.ts`.
Backend: `list_keys` добавляет `usage_this_month`/`monthly_cap`; `list_domains` добавляет `token`+`methods` для неверифицированных доменов.
Auth: читает DID из localStorage (`aptogon_did` / `hsi_did`), использует `authHeaders()` для JWT/X-APTOGON-DID.

Деплой: `npm run build` → перезапуск frontend-контейнера. Изменений схемы нет — backend перезапустить только.
Активировать: `FEATURE_CONSOLE=true` в `/var/www/aptogon/.env` после smoke-теста на проде.

## Программа полного тестирования (запланирована, отдельный цикл)
Охват: E2E по слоям (вкл. реальную DNS-проверку D1), матрица FEATURE_* флагов (регрессия «всё OFF»), security-прогон (SSRF/CGNAT, replay, cross-site aud, подмена origin), негативные/граничные (истёкший/отозванный credential, плохая подпись, неверифицированный домен при enforcement ON), прод-смоук-скрипты, перфоманс/лимиты (free-cap, rate-limit, недоступный Redis/Postgres). Делать после R1-D2/E (когда self-serve+лимиты замкнут картину): спека→план→скрипты/чеклисты.



## 2026-05-24 — R1-D4 Alerts & Anomaly Feed

- DB: `alert_events` table (30-day retention, 3 indexes)
- Service: `alert_service.py` (record_alert + 5-min dedup, auto_resolve_old, delete_expired)
- API: 5 console endpoints + 2 admin endpoints behind `FEATURE_ALERTS`
- Hooks: unknown_origin, cap_exceeded, rate_limit_hit, blocked_did (embed.py)
- Hooks: usage_spike, behavior_cascade (behavior_monitor.py)
- Frontend: AlertsSection (console widget), AlertsFeed (admin feed)
- Extension: polling loop every 5 min → Chrome notification on new alerts
- Feature flag: `FEATURE_ALERTS=false` (default); activate after smoke test
