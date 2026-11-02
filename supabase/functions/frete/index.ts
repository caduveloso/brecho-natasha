// Edge Function: frete
// Cotação de frete no checkout, pedido com frete e etiquetas de envio, pelo Melhor Envio.
//
// Segredos (Supabase > Edge Functions > Secrets):
//   MELHOR_ENVIO_TOKEN    token da conta no Melhor Envio (sem ele, o site combina o frete pelo WhatsApp)
//   MELHOR_ENVIO_SANDBOX  "true" para usar o ambiente de testes do Melhor Envio (opcional)
//
// Ações públicas (site): ativo, cotar, pedido.
// Ações do painel (só administradoras): status, transportadoras, agencias, etiqueta, imprimir, cancelar.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ErroMelhorEnvio, MelhorEnvio } from "./melhor-envio.ts";
import {
  cepValido,
  corpoDaCotacao,
  cpfValido,
  type Endereco,
  ehFaltaDeSaldo,
  enderecoEmTexto,
  faltasDoRemetente,
  lerCotacao,
  montarCarrinho,
  opcaoPublica,
  pacoteUnico,
  type PecaFrete,
  soDigitos,
} from "./regras.ts";

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

class ErroDoPedido extends Error {}

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

const URL_SUPABASE = Deno.env.get("SUPABASE_URL") ?? "";

