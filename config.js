// ============================================================
// Настройки за връзка с облака (Supabase)
// ------------------------------------------------------------
// Попълни двете стойности по-долу с данните от твоя Supabase проект:
//   Supabase → Project Settings (зъбчатото колело) → "API"
//     • Project URL            -> сложи го в SUPABASE_URL
//     • Project API keys: anon -> сложи го в SUPABASE_ANON_KEY
//
// Тези стойности са безопасни за публикуване (ключът "anon" е
// предназначен за браузъра; достъпът се пази от правилата в базата).
// ============================================================
window.DANKO_CONFIG = {
  SUPABASE_URL: "https://hwbblteomrrahfrsyuow.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_c5aOG4PykNHjAJDV82-wiQ_Y9yS9ba2",

  // Имейли за уведомяване (по избор). Ако оставиш списъка празен, всеки
  // задава своя списък през бутона „⚙ Имейли“. Пример:
  // NOTIFY_EMAILS: ["ivan@danko.bg", "maria@danko.bg"],
  NOTIFY_EMAILS: [],
};
