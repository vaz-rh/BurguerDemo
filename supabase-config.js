/* supabase-config.js
   Cria o cliente do Supabase em window.db.
   Carregue DEPOIS do script do supabase-js e ANTES de pagamento.js e painel.js.

   A chave "publishable" é pública por design: ela pode ficar no site.
   Quem protege os dados são as regras (RLS) do supabase-schema.sql.
   NUNCA coloque aqui a chave "secret" ou "service_role". */
(function () {
  "use strict";

  var SUPABASE_URL = "https://kgnexthzjmlmusajyxcj.supabase.co";
  var SUPABASE_KEY = "sb_publishable_HsYEpxgr-Q8Gh3jp-NGQCw_9ZUO-dJV";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("supabase-config.js: o script do supabase-js não carregou.");
    return;
  }

  window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
})();