function bancoDoServidor(): SupabaseClient {
  return createClient(URL_SUPABASE, chave("servico"), { auth: { persistSession: false } });
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

type Config = Endereco & {
  transportadoras: string[];
  agencias: Record<string, number>;
  declarar_valor: boolean;
  dias_postagem: number;
};

const CONFIG_VAZIA: Config = {
  nome: "",
  telefone: "",
  email: "",
  documento: "",
  cep: "",
  rua: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  transportadoras: ["Correios", "Jadlog", "Loggi"],
  agencias: {},
  declarar_valor: true,
  dias_postagem: 2,
};

async function carregarConfig(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from("envio_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return { ...CONFIG_VAZIA, ...(data ?? {}) };
}

function tokenMelhorEnvio() {
  return Deno.env.get("MELHOR_ENVIO_TOKEN")?.trim() ?? "";
}

function emSandbox() {
  return /^(1|true|sim)$/i.test(Deno.env.get("MELHOR_ENVIO_SANDBOX") ?? "");
}

function clienteMelhorEnvio(cfg: Config): MelhorEnvio | null {
  const token = tokenMelhorEnvio();
  if (!token) return null;
  // O Melhor Envio pede um e-mail de contato técnico no User-Agent.
  return new MelhorEnvio(token, emSandbox(), `Brecho da Natasha (${cfg.email || "sem e-mail"})`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsValidos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(String).filter((x) => UUID.test(x)))].slice(0, 30);
}

type LinhaPeca = {
  id: string;
  titulo: string;
  preco: number | string | null;
  peso_g: number | null;
  status: string;
  categorias: { slug: string } | { slug: string }[] | null;
};

function paraPecaFrete(p: LinhaPeca): PecaFrete {
  const categoria = Array.isArray(p.categorias) ? p.categorias[0] : p.categorias;
  return {
    id: p.id,
    titulo: p.titulo,
    preco: Number(p.preco) || 0,
    peso_g: p.peso_g,
    categoria_slug: categoria?.slug ?? null,
  };
}

async function carregarPecas(db: SupabaseClient, ids: string[]) {
  const { data, error } = await db
    .from("pecas")
    .select("id,titulo,preco,peso_g,status,categorias(slug)")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as unknown as LinhaPeca[];
}

/* ------------------------------------------------------------------ */
/* Ações públicas                                                      */
/* ------------------------------------------------------------------ */

async function acaoAtivo(db: SupabaseClient) {
  const cfg = await carregarConfig(db);
  return json({ ok: true, ativo: Boolean(tokenMelhorEnvio()) && cepValido(cfg.cep) });
}

async function acaoCotar(db: SupabaseClient, corpo: Record<string, unknown>) {
  const cep = soDigitos(corpo.cep);
  if (!cepValido(cep)) return json({ ok: false, erro: "CEP inválido." }, 400);
  const ids = idsValidos(corpo.pecas);
  if (!ids.length) return json({ ok: false, erro: "Sua sacola está vazia." }, 400);

  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  if (!me || !cepValido(cfg.cep)) return json({ ok: true, ativo: false, opcoes: [] });

  const pecas = (await carregarPecas(db, ids)).filter((p) => p.status === "disponivel").map(paraPecaFrete);
  if (!pecas.length) return json({ ok: false, erro: "As peças da sacola não estão mais disponíveis." }, 409);

  try {
    const resposta = await me.cotar(corpoDaCotacao(cfg.cep, cep, pecas, cfg.declarar_valor));
    const opcoes = lerCotacao(resposta, cfg.transportadoras, cfg.dias_postagem);
    return json({ ok: true, ativo: true, opcoes: opcoes.map(opcaoPublica) });
  } catch (e) {
    console.error("Cotação falhou", e instanceof ErroMelhorEnvio ? `${e.status} ${e.message}` : e);
    return json({ ok: false, ativo: true, erro: "Não foi possível calcular o frete agora." });
  }
}

async function acaoPedido(db: SupabaseClient, corpo: Record<string, unknown>) {
  const d = (corpo.dados ?? {}) as Record<string, string>;
  const texto = (k: string, max = 160) => String(d[k] ?? "").trim().slice(0, max);
  const end = {
    rua: texto("rua"),
    numero: texto("numero", 20),
    complemento: texto("complemento", 80),
    bairro: texto("bairro", 80),
    cidade: texto("cidade", 80),
    uf: texto("uf", 2).toUpperCase(),
  };
  const faltas: string[] = [];
  if (!texto("nome")) faltas.push("seu nome");
  if (soDigitos(d.telefone).length < 10) faltas.push("um WhatsApp com DDD");
  if (!cpfValido(d.cpf)) faltas.push("um CPF válido");
  if (!cepValido(d.cep)) faltas.push("o CEP");
  if (!end.rua || !end.numero || !end.bairro || !end.cidade || !/^[A-Z]{2}$/.test(end.uf)) {
    faltas.push("o endereço completo");
  }
  if (faltas.length) return json({ ok: false, erro: `Falta informar ${faltas.join(", ")}.` }, 400);

  const ids = idsValidos(corpo.pecas);
  if (!ids.length) return json({ ok: false, erro: "Sua sacola está vazia." }, 400);
  const servico = Number(corpo.servico);
  if (!Number.isInteger(servico) || servico <= 0) return json({ ok: false, erro: "Escolha uma opção de frete." }, 400);

  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  if (!me || !cepValido(cfg.cep)) {
    return json({ ok: false, recotar: true, erro: "O cálculo de frete foi desligado. Atualize a página e tente de novo." });
  }

  const linhas = await carregarPecas(db, ids);
  const disponiveis = linhas.filter((p) => p.status === "disponivel");
  if (disponiveis.length < ids.length) {
    const ok = new Set(disponiveis.map((p) => p.id));
    return json({ ok: false, indisponiveis: ids.filter((id) => !ok.has(id)) });
  }

  let escolhida;
  try {
    const resposta = await me.cotar(corpoDaCotacao(cfg.cep, d.cep, disponiveis.map(paraPecaFrete), cfg.declarar_valor));
    escolhida = lerCotacao(resposta, cfg.transportadoras, cfg.dias_postagem).find((o) => o.id === servico);
  } catch (e) {
    console.error("Cotação do pedido falhou", e instanceof ErroMelhorEnvio ? `${e.status} ${e.message}` : e);
    return json({ ok: false, erro: "Não foi possível confirmar o frete agora. Tente de novo em instantes." });
  }
  if (!escolhida) {
    return json({ ok: false, recotar: true, erro: "Essa opção de frete não está mais disponível. Escolha outra." });
  }

  const cep = soDigitos(d.cep);
  const { data, error } = await db.rpc("fazer_pedido_com_frete", {
    p_nome: texto("nome", 120),
    p_telefone: texto("telefone", 40),
    p_email: texto("email"),
    p_entrega: "envio",
    p_endereco: enderecoEmTexto(end),
    p_cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    p_observacoes: String(d.observacoes ?? "").slice(0, 1000),
    p_pecas: ids,
    p_cpf: soDigitos(d.cpf),
    p_end: end,
    p_frete: {
      servico: escolhida.id,
      nome: escolhida.nome,
      empresa: escolhida.empresa,
      valor: escolhida.valor,
      prazo: escolhida.prazo_max,
    },
  });
  if (error) return json({ ok: false, erro: error.message }, 400);
  return json({ ...(data as Record<string, unknown>), frete: opcaoPublica(escolhida) });
}

/* ------------------------------------------------------------------ */
/* Ações do painel                                                     */
/* ------------------------------------------------------------------ */

async function acaoStatus(db: SupabaseClient) {
  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  const resultado: Record<string, unknown> = {
    ok: true,
    token: Boolean(me),
    sandbox: emSandbox(),
    faltas: faltasDoRemetente(cfg),
    valido: null,
    conta: null,
    saldo: null,
    erro: "",
  };
  if (me) {
    try {
      const c = await me.conta();
      resultado.valido = true;
      resultado.conta = { nome: `${c?.firstname ?? ""} ${c?.lastname ?? ""}`.trim(), email: c?.email ?? "" };
    } catch (e) {
      resultado.valido = false;
      resultado.erro = e instanceof Error ? e.message : String(e);
    }
    if (resultado.valido) {
      try {
        const s = await me.saldo();
        resultado.saldo = Number(s?.balance ?? 0);
      } catch {
        /* o saldo é só informativo */
      }
    }
  }
  return json(resultado);
}

const TRANSPORTADORAS_CONHECIDAS = ["Correios", "Jadlog", "Loggi", "J&T Express", "Azul Cargo Express", "LATAM Cargo", "Buslog"];

async function acaoTransportadoras(db: SupabaseClient) {
  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  let lista: { id: number | null; nome: string; servicos: string[] }[] = [];
  if (me) {
    try {
      const resposta = await me.transportadoras();
      if (Array.isArray(resposta)) {
        lista = resposta
          // deno-lint-ignore no-explicit-any
          .map((c: any) => ({
            id: Number(c?.id) || null,
            nome: String(c?.name ?? "").trim(),
            // deno-lint-ignore no-explicit-any
            servicos: Array.isArray(c?.services) ? c.services.map((s: any) => String(s?.name ?? "")).filter(Boolean) : [],
          }))
          .filter((c) => c.nome);
      }
    } catch (e) {
      console.warn("Lista de transportadoras indisponível", e);
    }
  }
  if (!lista.length) lista = TRANSPORTADORAS_CONHECIDAS.map((nome) => ({ id: null, nome, servicos: [] }));
  return json({ ok: true, transportadoras: lista });
}

async function acaoAgencias(db: SupabaseClient, corpo: Record<string, unknown>) {
  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  const empresa = Number(corpo.empresa);
  if (!me) return json({ ok: false, erro: "Cadastre o token do Melhor Envio primeiro." });
  if (!empresa || !cfg.cidade || !cfg.uf) return json({ ok: true, agencias: [] });
  try {
    const resposta = await me.agencias(empresa, cfg.uf, cfg.cidade);
    const agencias = (Array.isArray(resposta) ? resposta : [])
      // deno-lint-ignore no-explicit-any
      .map((a: any) => ({
        id: Number(a?.id) || null,
        nome: String(a?.name ?? "").trim(),
        endereco: [a?.address?.address, a?.address?.number, a?.address?.district].filter(Boolean).join(", "),
      }))
      .filter((a) => a.id)
      .slice(0, 80);
    return json({ ok: true, agencias });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) });
  }
}

