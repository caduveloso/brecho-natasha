// Regras do frete: medidas das peças, leitura da cotação do Melhor Envio e
// montagem dos pedidos de etiqueta. Sem dependências, para testar fora do Supabase.

export type Medidas = { altura: number; largura: number; comprimento: number; peso: number };

/** Caixa e peso típicos de cada categoria (cm e kg), já contando a embalagem. */
export const MEDIDAS_POR_CATEGORIA: Record<string, Medidas> = {
  vestidos: { altura: 5, largura: 25, comprimento: 30, peso: 0.4 },
  blusas: { altura: 4, largura: 20, comprimento: 25, peso: 0.25 },
  calcas: { altura: 6, largura: 25, comprimento: 30, peso: 0.6 },
  saias: { altura: 4, largura: 25, comprimento: 30, peso: 0.35 },
  shorts: { altura: 4, largura: 20, comprimento: 25, peso: 0.3 },
  macacoes: { altura: 6, largura: 25, comprimento: 30, peso: 0.5 },
  casacos: { altura: 8, largura: 30, comprimento: 35, peso: 0.9 },
  tricos: { altura: 8, largura: 25, comprimento: 30, peso: 0.6 },
  bolsas: { altura: 15, largura: 30, comprimento: 35, peso: 0.8 },
  calcados: { altura: 13, largura: 22, comprimento: 33, peso: 1.0 },
  acessorios: { altura: 5, largura: 15, comprimento: 20, peso: 0.2 },
};

export const MEDIDAS_PADRAO: Medidas = { altura: 5, largura: 25, comprimento: 30, peso: 0.5 };

export type PecaFrete = {
  id: string;
  titulo: string;
  preco: number;
  peso_g: number | null;
  categoria_slug: string | null;
};

export type Endereco = {
  nome: string;
  telefone: string;
  email: string;
  documento: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type Pacote = {
  altura: number;
  largura: number;
  comprimento: number;
  peso: number;
  produtos: string[];
};

export type OpcaoFrete = {
  id: number;
  nome: string;
  empresa: string;
  empresa_id: number | null;
  valor: number;
  prazo_min: number;
  prazo_max: number;
  pacotes: Pacote[];
};

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

export function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cepValido(cep: unknown): boolean {
  return /^\d{8}$/.test(soDigitos(cep));
}

/** Confere os dígitos verificadores do CPF. */
export function cpfValido(cpf: unknown): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(d[tamanho])) return false;
  }
  return true;
}

/** Confere os dígitos verificadores do CNPJ. */
export function cnpjValido(cnpj: unknown): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calcular = (base: string) => {
    let pesoAtual = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * pesoAtual--;
      if (pesoAtual < 2) pesoAtual = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calcular(d.slice(0, 12)) === Number(d[12]) && calcular(d.slice(0, 13)) === Number(d[13]);
}

export function medidasDaPeca(p: PecaFrete): Medidas {
  const base = MEDIDAS_POR_CATEGORIA[p.categoria_slug ?? ""] ?? MEDIDAS_PADRAO;
  const peso = p.peso_g && p.peso_g > 0 ? p.peso_g / 1000 : base.peso;
  return { ...base, peso: Math.round(peso * 1000) / 1000 };
}

/** Lista de produtos no formato da cotação do Melhor Envio. */
export function produtosParaCotacao(pecas: PecaFrete[], declararValor: boolean) {
  return pecas.map((p) => {
    const m = medidasDaPeca(p);
    return {
      id: p.id,
      width: m.largura,
      height: m.altura,
      length: m.comprimento,
      weight: m.peso,
      insurance_value: declararValor ? centavos(Number(p.preco) || 0) : 0,
      quantity: 1,
    };
  });
}

export function corpoDaCotacao(
  cepOrigem: string,
  cepDestino: string,
  pecas: PecaFrete[],
  declararValor: boolean,
  servico?: number,
) {
  return {
    from: { postal_code: soDigitos(cepOrigem) },
    to: { postal_code: soDigitos(cepDestino) },
    products: produtosParaCotacao(pecas, declararValor),
    options: { receipt: false, own_hand: false },
    ...(servico ? { services: String(servico) } : {}),
  };
}

