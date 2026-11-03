// Atendimento da Edge Function "pagamento", separado do Deno.serve para poder ser testado.
import { ErroMercadoPago, type MercadoPago } from "./mercado-pago.ts";
import {
  montarPreferencia,
  motivoSemPagamento,
  type PagamentoMP,
  pagamentoPrincipal,
  type PedidoPagamento,
  pedidoPublico,
  podePagar,
  RESERVA_MINUTOS,
  resumoDoPagamento,
  situacaoDoMercadoPago,
  soDigitos,
  uuidValido,
  VENCIDOS_FOLGA_MINUTOS,
} from "./regras.ts";

/** O suficiente do cliente do Supabase: só chamamos funções do banco. */
export type Banco = {
  rpc: (
    nome: string,
    argumentos?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type Ambiente = {
  banco: () => Banco;
  /** null quando o Access Token do Mercado Pago não está configurado */
  mercadoPago: () => MercadoPago | null;
  ehAdmin: (req: Request) => Promise<boolean>;
  tokenDeTeste?: () => boolean;
  /** endereço da loja, para onde o Mercado Pago devolve a cliente */
  site: string;
  /** endereço público desta função, para os avisos do Mercado Pago */
  urlFuncao: string;
  /** endereço público das fotos das peças */
  urlFotos: string;
  agora?: () => Date;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function descreverErro(e: unknown) {
  return e instanceof ErroMercadoPago ? `${e.status} ${e.message}` : e;
}

export function criarApp(amb: Ambiente) {
  const agora = amb.agora ?? (() => new Date());

  async function rpc<T>(nome: string, argumentos: Record<string, unknown>): Promise<T> {
    const { data, error } = await amb.banco().rpc(nome, argumentos);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data as T;
  }

  const carregar = (id: string) => rpc<PedidoPagamento | null>("pagamento_pedido", { p_pedido: id });

  async function aplicar(id: string, pagamento: PagamentoMP) {
    const resumo = resumoDoPagamento(pagamento);
    if (!resumo) return null;
    return await rpc<{ ok: boolean; situacao?: string }>("aplicar_pagamento", { p_pedido: id, p_pagamento: resumo });
  }

  /* ---------------------------------------------------------------- */
  /* Site                                                              */
  /* ---------------------------------------------------------------- */

  /** Abre (ou reaproveita) o pagamento do pedido no Mercado Pago. */
  async function acaoCriar(corpo: Record<string, unknown>) {
    const id = uuidValido(corpo.pedido);
    if (!id) return json({ ok: false, erro: "Pedido inválido." }, 400);
    const pedido = await carregar(id);
    if (!pedido) return json({ ok: false, erro: "Pedido não encontrado." }, 404);

    const mp = amb.mercadoPago();
    if (!mp || !pedido.online) {
      return json({
        ok: false,
        desligado: true,
        erro: "O pagamento pelo site está desligado agora. Vamos combinar o pagamento pelo WhatsApp.",
      });
    }
    const t = agora();
    if (!podePagar(pedido, t)) {
      return json({ ok: false, erro: motivoSemPagamento(pedido, t), pedido: pedidoPublico(pedido, t) });
    }
    if (pedido.pagamento_link && pedido.pagamento_limite && new Date(pedido.pagamento_limite) > t) {
      return json({ ok: true, link: pedido.pagamento_link, limite: pedido.pagamento_limite });
    }

    const limite = pedido.pagamento_limite
      ? new Date(pedido.pagamento_limite)
      : new Date(t.getTime() + RESERVA_MINUTOS * 60_000);
    const preferencia = await mp.criarPreferencia(
      montarPreferencia(pedido, {
        site: amb.site,
        aviso: `${amb.urlFuncao}?aviso=mp&source_news=webhooks`,
        fotos: amb.urlFotos,
        limite,
        agora: t,
      }),
    );
    const link = (amb.tokenDeTeste?.() ? preferencia.sandbox_init_point : "") || preferencia.init_point ||
      preferencia.sandbox_init_point || "";
    if (!link) throw new Error("O Mercado Pago não devolveu o link de pagamento.");
    await rpc<boolean>("pagamento_salvar_link", {
      p_pedido: id,
      p_preferencia: String(preferencia.id ?? ""),
      p_link: link,
      p_limite: limite.toISOString(),
    });
    return json({ ok: true, link, limite: limite.toISOString() });
  }

  /**
   * Situação do pedido para a página de volta do pagamento.
   * Com o número do pagamento (vindo do Mercado Pago na volta) ou verificar=true,
   * confere direto no Mercado Pago, sem esperar o aviso chegar.
   */
  async function acaoSituacao(corpo: Record<string, unknown>) {
    const id = uuidValido(corpo.pedido);
    if (!id) return json({ ok: false, erro: "Pedido inválido." }, 400);
    let pedido = await carregar(id);
    if (!pedido) return json({ ok: false, erro: "Pedido não encontrado." }, 404);

    const mp = amb.mercadoPago();
    const emAberto = ["aguardando", "pendente", "em_analise", "recusado"].includes(pedido.pagamento_situacao);
    const numeroPagamento = soDigitos(corpo.pagamento).slice(0, 20);
    if (mp && emAberto && (numeroPagamento || corpo.verificar === true)) {
      try {
        if (numeroPagamento) {
          const pagamento = await mp.pagamento(numeroPagamento);
          if (uuidValido(pagamento.external_reference) === id) await aplicar(id, pagamento);
        } else {
          const principal = pagamentoPrincipal(await mp.pagamentosDoPedido(id));
          if (principal) await aplicar(id, principal);
        }
        pedido = (await carregar(id)) ?? pedido;
      } catch (e) {
        console.error("Não consegui conferir o pagamento no Mercado Pago", descreverErro(e));
      }
    }
    return json({ ok: true, pedido: pedidoPublico(pedido, agora()) });
  }

  /** Cancela os pedidos com a reserva vencida e sem pagamento (chamada a cada 10 minutos). */
  async function acaoExpirar() {
    const mp = amb.mercadoPago();
    if (!mp) return json({ ok: true, conferidos: 0, cancelados: 0 });
    const ids = await rpc<string[]>("pagamento_vencidos", { p_folga_minutos: VENCIDOS_FOLGA_MINUTOS });
    let conferidos = 0;
    let cancelados = 0;
    for (const id of ids ?? []) {
      try {
        const principal = pagamentoPrincipal(await mp.pagamentosDoPedido(id));
        conferidos++;
        if (principal) {
          await aplicar(id, principal);
          const situacao = situacaoDoMercadoPago(principal.status);
          if (situacao === "aprovado" || situacao === "em_analise") continue;
        }
        if (await rpc<boolean>("expirar_pedido", { p_pedido: id })) cancelados++;
      } catch (e) {
        console.error(`Não consegui conferir o pedido ${id}`, descreverErro(e));
      }
    }
    return json({ ok: true, conferidos, cancelados });
  }

  /* ---------------------------------------------------------------- */
  /* Mercado Pago                                                      */
  /* ---------------------------------------------------------------- */

  /** Aviso de pagamento (Webhooks). Lemos o pagamento direto na API, então o aviso não precisa ser confiável. */
  async function receberAviso(req: Request, url: URL) {
    let corpo: Record<string, unknown> = {};
    try {
      const texto = await req.text();
      corpo = texto ? JSON.parse(texto) : {};
    } catch {
      corpo = {};
    }
    const dados = (corpo.data ?? {}) as Record<string, unknown>;
    const tipo = String(corpo.type ?? corpo.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
    const numero = soDigitos(
      dados.id ?? url.searchParams.get("data.id") ?? (tipo === "payment" ? url.searchParams.get("id") : ""),
    ).slice(0, 20);
    if (tipo !== "payment" || !numero) return new Response("ok");

    const mp = amb.mercadoPago();
    if (!mp) return new Response("ok");
    let pagamento: PagamentoMP;
    try {
      pagamento = await mp.pagamento(numero);
    } catch (e) {
      if (e instanceof ErroMercadoPago && e.status >= 400 && e.status < 500 && e.status !== 429) {
        return new Response("ok"); // pagamento que não é desta conta
      }
      console.error("Aviso do Mercado Pago: não consegui ler o pagamento", descreverErro(e));
      return new Response("tente de novo", { status: 500 });
    }
    const id = uuidValido(pagamento.external_reference);
    if (id) await aplicar(id, pagamento);
    return new Response("ok");
  }

  /* ---------------------------------------------------------------- */
  /* Painel                                                            */
  /* ---------------------------------------------------------------- */

  async function acaoStatus() {
    const mp = amb.mercadoPago();
    if (!mp) return json({ ok: true, conectado: false });
    try {
      const conta = await mp.conta();
      return json({
        ok: true,
        conectado: true,
        teste: Boolean(amb.tokenDeTeste?.()),
        conta: { id: conta.id, apelido: conta.nickname ?? "", email: conta.email ?? "" },
      });
    } catch (e) {
      if (e instanceof ErroMercadoPago && (e.status === 401 || e.status === 403)) {
        return json({
          ok: true,
          conectado: false,
          erro: "O Mercado Pago não aceitou o token. Confira se colou o Access Token de produção inteiro.",
        });
      }
      throw e;
    }
  }

  return async function atender(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const url = new URL(req.url);
    if (url.searchParams.get("aviso") === "mp") {
      try {
        return await receberAviso(req, url);
      } catch (e) {
        console.error("Erro no aviso do Mercado Pago", descreverErro(e));
        return new Response("tente de novo", { status: 500 });
      }
    }
    if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, 405);

    let corpo: Record<string, unknown>;
    try {
      corpo = await req.json();
    } catch {
      return json({ ok: false, erro: "Corpo inválido." }, 400);
    }
    const acao = String(corpo?.acao ?? "");
    try {
      switch (acao) {
        case "criar":
          return await acaoCriar(corpo);
        case "situacao":
          return await acaoSituacao(corpo);
        case "expirar":
          return await acaoExpirar();
        case "status":
          if (!(await amb.ehAdmin(req))) return json({ ok: false, erro: "Acesso restrito." }, 403);
          return await acaoStatus();
        default:
          return json({ ok: false, erro: "Ação desconhecida." }, 400);
      }
    } catch (e) {
      console.error(`Erro na ação ${acao}`, descreverErro(e));
      return json({ ok: false, erro: "Não foi possível falar com o Mercado Pago agora. Tente de novo em instantes." }, 500);
    }
  };
}
