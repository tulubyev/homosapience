# TODO Today — Запуск Gold Members (HSI Bond)

## 🔐 Шаг 0 — Сгенерировать секреты (локально)

**Admin-пароль → хэш** (пароль не попадёт ни в историю, ни в `ps`):
```bash
python3 -c "import hashlib,getpass; print('ADMIN_PASSWORD_HASH='+hashlib.sha256(getpass.getpass('Новый admin-пароль: ').encode()).hexdigest())"
```
Скопируй вывод `ADMIN_PASSWORD_HASH=...`. **Пароль запомни** — им будешь логиниться в админку.

**Время старта сети:**
```
NETWORK_START_TS=1779495722
```
(это «сейчас»; если запуск позже — подставь свежий `date +%s`)

---

## 🚀 Шаг 1 — Деплой кода

**Локально уже запушено** (commit `8eec785`). На сервере:
```bash
ssh tulubyev@62.217.178.173

cd /var/www/aptogon && git pull
```

---

## ⚙️ Шаг 2 — Настроить `.env` на сервере

```bash
nano /var/www/aptogon/backend/.env
```
Добавь/обнови три строки (старый токен `9ded5b86…` тем самым станет бесполезен):
```env
ADMIN_PASSWORD_HASH=<хэш из Шага 0>
NETWORK_START_TS=1779495722
GOLD_MEMBER_DIDS=did:key:z6Mk_ТВОЙ_DID
```
> `GOLD_MEMBER_DIDS` пока пустой/только твой — остальных добавим через админку без рестарта.

**Перезапуск backend** (stop→rm→up — иначе `.env` не перечитается):
```bash
cd /var/www/aptogon
docker compose stop api && docker compose rm -f api && kill $(lsof -ti:8000) 2>/dev/null; sleep 2 && docker compose up -d api

# фронтенд (изменения /bond + переводы)
cd frontend && npm run build && pm2 restart aptogon-frontend
```

---

## 👤 Шаг 3 — Founder становится первым Gold Member

1. Открой `https://homosapience.org/verify` → пройди верификацию → **скопируй свой DID** (`did:key:z6Mk…`) — он же сохранится в `localStorage`.
2. Зарегистрируйся как admin (подставь свой DID и пароль из Шага 0):
```bash
curl -s -X POST https://homosapience.org/api/admin/claim \
  -H "Content-Type: application/json" \
  -H "X-APTOGON-DID: did:key:z6Mk_ТВОЙ_DID" \
  -d '{"password":"ТВОЙ_ПАРОЛЬ","display_name":"Founder"}'
```
Ожидаемо: `{"status":"ok","did_short":"...","message":"... registered as admin"}`

3. Открой `https://homosapience.org/en/admin` — войди тем же паролем. Это твоя панель управления.

---

## 📨 Шаг 4 — Пригласить Gold Members и записать их DID

**Для каждого приглашённого:**

1. **Отправь приглашение** — возьми нужный языковой блок из `docs/gold-member-invitation.md` (9 языков готовы), отправь лично (Telegram/Email/Signal).
2. Человек проходит `homosapience.org/verify` → **присылает тебе свой DID**.
3. **Добавь его DID как gold_member** — два способа:

**Способ A — через админку (рекомендуется, без рестарта):**
- На `/en/admin` найди DID в таблице → кнопка **`+ Gold`**.
- Подхватится в течение 60 сек (TTL-кэш).

**Способ B — через API** (если кнопки нет под рукой; `did_short` = **последние 8 символов** DID):
```bash
curl -s -X POST https://homosapience.org/api/admin/dids \
  -H "Content-Type: application/json" \
  -H "X-APTOGON-DID: did:key:z6Mk_ТВОЙ_DID" \
  -d '{
    "did_short":"ПОСЛЕДНИЕ_8_СИМВОЛОВ",
    "did_full":"did:key:z6Mk_ПОЛНЫЙ_DID_ПРИГЛАШЁННОГО",
    "role":"gold_member",
    "display_name":"Gold Member"
  }'
```
> ⚠️ Обязательно `did_full` — одобрение bond'а сверяет полный DID; без него поручительство не пройдёт.

4. Приглашённый ставит расширение APTOGON → открывает `/bond-panel` → получает запросы по WebSocket → жмёт **✓ Vouch**.

---

## ✅ Шаг 5 — Проверка

```bash
# Gold Members активны
curl -s https://homosapience.org/api/bond/gold-members
# → count > 0, status: "active"

# Кандидаты — реальные (НЕ a0b0c0..., НЕ ⭐950 фейки); на старте может быть []
curl -s https://homosapience.org/api/bond/candidates

# Sunset настроен
ssh tulubyev@62.217.178.173 'grep -E "NETWORK_START_TS|GOLD_MEMBER_DIDS" /var/www/aptogon/backend/.env'

# Health
curl -s https://homosapience.org/api/health
```

**End-to-end (нужны 2 устройства/браузера):**
- Gold Member A онлайн на `/bond-panel`.
- Новый пользователь B: verify → `/bond` → запрос уходит push'ом.
- A видит `bond:request` → ✓ Vouch. Повторить с 3 Gold Members.
- У B `trust_score` становится `0.5`, бейдж → `community_verified`.

---

## 🛠 Шаг 4.5 — Backfill: починить старых Gold Members без full DID

⚠️ Текущие 3 Gold Members записаны без `did_full` → **не могут одобрять bond'ы**
(одобрение сверяет полный DID, а не 8 символов). После `git pull` исправлено
для новых записей; старые нужно один раз пробэкфилить из `human_credentials`.

На сервере (контейнер postgres):
```bash
# 1) Посмотреть что восстановится (глазами проверить соответствие)
docker exec -it aptogon-postgres psql -U tulubyev -d aptogon_db -c "
SELECT a.did_short, c.did AS recovered_full
FROM admin_dids a
JOIN human_credentials c ON c.did LIKE '%' || a.did_short
WHERE a.role = 'gold_member' AND a.did_full IS NULL;"

# 2) Применить
docker exec -it aptogon-postgres psql -U tulubyev -d aptogon_db -c "
UPDATE admin_dids a
SET did_full = c.did
FROM human_credentials c
WHERE a.role = 'gold_member' AND a.did_full IS NULL
  AND c.did LIKE '%' || a.did_short;"
```
Записи без соответствующего credential восстановить нельзя — пере-добавь их через
`./add-gold.sh <полный_did>`, когда человек пришлёт DID. Кэш обновится за ~60 сек.

Проверка: `./add-gold.sh --list` → у всех `full` = полный `did:key:z6Mk…`, НЕ 8 символов.

---

## 📌 Памятка по логике

- **Bootstrap 0–60 дней / до 150 юзеров:** Gold Members одобряют вручную (даже при своём trust 0.1).
- **После sunset:** Gold-привилегия исчезает, поручаются все с `trust ≥ 0.5` (3+ полученных bond'а) — сеть переходит на чистый пиринг.
- **`+ Gold` через DB** работает без рестарта (TTL 60с); **`GOLD_MEMBER_DIDS` в env** — только на старте/рестарте.
