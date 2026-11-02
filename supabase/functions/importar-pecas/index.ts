// Edge Function: importar-pecas
// Cria rascunhos a partir de peças já anunciadas em outro lugar (ex.: a loja no Enjoei),
// copiando as fotos para o armazenamento da loja. Nada é publicado: as peças entram
// como rascunho para revisão no painel.
//
// Quem pode usar: administradoras logadas, ou quem enviar no cabeçalho
// "x-chave-importacao" uma chave temporária cadastrada na tabela chaves_importacao.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-chave-importacao",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

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

// Só baixamos fotos destes sites (e de subdomínios deles).
const SITES_PERMITIDOS = ["enjoei.com.br", "enjoei.com", ...(Deno.env.get("IMPORTACAO_SITES") ?? "").split(",")]
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function sitePermitido(host: string): boolean {
  const h = host.toLowerCase();
  return SITES_PERMITIDOS.some((s) => h === s || h.endsWith(`.${s}`));
}

async function sha256(texto: string) {
  const dados = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(dados)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function autorizado(req: Request, db: SupabaseClient): Promise<boolean> {
  const chaveImportacao = req.headers.get("x-chave-importacao")?.trim();
  if (chaveImportacao && chaveImportacao.length >= 24) {
    const { data } = await db
      .from("chaves_importacao")
      .select("hash")
      .eq("hash", await sha256(chaveImportacao))
      .gt("expira_em", new Date().toISOString())
      .maybeSingle();
    if (data) return true;
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const cliente = createClient(URL_SUPABASE, chave("anon"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await cliente.rpc("is_admin");
  return !error && data === true;
}

type FotoEntrada = string | { grande?: string; pequena?: string };

type PecaEntrada = {
  origem_url?: string;
  titulo?: string;
  descricao?: string;
  preco?: number | string | null;
  preco_original?: number | string | null;
  tamanho?: string;
  marca?: string;
  cor?: string;
  estado?: string;
  medidas?: string;
  categoria?: string;
  peso_g?: number | null;
  texto_original?: string;
  fotos?: FotoEntrada[];
};

type Imagem = { bytes: Uint8Array; tipo: string };

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function baixar(endereco: string): Promise<Imagem> {
  const url = new URL(endereco);
  if (url.protocol !== "https:" || !sitePermitido(url.hostname)) throw new Error(`Site de foto não permitido: ${url.hostname}`);
  const r = await fetch(url, {
    headers: { "User-Agent": "BrechoDaNatasha-Importador/1.0", Accept: "image/webp,image/jpeg,image/png" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!sitePermitido(new URL(r.url).hostname)) throw new Error("A foto redirecionou para outro site.");
  if (!r.ok) throw new Error(`Foto indisponível (${r.status}).`);
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS[tipo]) throw new Error(`Formato de foto não suportado (${tipo || "desconhecido"}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 500 || bytes.length > 9_000_000) throw new Error("Tamanho de foto inesperado.");
  return { bytes, tipo };
}

function texto(v: unknown, max: number) {
  return String(v ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);
}

function preco(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function normalizar(v: unknown) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function aleatorio() {
  return `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4)}`;
}

async function enviarArquivo(db: SupabaseClient, bucket: string, caminho: string, img: Imagem) {
  const { error } = await db.storage.from(bucket).upload(caminho, img.bytes, {
    contentType: img.tipo,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
}

async function importarPeca(
  db: SupabaseClient,
  p: PecaEntrada,
  categorias: { id: number; nome: string; slug: string }[],
) {
  const origem = texto(p.origem_url, 500) || null;
  if (origem) {
    const { data } = await db.from("pecas").select("id,codigo").eq("origem_url", origem).maybeSingle();
    if (data) return { origem_url: origem, situacao: "existente", id: data.id, codigo: data.codigo };
  }

  const id = crypto.randomUUID();
  const fotos: string[] = [];
  const origens: unknown[] = [];
  const avisos: string[] = [];
  const agora = new Date();
  const pasta = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

  for (const f of (p.fotos ?? []).slice(0, 8)) {
    const enderecoGrande = typeof f === "string" ? f : f?.grande ?? "";
    const enderecoPequena = typeof f === "string" ? "" : f?.pequena ?? "";
    try {
      const grande = await baixar(enderecoGrande);
      let pequena = grande;
      if (enderecoPequena) {
        try {
          const p2 = await baixar(enderecoPequena);
          if (p2.tipo === grande.tipo) pequena = p2;
        } catch {
          /* usa a grande também como miniatura */
        }
      }
      const ext = TIPOS[grande.tipo];
      const base = `${id}/${aleatorio()}`;
      await enviarArquivo(db, "pecas", `${base}.${ext}`, grande);
      await enviarArquivo(db, "pecas", `${base}_p.${ext}`, pequena);
      let original: string | null = `${pasta}/${crypto.randomUUID()}.${ext}`;
      try {
        await enviarArquivo(db, "originais", original, grande);
      } catch {
        original = null;
      }
      fotos.push(`${base}.${ext}`);
      origens.push({ original, recorte: null, fonte: enderecoGrande });
    } catch (e) {
      avisos.push(e instanceof Error ? e.message : String(e));
    }
  }

  const cat = normalizar(p.categoria);
  const categoria = cat ? categorias.find((c) => normalizar(c.nome) === cat || normalizar(c.slug) === cat) : null;
  const peso = Number(p.peso_g);
  const registro = {
    id,
    status: "rascunho",
    titulo: texto(p.titulo, 120),
    descricao: texto(p.descricao, 2000),
    marca: texto(p.marca, 80),
    tamanho: texto(p.tamanho, 30),
    cor: texto(p.cor, 60),
    estado: texto(p.estado, 60),
    medidas: texto(p.medidas, 300),
    preco: preco(p.preco),
    preco_original: preco(p.preco_original),
    categoria_id: categoria?.id ?? null,
    peso_g: Number.isInteger(peso) && peso >= 10 && peso <= 30000 ? peso : null,
    fotos,
    origens,
    origem_texto: texto(p.texto_original, 4000) || null,
    origem_url: origem,
  };
  const { data, error } = await db.from("pecas").insert(registro).select("id,codigo").single();
  if (error) {
    if (fotos.length) {
      await db.storage.from("pecas").remove(fotos.flatMap((c) => [c, c.replace(/(\.\w+)$/, "_p$1")]));
    }
    throw error;
  }
  return { origem_url: origem, situacao: "criada", id: data.id, codigo: data.codigo, fotos: fotos.length, avisos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, 405);

  const db = createClient(URL_SUPABASE, chave("servico"), { auth: { persistSession: false } });
  if (!(await autorizado(req, db))) return json({ ok: false, erro: "Acesso restrito." }, 403);

  let corpo: { pecas?: PecaEntrada[] };
  try {
    corpo = await req.json();
  } catch {
    return json({ ok: false, erro: "Corpo inválido." }, 400);
  }
  const pecas = Array.isArray(corpo.pecas) ? corpo.pecas.slice(0, 6) : [];
  if (!pecas.length) return json({ ok: false, erro: "Nenhuma peça enviada." }, 400);

  const { data: categorias } = await db.from("categorias").select("id,nome,slug");
  const resultados = [];
  for (const p of pecas) {
    try {
      resultados.push(await importarPeca(db, p, categorias ?? []));
    } catch (e) {
      console.error("Falha ao importar", p?.origem_url, e);
      resultados.push({
        origem_url: p?.origem_url ?? null,
        situacao: "erro",
        erro: e instanceof Error ? e.message : JSON.stringify(e),
      });
    }
  }
  return json({ ok: true, resultados });
});
