// Edge Function: extrair-peca
// Recebe fotos, prints e/ou texto colado e devolve os dados das peças
// (título, preço, tamanho, marca, recorte da foto...) usando o Claude.
//
// Segredo necessário: ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets).
// Opcional: CLAUDE_MODEL (padrão: claude-opus-5-5).
// Sem a chave, responde { ok: false, motivo: "sem_chave" } e o painel usa a
// leitura local (OCR + regras) como alternativa.

import Anthropic from "npm:@anthropic-ai/sdk@1";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const TEXTO = { type: "string" } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pecas"],
  properties: {
    pecas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "titulo", "descricao", "categoria", "marca", "tamanho", "cor", "estado",
          "medidas", "preco", "preco_original", "fotos", "trecho_texto", "observacao",
        ],
        properties: {
          titulo: TEXTO,
          descricao: TEXTO,
          categoria: TEXTO,
          marca: TEXTO,
          tamanho: TEXTO,
          cor: TEXTO,
          estado: TEXTO,
          medidas: TEXTO,
          preco: TEXTO,
          preco_original: TEXTO,
          trecho_texto: TEXTO,
          observacao: TEXTO,
          fotos: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["imagem", "x", "y", "largura", "altura"],
              properties: {
                imagem: { type: "integer" },
                x: { type: "number" },
                y: { type: "number" },
                largura: { type: "number" },
                altura: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
};

const SISTEMA = `Você ajuda a dona de uma loja de roupas e acessórios seminovos de alto padrão a cadastrar peças no site.
Você recebe imagens (fotos de peças, prints de conversas do WhatsApp ou Instagram, prints de anúncios) e/ou texto colado, e identifica cada peça à venda, extraindo os dados.

Regras:
- Uma peça é um item à venda. Um print pode conter várias peças, cada uma com sua foto e seu preço. Várias imagens podem ser fotos da mesma peça.
- fotos: para cada foto que mostra a peça, informe "imagem" (o índice da imagem, começando em 0) e o retângulo de recorte (x, y, largura, altura, valores de 0 a 1 relativos à imagem inteira, a partir do canto superior esquerdo) cobrindo apenas a foto do produto, sem barras do aplicativo, textos, horários ou balões de mensagem. Se a imagem inteira já é a foto da peça, use x=0, y=0, largura=1, altura=1. Se não houver nenhuma foto da peça, deixe a lista vazia.
- preco: valor de venda em reais, só o número com ponto decimal (ex.: "89.90"). Se houver "de X por Y", preco é Y e preco_original é X. Deixe vazio se não houver preço.
- titulo: curto e elegante, em português (ex.: "Vestido midi de linho", "Blazer de alfaiataria Zara"). Sem emojis, sem preço, sem tamanho, sem a palavra brechó. Só a primeira letra maiúscula, além de nomes de marcas.
- descricao: de 1 a 3 frases sóbrias e elegantes sobre a peça (tecido, modelagem, detalhes visíveis). Sem exageros, sem emojis, sem inventar o que não aparece.
- categoria: exatamente um dos nomes da lista de categorias fornecida, ou vazio se nenhuma servir.
- tamanho: como informado (PP, P, M, G, GG, 36, 38, Único...). Vazio se não for informado.
- marca, cor, estado (ex.: "Nova com etiqueta", "Excelente estado", "Ótimo estado", "Bom estado") e medidas (ex.: "Busto 90 cm, comprimento 110 cm").
- Não invente marca, tamanho, medidas nem preço: use só o que está escrito ou visível. Cor e categoria podem ser deduzidas da foto.
- trecho_texto: o trecho do texto original (do print ou do texto colado) que se refere a esta peça, transcrito literalmente. Vazio se não houver.
- observacao: se algo estiver ambíguo (preço ilegível, dúvida se duas fotos são da mesma peça), explique em poucas palavras. Caso contrário, deixe vazio.
- Ignore mensagens que não sejam de venda (cumprimentos, perguntas, conversas).

Prints de anúncios do Enjoei (ou de outros sites e apps de venda, como OLX, Repassa e Instagram):
- Cada anúncio é uma peça. Use o que a vendedora escreveu: título, preço, tamanho, marca, estado de conservação, medidas e descrição.
- Ignore tudo o que é do aplicativo: botões ("eu quero", "fazer oferta", "comprar", "adicionar à sacolinha"), parcelamento ("em até 3x sem juros"), frete ("frete grátis", "calcular frete"), avaliações, nome e foto da vendedora, curtidas, comentários, contadores, selos e cupons do aplicativo.
- Se houver preço riscado e preço atual, o atual é preco e o riscado é preco_original. Não use valores de parcela, de frete ou de cupom como preço.
- O recorte deve pegar só a foto do produto, sem barras, botões, ícones ou textos sobrepostos.
- Reescreva a descrição no tom da loja: sóbria, sem gírias, exageros ou emojis do anúncio, mantendo as informações úteis (tecido, caimento, detalhes). Se o anúncio citar defeitos ou sinais de uso, mantenha essa informação de forma clara e gentil.`;

const MODOS: Record<string, string> = {
  auto: "Decida você como agrupar as imagens em peças.",
  cada: "Cada imagem é de uma peça diferente. Um print pode, ainda assim, conter mais de uma peça.",
  mesma: "Todas as imagens são da MESMA peça: devolva exatamente uma peça, com todas as fotos dela.",
};

type ImagemEntrada = { dados: string; tipo: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, 405);

  // Só administradoras da loja podem usar.
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: ehAdmin, error: erroAdmin } = await supabase.rpc("is_admin");
  if (erroAdmin || ehAdmin !== true) {
    return json({ ok: false, erro: "Acesso restrito." }, 403);
  }

  let corpo: { imagens?: ImagemEntrada[]; texto?: string; categorias?: string[]; modo?: string; ping?: boolean };
  try {
    corpo = await req.json();
  } catch {
    return json({ ok: false, erro: "Corpo inválido." }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  // "ping": o painel só quer saber se a leitura automática está ligada.
  if (corpo.ping) return json({ ok: true, ia: Boolean(apiKey) });
  if (!apiKey) return json({ ok: false, motivo: "sem_chave" });

  const imagens = (corpo.imagens ?? []).slice(0, 10);
  const texto = (corpo.texto ?? "").slice(0, 20000);
  const categorias = (corpo.categorias ?? []).slice(0, 60);
  const modo = MODOS[corpo.modo ?? "auto"] ?? MODOS.auto;

  if (imagens.length === 0 && texto.trim() === "") {
    return json({ ok: false, erro: "Envie pelo menos uma imagem ou um texto." }, 400);
  }

  const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [];
  imagens.forEach((img, i) => {
    const tipo = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(img.tipo)
      ? img.tipo
      : "image/jpeg";
    conteudo.push({ type: "text", text: `Imagem ${i}:` });
    conteudo.push({
      type: "image",
      source: { type: "base64", media_type: tipo as "image/jpeg", data: img.dados },
    });
  });
  conteudo.push({
    type: "text",
    text: [
      `Categorias da loja: ${categorias.join(", ") || "(nenhuma)"}`,
      `Total de imagens: ${imagens.length}. ${imagens.length ? modo : ""}`,
      texto.trim() ? `Texto colado:\n"""\n${texto.trim()}\n"""` : "Sem texto colado.",
      "Extraia as peças à venda.",
    ].join("\n\n"),
  });

  const client = new Anthropic({ apiKey });
  const pedido = {
    model: Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5",
    max_tokens: 16000,
    system: SISTEMA,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user" as const, content: conteudo }],
  };

  let resposta: Anthropic.Beta.BetaMessage;
  try {
    try {
      // Se o modelo recusar por engano, o próprio servidor tenta outro modelo.
      resposta = await client.beta.messages.create({
        ...pedido,
        betas: ["server-side-fallback-2026-07-01"],
        // deno-lint-ignore no-explicit-any
        fallbacks: "default" as any,
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      resposta = await client.beta.messages.create(
        pedido as Anthropic.Beta.MessageCreateParamsNonStreaming,
      );
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return json({ ok: false, motivo: "chave_invalida", erro: "A chave da Anthropic é inválida." });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return json({ ok: false, motivo: "limite", erro: "Muitas leituras seguidas. Tente de novo em instantes." });
    }
    if (e instanceof Anthropic.APIError) {
      console.error("Erro da API", e.status, e.message);
      return json({ ok: false, motivo: "erro_api", erro: `Falha na leitura automática (${e.status}).` });
    }
    console.error("Erro inesperado", e);
    return json({ ok: false, motivo: "erro_api", erro: "Falha na leitura automática." });
  }

  if (resposta.stop_reason === "refusal") {
    return json({ ok: false, motivo: "recusa", erro: "A leitura automática recusou estas imagens." });
  }

  const textoResposta = resposta.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  try {
    const dados = JSON.parse(textoResposta);
    return json({ ok: true, pecas: Array.isArray(dados.pecas) ? dados.pecas : [] });
  } catch {
    console.error("Resposta não é JSON", resposta.stop_reason, textoResposta.slice(0, 500));
    return json({ ok: false, motivo: "erro_api", erro: "Não consegui interpretar a leitura automática." });
  }
});
