// Regras do pagamento pelo Mercado Pago, sem acesso à rede (fáceis de testar).

/** Tempo que a cliente tem para pagar depois de fazer o pedido. */
export const RESERVA_MINUTOS = 120;
/** Um PIX gerado no fim da reserva ainda pode ser pago por mais este tempo. */
export const PIX_FOLGA_MINUTOS = 30;
/** A reserva só cai depois que nenhum PIX do pedido pode mais ser pago. */
export const VENCIDOS_FOLGA_MINUTOS = 45;

export type Situacao = "pendente" | "em_analise" | "aprovado" | "recusado" | "devolvido";

export type ItemPedido = {
  titulo: string;
  preco: number | string;
  foto: string | null;
  codigo: number | null;
};

/** O pedido como a função pagamento_pedido devolve. */
export type PedidoPagamento = {
  id: string;
  numero: number;
  status: string;
  criado_em: string;
  nome: string;
  telefone: string;
  email: string;
  cpf: string;
  entrega: string;
  cep: string;
  end_rua: string;
  end_numero: string;
  total: number | string;
  frete_valor: number | string | null;
  frete_nome: string;
  frete_empresa: string;
  frete_prazo: number | null;
  pagamento_situacao: string;
  pagamento_forma: string;
  pagamento_parcelas: number | null;
  pagamento_id: string;
  pagamento_link: string;
  pagamento_limite: string | null;
  pago_em: string | null;
  online: boolean;
  itens: ItemPedido[];
};

/** O que usamos de um pagamento do Mercado Pago (GET /v1/payments/{id}). */
export type PagamentoMP = {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number | string;
  payment_method_id?: string;
  payment_type_id?: string;
  installments?: number;
  date_approved?: string | null;
  date_created?: string;
  external_reference?: string | null;
};

export function soDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

