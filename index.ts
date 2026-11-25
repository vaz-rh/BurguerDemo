// Edge Function "pix": Pix com confirmação automática pelo Mercado Pago.
//
//   POST /functions/v1/pix           { action: "create" | "check", number, phone }   <- chamado pelo site
//   POST /functions/v1/pix/webhook   notificação enviada pelo Mercado Pago           <- chamado pelo Mercado Pago
//
// Segredos (Supabase > Edge Functions > Secrets):
//   MP_ACCESS_TOKEN     token de acesso de PRODUÇÃO do Mercado Pago (nunca coloque no site)
//   MP_PAYER_EMAIL      e-mail usado como "pagador" nas cobranças. Não pode ser o e-mail da sua conta do Mercado Pago
//   MP_WEBHOOK_SECRET   assinatura secreta do webhook (Mercado Pago > Suas integrações > Webhooks)
//
// IMPORTANTE: deixe "Verify JWT" DESLIGADO nesta função. O site e o Mercado Pago não enviam JWT;
// a autorização é feita aqui dentro (número + telefone do pedido, e a assinatura do webhook).

import { createClient } from "npm:@supabase/supabase-js@2.110.9";

type Db = ReturnType<typeof createClient>;
type Row = Record<string, any>;

const MP_API = "https://api.mercadopago.com";
const PIX_EXPIRATION_MINUTES = 35;
const MAX_ATTEMPTS = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ---------- Utilidades ---------- */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// O Mercado Pago pede a data de vencimento com fuso; o Brasil usa -03:00 o ano todo
function toBrasiliaIso(date: Date): string {
  return new Date(date.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");
}

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch { /* cai para a chave antiga */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getDb(): Db | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Assinatura do webhook (x-signature) ----------
   O Mercado Pago assina "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com HMAC-SHA256. */
async function verifySignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
  secret: string,
): Promise<boolean> {
  if (!xSignature) return false;

  let ts = "";
  let v1 = "";
  for (const part of xSignature.split(",")) {
    const [name, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (name.trim() === "ts") ts = value;
    if (name.trim() === "v1") v1 = value;
  }
  if (!ts || !v1) return false;

  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return safeEqual(toHex(signature), v1.toLowerCase());
}

/* ---------- Confere o pagamento direto no Mercado Pago ----------
   Nunca confiamos no que chega pelo webhook ou pelo site: o status só muda
   depois de consultar o pagamento no Mercado Pago com o nosso token. */
async function reconcile(
  db: Db,
  token: string,
  mpPaymentId: string,
): Promise<{ paid: boolean; cancelled: boolean } | null> {
  const { data: row, error: rowError } = await db
    .from("payments").select("order_id").eq("mp_payment_id", mpPaymentId).maybeSingle();
  if (rowError) throw new Error("payments: " + rowError.message);
  if (!row) return null; // pagamento que não foi criado por este site

  const response = await fetch(`${MP_API}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Mercado Pago respondeu ${response.status}`);
  const payment: Row = await response.json();

  const { data: order, error: orderError } = await db
    .from("orders").select("id, total, status, payment_status").eq("id", row.order_id).maybeSingle();
  if (orderError || !order) throw new Error("pedido do pagamento não encontrado");

  if (String(payment.id) !== mpPaymentId || String(payment.external_reference) !== String(order.id)) {
    console.error("O pagamento não confere com o pedido", mpPaymentId, order.id);
    return { paid: false, cancelled: false };
  }

  await db.from("payments")
    .update({ status: String(payment.status), updated_at: new Date().toISOString() })
    .eq("order_id", order.id);

  const status = String(payment.status);

  if (status === "approved") {
    const sameAmount =
      Math.round(Number(payment.transaction_amount) * 100) === Math.round(Number(order.total) * 100);
    if (!sameAmount) {
      console.error("Valor pago diferente do total do pedido", mpPaymentId, payment.transaction_amount, order.total);
      return { paid: false, cancelled: false };
    }

    if (order.payment_status !== "paid") {
      if (order.status === "awaiting_payment") {
        const { error } = await db.from("orders")
          .update({ payment_status: "paid", status: "received" })
          .eq("id", order.id).eq("status", "awaiting_payment");
        if (error) throw new Error("orders: " + error.message);
      } else {
        // Pago, mas o pedido já não aguardava pagamento (ex.: cancelado): registra e avisa nos logs
        await db.from("orders").update({ payment_status: "paid" }).eq("id", order.id);
        console.error("ATENÇÃO: pagamento aprovado em pedido que não estava aguardando. Confira e, se preciso, reembolse.", order.id);
        return { paid: false, cancelled: order.status === "cancelled" };
      }
    }
    return { paid: true, cancelled: false };
  }

  if (status === "cancelled" || status === "rejected" || status === "expired") {
    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id).eq("status", "awaiting_payment");
    return { paid: false, cancelled: true };
  }

  return { paid: false, cancelled: false }; // ainda pendente
}

/* ---------- Webhook do Mercado Pago ---------- */
async function handleWebhook(req: Request, db: Db, token: string): Promise<Response> {
  const url = new URL(req.url);
  const dataId = (url.searchParams.get("data.id") ?? "").toLowerCase();
  const type = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "";

  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (secret) {
    const ok = await verifySignature(req.headers.get("x-signature"), req.headers.get("x-request-id"), dataId, secret);
    if (!ok) return new Response("assinatura inválida", { status: 401 });
  } else {
    console.error("MP_WEBHOOK_SECRET não configurado: a assinatura do webhook não está sendo verificada.");
  }

  if (type !== "payment" || !/^\d+$/.test(dataId)) return new Response("ignorado", { status: 200 });

  try {
    await reconcile(db, token, dataId);
  } catch (error) {
    console.error("Falha ao processar o webhook", error);
    return new Response("erro", { status: 500 }); // o Mercado Pago tenta de novo
  }
  return new Response("ok", { status: 200 });
}

/* ---------- Chamadas do site ---------- */
async function handleCustomer(req: Request, db: Db, token: string): Promise<Response> {
  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "BAD_REQUEST" }, 400);
  }

  const action = body.action === "check" ? "check" : body.action === "create" ? "create" : "";
  const number = Number(body.number);
  const phone = String(body.phone ?? "").replace(/\D/g, "");

  if (
    !action || !Number.isInteger(number) || number < 1 || number > 2147483647 ||
    phone.length < 10 || phone.length > 11
  ) {
    return json({ error: "BAD_REQUEST" }, 400);
  }

  // Quem sabe o número do pedido E o telefone usado pode ver e pagar o pedido
  const { data: order, error } = await db
    .from("orders")
    .select("id, number, total, status, payment_method, payment_status")
    .eq("number", number)
    .eq("customer_phone", phone)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar o pedido", error.message);
    return json({ error: "DB_ERROR" }, 500);
  }
  if (!order) return json({ error: "NOT_FOUND" }, 404);
  if (order.payment_method !== "pix") return json({ error: "NOT_PIX" }, 409);

  return action === "check" ? await checkOrder(db, token, order) : await createPix(db, token, order);
}

