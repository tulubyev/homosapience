#!/usr/bin/env bash
# add-gold.sh — массово добавить Gold Members (поручителей) в APTOGON.
#
# Использование:
#   ./add-gold.sh did:key:z6Mk... [did:key:z6Mk... ...]   # один или несколько DID аргументами
#   ./add-gold.sh -f gold_dids.txt                          # из файла (по одному DID на строку, # = комментарий)
#   ./add-gold.sh --list                                    # показать текущих Gold Members
#
# Конфиг через переменные окружения (или отредактируй значения ниже):
#   APTOGON_API       база API           (default: https://homosapience.org)
#   APTOGON_ADMIN_DID твой admin DID      (обязательно — им авторизуемся)
#
# Пример:
#   export APTOGON_ADMIN_DID="did:key:z6Mk_ТВОЙ_DID"
#   ./add-gold.sh did:key:z6MkAAA... did:key:z6MkBBB...

set -euo pipefail

API="${APTOGON_API:-https://homosapience.org}"
ADMIN_DID="${APTOGON_ADMIN_DID:-}"

# ── Цвета ────────────────────────────────────────────────────────────────────
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'

die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }

command -v curl >/dev/null || die "curl не найден"

# ── --list ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--list" ]]; then
  echo -e "${B}Текущие Gold Members:${N}"
  curl -s "$API/api/bond/gold-members"
  echo
  exit 0
fi

[[ -n "$ADMIN_DID" ]] || die "Не задан APTOGON_ADMIN_DID. Сделай: export APTOGON_ADMIN_DID=\"did:key:z6Mk...\""

# ── Собрать список DID ──────────────────────────────────────────────────────────
DIDS=()
if [[ "${1:-}" == "-f" || "${1:-}" == "--file" ]]; then
  FILE="${2:-}"
  [[ -n "$FILE" && -f "$FILE" ]] || die "Файл не найден: ${FILE:-<пусто>}"
  while IFS= read -r line; do
    line="${line%%#*}"                       # срезать комментарии
    line="$(echo "$line" | tr -d '[:space:]')"  # убрать пробелы
    [[ -n "$line" ]] && DIDS+=("$line")
  done < "$FILE"
else
  DIDS=("$@")
fi

[[ ${#DIDS[@]} -gt 0 ]] || die "Нет DID для добавления. Передай аргументами или через -f файл.txt"

echo -e "${B}API:${N} $API"
echo -e "${B}Admin:${N} ${ADMIN_DID: -16}"
echo -e "${B}К добавлению:${N} ${#DIDS[@]} DID\n"

ok=0; fail=0
for did in "${DIDS[@]}"; do
  # Базовая валидация
  if [[ "$did" != did:key:z* ]]; then
    echo -e "${Y}⊘ пропуск (не похоже на DID): $did${N}"; ((fail++)); continue
  fi
  short="${did: -8}"   # последние 8 символов

  resp="$(curl -s -w '\n%{http_code}' -X POST "$API/api/admin/dids" \
    -H "Content-Type: application/json" \
    -H "X-APTOGON-DID: $ADMIN_DID" \
    -d "{\"did_short\":\"$short\",\"did_full\":\"$did\",\"role\":\"gold_member\",\"display_name\":\"Gold Member\"}")"

  code="$(echo "$resp" | tail -n1)"
  body="$(echo "$resp" | sed '$d')"

  if [[ "$code" == "200" ]]; then
    echo -e "${G}✓ добавлен${N} …$short"
    ((ok++))
  else
    echo -e "${R}✗ ошибка ($code)${N} …$short — $body"
    ((fail++))
  fi
done

echo -e "\n${B}Итого:${N} ${G}$ok успешно${N}, ${R}$fail с ошибкой${N}"
echo -e "${Y}Подхватятся в /bond-panel в течение ~60 сек (TTL-кэш).${N}"
echo -e "Проверить: ${B}./add-gold.sh --list${N}"