/** Uma caixa só com todas as peças: soma as alturas e os pesos. */
export function pacoteUnico(pecas: PecaFrete[]): Pacote {
  const medidas = pecas.map(medidasDaPeca);
  return {
    altura: Math.min(100, medidas.reduce((s, m) => s + m.altura, 0) || MEDIDAS_PADRAO.altura),
    largura: Math.max(...medidas.map((m) => m.largura), 11),
    comprimento: Math.max(...medidas.map((m) => m.comprimento), 16),
    peso: Math.round(medidas.reduce((s, m) => s + m.peso, 0) * 1000) / 1000 || MEDIDAS_PADRAO.peso,
    produtos: pecas.map((p) => p.id),
  };
}

// deno-lint-ignore no-explicit-any
function lerPacotes(lista: any): Pacote[] {
  if (!Array.isArray(lista)) return [];
  const pacotes: Pacote[] = [];
  for (const p of lista) {
    const d = p?.dimensions ?? {};
    const altura = numero(d.height);
    const largura = numero(d.width);
    const comprimento = numero(d.length);
    const peso = numero(p?.weight);
    if (!altura || !largura || !comprimento || !peso) continue;
    pacotes.push({
      altura,
      largura,
      comprimento,
      peso,
      produtos: Array.isArray(p?.products) ? p.products.map((x: { id?: unknown }) => String(x?.id ?? "")).filter(Boolean) : [],
    });
  }
  return pacotes;
}

/**
 * Lê a resposta da cotação: descarta serviços indisponíveis, filtra pelas
 * transportadoras escolhidas e soma os dias de postagem ao prazo.
 */
export function lerCotacao(resposta: unknown, transportadoras: string[], diasPostagem = 0): OpcaoFrete[] {
  if (!Array.isArray(resposta)) return [];
  const permitidas = (transportadoras ?? []).map(normalizar).filter(Boolean);
  const opcoes: OpcaoFrete[] = [];
  for (const item of resposta) {
    if (!item || typeof item !== "object" || item.error) continue;
    const valor = numero(item.custom_price ?? item.price);
    if (valor === null || valor <= 0) continue;
    const empresa = String(item.company?.name ?? "").trim();
    if (permitidas.length && !permitidas.includes(normalizar(empresa))) continue;
    const faixa = item.custom_delivery_range ?? item.delivery_range ?? {};
    const prazo = numero(item.custom_delivery_time ?? item.delivery_time);
    const min = numero(faixa.min) ?? prazo;
    const max = numero(faixa.max) ?? prazo ?? min;
    if (min === null || max === null) continue;
    const dias = Math.max(0, Math.round(diasPostagem || 0));
    opcoes.push({
      id: Number(item.id),
      nome: String(item.name ?? "").trim(),
      empresa,
      empresa_id: numero(item.company?.id),
      valor: centavos(valor),
      prazo_min: Math.round(min) + dias,
      prazo_max: Math.round(Math.max(min, max)) + dias,
      pacotes: lerPacotes(item.packages),
    });
  }
  opcoes.sort((a, b) => a.valor - b.valor || a.prazo_max - b.prazo_max);
  return opcoes;
}

/** Versão pública de uma opção (sem os pacotes). */
export function opcaoPublica(o: OpcaoFrete) {
  return { id: o.id, nome: o.nome, empresa: o.empresa, valor: o.valor, prazo_min: o.prazo_min, prazo_max: o.prazo_max };
}

export function enderecoEmTexto(e: Pick<Endereco, "rua" | "numero" | "complemento" | "bairro" | "cidade" | "uf">): string {
  const linha1 = [e.rua, e.numero].filter((x) => String(x ?? "").trim()).join(", ");
  const comComplemento = e.complemento?.trim() ? `${linha1} - ${e.complemento.trim()}` : linha1;
  const cidade = [e.cidade?.trim(), e.uf?.trim().toUpperCase()].filter(Boolean).join("/");
  return [comComplemento, e.bairro?.trim(), cidade].filter(Boolean).join(", ");
}

