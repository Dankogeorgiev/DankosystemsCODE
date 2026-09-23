# DANKO Sales Agent — Фаза 2B: n8n „Pipeline Runner" (договор + рецепта)

Целта: от Системата се стартира ИСТИНСКИЯТ пайплайн, отговорът идва за
секунди (job id), а n8n продължава сам и пише прогреса в crm_jobs.

    Системата → crm-bridge → [създава ред в crm_jobs] → n8n Runner webhook
                                   ↑                        (отговаря ВЕДНАГА)
                                   └── n8n пише прогреса ────┘ и вика
                                       Stage 1 → Stage 2 → Outreach

## Стъпка 0 — какво вече е готово (от Клод)

- Таблица **crm_jobs** → пусни `crm-jobs-setup.sql` в SQL Editor (веднъж).
- **crm-bridge** знае start_full/start_stage1/start_stage2/start_outreach
  и callback action **job_update** → ре-деплой с новия код.
- Нови тайни на crm-bridge: `N8N_START_URL`, `N8N_START_SECRET`,
  `N8N_CALLBACK_SECRET` (три нови; двете стари READ си остават).

## Стъпка 1 — новият workflow „DANKO Pipeline Runner"

Нов workflow (СТАРИТЕ 4 НЕ се пипат — те се ВИКАТ оттук):

1. **Webhook** — POST, path `danko-pipeline-run`, Authentication: Header Auth
   (Name: `x-start-key`, Value: нов дълъг таен низ = `N8N_START_SECRET`),
   Respond: Using Respond to Webhook node.
2. **Respond to Webhook** — ВЕДНАГА след Webhook-а, отговаря `{"ok":true}`.
   ⚠ Това е ключът срещу Cloudflare 524: браузърът/мостът получават отговор
   за секунди, а клоновете СЛЕД Respond node-а продължават да работят.
3. След Respond: **HTTP Request „джоб RUNNING"** (виж договора долу) →
   **Execute Workflow: Stage 1 Batch Research** → **HTTP „stage1 готов"** →
   **Execute Workflow: Stage 2 Batch Research** (САМО за домейните,
   създадени от Stage 1!) → **HTTP „stage2 готов"** →
   **Execute Workflow: Outreach Batch** (САМО за успешно проучените) →
   **HTTP „финал"**.

Тялото, което Runner-ът получава от crm-bridge:

    { "job_id": "...", "request_id": "...", "mode": "FULL_PIPELINE|STAGE1|STAGE2|OUTREACH",
      "params": { "country", "target_count", "min_fit_score", "industry_focus",
                  "exclude_industries", "requested_websites": ["домейн", ...] } }

По mode: STAGE1 → само Stage 1; STAGE2/OUTREACH → само съответния batch с
requested_websites; FULL_PIPELINE → трите поред, като изходът на единия
храни следващия (никакво „разливане" върху чужди CRM редове).

## Стъпка 2 — договорът за прогреса (HTTP Request node-ове)

Всеки checkpoint е POST към ОТДЕЛНАТА callback функция (Verify JWT = OFF,
пази я само тайната — без anon ключ, без Bearer):

    https://hwbblteomrrahfrsyuow.supabase.co/functions/v1/crm-job-callback

Заглавки (само тези две):

    Content-Type: application/json
    x-callback-secret: <N8N_CALLBACK_SECRET — нов дълъг таен низ>

Тела (job_id идва от Webhook входа; изпращай само каквото се е променило —
stages се СЛИВА, старите етапи не се губят):

    Старт:      {"action":"job_update","job_id":"...","patch":{"status":"RUNNING","current_stage":"Stage 1",
                  "stages":{"stage1":{"status":"RUNNING","requested":5}}}}

    Stage 1 ✓:  {"action":"job_update","job_id":"...","patch":{"current_stage":"Stage 2",
                  "stages":{"stage1":{"status":"COMPLETED","requested":5,"completed":5,"success":5,"failed":0},
                            "stage2":{"status":"RUNNING","requested":5}},
                  "companies":[{"website":"a.de","company":"A GmbH","country":"Germany","fit_score":91,"phase":"CREATED"}, ...]}}

    Stage 2 ✓:  {"action":"job_update","job_id":"...","patch":{"current_stage":"Outreach",
                  "stages":{"stage2":{"status":"COMPLETED","requested":5,"completed":5,"success":4,"failed":1},
                            "outreach":{"status":"RUNNING","requested":4}},
                  "companies":[... с phase "RESEARCH_COMPLETE" / "MISSING_EMAIL" ...]}}

    Финал:      {"action":"job_update","job_id":"...","patch":{"status":"COMPLETED" или "PARTIAL",
                  "current_stage":"готово","drafts_created":4,
                  "stages":{"outreach":{"status":"COMPLETED","requested":4,"completed":4,"success":4,"failed":0}},
                  "companies":[... финалните phase: "DRAFT_CREATED"/"MISSING_EMAIL"/"SKIPPED"/"FAILED",
                               по желание "draft_id"/"draft_link" от Gmail node-а ...]}}

    Провал:     {"action":"job_update","job_id":"...","patch":{"status":"FAILED","error":"кратко защо"}}

Правила:
- **status на джоба**: COMPLETED = всичко мина; PARTIAL = завърши, но с
  пропуски (напр. липсващ имейл) — това е ВАЛИДЕН резултат; FAILED = счупи се.
- **Никакъв фалшив прогрес**: ако точни бройки няма, прати само status
  RUNNING — Системата показва „работи…", не измисля 3/5.
- **emails_sent не съществува в договора** — базата има CHECK = 0 и мостът
  не приема това поле. Драфтове само.
- Ако имаш per-company прогрес по средата на етап — същият формат, по-често.
  Ако не — етапните checkpoint-и стигат (те са задължителните).

## Стъпка 3 — тайните в Supabase (Edge Functions → Secrets)

    N8N_START_URL       = Production URL на danko-pipeline-run webhook-а
    N8N_START_SECRET    = тайната от Header Auth (x-start-key)
    N8N_CALLBACK_SECRET = тайната за обратната посока (x-callback-secret)

## Стъпка 4 — Gmail Draft линкът (проверка, не измисляне)

От изхода на Gmail „Create Draft" node-а вземи id-тата (draftId/messageId) и
пробвай НА РЪКА дали `https://mail.google.com/mail/u/0/#drafts/<messageId>`
отваря точния драфт. Ако ДА → слагай в companies[].draft_link. Ако не се
получава надеждно — НЕ слагай линк; Системата има безопасен резервен бутон
„Отвори Gmail → Drafts".

## Стъпка 5 — тестове (в този ред, не направо пълния!)

- **Тест А (идемпотентност)**: Клод го прави от Системата — две еднакви
  заявки → 1 джоб, 1 n8n execution.
- **Тест Б (безопасен Stage 2)**: 1 компания със Stage2 Needed = YES →
  старт от Системата → същият CRM ред се обогатява, нула Gmail действия.
- **Тест В (безопасен Outreach)**: 1 компания с Outreach Eligible = YES и
  потвърден имейл → точно 1 драфт, 0 изпратени.
- **Чак после**: пълен пайплайн Germany / 2 / Fit 80.
