# Автоматично изпращане на запитвания по имейл

Запитванията се изпращат от пощата **zapitvane@dankosystems.com** чрез
Supabase Edge Function `send-inquiry`. Паролата за пощата **не се пази в кода**,
а като таен ключ (secret) в Supabase.

## 1. Деплой на функцията (еднократно)

На компютър с инсталиран [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref hwbblteomrrahfrsyuow
supabase functions deploy send-inquiry
```

## 2. Задаване на тайните ключове (SMTP данни)

Може през CLI:

```bash
supabase secrets set \
  SMTP_HOST=mail.dankosystems.com \
  SMTP_PORT=465 \
  SMTP_USER=zapitvane@dankosystems.com \
  SMTP_PASS=ПАРОЛАТА_ТУК \
  FROM_EMAIL=zapitvane@dankosystems.com \
  "FROM_NAME=Данко Системс"
```

…или през уеб интерфейса:
**Supabase → Project → Edge Functions → Manage secrets → Add new secret**
(добави горните 6 ключа).

> ⚠️ Паролата се въвежда САМО тук. Никога в кода или в GitHub.

## 3. Готово

След това бутонът „Регистрирай и изпрати имейл" праща писмото автоматично.
Ако функцията не е налична, приложението се връща към стария режим
(отваря пощенската програма с готово запитване).