export function uuidValido(valor: unknown): string | null {
  const s = String(valor ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

export function centavos(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function limitar(texto: string, max: number): string {
  const t = texto.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Data e hora no formato dos exemplos do Mercado Pago, no horário de Brasília (UTC-3). */
export function dataMP(data: Date): string {
  return new Date(data.getTime() - 3 * 3600_000).toISOString().replace("Z", "-03:00");
}

/** Caminho da miniatura de uma foto (o painel grava "foto.webp" e "foto_p.webp"). */
function miniatura(caminho: string): string {
  return caminho.replace(/(\.\w+)$/, "_p$1");
}

export function nomeDoFrete(p: { frete_nome: string; frete_empresa: string }): string {
  const empresa = (p.frete_empresa || "").trim();
  const nome = (p.frete_nome || "").trim();
  return nome.toLowerCase().startsWith(empresa.toLowerCase()) ? nome : `${empresa} ${nome}`.trim();
}

/** Corpo da preferência do Checkout Pro para um pedido. */
export function montarPreferencia(
  pedido: PedidoPagamento,
  opcoes: { site: string; aviso: string; fotos: string; limite: Date; agora: Date },
) {
  const itens: Record<string, unknown>[] = pedido.itens.map((i, n) => ({
    id: i.codigo ? `peca-${i.codigo}` : `item-${n + 1}`,
    title: limitar(i.titulo || "Peça", 250),
    quantity: 1,
    unit_price: centavos(i.preco),
    currency_id: "BRL",
    ...(i.foto && !/^https?:/.test(i.foto)
      ? { picture_url: `${opcoes.fotos}/${miniatura(i.foto).split("/").map(encodeURIComponent).join("/")}` }
      : {}),
  }));
  const frete = centavos(pedido.frete_valor ?? 0);
  if (frete > 0) {
    itens.push({
      id: "frete",
      title: limitar(`Frete ${nomeDoFrete(pedido)}`, 250),
      quantity: 1,
      unit_price: frete,
      currency_id: "BRL",
    });
  }

  const [nome, ...sobrenome] = pedido.nome.trim().split(/\s+/);
  const pagador: Record<string, unknown> = { name: nome || "Cliente" };
  if (sobrenome.length) pagador.surname = sobrenome.join(" ");
  if (emailValido(pedido.email || "")) pagador.email = pedido.email.trim();
  const telefone = soDigitos(pedido.telefone).replace(/^55(?=\d{10,11}$)/, "");
  if (telefone.length === 10 || telefone.length === 11) {
    pagador.phone = { area_code: telefone.slice(0, 2), number: telefone.slice(2) };
  }
  const cpf = soDigitos(pedido.cpf);
  if (cpf.length === 11) pagador.identification = { type: "CPF", number: cpf };

  const volta = `${opcoes.site}?pedido=${pedido.id}`;
  return {
    items: itens,
    payer: pagador,
    external_reference: pedido.id,
    back_urls: { success: volta, pending: volta, failure: volta },
    auto_return: "approved",
    notification_url: opcoes.aviso,
    // Boleto demora dias para compensar, mais do que a reserva das peças.
    payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
    expires: true,
    expiration_date_from: dataMP(new Date(opcoes.agora.getTime() - 60_000)),
    expiration_date_to: dataMP(opcoes.limite),
    // Vale para o PIX: depois disso o QR code não pode mais ser pago.
    date_of_expiration: dataMP(new Date(opcoes.limite.getTime() + PIX_FOLGA_MINUTOS * 60_000)),
  };
}

/** Traduz a situação do Mercado Pago para a do pedido. */
export function situacaoDoMercadoPago(status: unknown): Situacao | null {
  switch (String(status ?? "")) {
    case "approved":
      return "aprovado";
    case "authorized":
    case "in_process":
    case "in_mediation":
      return "em_analise";
    case "pending":
      return "pendente";
    case "rejected":
    case "cancelled":
      return "recusado";
    case "refunded":
    case "charged_back":
      return "devolvido";
    default:
      return null;
  }
}

export function formaDoPagamento(p: PagamentoMP): string {
  const tipo = String(p.payment_type_id ?? "");
  const metodo = String(p.payment_method_id ?? "");
  if (metodo === "pix" || tipo === "bank_transfer") return "PIX";
  if (tipo === "credit_card") return "Cartão de crédito";
  if (tipo === "debit_card" || tipo === "prepaid_card") return "Cartão de débito";
  if (tipo === "account_money") return "Saldo no Mercado Pago";
  if (tipo === "digital_currency" || metodo === "consumer_credits") return "Mercado Crédito";
  if (tipo === "ticket") return "Boleto";
  return "Mercado Pago";
}

/** O que gravamos no pedido (formato esperado por aplicar_pagamento). */
export function resumoDoPagamento(p: PagamentoMP) {
  const situacao = situacaoDoMercadoPago(p.status);
  if (!situacao || p.id === undefined || p.id === null || String(p.id) === "") return null;
  const valor = Number(p.transaction_amount);
  return {
    id: String(p.id),
    status_mp: String(p.status),
    situacao,
    valor: Number.isFinite(valor) ? centavos(valor) : null,
    forma: formaDoPagamento(p),
    parcelas: p.payment_type_id === "credit_card" ? Math.max(1, Number(p.installments) || 1) : null,
    aprovado_em: situacao === "aprovado" ? p.date_approved || null : null,
  };
}

const PESO: Record<Situacao, number> = { aprovado: 0, em_analise: 1, pendente: 2, recusado: 3, devolvido: 4 };

/** Entre as tentativas de um pedido, a que decide: aprovada, depois em análise, pendente, recusada. */
export function pagamentoPrincipal(lista: PagamentoMP[]): PagamentoMP | null {
  const validos = lista.filter((p) => situacaoDoMercadoPago(p.status));
  validos.sort((a, b) => {
    const pa = PESO[situacaoDoMercadoPago(a.status)!];
    const pb = PESO[situacaoDoMercadoPago(b.status)!];
    if (pa !== pb) return pa - pb;
    return String(b.date_created ?? "").localeCompare(String(a.date_created ?? ""));
  });
  return validos[0] ?? null;
}

/** O pedido ainda pode receber pagamento pelo site? */
export function podePagar(p: PedidoPagamento, agora: Date): boolean {
  if (p.status !== "novo") return false;
  if (!["", "aguardando", "pendente", "recusado"].includes(p.pagamento_situacao)) return false;
  if (p.pagamento_limite) return new Date(p.pagamento_limite).getTime() > agora.getTime();
  // Pedido feito com a cobrança desligada não passa a ter prazo depois.
  return agora.getTime() - new Date(p.criado_em).getTime() < RESERVA_MINUTOS * 60_000;
}

export function motivoSemPagamento(p: PedidoPagamento, agora: Date): string {
  if (["pago", "enviado", "concluido"].includes(p.status) || p.pagamento_situacao === "aprovado") {
    return "Este pedido já está pago.";
  }
  if (p.status === "cancelado") return "A reserva deste pedido terminou.";
  if (p.pagamento_situacao === "em_analise") return "O pagamento está em análise no Mercado Pago. Aguarde a confirmação.";
  if (p.pagamento_situacao === "divergente" || p.pagamento_situacao === "devolvido") {
    return "Vamos falar com você pelo WhatsApp sobre o pagamento deste pedido.";
  }
  if (p.pagamento_limite && new Date(p.pagamento_limite).getTime() <= agora.getTime()) {
    return "O prazo para pagar este pedido terminou.";
  }
  return "Este pedido é pago pelo WhatsApp. Vamos chamar você por lá.";
}

/** O que o site pode mostrar do pedido (sem dados pessoais). */
export function pedidoPublico(p: PedidoPagamento, agora: Date) {
  const temFrete = p.frete_valor !== null && p.frete_valor !== undefined;
  return {
    numero: p.numero,
    status: p.status,
    situacao: p.pagamento_situacao,
    forma: p.pagamento_forma,
    parcelas: p.pagamento_parcelas,
    limite: p.pagamento_limite,
    pago_em: p.pago_em,
    entrega: p.entrega,
    total: centavos(p.total),
    frete: temFrete
      ? { valor: centavos(p.frete_valor), nome: p.frete_nome, empresa: p.frete_empresa, prazo_max: p.frete_prazo }
      : null,
    itens: p.itens.map((i) => ({ titulo: i.titulo, preco: centavos(i.preco), foto: i.foto, codigo: i.codigo })),
    pode_pagar: podePagar(p, agora),
  };
}