/** O que falta no cadastro de quem envia para gerar etiquetas. */
export function faltasDoRemetente(e: Endereco): string[] {
  const faltas: string[] = [];
  if (!e.nome?.trim()) faltas.push("nome");
  const doc = soDigitos(e.documento);
  if (!(cpfValido(doc) || cnpjValido(doc))) faltas.push("CPF ou CNPJ");
  if (soDigitos(e.telefone).length < 10) faltas.push("telefone");
  if (!/^\S+@\S+\.\S+$/.test(e.email ?? "")) faltas.push("e-mail");
  if (!cepValido(e.cep)) faltas.push("CEP");
  if (!e.rua?.trim()) faltas.push("rua");
  if (!e.numero?.trim()) faltas.push("número");
  if (!e.bairro?.trim()) faltas.push("bairro");
  if (!e.cidade?.trim()) faltas.push("cidade");
  if (!/^[A-Za-z]{2}$/.test(e.uf ?? "")) faltas.push("UF");
  return faltas;
}

function enderecoMelhorEnvio(e: Endereco) {
  const doc = soDigitos(e.documento);
  return {
    name: e.nome.trim().slice(0, 100),
    phone: soDigitos(e.telefone),
    email: e.email.trim(),
    ...(doc.length === 14 ? { company_document: doc } : { document: doc }),
    address: e.rua.trim(),
    complement: e.complemento?.trim() ?? "",
    number: e.numero.trim(),
    district: e.bairro.trim() || "Centro",
    city: e.cidade.trim(),
    country_id: "BR",
    postal_code: soDigitos(e.cep),
    state_abbr: e.uf.trim().toUpperCase(),
    note: "",
  };
}

/** Corpo do pedido de etiqueta (carrinho do Melhor Envio) para um pacote. */
export function montarCarrinho(args: {
  servico: number;
  agencia?: number | null;
  de: Endereco;
  para: Endereco;
  pacote: Pacote;
  pecas: PecaFrete[];
  numeroPedido: number;
  declararValor: boolean;
  plataforma: string;
}) {
  const ids = new Set(args.pacote.produtos);
  let doPacote = args.pecas.filter((p) => ids.has(p.id));
  if (!doPacote.length) doPacote = args.pecas;
  const valor = centavos(doPacote.reduce((s, p) => s + (Number(p.preco) || 0), 0));
  return {
    service: args.servico,
    ...(args.agencia ? { agency: args.agencia } : {}),
    from: enderecoMelhorEnvio(args.de),
    to: enderecoMelhorEnvio(args.para),
    products: doPacote.map((p) => ({
      name: (p.titulo || "Peça de roupa").slice(0, 100),
      quantity: 1,
      unitary_value: centavos(Number(p.preco) || 0),
    })),
    volumes: [{
      height: args.pacote.altura,
      width: args.pacote.largura,
      length: args.pacote.comprimento,
      weight: args.pacote.peso,
    }],
    options: {
      insurance_value: args.declararValor ? valor : 0,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: true,
      platform: args.plataforma.slice(0, 60),
      tags: [{ tag: `Pedido ${args.numeroPedido}`, url: null }],
    },
  };
}

/** Mensagem legível a partir de um erro do Melhor Envio. */
// deno-lint-ignore no-explicit-any
export function mensagemDoErro(dados: any, status: number): string {
  if (dados && typeof dados === "object") {
    if (dados.errors && typeof dados.errors === "object") {
      const lista = Object.values(dados.errors).flat().map(String).filter(Boolean);
      if (lista.length) return lista.slice(0, 3).join(" ");
    }
    if (typeof dados.error === "string" && dados.error) return dados.error;
    if (typeof dados.message === "string" && dados.message) return dados.message;
  }
  if (typeof dados === "string" && dados.trim() && dados.length < 300) return dados.trim();
  if (status === 401) return "O token do Melhor Envio é inválido ou expirou.";
  return `O Melhor Envio respondeu com erro ${status}.`;
}

export function ehFaltaDeSaldo(mensagem: string): boolean {
  return /saldo|balance|insufficient|insuficiente/i.test(mensagem);
}
