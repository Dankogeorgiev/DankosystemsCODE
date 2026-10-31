# DANKO Sales Agent — Фаза 2A: n8n READ workflow + crm-bridge (настройка)

Целта: Системата да чете CRM-а (Google Sheet „DANKO Sales Leads") на живо,
САМО ЗА ЧЕТЕНЕ, без никакви ключове в браузъра.

Веригата: **Системата → Edge функция crm-bridge → n8n webhook → Google Sheet**

---

## Стъпка 1 — нов workflow в n8n (3 node-а, нищо друго)

Създай нов workflow с име **DANKO CRM Read** (отделен от Sales Agent v1.0 —
него НЕ го пипаме). Точно 3 node-а:

1. **Webhook**
   - HTTP Method: `POST`
   - Path: `danko-crm-read`
   - Authentication: **Header Auth** → създай credential:
     - Name: `x-read-key`
     - Value: измисли ДЪЛЪГ случаен низ (напр. 40+ знака) — това е тайната,
       същата отива в Supabase (стъпка 2)
   - Respond: **Using 'Respond to Webhook' node**

2. **Google Sheets** (свържи със СЪЩИЯ Google акаунт, който ползва Sales Agent-ът)
   - Operation: **Get Row(s) in Sheet** (само четене!)
   - Document: `DANKO Sales Leads` (ID: 10ELDEhqBK9JxkJkzHspq4XZgt9DsBTne3veIcoMHmpU)
   - Sheet: `Qualified Leads`
   - Options: остави по подразбиране (връща редовете като обекти с ключове =
     заглавния ред — точно това ни трябва)

3. **Respond to Webhook**
   - Respond With: **All Incoming Items**

Свържи ги: Webhook → Google Sheets → Respond to Webhook.
**Activate** (ключето горе вдясно) и копирай **Production URL** на webhook-а.

> Този workflow НЕ пише никъде, няма AI, няма Gmail, няма Stage 1/2/Outreach.
> Празните „опашни" редове от ARRAYFORMULA не са проблем — мостът брои
> само редове с попълнена Company/Website.

## Стъпка 2 — Edge функцията crm-bridge в Supabase

1. https://supabase.com/dashboard/project/hwbblteomrrahfrsyuow/functions →
   **Deploy a new function** → име: **crm-bridge** (попълни името ПРЕДИ Deploy!)
   → постави кода от `supabase/functions/crm-bridge/index.ts` (GitHub Raw:
   https://raw.githubusercontent.com/Dankogeorgiev/DankosystemsCODE/main/supabase/functions/crm-bridge/index.ts)
   → Deploy. **Verify JWT: ON** (по подразбиране).
2. Edge Functions → **Secrets** → добави:
   - `N8N_READ_URL` = Production URL-а от стъпка 1
   - `N8N_READ_SECRET` = същия дълъг низ от Header Auth credential-а

## Стъпка 3 — проверка от Системата

1. Системата → 🤝 CRM Sales agent → ⚙ Настройки → избери **Production (n8n)**
2. Натисни **„🔌 Тест на връзката"** — трябва да покаже броя компании (≈47)
   и кога е прочетен CRM-ът.
3. Начало/Компании/Outreach/Задачи/Отчети вече са на живо. Пайплайните
   (Ново търсене) в Production са ИЗКЛЮЧЕНИ до Фаза 2B.

## Кой има достъп

Сървърният allow-list е в `crm-bridge/index.ts` (CRM_ALLOWED): Данко +
Григор. Списъкът в браузъра (CRM_EMAILS) само крие бутона — истинската
проверка е в функцията. Добавяш човек → и на двете места + ре-деплой.
