// Cliente mínimo da API do Mercado Pago (Checkout Pro).
import type { PagamentoMP } from "./regras.ts";

export class ErroMercadoPago extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly corpo?: unknown,
  ) {
    super(mensagem);
  }
}

export function mensagemDoErro(dados: unknown): string {
  if (dados && typeof dados === "object") {
    const d = dados as { message?: unknown; error?: unknown; cause?: { description?: unknown }[] };
    return String(d.message || d.cause?.[0]?.description || d.error || "");
  }
  return typeof dados === "string" ? dados.slice(0, 200) : "";
}

export type Preferencia = { id: string; init_point?: string; sandbox_init_point?: string };
export type Conta = { id: number; nickname?: string; email?: string; site_id?: string };

export class MercadoPago {
  constructor(
    private readonly token: string,
    private readonly base = "https://api.mercadopago.com",
  ) {}

  private async chamar<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
    const resposta = await fetch(`${this.base}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await resposta.text();
    let dados: unknown = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = texto;
    }
    if (!resposta.ok) {
      throw new ErroMercadoPago(resposta.status, mensagemDoErro(dados) || `Mercado Pago respondeu ${resposta.status}`, dados);
    }
    return dados as T;
  }

  criarPreferencia(corpo: unknown): Promise<Preferencia> {
    return this.chamar<Preferencia>("POST", "/checkout/preferences", corpo);
  }

  pagamento(id: string): Promise<PagamentoMP> {
    return this.chamar<PagamentoMP>("GET", `/v1/payments/${encodeURIComponent(id)}`);
  }

  async pagamentosDoPedido(referencia: string): Promise<PagamentoMP[]> {
    const busca = new URLSearchParams({
      external_reference: referencia,
      sort: "date_created",
      criteria: "desc",
      limit: "30",
    });
    const dados = await this.chamar<{ results?: PagamentoMP[] }>("GET", `/v1/payments/search?${busca}`);
    return Array.isArray(dados?.results) ? dados.results : [];
  }

  conta(): Promise<Conta> {
    return this.chamar<Conta>("GET", "/users/me");
  }
}
