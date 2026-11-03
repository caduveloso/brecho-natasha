// Edge Function: pagamento
// Cobrança por PIX e cartão pelo Mercado Pago (Checkout Pro).
//
// Segredo (Supabase > Edge Functions > Secrets):
//   MERCADO_PAGO_ACCESS_TOKEN  Access Token de produção da aplicação no Mercado Pago
//                              (sem ele, o site continua combinando o pagamento pelo WhatsApp)
// Opcional:
//   SITE_URL                   endereço da loja (padrão: https://caduveloso.github.io/brecho-natasha/)
//
// Ações públicas (site): criar, situacao, expirar (também chamada a cada 10 minutos pelo banco).
// Avisos do Mercado Pago: POST ?aviso=mp
// Ação do painel (só administradoras): status.

import { createClient } from "npm:@supabase/supabase-js@2";
import { criarApp } from "./app.ts";
import { MercadoPago } from "./mercado-pago.ts";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? "";

/** Chaves do projeto (aceita o formato antigo e o novo de chaves do Supabase). */
function chave(tipo: "anon" | "servico"): string {
  const antiga = Deno.env.get(tipo === "anon" ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  try {
    const mapa = JSON.parse(Deno.env.get(tipo === "anon" ? "SUPABASE_PUBLISHABLE_KEYS" : "SUPABASE_SECRET_KEYS") ?? "{}");
    return String(mapa.default ?? Object.values(mapa)[0] ?? "");
  } catch {
    return "";
  }
}

async function ehAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const cliente = createClient(URL_SUPABASE, chave("anon"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await cliente.rpc("is_admin");
  return !error && data === true;
}

const token = () => (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "").trim();

Deno.serve(
  criarApp({
    banco: () => createClient(URL_SUPABASE, chave("servico"), { auth: { persistSession: false } }),
    mercadoPago: () => (token() ? new MercadoPago(token()) : null),
    ehAdmin,
    tokenDeTeste: () => token().startsWith("TEST-"),
    site: Deno.env.get("SITE_URL") || "https://caduveloso.github.io/brecho-natasha/",
    urlFuncao: `${URL_SUPABASE}/functions/v1/pagamento`,
    urlFotos: `${URL_SUPABASE}/storage/v1/object/public/pecas`,
  }),
);