async function checkOrder(db: Db, token: string, order: Row): Promise<Response> {
  if (order.payment_status === "paid") return json({ paid: true, cancelled: false });
  if (order.status === "cancelled") return json({ paid: false, cancelled: true });

  const { data: payment, error } = await db
    .from("payments").select("mp_payment_id").eq("order_id", order.id).maybeSingle();
  if (error) {
    console.error("Erro ao buscar o pagamento", error.message);
    return json({ error: "DB_ERROR" }, 500);
  }
  if (!payment || !payment.mp_payment_id) return json({ paid: false, cancelled: false });

  try {
    const result = await reconcile(db, token, String(payment.mp_payment_id));
    return json(result ?? { paid: false, cancelled: false });
  } catch (e) {
    console.error("Erro ao consultar o Mercado Pago", e);
    return json({ error: "MP_ERROR" }, 502);
  }
}

function publicPayment(payment: Row, order: Row) {
  return {
    qr_code: payment.qr_code,
    qr_code_base64: payment.qr_code_base64,
    expires_at: payment.expires_at,
    amount: Number(order.total),
    number: order.number,
  };
}

async function createPix(db: Db, token: string, order: Row): Promise<Response> {
  if (order.payment_status === "paid") return json({ error: "ALREADY_PAID" }, 409);
  if (order.status !== "awaiting_payment") return json({ error: "NOT_PAYABLE" }, 409);

  const payerEmail = Deno.env.get("MP_PAYER_EMAIL");
  if (!payerEmail) {
    console.error("Configuração ausente: MP_PAYER_EMAIL");
    return json({ error: "SERVER_CONFIG" }, 500);
  }

  const { data: existing, error: existingError } = await db
    .from("payments").select("*").eq("order_id", order.id).maybeSingle();
  if (existingError) {
    console.error("Erro ao buscar o pagamento", existingError.message);
    return json({ error: "DB_ERROR" }, 500);
  }

  // Já existe um Pix válido para este pedido: devolve o mesmo QR Code
  if (existing && existing.qr_code && existing.expires_at && new Date(existing.expires_at).getTime() > Date.now()) {
    return json(publicPayment(existing, order));
  }

  const attempts = existing ? Number(existing.attempts) || 0 : 0;
  if (attempts >= MAX_ATTEMPTS) return json({ error: "TOO_MANY_ATTEMPTS" }, 429);

  const expires = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000);

  const response = await fetch(`${MP_API}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Mesma chave em uma nova tentativa do mesmo pedido: o Mercado Pago não cobra duas vezes
      "X-Idempotency-Key": `${order.id}-${attempts + 1}`,
    },
    body: JSON.stringify({
      transaction_amount: Number(Number(order.total).toFixed(2)),
      description: `Pedido DevBurguer nº ${order.number}`,
      payment_method_id: "pix",
      external_reference: String(order.id),
      date_of_expiration: toBrasiliaIso(expires),
      payer: { email: payerEmail },
    }),
  });

  const payment: Row | null = await response.json().catch(() => null);
  if (!response.ok || !payment) {
    console.error("O Mercado Pago recusou a criação do Pix", response.status, JSON.stringify(payment));
    return json({ error: "MP_ERROR" }, 502);
  }

  const data = payment.point_of_interaction?.transaction_data;
  if (!data || !data.qr_code || !data.qr_code_base64) {
    console.error("Resposta do Mercado Pago sem QR Code", JSON.stringify(payment));
    return json({ error: "MP_NO_QR" }, 502);
  }

  const parsedExpiry = payment.date_of_expiration ? new Date(payment.date_of_expiration) : expires;
  const expiresAt = isNaN(parsedExpiry.getTime()) ? expires : parsedExpiry;

  const record = {
    order_id: order.id,
    mp_payment_id: String(payment.id),
    status: String(payment.status ?? "pending"),
    qr_code: String(data.qr_code),
    qr_code_base64: String(data.qr_code_base64),
    amount: Number(order.total),
    expires_at: expiresAt.toISOString(),
    attempts: attempts + 1,
    updated_at: new Date().toISOString(),
  };

  const { error: saveError } = await db.from("payments").upsert(record, { onConflict: "order_id" });
  if (saveError) {
    console.error("Erro ao salvar o pagamento", saveError.message);
    return json({ error: "DB_ERROR" }, 500);
  }

  return json(publicPayment(record, order));
}

/* ---------- Entrada ---------- */
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const token = Deno.env.get("MP_ACCESS_TOKEN");
  const db = getDb();
  if (!token || !db) {
    console.error("Configuração ausente: MP_ACCESS_TOKEN ou chaves do Supabase.");
    return json({ error: "SERVER_CONFIG" }, 500);
  }

  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (path.endsWith("/webhook")) return await handleWebhook(req, db, token);
    return await handleCustomer(req, db, token);
  } catch (error) {
    console.error("Erro inesperado", error);
    return json({ error: "INTERNAL" }, 500);
  }
});