type Pedido = {
  id: string;
  numero: number;
  status: string;
  entrega: string;
  nome: string;
  telefone: string;
  email: string;
  cpf: string;
  cep: string;
  end_rua: string;
  end_numero: string;
  end_complemento: string;
  end_bairro: string;
  end_cidade: string;
  end_uf: string;
  frete_servico: number | null;
  frete_nome: string;
  frete_empresa: string;
  etiqueta_ids: string[];
  etiqueta_status: string;
  etiqueta_url: string;
  etiqueta_rastreio: string;
  etiqueta_valor: number | null;
  pedido_itens: { peca_id: string | null; titulo: string; preco: number | string }[];
};

async function carregarPedido(db: SupabaseClient, id: unknown): Promise<Pedido> {
  if (!UUID.test(String(id ?? ""))) throw new ErroDoPedido("Pedido inválido.");
  const { data, error } = await db
    .from("pedidos")
    .select("*, pedido_itens(peca_id,titulo,preco)")
    .eq("id", String(id))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ErroDoPedido("Pedido não encontrado.");
  return data as Pedido;
}

async function pecasDoPedido(db: SupabaseClient, pedido: Pedido): Promise<PecaFrete[]> {
  const ids = pedido.pedido_itens.map((i) => i.peca_id).filter((x): x is string => Boolean(x));
  const linhas = ids.length ? await carregarPecas(db, ids) : [];
  const mapa = new Map(linhas.map((p) => [p.id, paraPecaFrete(p)]));
  return pedido.pedido_itens.map((i, n) =>
    (i.peca_id && mapa.get(i.peca_id)) || {
      id: i.peca_id ?? `item-${n}`,
      titulo: i.titulo,
      preco: Number(i.preco) || 0,
      peso_g: null,
      categoria_slug: null,
    }
  );
}

