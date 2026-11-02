// Cliente mínimo da API do Melhor Envio (https://docs.melhorenvio.com.br).
import { mensagemDoErro } from "./regras.ts";

export class ErroMelhorEnvio extends Error {
  constructor(public status: number, mensagem: string, public dados: unknown) {
    super(mensagem);
  }
}

export class MelhorEnvio {
  constructor(
    private token: string,
    private sandbox: boolean,
    private agente: string,
    private buscar: typeof fetch = fetch,
  ) {}

  get base() {
    return this.sandbox ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
  }

  async pedir<T = unknown>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const resposta = await this.buscar(`${this.base}${caminho}`, {
      method: metodo,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": this.agente,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(25000),
    });
    const texto = await resposta.text();
    let dados: unknown = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = texto;
    }
    if (!resposta.ok) throw new ErroMelhorEnvio(resposta.status, mensagemDoErro(dados, resposta.status), dados);
    return dados as T;
  }

  cotar(corpo: unknown) {
    return this.pedir<unknown[]>("POST", "/api/v2/me/shipment/calculate", corpo);
  }

  conta() {
    return this.pedir<{ firstname?: string; lastname?: string; email?: string }>("GET", "/api/v2/me");
  }

  saldo() {
    return this.pedir<{ balance?: number | string; reserved?: number | string; debts?: number | string }>(
      "GET",
      "/api/v2/me/balance",
    );
  }

  transportadoras() {
    return this.pedir<unknown[]>("GET", "/api/v2/me/shipment/companies");
  }

  agencias(empresa: number, uf: string, cidade: string) {
    const q = new URLSearchParams({ company: String(empresa), country: "BR", state: uf, city: cidade });
    return this.pedir<unknown[]>("GET", `/api/v2/me/shipment/agencies?${q}`);
  }

  adicionarAoCarrinho(corpo: unknown) {
    return this.pedir<{ id: string }>("POST", "/api/v2/me/cart", corpo);
  }

  removerDoCarrinho(id: string) {
    return this.pedir("DELETE", `/api/v2/me/cart/${encodeURIComponent(id)}`);
  }

  comprar(ids: string[]) {
    return this.pedir<{ purchase?: { total?: number | string } }>("POST", "/api/v2/me/shipment/checkout", { orders: ids });
  }

  gerar(ids: string[]) {
    return this.pedir("POST", "/api/v2/me/shipment/generate", { orders: ids });
  }

  imprimir(ids: string[]) {
    return this.pedir<{ url?: string }>("POST", "/api/v2/me/shipment/print", { mode: "public", orders: ids });
  }

  rastrear(ids: string[]) {
    return this.pedir<Record<string, { tracking?: string | null; status?: string }>>(
      "POST",
      "/api/v2/me/shipment/tracking",
      { orders: ids },
    );
  }

  cancelar(id: string) {
    return this.pedir("POST", "/api/v2/me/shipment/cancel", {
      order: { id, reason_id: "2", description: "Pedido cancelado pela loja" },
    });
  }
}
