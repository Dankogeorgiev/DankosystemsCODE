# Автоматично изпращане на запитвания по имейл (Brevo)

Запитванията се изпращат от **zapitvane@dankosystems.com** чрез услугата
**Brevo** (HTTP API). Ключът се пази като secret в Supabase, не в кода.

## 1. Регистрация в Brevo
- Влез в https://www.brevo.com → безплатна регистрация.

## 2. Потвърди подателя
- Brevo → **Senders, Domains & Dedicated IPs → Senders → Add a sender**
- Име: `Данко Системс`, имейл: `zapitvane@dankosystems.com`
- Brevo праща писмо за потвърждение на тази поща → отвори го и потвърди.

## 3. Вземи API ключ
- Brevo → **SMTP & API → API Keys → Generate a new API key** → копирай го.

## 4. Задай тайните ключове в Supabase
Edge Functions → Secrets (https://supabase.com/dashboard/project/hwbblteomrrahfrsyuow/functions/secrets):

| Key | Value |
|---|---|
| `BREVO_API_KEY` | (ключът от стъпка 3) |
| `FROM_EMAIL` | `zapitvane@dankosystems.com` |
| `FROM_NAME` | `Данко Системс` |

## 5. Деплой на функцията
- Замени кода на `send-inquiry` с този от `supabase/functions/send-inquiry/index.ts` и Deploy.

## (по желание, за перфектна доставимост)
- Brevo → Domains → автентикирай `dankosystems.com` (добавяш няколко DNS записа).
  Не е задължително за старт, но премахва риска от спам.