function destinatario(p: Pedido): Endereco {
  return {
    nome: p.nome,
    telefone: p.telefone,
    email: p.email,
    documento: p.cpf,
    cep: p.cep,
    rua: p.end_rua,
    numero: p.end_numero,
    complemento: p.end_complemento,
    bairro: p.end_bairro,
    cidade: p.end_cidade,
    uf: p.end_uf,
  };
}

function salvarNoPedido(db: SupabaseClient, pedido: Pedido) {
  return async (campos: Partial<Pedido> & Record<string, unknown>) => {
    const { error } = await db.from("pedidos").update(campos).eq("id", pedido.id);
    if (error) throw error;
    Object.assign(pedido, campos);
  };
}

async function atualizarImpressao(me: MelhorEnvio, pedido: Pedido, salvar: ReturnType<typeof salvarNoPedido>) {
  const ids = pedido.etiqueta_ids;
  let url = pedido.etiqueta_url;
  let rastreio = pedido.etiqueta_rastreio;
  try {
    const r = await me.imprimir(ids);
    if (r?.url) url = r.url;
  } catch (e) {
    console.warn("Impressão ainda indisponível", e instanceof Error ? e.message : e);
  }
  try {
    const r = await me.rastrear(ids);
    const codigos = ids.map((id) => r?.[id]?.tracking).filter((x): x is string => Boolean(x));
    if (codigos.length) rastreio = codigos.join(", ");
  } catch {
    /* o código de rastreio aparece depois da postagem */
  }
  await salvar({ etiqueta_url: url, etiqueta_rastreio: rastreio });
  return {
    ok: true,
    status: pedido.etiqueta_status,
    url,
    rastreio,
    valor: pedido.etiqueta_valor,
    aviso: url ? "" : "A etiqueta está sendo gerada. Clique em Imprimir etiqueta em alguns segundos.",
  };
}

async function acaoEtiqueta(db: SupabaseClient, corpo: Record<string, unknown>) {
  const pedido = await carregarPedido(db, corpo.pedido_id);
  if (pedido.entrega !== "envio") throw new ErroDoPedido("Este pedido é de retirada.");
  if (pedido.status === "cancelado") throw new ErroDoPedido("Este pedido está cancelado.");
  if (!pedido.frete_servico) {
    throw new ErroDoPedido("Este pedido não tem frete escolhido no site, então a etiqueta precisa ser feita no Melhor Envio.");
  }
  const cfg = await carregarConfig(db);
  const faltasRemetente = faltasDoRemetente(cfg);
  if (faltasRemetente.length) {
    throw new ErroDoPedido(`Complete os dados de quem envia em Loja › Envio: ${faltasRemetente.join(", ")}.`);
  }
  const para = destinatario(pedido);
  const faltasCliente = faltasDoRemetente({ ...para, email: para.email || cfg.email })
    .filter((f) => f !== "CPF ou CNPJ");
  if (!cpfValido(para.documento)) faltasCliente.unshift("CPF");
  if (faltasCliente.length) throw new ErroDoPedido(`Faltam dados da cliente: ${faltasCliente.join(", ")}.`);
  const me = clienteMelhorEnvio(cfg);
  if (!me) throw new ErroDoPedido("Cadastre o token do Melhor Envio no Supabase para gerar etiquetas.");

  const salvar = salvarNoPedido(db, pedido);
  try {
    if (!pedido.etiqueta_ids.length || ["", "cancelada"].includes(pedido.etiqueta_status)) {
      const pecas = await pecasDoPedido(db, pedido);
      const resposta = await me.cotar(corpoDaCotacao(cfg.cep, pedido.cep, pecas, cfg.declarar_valor, pedido.frete_servico));
      const opcao = lerCotacao(resposta, [], 0).find((o) => o.id === pedido.frete_servico);
      if (!opcao) {
        throw new ErroDoPedido(
          `${pedido.frete_empresa} ${pedido.frete_nome} não está disponível para este endereço agora. Gere a etiqueta direto no Melhor Envio.`,
        );
      }
      const pacotes = opcao.pacotes.length ? opcao.pacotes : [pacoteUnico(pecas)];
      const agencia = opcao.empresa_id ? Number(cfg.agencias?.[String(opcao.empresa_id)]) || null : null;
      const ids: string[] = [];
      for (const pacote of pacotes) {
        const r = await me.adicionarAoCarrinho(montarCarrinho({
          servico: opcao.id,
          agencia,
          de: cfg,
          para: { ...para, email: para.email || cfg.email },
          pacote,
          pecas,
          numeroPedido: pedido.numero,
          declararValor: cfg.declarar_valor,
          plataforma: "Brecho da Natasha",
        }));
        ids.push(String(r.id));
      }
      await salvar({
        etiqueta_ids: ids,
        etiqueta_status: "carrinho",
        etiqueta_url: "",
        etiqueta_rastreio: "",
        etiqueta_valor: null,
      });
    }
    if (pedido.etiqueta_status === "carrinho") {
      const r = await me.comprar(pedido.etiqueta_ids);
      const total = Number(r?.purchase?.total);
      await salvar({ etiqueta_status: "paga", etiqueta_valor: Number.isFinite(total) ? total : null });
    }
    if (pedido.etiqueta_status === "paga") {
      await me.gerar(pedido.etiqueta_ids);
      await salvar({ etiqueta_status: "gerada", etiqueta_em: new Date().toISOString() });
    }
  } catch (e) {
    if (e instanceof ErroMelhorEnvio && ehFaltaDeSaldo(e.message)) {
      return json({
        ok: false,
        motivo: "saldo",
        status: pedido.etiqueta_status,
        erro: "Falta saldo no Melhor Envio para pagar a etiqueta. Adicione saldo na conta e clique de novo em Gerar etiqueta.",
      });
    }
    if (e instanceof ErroMelhorEnvio || e instanceof ErroDoPedido) {
      return json({ ok: false, status: pedido.etiqueta_status, erro: e.message });
    }
    throw e;
  }
  return json(await atualizarImpressao(me, pedido, salvar));
}

