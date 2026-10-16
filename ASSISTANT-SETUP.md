# AI Асистент (Клод) — настройка

Асистентът в СИСТЕМАТА (плаващият бутон 🤖 долу вдясно) праща въпросите към
Claude през **сигурна Edge функция в Supabase**. API ключът стои в Supabase,
никога в браузъра.

## Стъпка 1 — Anthropic акаунт и ключ
1. Влез в **https://console.anthropic.com** (регистрирай се).
2. **Billing** → добави карта / кредит (плаща се на използване).
3. **API Keys** → *Create Key* → копирай ключа (`sk-ant-...`). Пази го — показва се веднъж.

## Стъпка 2 — Качи Edge функцията в Supabase
**Вариант А (през браузъра — най-лесно):**
1. Supabase → проекта → **Edge Functions** → *Deploy a new function*.
2. Име: **assistant**
3. Постави съдържанието на `supabase/functions/assistant/index.ts` (от репото).
4. Deploy.

**Вариант Б (през CLI):**
```bash
supabase functions deploy assistant --project-ref hwbblteomrrahfrsyuow
```

## Стъпка 3 — Задай тайния ключ
Supabase → **Project Settings** → **Edge Functions** → **Secrets** (или „Manage secrets"):
- добави: `ANTHROPIC_API_KEY` = `sk-ant-...`

(или през CLI:)
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

## Готово
Отвори СИСТЕМАТА → натисни бутона 🤖 долу вдясно → питай.

## Настройки (по избор)
- **Модел / цена:** в `index.ts` променливата `MODEL`. По подразбиране е
  `claude-haiku-4-5-20251001` (евтин и бърз). За по-сложни разсъждения смени на
  `claude-sonnet-5`.
- **Какво вижда асистентът:** оперативни данни (активни заявки, материали под
  минимум). НЕ вижда заплати, маржове и себестойности.
- **Достъп:** всеки влязъл потребител (Supabase проверява входа автоматично).