async function acaoImprimir(db: SupabaseClient, corpo: Record<string, unknown>) {
  const pedido = await carregarPedido(db, corpo.pedido_id);
  if (pedido.etiqueta_status !== "gerada" || !pedido.etiqueta_ids.length) {
    throw new ErroDoPedido("A etiqueta deste pedido ainda não foi gerada.");
  }
  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  if (!me) throw new ErroDoPedido("Cadastre o token do Melhor Envio no Supabase.");
  return json(await atualizarImpressao(me, pedido, salvarNoPedido(db, pedido)));
}

async function acaoCancelar(db: SupabaseClient, corpo: Record<string, unknown>) {
  const pedido = await carregarPedido(db, corpo.pedido_id);
  if (!pedido.etiqueta_ids.length) throw new ErroDoPedido("Este pedido não tem etiqueta.");
  const cfg = await carregarConfig(db);
  const me = clienteMelhorEnvio(cfg);
  if (!me) throw new ErroDoPedido("Cadastre o token do Melhor Envio no Supabase.");
  try {
    for (const id of pedido.etiqueta_ids) {
      if (pedido.etiqueta_status === "carrinho") await me.removerDoCarrinho(id);
      else await me.cancelar(id);
    }
  } catch (e) {
    if (e instanceof ErroMelhorEnvio) return json({ ok: false, erro: e.message });
    throw e;
  }
  await salvarNoPedido(db, pedido)({
    etiqueta_status: "cancelada",
    etiqueta_ids: [],
    etiqueta_url: "",
    etiqueta_rastreio: "",
  });
  return json({ ok: true, status: "cancelada" });
}

/* ------------------------------------------------------------------ */

const PUBLICAS: Record<string, (db: SupabaseClient, corpo: Record<string, unknown>) => Promise<Response>> = {
  ativo: (db) => acaoAtivo(db),
  cotar: acaoCotar,
  pedido: acaoPedido,
};

const DO_PAINEL: Record<string, (db: SupabaseClient, corpo: Record<string, unknown>) => Promise<Response>> = {
  status: (db) => acaoStatus(db),
  transportadoras: (db) => acaoTransportadoras(db),
  agencias: acaoAgencias,
  etiqueta: acaoEtiqueta,
  imprimir: acaoImprimir,
  cancelar: acaoCancelar,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, 405);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ ok: false, erro: "Corpo inválido." }, 400);
  }
  const acao = String(corpo?.acao ?? "");

  try {
    const publica = PUBLICAS[acao];
    if (publica) return await publica(bancoDoServidor(), corpo);
    const doPainel = DO_PAINEL[acao];
    if (!doPainel) return json({ ok: false, erro: "Ação desconhecida." }, 400);
    if (!(await ehAdmin(req))) return json({ ok: false, erro: "Acesso restrito." }, 403);
    return await doPainel(bancoDoServidor(), corpo);
  } catch (e) {
    if (e instanceof ErroDoPedido) return json({ ok: false, erro: e.message });
    console.error(`Erro na ação ${acao}`, e);
    return json({ ok: false, erro: "Algo deu errado no frete. Tente de novo." }, 500);
  }
});
