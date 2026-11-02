// Painel da loja: cadastro rápido, peças, pedidos e configurações.
import {
  sb,
  fotoUrl,
  formatarPreco,
  lerPreco,
  escapar,
  avisar,
  logotipoHtml,
  mensagemDeErro,
  linkWhatsapp,
  soDigitos,
  chamarFuncao,
  BUCKET_FOTOS,
  BUCKET_ORIGINAIS,
} from "./comum.js";
import { carregarBitmap, gerarBlob, extensao, paraBase64, normalizarRecorte } from "./imagem.js";
import { extrairDeTexto, lerTextoDaImagem, categoriaPorTexto, normalizar } from "./extrator.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STATUS_PECA = {
  rascunho: "Rascunho",
  disponivel: "Disponível",
  reservado: "Reservada",
  vendido: "Vendida",
  oculto: "Oculta",
};

const STATUS_PEDIDO = {
  novo: "Novo",
  pago: "Pago",
  enviado: "Enviado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const estado = {
  usuario: null,
  config: null,
  categorias: [],
  pendentes: [], // imagens aguardando leitura: { id, arquivo, url }
  observacoes: new Map(), // id da peça -> aviso da leitura automática
  editores: new Map(), // id da peça -> controle do editor de rascunho
  iaDisponivel: null,
  processando: false,
  pecasCarregadas: 0,
  pecasTotal: 0,
  envio: null, // dados de envio (remetente, transportadoras)
  statusEnvio: null, // situação da conta no Melhor Envio
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
  );
}

function precoParaCampo(v) {
  if (v === null || v === undefined || v === "") return "";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slugificar(texto) {
  return (
    normalizar(texto)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `categoria-${Date.now().toString(36)}`
  );
}

function dataCurta(iso) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Entrar / sair                                                       */
/* ------------------------------------------------------------------ */

function mostrarEntrar(mensagem = "") {
  $("#app").classList.add("oculto");
  $("#tela-entrar").classList.remove("oculto");
  const erro = $("#erro-entrar");
  erro.textContent = mensagem;
  erro.classList.toggle("oculto", !mensagem);
}

async function entrarNoPainel(usuario) {
  const { data: ehAdmin, error } = await sb.rpc("is_admin");
  if (error || ehAdmin !== true) {
    await sb.auth.signOut();
    mostrarEntrar("Este acesso não tem permissão para o painel.");
    return;
  }
  estado.usuario = usuario;
  $("#email-usuario").textContent = usuario.email || "";
  $("#tela-entrar").classList.add("oculto");
  $("#app").classList.remove("oculto");
  await carregarBase();
  irParaAba();
  verificarIa();
  contarPedidosNovos();
}

async function carregarBase() {
  const [config, categorias] = await Promise.all([
    sb.from("loja_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("categorias").select("*").order("ordem").order("nome"),
  ]);
  estado.config = config.data || { nome: "Brechó da Natasha" };
  estado.categorias = categorias.data || [];
  $("#logo-painel").innerHTML = logotipoHtml(estado.config.nome);
  document.title = `Painel · ${estado.config.nome}`;
  const opcoes = estado.categorias.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join("");
  $("#filtro-categoria").innerHTML = `<option value="">Todas as categorias</option>${opcoes}`;
}

/* ------------------------------------------------------------------ */
/* Abas                                                                */
/* ------------------------------------------------------------------ */

function irParaAba() {
  const aba = (location.hash || "#cadastro").slice(1);
  const valida = ["cadastro", "pecas", "pedidos", "loja"].includes(aba) ? aba : "cadastro";
  $$(".abas a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === valida));
  $$(".aba").forEach((s) => s.classList.toggle("oculto", s.id !== `aba-${valida}`));
  window.scrollTo(0, 0);
  if (valida === "cadastro") carregarRascunhos();
  if (valida === "pecas") carregarPecas(true);
  if (valida === "pedidos") carregarPedidos();
  if (valida === "loja") mostrarLoja();
}

/* ------------------------------------------------------------------ */
/* Envio de imagens                                                    */
/* ------------------------------------------------------------------ */

async function enviarArquivo(bucket, caminho, blob) {
  const { error } = await sb.storage.from(bucket).upload(caminho, blob, {
    contentType: blob.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
}

/** Guarda a imagem original (print ou foto) no armazenamento privado, para recortes futuros. */
async function enviarOriginal(bitmap) {
  try {
    const blob = await gerarBlob(bitmap, { maxLado: 2400, tipo: "image/jpeg", qualidade: 0.9 });
    const agora = new Date();
    const caminho = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}/${uuid()}.jpg`;
    await enviarArquivo(BUCKET_ORIGINAIS, caminho, blob);
    return caminho;
  } catch (e) {
    console.warn("Original não guardado", e);
    return null;
  }
}

/** Gera a foto da loja (grande + miniatura) e envia. Retorna o caminho da foto grande. */
async function enviarFoto(pecaId, bitmap, recorte) {
  const base = `${pecaId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const grande = await gerarBlob(bitmap, { maxLado: 1600, recorte, qualidade: 0.86 });
  const ext = extensao(grande);
  const pequena = await gerarBlob(bitmap, { maxLado: 640, recorte, tipo: grande.type, qualidade: 0.82 });
  await Promise.all([
    enviarArquivo(BUCKET_FOTOS, `${base}.${ext}`, grande),
    enviarArquivo(BUCKET_FOTOS, `${base}_p.${ext}`, pequena),
  ]);
  return `${base}.${ext}`;
}

async function apagarFotos(caminhos) {
  const lista = caminhos.filter(Boolean).flatMap((c) => [c, c.replace(/(\.\w+)$/, "_p$1")]);
  if (lista.length) await sb.storage.from(BUCKET_FOTOS).remove(lista);
}

/* ------------------------------------------------------------------ */
/* Cadastro rápido                                                     */
/* ------------------------------------------------------------------ */

function adicionarPendentes(arquivos) {
  let n = 0;
  for (const arquivo of arquivos) {
    if (!arquivo?.type?.startsWith("image/")) continue;
    estado.pendentes.push({ id: uuid(), arquivo, url: URL.createObjectURL(arquivo) });
    n++;
  }
  if (!n && arquivos.length) avisar("Só é possível adicionar imagens.", "erro");
  desenharPrevias();
}

function desenharPrevias() {
  const el = $("#previas");
  el.classList.toggle("oculto", estado.pendentes.length === 0);
  el.innerHTML = estado.pendentes
    .map(
      (p) => `<div class="previa"><img src="${p.url}" alt=""><button data-tirar="${p.id}" aria-label="Tirar imagem">✕</button></div>`,
    )
    .join("");
  atualizarBotaoProcessar();
}

function atualizarBotaoProcessar() {
  const tem = estado.pendentes.length > 0 || $("#texto-colado").value.trim() !== "";
  const botao = $("#processar");
  botao.disabled = !tem || estado.processando;
  const n = estado.pendentes.length;
  botao.textContent = n
    ? `Ler ${n} ${n === 1 ? "imagem" : "imagens"} e criar rascunhos`
    : "Ler e criar rascunhos";
}

function criarIndicador(texto) {
  const el = document.createElement("div");
  el.className = "processando";
  el.innerHTML = `<span class="girando"></span><span class="texto"></span>`;
  $(".texto", el).textContent = texto;
  $("#processando").prepend(el);
  return {
    texto: (t) => ($(".texto", el).textContent = t),
    concluir: (t) => {
      el.innerHTML = `<span>✓</span><span>${escapar(t)}</span>`;
      setTimeout(() => el.remove(), 8000);
    },
    falhar: (t) => {
      el.classList.add("falhou");
      el.innerHTML = `<span>!</span><span>${escapar(t)}</span>`;
    },
  };
}

function fatiar(lista, tamanho) {
  const partes = [];
  for (let i = 0; i < lista.length; i += tamanho) partes.push(lista.slice(i, i + tamanho));
  return partes;
}

function categoriaPorNome(nome, titulo = "") {
  const n = normalizar(nome);
  if (n) {
    const exata = estado.categorias.find((c) => normalizar(c.nome) === n);
    if (exata) return exata;
  }
  return categoriaPorTexto(`${nome || ""} ${titulo || ""}`, estado.categorias);
}

const PECA_VAZIA = {
  titulo: "",
  descricao: "",
  marca: "",
  tamanho: "",
  cor: "",
  estado: "",
  medidas: "",
  preco: null,
  preco_original: null,
  categoria_id: null,
  fotos: [],
  trecho_texto: "",
  observacao: "",
};

function daIa(pecas, totalImagens) {
  const usadas = new Set();
  const lista = (pecas || []).map((p) => {
    const fotos = (p.fotos || [])
      .filter((f) => Number.isInteger(f.imagem) && f.imagem >= 0 && f.imagem < totalImagens)
      .map((f) => {
        usadas.add(f.imagem);
        return { imagem: f.imagem, recorte: normalizarRecorte(f) };
      });
    const cat = categoriaPorNome(p.categoria, p.titulo);
    const preco = lerPreco(p.preco);
    const original = lerPreco(p.preco_original);
    return {
      ...PECA_VAZIA,
      titulo: (p.titulo || "").trim(),
      descricao: (p.descricao || "").trim(),
      marca: (p.marca || "").trim(),
      tamanho: (p.tamanho || "").trim(),
      cor: (p.cor || "").trim(),
      estado: (p.estado || "").trim(),
      medidas: (p.medidas || "").trim(),
      preco,
      preco_original: original && preco && original > preco ? original : null,
      categoria_id: cat?.id ?? null,
      fotos,
      trecho_texto: (p.trecho_texto || "").trim(),
      observacao: (p.observacao || "").trim(),
    };
  });
  for (let i = 0; i < totalImagens; i++) {
    if (!usadas.has(i)) {
      lista.push({
        ...PECA_VAZIA,
        fotos: [{ imagem: i, recorte: null }],
        observacao: "Não identifiquei uma peça à venda nesta imagem. Confira os dados ou exclua o rascunho.",
      });
    }
  }
  return lista;
}

function doLocal(d) {
  if (!d) return { ...PECA_VAZIA };
  return {
    ...PECA_VAZIA,
    titulo: d.titulo || "",
    marca: d.marca || "",
    tamanho: d.tamanho || "",
    cor: d.cor || "",
    estado: d.estado || "",
    medidas: d.medidas || "",
    preco: d.preco ?? null,
    preco_original: d.preco_original ?? null,
    categoria_id: d.categoria?.id ?? null,
    trecho_texto: d.trecho_texto || "",
  };
}

/** Junta dados: os primeiros têm preferência, os seguintes só preenchem o que falta. */
function juntar(...fontes) {
  const r = { ...PECA_VAZIA };
  for (const f of fontes.filter(Boolean)) {
    for (const k of Object.keys(PECA_VAZIA)) {
      if (k === "fotos") continue;
      const vazio = r[k] === null || r[k] === "";
      if (vazio && f[k] !== undefined && f[k] !== null && f[k] !== "") r[k] = f[k];
    }
  }
  r.trecho_texto = fontes
    .filter(Boolean)
    .map((f) => f.trecho_texto)
    .filter(Boolean)
    .join("\n\n");
  return r;
}

async function extrairLocal(lote, texto, modo, indicador) {
  const doTexto = texto ? extrairDeTexto(texto, estado.categorias).map(doLocal) : [];
  const daImagem = [];
  for (let i = 0; i < lote.length; i++) {
    indicador.texto(`Lendo o texto ${lote.length > 1 ? `da imagem ${i + 1} de ${lote.length}` : "da imagem"} (leitura simples)…`);
    const t = await lerTextoDaImagem(lote[i].arquivo);
    const pecas = t ? extrairDeTexto(t, estado.categorias) : [];
    daImagem.push(pecas[0] ? doLocal(pecas[0]) : null);
  }
  const aviso = "Leitura simples (sem IA): confira os dados e ajuste o recorte da foto.";
  const todasFotos = lote.map((_, i) => ({ imagem: i, recorte: null }));

  if (modo === "mesma" && lote.length) {
    return [{ ...juntar(...doTexto, ...daImagem), fotos: todasFotos, observacao: aviso }];
  }
  if (lote.length && doTexto.length === lote.length) {
    return lote.map((_, i) => ({ ...juntar(doTexto[i], daImagem[i]), fotos: [{ imagem: i, recorte: null }], observacao: aviso }));
  }
  if (lote.length && doTexto.length === 1 && modo === "auto") {
    return [{ ...juntar(doTexto[0], ...daImagem), fotos: todasFotos, observacao: aviso }];
  }
  const daFoto = lote.map((_, i) => ({
    ...juntar(daImagem[i]),
    fotos: [{ imagem: i, recorte: null }],
    observacao: aviso,
  }));
  return [...daFoto, ...doTexto.map((p) => ({ ...p, observacao: "Peça sem foto: adicione pelo menos uma." }))];
}

async function extrair(lote, texto, modo, indicador) {
  if (estado.iaDisponivel !== false) {
    try {
      const imagens = [];
      for (const f of lote) {
        const blob = await gerarBlob(f.bitmap, { maxLado: 1568, tipo: "image/jpeg", qualidade: 0.85 });
        imagens.push({ dados: await paraBase64(blob), tipo: "image/jpeg" });
      }
      const categorias = estado.categorias.map((c) => c.nome);
      const { data, error } = await sb.functions.invoke("extrair-peca", { body: { imagens, texto, categorias, modo } });
      if (error) throw error;
      if (data?.ok) {
        estado.iaDisponivel = true;
        return daIa(data.pecas, lote.length);
      }
      if (data?.motivo === "sem_chave") {
        estado.iaDisponivel = false;
      } else if (data?.erro) {
        avisar(`${data.erro} Usando a leitura simples.`, "erro");
      }
    } catch (e) {
      console.warn("Leitura automática indisponível", e);
      avisar("A leitura automática não respondeu. Usando a leitura simples.", "erro");
    }
  }
  return extrairLocal(lote, texto, modo, indicador);
}

async function criarRascunho(p, lote, originais) {
  const id = uuid();
  const fotos = [];
  const origens = [];
  for (const f of p.fotos) {
    const fonte = lote[f.imagem];
    if (!fonte) continue;
    if (!originais.has(f.imagem)) originais.set(f.imagem, await enviarOriginal(fonte.bitmap));
    fotos.push(await enviarFoto(id, fonte.bitmap, f.recorte));
    origens.push({ original: originais.get(f.imagem), recorte: f.recorte });
  }
  const registro = {
    id,
    status: "rascunho",
    titulo: p.titulo || "",
    descricao: p.descricao || "",
    marca: p.marca || "",
    tamanho: p.tamanho || "",
    cor: p.cor || "",
    estado: p.estado || "",
    medidas: p.medidas || "",
    preco: p.preco,
    preco_original: p.preco_original,
    categoria_id: p.categoria_id,
    fotos,
    origens,
    origem_texto: p.trecho_texto || null,
  };
  const { error } = await sb.from("pecas").insert(registro);
  if (error) {
    await apagarFotos(fotos);
    throw error;
  }
  if (p.observacao) estado.observacoes.set(id, p.observacao);
}

async function processar() {
  if (estado.processando) return;
  const imagens = estado.pendentes.splice(0);
  const campoTexto = $("#texto-colado");
  const texto = campoTexto.value.trim();
  const modo = $("#modo").value;
  if (!imagens.length && !texto) return;

  estado.processando = true;
  campoTexto.value = "";
  desenharPrevias();
  const indicador = criarIndicador("Preparando…");
  let criadas = 0;
  const fontes = [];
  try {
    for (const p of imagens) fontes.push({ ...p, bitmap: await carregarBitmap(p.arquivo) });
    let lotes = modo === "mesma" ? fatiar(fontes, 10) : fatiar(fontes, 6);
    if (!lotes.length) lotes = [[]];
    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      const qual = lote.length
        ? `${lote.length} ${lote.length === 1 ? "imagem" : "imagens"}${texto && i === 0 ? " e o texto" : ""}`
        : "o texto";
      indicador.texto(`Lendo ${qual}${lotes.length > 1 ? ` (parte ${i + 1} de ${lotes.length})` : ""}…`);
      const pecas = await extrair(lote, i === 0 ? texto : "", modo, indicador);
      const originais = new Map();
      for (let j = 0; j < pecas.length; j++) {
        indicador.texto(`Criando rascunho ${criadas + 1}${pecas.length > 1 ? ` (${j + 1} de ${pecas.length} desta leitura)` : ""}…`);
        await criarRascunho(pecas[j], lote, originais);
        criadas++;
      }
    }
    indicador.concluir(
      criadas === 0
        ? "Não encontrei peças nesse conteúdo."
        : `${criadas} ${criadas === 1 ? "rascunho criado" : "rascunhos criados"}. Revise abaixo e publique.`,
    );
  } catch (e) {
    console.error(e);
    indicador.falhar(`Não foi possível concluir: ${mensagemDeErro(e)}`);
    if (criadas === 0) {
      estado.pendentes.unshift(...imagens);
      if (!campoTexto.value) campoTexto.value = texto;
      desenharPrevias();
    }
  } finally {
    fontes.forEach((f) => f.bitmap?.close?.());
    if (criadas > 0) imagens.forEach((p) => URL.revokeObjectURL(p.url));
    estado.processando = false;
    atualizarBotaoProcessar();
    carregarRascunhos();
  }
}

async function carregarRascunhos() {
  const lista = $("#lista-rascunhos");
  const { data, error, count } = await sb
    .from("pecas")
    .select("*", { count: "exact" })
    .eq("status", "rascunho")
    .order("criado_em", { ascending: false })
    .limit(150);
  if (error) {
    lista.innerHTML = `<div class="aviso erro">${escapar(mensagemDeErro(error))}</div>`;
    return;
  }
  $("#qtd-rascunhos").textContent = count ? `(${count})` : "";
  estado.editores.clear();
  if (!data.length) {
    lista.innerHTML = `<div class="sem-rascunhos">Nenhum rascunho. As peças lidas aparecem aqui para você revisar.</div>`;
    atualizarPublicarProntos();
    return;
  }
  lista.innerHTML = "";
  for (const p of data) {
    const el = document.createElement("div");
    el.innerHTML = editorHtml(p, "rascunho");
    const editor = el.firstElementChild;
    lista.appendChild(editor);
    estado.editores.set(p.id, ligarEditor(editor, p, "rascunho"));
  }
  atualizarPublicarProntos();
}

function atualizarPublicarProntos() {
  const prontos = [...estado.editores.values()].filter((e) => e.pronta()).length;
  const botao = $("#publicar-prontos");
  botao.disabled = prontos === 0;
  botao.textContent = prontos ? `Publicar prontos (${prontos})` : "Publicar prontos";
}

async function publicarProntos() {
  const editores = [...estado.editores.values()];
  await Promise.all(editores.map((e) => e.salvarAgora()));
  const ids = editores.filter((e) => e.pronta()).map((e) => e.id);
  if (!ids.length) return;
  const { error } = await sb.from("pecas").update({ status: "disponivel" }).in("id", ids);
  if (error) return avisar(mensagemDeErro(error), "erro");
  avisar(`${ids.length} ${ids.length === 1 ? "peça publicada" : "peças publicadas"} na loja.`);
  carregarRascunhos();
}

/* ------------------------------------------------------------------ */
/* Editor de peça (usado nos rascunhos e na edição)                    */
/* ------------------------------------------------------------------ */

function fotosHtml(p) {
  const fotos = p.fotos || [];
  return `
    ${fotos
      .map(
        (f, i) => `
      <div class="editor-foto" data-indice="${i}">
        <img src="${fotoUrl(f, "p")}" alt="Foto ${i + 1}" loading="lazy">
        ${i === 0 ? `<span class="capa">Capa</span>` : ""}
        <div class="editor-foto-acoes">
          ${i > 0 ? `<button type="button" data-acao="capa" title="Usar como capa">Capa</button>` : ""}
          ${p.origens?.[i]?.original ? `<button type="button" data-acao="recortar" title="Ajustar recorte">✂</button>` : ""}
          <button type="button" data-acao="remover-foto" title="Remover foto">✕</button>
        </div>
      </div>`,
      )
      .join("")}
    <button type="button" class="adicionar-foto" data-acao="adicionar-foto"><b>+</b>${fotos.length ? "Foto" : "Adicionar foto (ou solte aqui)"}</button>`;
}

function editorHtml(p, contexto) {
  const obs = estado.observacoes.get(p.id);
  const cat = (id) =>
    `<option value="">Escolha…</option>${estado.categorias
      .map((c) => `<option value="${c.id}" ${c.id === id ? "selected" : ""}>${escapar(c.nome)}</option>`)
      .join("")}`;
  const v = (k) => escapar(p[k] ?? "");
  return `
    <article class="editor" data-id="${p.id}">
      <div class="editor-fotos">${fotosHtml(p)}</div>
      <input type="file" accept="image/*" multiple hidden data-arquivo-foto>
      <div class="editor-campos">
        <label class="campo c4"><span>Título</span><input data-campo="titulo" value="${v("titulo")}" placeholder="Ex.: Vestido midi de linho"></label>
        <label class="campo c2"><span>Preço (R$)</span><input data-campo="preco" inputmode="decimal" value="${precoParaCampo(p.preco)}" placeholder="Ex.: 120,00"></label>
        <label class="campo c2"><span>Categoria</span><select data-campo="categoria_id">${cat(p.categoria_id)}</select></label>
        <label class="campo c2"><span>Tamanho</span><input data-campo="tamanho" value="${v("tamanho")}" list="lista-tamanhos"></label>
        <label class="campo c2"><span>Marca</span><input data-campo="marca" value="${v("marca")}"></label>
        <label class="campo c2"><span>Cor</span><input data-campo="cor" value="${v("cor")}"></label>
        <label class="campo c2"><span>Estado</span><input data-campo="estado" value="${v("estado")}" list="lista-estados"></label>
        <label class="campo c2"><span>Preço original (riscado)</span><input data-campo="preco_original" inputmode="decimal" value="${precoParaCampo(p.preco_original)}" placeholder="Opcional"></label>
        <label class="campo c4"><span>Medidas</span><input data-campo="medidas" value="${v("medidas")}" placeholder="Ex.: Busto 90 cm, comprimento 110 cm"></label>
        <label class="campo c2"><span>Peso (g)</span><input data-campo="peso_g" inputmode="numeric" value="${p.peso_g ?? ""}" placeholder="Padrão da categoria" title="Usado no cálculo do frete. Sem peso, vale o padrão da categoria."></label>
        <label class="campo c6"><span>Descrição</span><textarea data-campo="descricao" rows="3" placeholder="Tecido, caimento, detalhes…">${v("descricao")}</textarea></label>
        ${obs ? `<div class="editor-observacao">${escapar(obs)}</div>` : ""}
        ${p.origem_texto ? `<details class="editor-original"><summary>Texto original</summary><pre>${escapar(p.origem_texto)}</pre></details>` : ""}
        <div class="editor-rodape">
          <span class="editor-situacao"></span>
          <div class="editor-botoes">
            <span class="salvo"></span>
            <button type="button" class="botao-texto" data-acao="excluir">Excluir</button>
            ${
              contexto === "rascunho"
                ? `<button type="button" class="botao pequeno" data-acao="publicar">Publicar</button>`
                : `<button type="button" class="botao pequeno" data-acao="concluir">Concluir</button>`
            }
          </div>
        </div>
      </div>
    </article>`;
}

function ligarEditor(el, peca, contexto, aoTerminar = () => {}) {
  const p = { ...peca, fotos: [...(peca.fotos || [])], origens: [...(peca.origens || [])] };
  let pendentes = {};
  let timer = null;
  let salvando = Promise.resolve();
  const salvo = $(".salvo", el);
  const inputArquivo = $("[data-arquivo-foto]", el);

  const faltando = () => {
    const f = [];
    if (!String(p.titulo || "").trim()) f.push("título");
    if (p.preco === null || p.preco === undefined || p.preco === "") f.push("preço");
    if (!p.fotos.length) f.push("foto");
    return f;
  };

  const atualizarSituacao = () => {
    const f = faltando();
    const s = $(".editor-situacao", el);
    if (contexto === "rascunho") {
      s.textContent = f.length ? `Falta: ${f.join(", ")}` : "Pronta para publicar";
      s.classList.toggle("pronta", f.length === 0);
    } else {
      s.textContent = `Cód. ${p.codigo} · ${STATUS_PECA[p.status] || p.status}`;
    }
    $('[data-campo="titulo"]', el).parentElement.classList.toggle("faltando", f.includes("título"));
    $('[data-campo="preco"]', el).parentElement.classList.toggle("faltando", f.includes("preço"));
    if (contexto === "rascunho") atualizarPublicarProntos();
  };

  const salvarAgora = async () => {
    clearTimeout(timer);
    const mudancas = pendentes;
    pendentes = {};
    if (!Object.keys(mudancas).length) return salvando;
    salvando = salvando.then(async () => {
      salvo.textContent = "Salvando…";
      const { error } = await sb.from("pecas").update(mudancas).eq("id", p.id);
      if (error) {
        pendentes = { ...mudancas, ...pendentes };
        salvo.textContent = "";
        avisar(mensagemDeErro(error), "erro");
      } else {
        salvo.textContent = "Salvo";
        setTimeout(() => {
          if (salvo.textContent === "Salvo") salvo.textContent = "";
        }, 2000);
      }
    });
    return salvando;
  };

  const agendar = (atraso = 700) => {
    clearTimeout(timer);
    timer = setTimeout(salvarAgora, atraso);
  };

  const lerCampo = (input) => {
    const campo = input.dataset.campo;
    let valor = input.value;
    if (campo === "preco" || campo === "preco_original") valor = lerPreco(valor);
    else if (campo === "categoria_id") valor = valor ? Number(valor) : null;
    else if (campo === "peso_g") {
      const gramas = parseInt(soDigitos(valor), 10);
      valor = gramas >= 10 ? Math.min(gramas, 30000) : null;
    } else valor = valor.trim();
    return [campo, valor];
  };

  el.addEventListener("input", (e) => {
    const input = e.target.closest("[data-campo]");
    if (!input) return;
    const [campo, valor] = lerCampo(input);
    p[campo] = valor;
    pendentes[campo] = valor;
    atualizarSituacao();
    agendar();
  });

  el.addEventListener("change", (e) => {
    const input = e.target.closest("[data-campo]");
    if (!input) return;
    const [campo, valor] = lerCampo(input);
    p[campo] = valor;
    pendentes[campo] = valor;
    if ((campo === "preco" || campo === "preco_original") && valor !== null) input.value = precoParaCampo(valor);
    atualizarSituacao();
    agendar(0);
  });

  const desenharFotos = () => {
    $(".editor-fotos", el).innerHTML = fotosHtml(p);
    atualizarSituacao();
  };

  const salvarFotos = async () => {
    const { error } = await sb.from("pecas").update({ fotos: p.fotos, origens: p.origens }).eq("id", p.id);
    if (error) throw error;
  };

  const adicionarFotos = async (arquivos) => {
    const imagens = [...arquivos].filter((a) => a.type?.startsWith("image/"));
    if (!imagens.length) return;
    const botao = $(".adicionar-foto", el);
    botao.innerHTML = `<span class="girando"></span>`;
    try {
      for (const arquivo of imagens) {
        const bitmap = await carregarBitmap(arquivo);
        const original = await enviarOriginal(bitmap);
        const caminho = await enviarFoto(p.id, bitmap, null);
        bitmap.close?.();
        p.fotos.push(caminho);
        p.origens.push({ original, recorte: null });
      }
      await salvarFotos();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
    desenharFotos();
  };

  const recortar = async (i) => {
    const origem = p.origens[i];
    if (!origem?.original) return;
    const { data: blob, error } = await sb.storage.from(BUCKET_ORIGINAIS).download(origem.original);
    if (error) return avisar("Não encontrei a imagem original.", "erro");
    const recorte = await abrirRecorte(blob, origem.recorte);
    if (recorte === undefined) return;
    const fotoEl = $(`.editor-foto[data-indice="${i}"]`, el);
    fotoEl?.insertAdjacentHTML("beforeend", `<div class="processando" style="position:absolute;inset:auto 0 0 0;margin:0;padding:8px"><span class="girando"></span></div>`);
    try {
      const bitmap = await carregarBitmap(blob);
      const novo = await enviarFoto(p.id, bitmap, recorte);
      bitmap.close?.();
      const antigo = p.fotos[i];
      p.fotos[i] = novo;
      p.origens[i] = { ...origem, recorte };
      await salvarFotos();
      apagarFotos([antigo]);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
    desenharFotos();
  };

  el.addEventListener("click", async (e) => {
    const botao = e.target.closest("[data-acao]");
    if (!botao) return;
    const acao = botao.dataset.acao;
    const indice = Number(botao.closest(".editor-foto")?.dataset.indice);

    if (acao === "adicionar-foto") inputArquivo.click();

    if (acao === "capa") {
      p.fotos.unshift(...p.fotos.splice(indice, 1));
      p.origens.unshift(...p.origens.splice(indice, 1));
      desenharFotos();
      salvarFotos().catch((err) => avisar(mensagemDeErro(err), "erro"));
    }

    if (acao === "remover-foto") {
      const [removida] = p.fotos.splice(indice, 1);
      p.origens.splice(indice, 1);
      if (p.status === "disponivel" && !p.fotos.length) {
        p.fotos.push(removida);
        return avisar("Uma peça publicada precisa de pelo menos uma foto.", "erro");
      }
      desenharFotos();
      try {
        await salvarFotos();
        apagarFotos([removida]);
      } catch (err) {
        avisar(mensagemDeErro(err), "erro");
      }
    }

    if (acao === "recortar") recortar(indice);

    if (acao === "excluir") {
      if (!confirm(`Excluir “${p.titulo || "esta peça"}”? Esta ação não pode ser desfeita.`)) return;
      clearTimeout(timer);
      pendentes = {};
      const { error } = await sb.from("pecas").delete().eq("id", p.id);
      if (error) return avisar(mensagemDeErro(error), "erro");
      if (!["vendido", "reservado"].includes(p.status)) apagarFotos(p.fotos);
      estado.editores.delete(p.id);
      el.classList.add("saindo");
      setTimeout(() => el.remove(), 300);
      avisar("Peça excluída.");
      if (contexto === "rascunho") {
        atualizarPublicarProntos();
        atualizarContagemRascunhos(-1);
      }
      aoTerminar("excluida");
    }

    if (acao === "publicar") {
      await salvarAgora();
      const f = faltando();
      if (f.length) return avisar(`Para publicar, falta: ${f.join(", ")}.`, "erro");
      botao.disabled = true;
      const { error } = await sb.from("pecas").update({ status: "disponivel" }).eq("id", p.id);
      botao.disabled = false;
      if (error) return avisar(mensagemDeErro(error), "erro");
      p.status = "disponivel";
      estado.editores.delete(p.id);
      el.classList.add("saindo");
      setTimeout(() => el.remove(), 300);
      avisar(`“${p.titulo}” publicada na loja.`);
      atualizarPublicarProntos();
      atualizarContagemRascunhos(-1);
    }

    if (acao === "concluir") {
      await salvarAgora();
      aoTerminar("concluida");
    }
  });

  inputArquivo.addEventListener("change", () => {
    adicionarFotos(inputArquivo.files);
    inputArquivo.value = "";
  });

  const areaFotos = $(".editor-fotos", el);
  areaFotos.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    $(".adicionar-foto", el)?.classList.add("arrastando");
  });
  areaFotos.addEventListener("dragleave", () => $(".adicionar-foto", el)?.classList.remove("arrastando"));
  areaFotos.addEventListener("drop", (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    $(".adicionar-foto", el)?.classList.remove("arrastando");
    adicionarFotos(e.dataTransfer.files);
  });

  atualizarSituacao();
  return { id: p.id, pronta: () => faltando().length === 0, salvarAgora };
}

function atualizarContagemRascunhos(delta) {
  const el = $("#qtd-rascunhos");
  const atual = parseInt(el.textContent.replace(/\D/g, ""), 10) || 0;
  const novo = Math.max(0, atual + delta);
  el.textContent = novo ? `(${novo})` : "";
  if (novo === 0 && !$("#lista-rascunhos .editor:not(.saindo)")) {
    setTimeout(() => {
      if (!$("#lista-rascunhos .editor")) {
        $("#lista-rascunhos").innerHTML = `<div class="sem-rascunhos">Nenhum rascunho. As peças lidas aparecem aqui para você revisar.</div>`;
      }
    }, 350);
  }
}

/* ------------------------------------------------------------------ */
/* Recorte                                                             */
/* ------------------------------------------------------------------ */

function abrirRecorte(blob, recorteInicial) {
  return new Promise((resolver) => {
    const dialogo = $("#dialogo-recorte");
    const area = $("#recorte-area");
    const img = $("#recorte-imagem");
    const caixa = $("#recorte-caixa");
    const url = URL.createObjectURL(blob);
    let atual = normalizarRecorte(recorteInicial);
    let inicio = null;
    let resolvido = false;

    const desenhar = () => {
      if (!atual) return caixa.classList.add("oculto");
      caixa.classList.remove("oculto");
      caixa.style.left = `${atual.x * 100}%`;
      caixa.style.top = `${atual.y * 100}%`;
      caixa.style.width = `${atual.largura * 100}%`;
      caixa.style.height = `${atual.altura * 100}%`;
    };

    const ponto = (e) => {
      const r = img.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };

    const baixo = (e) => {
      inicio = ponto(e);
      area.setPointerCapture(e.pointerId);
      atual = { x: inicio.x, y: inicio.y, largura: 0, altura: 0 };
      desenhar();
    };
    const mover = (e) => {
      if (!inicio) return;
      const q = ponto(e);
      atual = {
        x: Math.min(inicio.x, q.x),
        y: Math.min(inicio.y, q.y),
        largura: Math.abs(q.x - inicio.x),
        altura: Math.abs(q.y - inicio.y),
      };
      desenhar();
    };
    const cima = () => {
      inicio = null;
      if (atual && (atual.largura < 0.03 || atual.altura < 0.03)) atual = null;
      desenhar();
    };

    const terminar = (valor) => {
      if (resolvido) return;
      resolvido = true;
      area.removeEventListener("pointerdown", baixo);
      area.removeEventListener("pointermove", mover);
      area.removeEventListener("pointerup", cima);
      $("#recorte-aplicar").onclick = null;
      $("#recorte-inteira").onclick = null;
      if (dialogo.open) dialogo.close();
      URL.revokeObjectURL(url);
      resolver(valor);
    };

    area.addEventListener("pointerdown", baixo);
    area.addEventListener("pointermove", mover);
    area.addEventListener("pointerup", cima);
    $("#recorte-aplicar").onclick = () => terminar(normalizarRecorte(atual));
    $("#recorte-inteira").onclick = () => terminar(null);
    dialogo.addEventListener("close", () => terminar(undefined), { once: true });

    img.onload = desenhar;
    img.src = url;
    dialogo.showModal();
  });
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

const LIMITE_PECAS = 50;

async function contarPecas() {
  const contar = (s) => sb.from("pecas").select("id", { count: "exact", head: true }).eq("status", s);
  const [d, r, v, o, ra] = await Promise.all(["disponivel", "reservado", "vendido", "oculto", "rascunho"].map(contar));
  const partes = [
    `${d.count ?? 0} disponíveis`,
    `${r.count ?? 0} reservadas`,
    `${v.count ?? 0} vendidas`,
  ];
  if (o.count) partes.push(`${o.count} ocultas`);
  if (ra.count) partes.push(`${ra.count} rascunhos`);
  $("#resumo-pecas").textContent = partes.join(" · ");
}

function linhaPecaHtml(p) {
  const nomeCat = estado.categorias.find((c) => c.id === p.categoria_id)?.nome;
  const publicada = ["disponivel", "reservado", "vendido"].includes(p.status);
  return `
    <div class="linha-peca" data-id="${p.id}">
      ${p.fotos?.[0] ? `<img src="${fotoUrl(p.fotos[0], "p")}" alt="" loading="lazy">` : `<span class="sem-foto"></span>`}
      <div>
        <h3>${escapar(p.titulo || "Sem título")}</h3>
        <small>Cód. ${p.codigo}${p.tamanho ? ` · Tam. ${escapar(p.tamanho)}` : ""}${p.marca ? ` · ${escapar(p.marca)}` : ""}${nomeCat ? ` · ${escapar(nomeCat)}` : ""}</small>
      </div>
      <span class="preco">${formatarPreco(p.preco) || "—"}</span>
      <select class="entrada" data-status aria-label="Situação">
        ${Object.entries(STATUS_PECA).map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <div class="linha-acoes">
        <button class="estrela ${p.destaque ? "ativa" : ""}" data-destaque title="${p.destaque ? "Tirar do destaque" : "Destacar na página inicial"}">★</button>
        <button class="botao contorno pequeno" data-editar>Editar</button>
        ${publicada ? `<a class="botao contorno pequeno" href="./#/peca/${p.codigo}" target="_blank" rel="noopener">Ver</a>` : ""}
      </div>
    </div>`;
}

async function carregarPecas(reiniciar) {
  const tabela = $("#tabela-pecas");
  if (reiniciar) {
    estado.pecasCarregadas = 0;
    tabela.innerHTML = `<div class="vazio-painel"><span class="girando" style="display:inline-block"></span></div>`;
    contarPecas();
  }
  const status = $("#filtro-status").value;
  const categoria = $("#filtro-categoria").value;
  const busca = $("#busca-pecas").value.trim();

  let q = sb
    .from("pecas")
    .select("id,codigo,titulo,marca,tamanho,preco,status,destaque,fotos,categoria_id", { count: "exact" });
  if (status === "publicadas") q = q.in("status", ["disponivel", "reservado"]);
  else if (status !== "todas") q = q.eq("status", status);
  if (categoria) q = q.eq("categoria_id", Number(categoria));
  if (busca) {
    const t = busca.replace(/[%,()"'*\\:]/g, " ").replace(/\s+/g, " ").trim();
    const filtros = [`titulo.ilike."%${t}%"`, `marca.ilike."%${t}%"`];
    if (/^\d+$/.test(t)) filtros.push(`codigo.eq.${t}`);
    if (t) q = q.or(filtros.join(","));
  }
  q = q.order("criado_em", { ascending: false }).range(estado.pecasCarregadas, estado.pecasCarregadas + LIMITE_PECAS - 1);

  const { data, error, count } = await q;
  if (error) {
    tabela.innerHTML = `<div class="aviso erro">${escapar(mensagemDeErro(error))}</div>`;
    return;
  }
  if (reiniciar) tabela.innerHTML = "";
  if (reiniciar && !data.length) {
    tabela.innerHTML = `<div class="vazio-painel">Nenhuma peça encontrada.</div>`;
  }
  tabela.insertAdjacentHTML("beforeend", data.map(linhaPecaHtml).join(""));
  estado.pecasCarregadas += data.length;
  estado.pecasTotal = count ?? estado.pecasCarregadas;
  $("#mais-pecas").classList.toggle("oculto", estado.pecasCarregadas >= estado.pecasTotal);
}

async function abrirEdicao(id) {
  const { data: p, error } = await sb.from("pecas").select("*").eq("id", id).maybeSingle();
  if (error || !p) return avisar(error ? mensagemDeErro(error) : "Peça não encontrada.", "erro");
  const dialogo = $("#dialogo-editar");
  const corpo = $("#dialogo-editar-corpo");
  corpo.innerHTML = editorHtml(p, "edicao");
  let controle;
  const fechar = () => {
    if (dialogo.open) dialogo.close();
  };
  controle = ligarEditor(corpo.firstElementChild, p, "edicao", fechar);
  dialogo.addEventListener(
    "close",
    async () => {
      await controle.salvarAgora();
      corpo.innerHTML = "";
      carregarPecas(true);
    },
    { once: true },
  );
  dialogo.showModal();
}

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

async function contarPedidosNovos() {
  const { count } = await sb.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "novo");
  const el = $("#novos-pedidos");
  el.textContent = count || "";
  el.classList.toggle("oculto", !count);
}

function formatarCpf(valor) {
  const d = soDigitos(valor);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

function nomeDoFrete(p) {
  const empresa = (p.frete_empresa || "").trim();
  const nome = (p.frete_nome || "").trim();
  return nome.toLowerCase().startsWith(empresa.toLowerCase()) ? nome : `${empresa} ${nome}`.trim();
}

function etiquetaHtml(p) {
  if (p.entrega !== "envio") return "";
  const st = p.etiqueta_status || "";
  if (!p.frete_servico) {
    return p.status === "cancelado"
      ? ""
      : `<div class="pedido-etiqueta"><small>Frete a combinar: se precisar de etiqueta, faça direto no Melhor Envio.</small></div>`;
  }
  const cancelar = ["carrinho", "paga", "gerada"].includes(st)
    ? `<button type="button" class="botao-texto" data-etiqueta="cancelar">${st === "carrinho" ? "Tirar do carrinho" : "Cancelar etiqueta"}</button>`
    : "";
  if (st === "gerada") {
    return `
      <div class="pedido-etiqueta">
        ${
          p.etiqueta_url
            ? `<a class="botao pequeno" href="${escapar(p.etiqueta_url)}" target="_blank" rel="noopener">Imprimir etiqueta</a>`
            : `<button type="button" class="botao pequeno" data-etiqueta="imprimir">Buscar etiqueta</button>`
        }
        ${
          p.etiqueta_rastreio
            ? `<span>Rastreio: <span class="rastreio">${escapar(p.etiqueta_rastreio)}</span></span>`
            : `<button type="button" class="botao-texto" data-etiqueta="imprimir">Atualizar rastreio</button>`
        }
        ${cancelar}
      </div>`;
  }
  if (p.status === "cancelado") return cancelar ? `<div class="pedido-etiqueta">${cancelar}</div>` : "";
  const nota =
    st === "carrinho"
      ? "Está no carrinho do Melhor Envio. Falta pagar com o saldo."
      : st === "paga"
        ? "Já está paga. Falta gerar."
        : `Usa o saldo da conta no Melhor Envio (cerca de ${formatarPreco(p.frete_valor)}).`;
  return `
    <div class="pedido-etiqueta">
      <button type="button" class="botao pequeno contorno" data-etiqueta="etiqueta">${st === "carrinho" || st === "paga" ? "Continuar etiqueta" : "Gerar etiqueta"}</button>
      <small>${nota}</small>
      ${cancelar}
    </div>`;
}

function pedidoHtml(p) {
  const nomeLoja = estado.config?.nome || "loja";
  const msg = `Olá, ${p.nome.split(" ")[0]}! Aqui é da ${nomeLoja}, sobre o seu pedido nº ${p.numero}.`;
  const temFrete = p.frete_valor !== null && p.frete_valor !== undefined;
  const total = Number(p.total) + (temFrete ? Number(p.frete_valor) : 0);
  return `
    <article class="pedido ${p.status === "novo" ? "novo" : ""}" data-id="${p.id}">
      <div class="pedido-topo">
        <div>
          <h3>Pedido nº ${p.numero}</h3>
          <small>${dataCurta(p.criado_em)} · ${STATUS_PEDIDO[p.status]}</small>
        </div>
        <div class="pedido-acoes">
          <a class="botao argila pequeno" href="${linkWhatsapp(p.telefone, msg)}" target="_blank" rel="noopener">WhatsApp</a>
          <select class="entrada" data-status-pedido aria-label="Situação do pedido">
            ${Object.entries(STATUS_PEDIDO).map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="pedido-corpo">
        <div>
          <p><strong>${escapar(p.nome)}</strong></p>
          <p>${escapar(p.telefone)}${p.email ? ` · ${escapar(p.email)}` : ""}</p>
          ${p.cpf ? `<p>CPF ${escapar(formatarCpf(p.cpf))}</p>` : ""}
          <p>${p.entrega === "envio" ? `Envio: ${escapar(p.endereco)}${p.cep ? ` · CEP ${escapar(p.cep)}` : ""}` : "Retirada"}</p>
          ${
            p.frete_servico
              ? `<p class="pedido-frete">Frete: ${escapar(nomeDoFrete(p))} · ${formatarPreco(p.frete_valor)}${p.frete_prazo ? ` · até ${p.frete_prazo} dias úteis` : ""}</p>`
              : p.entrega === "envio"
                ? `<p class="pedido-frete">Frete a combinar</p>`
                : ""
          }
          ${p.observacoes ? `<p style="color:var(--taupe)">“${escapar(p.observacoes)}”</p>` : ""}
        </div>
        <div class="pedido-itens">
          ${(p.pedido_itens || [])
            .map(
              (i) => `
            <div class="pedido-item">
              ${i.foto ? `<img src="${fotoUrl(i.foto, "p")}" alt="" loading="lazy">` : `<span class="sem-foto"></span>`}
              <span>${escapar(i.titulo)}</span>
              <span>${formatarPreco(i.preco)}</span>
            </div>`,
            )
            .join("")}
          ${
            temFrete
              ? `<div class="pedido-subtotal"><span>Peças</span><span>${formatarPreco(p.total)}</span></div>
                 <div class="pedido-subtotal"><span>Frete</span><span>${formatarPreco(p.frete_valor)}</span></div>`
              : ""
          }
          <div class="pedido-total"><span>Total</span><span>${formatarPreco(total)}</span></div>
        </div>
      </div>
      ${etiquetaHtml(p)}
    </article>`;
}

async function carregarPedidos() {
  const lista = $("#lista-pedidos");
  lista.innerHTML = `<div class="vazio-painel"><span class="girando" style="display:inline-block"></span></div>`;
  const filtro = $("#filtro-pedidos").value;
  let q = sb
    .from("pedidos")
    .select("*, pedido_itens(id,titulo,preco,foto,peca_id)")
    .order("criado_em", { ascending: false })
    .limit(100);
  if (filtro === "abertos") q = q.in("status", ["novo", "pago", "enviado"]);
  else if (filtro !== "todos") q = q.eq("status", filtro);
  const { data, error } = await q;
  if (error) {
    lista.innerHTML = `<div class="aviso erro">${escapar(mensagemDeErro(error))}</div>`;
    return;
  }
  lista.innerHTML = data.length
    ? data.map(pedidoHtml).join("")
    : `<div class="vazio-painel">Nenhum pedido ${filtro === "abertos" ? "em aberto" : "por aqui"}.</div>`;
  contarPedidosNovos();
}

/* ------------------------------------------------------------------ */
/* Loja                                                                */
/* ------------------------------------------------------------------ */

function mostrarLoja() {
  const form = $("#form-config");
  const c = estado.config || {};
  ["nome", "slogan", "sobre", "whatsapp", "instagram", "email", "cidade", "envio_info", "retirada_info"].forEach((k) => {
    if (form[k]) form[k].value = c[k] ?? "";
  });
  desenharCategorias();
  carregarEnvio();
}

function desenharCategorias() {
  $("#lista-categorias").innerHTML = estado.categorias
    .map(
      (c, i) => `
      <div class="linha-categoria" data-id="${c.id}">
        <input class="entrada" value="${escapar(c.nome)}" aria-label="Nome da categoria">
        <button type="button" data-mover="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
        <button type="button" data-mover="1" ${i === estado.categorias.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
        <button type="button" data-apagar aria-label="Excluir categoria">✕</button>
      </div>`,
    )
    .join("");
}

async function recarregarCategorias() {
  const { data } = await sb.from("categorias").select("*").order("ordem").order("nome");
  estado.categorias = data || [];
  desenharCategorias();
  const opcoes = estado.categorias.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join("");
  $("#filtro-categoria").innerHTML = `<option value="">Todas as categorias</option>${opcoes}`;
}

async function verificarIa() {
  const el = $("#status-ia");
  const dica = $("#dica-ia");
  try {
    const { data, error } = await sb.functions.invoke("extrair-peca", { body: { ping: true } });
    if (error) throw error;
    estado.iaDisponivel = Boolean(data?.ia);
  } catch {
    estado.iaDisponivel = null;
  }
  const painelSegredos = "https://supabase.com/dashboard/project/vmhbvlyxpxzqclghxvtj/functions/secrets";
  if (estado.iaDisponivel === true) {
    el.innerHTML = "Ativa. Fotos, prints e textos são lidos pelo Claude, que preenche os campos e recorta as fotos.";
    dica.textContent = "Dica: dá para enviar vários prints de uma vez, inclusive de anúncios do Enjoei. Cada peça vira um rascunho com a foto recortada e uma descrição no tom da loja.";
  } else if (estado.iaDisponivel === false) {
    el.innerHTML = `Desligada. O painel usa a leitura simples, que entende textos e lê prints, mas acerta menos e não recorta as fotos sozinha. Para ligar, cadastre o segredo <code>ANTHROPIC_API_KEY</code> em <a class="link" href="${painelSegredos}" target="_blank" rel="noopener">Edge Functions › Secrets</a> no Supabase.`;
    dica.textContent = "Leitura simples ativa: textos são entendidos na hora; prints passam por leitura de texto (OCR), o que leva alguns segundos.";
  } else {
    el.textContent = "Não consegui verificar agora. O cadastro funciona mesmo assim.";
    dica.textContent = "";
  }
}

/* ------------------------------------------------------------------ */
/* Envio e etiquetas (Melhor Envio)                                    */
/* ------------------------------------------------------------------ */

const CAMPOS_ENVIO = ["nome", "documento", "telefone", "email", "cep", "rua", "numero", "complemento", "bairro", "cidade", "uf", "dias_postagem"];
const TRANSPORTADORAS_BASE = ["Correios", "Jadlog", "Loggi"];
const PAINEL_SEGREDOS = "https://supabase.com/dashboard/project/vmhbvlyxpxzqclghxvtj/functions/secrets";

async function carregarEnvio() {
  const form = $("#form-envio");
  const { data, error } = await sb.from("envio_config").select("*").eq("id", 1).maybeSingle();
  if (error) {
    $("#status-envio").innerHTML = `<p class="alerta">${escapar(mensagemDeErro(error))}</p>`;
    return;
  }
  estado.envio = data || {};
  CAMPOS_ENVIO.forEach((k) => {
    if (form[k]) form[k].value = estado.envio[k] ?? "";
  });
  form.declarar_valor.checked = estado.envio.declarar_valor !== false;
  desenharTransportadoras([]);
  atualizarStatusEnvio();
  chamarFuncao("frete", { acao: "transportadoras" })
    .then((r) => {
      if (r?.ok && Array.isArray(r.transportadoras)) desenharTransportadoras(r.transportadoras);
    })
    .catch(() => {});
}

function desenharTransportadoras(lista) {
  const marcadas = new Set((estado.envio?.transportadoras || []).map((n) => n.toLowerCase()));
  const porNome = new Map();
  const incluir = (nome, id = null) => {
    const chave = nome.toLowerCase();
    const atual = porNome.get(chave);
    if (!atual) porNome.set(chave, { nome, id });
    else if (id && !atual.id) atual.id = id;
  };
  (lista || []).forEach((t) => t?.nome && incluir(t.nome, t.id));
  TRANSPORTADORAS_BASE.forEach((n) => incluir(n));
  (estado.envio?.transportadoras || []).forEach((n) => incluir(n));
  $("#lista-transportadoras").innerHTML = [...porNome.values()]
    .map(
      (t) => `<label class="marcar"><input type="checkbox" name="transportadora" value="${escapar(t.nome)}" data-empresa="${t.id ?? ""}" ${
        marcadas.has(t.nome.toLowerCase()) ? "checked" : ""
      }> ${escapar(t.nome)}</label>`,
    )
    .join("");
  carregarAgencias();
}

async function carregarAgencias() {
  const caixa = $("#agencias-envio");
  const empresas = $$("#lista-transportadoras input:checked")
    .map((i) => ({ nome: i.value, id: Number(i.dataset.empresa) || null }))
    .filter((t) => t.id && t.nome.toLowerCase() !== "correios");
  if (!empresas.length || !estado.statusEnvio?.valido || !estado.envio?.cidade) {
    caixa.classList.add("oculto");
    caixa.innerHTML = "";
    return;
  }
  const blocos = await Promise.all(
    empresas.map(async (t) => {
      const r = await chamarFuncao("frete", { acao: "agencias", empresa: t.id }).catch(() => null);
      const lista = r?.ok ? r.agencias || [] : [];
      if (!lista.length) return "";
      const atual = String(estado.envio?.agencias?.[t.id] ?? "");
      return `<label class="campo"><span>Agência ${escapar(t.nome)} onde você posta</span>
        <select data-agencia="${t.id}"><option value="">Escolha a agência…</option>${lista
          .map((a) => `<option value="${a.id}" ${String(a.id) === atual ? "selected" : ""}>${escapar(a.nome)}${a.endereco ? ` · ${escapar(a.endereco)}` : ""}</option>`)
          .join("")}</select></label>`;
    }),
  );
  const html = blocos.filter(Boolean).join("");
  caixa.innerHTML = html ? `${html}<p class="dica">Algumas transportadoras pedem a agência onde o pacote vai ser deixado.</p>` : "";
  caixa.classList.toggle("oculto", !html);
}

async function atualizarStatusEnvio() {
  const el = $("#status-envio");
  el.textContent = "Verificando o Melhor Envio…";
  let s = null;
  try {
    s = await chamarFuncao("frete", { acao: "status" });
  } catch {
    s = null;
  }
  estado.statusEnvio = s;
  if (!s?.ok) {
    el.innerHTML = `<p>Não consegui verificar o Melhor Envio agora. O site continua aceitando pedidos com frete a combinar.</p>`;
    return;
  }
  const faltas = s.faltas || [];
  const partes = [];
  if (!s.token) {
    partes.push(`
      <p><strong>Frete automático desligado.</strong> Enquanto isso, os pedidos com envio ficam com o frete a combinar pelo WhatsApp.</p>
      <p>Para ligar o frete no site e as etiquetas:</p>
      <ol>
        <li>Crie uma conta grátis no <a class="link" href="https://melhorenvio.com.br" target="_blank" rel="noopener">Melhor Envio</a>.</li>
        <li>Lá, em <a class="link" href="https://melhorenvio.com.br/painel/gerenciar/tokens" target="_blank" rel="noopener">Gerenciar › Tokens</a>, clique em <strong>Novo token</strong>, marque <strong>Selecionar todos</strong> e salve.</li>
        <li>Copie o token e cadastre no Supabase, em <a class="link" href="${PAINEL_SEGREDOS}" target="_blank" rel="noopener">Edge Functions › Secrets</a>, com o nome <code>MELHOR_ENVIO_TOKEN</code>.</li>
      </ol>`);
  } else if (s.valido === false) {
    partes.push(`<p class="alerta"><strong>O Melhor Envio recusou o token.</strong> ${escapar(s.erro || "")} Gere um novo em Gerenciar › Tokens e troque o segredo <code>MELHOR_ENVIO_TOKEN</code> no <a class="link" href="${PAINEL_SEGREDOS}" target="_blank" rel="noopener">Supabase</a>.</p>`);
  } else {
    partes.push(`<p class="ok"><strong>Conectado ao Melhor Envio</strong>${s.conta?.nome ? ` (${escapar(s.conta.nome)})` : ""}${s.sandbox ? ", no ambiente de testes" : ""}.</p>`);
    if (s.saldo !== null && s.saldo !== undefined) {
      partes.push(`<p>Saldo para etiquetas: <strong>${formatarPreco(s.saldo)}</strong>. Para pôr mais, use a carteira da sua conta no <a class="link" href="https://melhorenvio.com.br/painel" target="_blank" rel="noopener">Melhor Envio</a>.</p>`);
    }
  }
  if (s.token && s.valido !== false) {
    if (faltas.includes("CEP")) partes.push(`<p class="alerta">Preencha o CEP de onde as peças saem para o frete aparecer no site.</p>`);
    else partes.push(`<p>O frete já aparece na finalização do pedido, com as transportadoras marcadas abaixo.</p>`);
    if (/combinad/i.test(estado.config?.envio_info || "")) {
      partes.push(`<p>Dica: o <strong>Texto sobre envio</strong>, em Dados da loja, ainda diz que o frete é combinado pelo WhatsApp. Vale trocar por algo como “Enviamos para todo o Brasil. O frete é calculado pelo CEP ao finalizar o pedido.”</p>`);
    }
    if (faltas.length) partes.push(`<p>Para gerar etiquetas, falta preencher: ${escapar(faltas.join(", "))}.</p>`);
  }
  el.innerHTML = partes.join("");
  carregarAgencias();
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

function ligarEventos() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<datalist id="lista-estados"><option>Nova com etiqueta</option><option>Nova</option><option>Excelente estado</option><option>Ótimo estado</option><option>Bom estado</option></datalist>
     <datalist id="lista-tamanhos">${["PP", "P", "M", "G", "GG", "XG", "Único", "34", "36", "38", "40", "42", "44", "46", "48"].map((t) => `<option>${t}</option>`).join("")}</datalist>`,
  );

  $("#form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const botao = $("button[type=submit]", f);
    botao.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    botao.disabled = false;
    if (error) {
      mostrarEntrar(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : mensagemDeErro(error));
      return;
    }
    f.senha.value = "";
    entrarNoPainel(data.user);
  });

  $("#sair").addEventListener("click", async () => {
    await sb.auth.signOut();
    mostrarEntrar();
  });

  window.addEventListener("hashchange", () => {
    if (estado.usuario) irParaAba();
  });

  // Cadastro: escolher, soltar e colar
  const soltar = $("#soltar");
  const arquivos = $("#arquivos");
  soltar.addEventListener("click", () => arquivos.click());
  soltar.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      arquivos.click();
    }
  });
  arquivos.addEventListener("change", () => {
    adicionarPendentes([...arquivos.files]);
    arquivos.value = "";
  });

  const abaCadastro = $("#aba-cadastro");
  abaCadastro.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    soltar.classList.add("arrastando");
  });
  abaCadastro.addEventListener("dragleave", (e) => {
    if (!abaCadastro.contains(e.relatedTarget)) soltar.classList.remove("arrastando");
  });
  abaCadastro.addEventListener("drop", (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    soltar.classList.remove("arrastando");
    adicionarPendentes([...e.dataTransfer.files]);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  document.addEventListener("paste", (e) => {
    if (!estado.usuario || $("#aba-cadastro").classList.contains("oculto")) return;
    if (document.querySelector("dialog[open]")) return;
    const itens = [...(e.clipboardData?.items || [])];
    const imagens = itens.filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile());
    if (imagens.length) {
      e.preventDefault();
      adicionarPendentes(imagens);
      avisar(imagens.length === 1 ? "Imagem adicionada." : `${imagens.length} imagens adicionadas.`);
      return;
    }
    const alvo = e.target;
    const emCampo = alvo.closest?.("input, textarea, select, [contenteditable]");
    const texto = e.clipboardData?.getData("text/plain");
    if (!emCampo && texto) {
      e.preventDefault();
      const campo = $("#texto-colado");
      campo.value = campo.value ? `${campo.value}\n\n${texto}` : texto;
      atualizarBotaoProcessar();
      campo.focus();
    }
  });

  $("#previas").addEventListener("click", (e) => {
    const id = e.target.closest("[data-tirar]")?.dataset.tirar;
    if (!id) return;
    const i = estado.pendentes.findIndex((p) => p.id === id);
    if (i > -1) {
      URL.revokeObjectURL(estado.pendentes[i].url);
      estado.pendentes.splice(i, 1);
    }
    desenharPrevias();
  });
  $("#texto-colado").addEventListener("input", atualizarBotaoProcessar);
  $("#processar").addEventListener("click", processar);
  $("#publicar-prontos").addEventListener("click", publicarProntos);

  // Peças
  let atrasoBusca;
  $("#busca-pecas").addEventListener("input", () => {
    clearTimeout(atrasoBusca);
    atrasoBusca = setTimeout(() => carregarPecas(true), 350);
  });
  $("#filtro-status").addEventListener("change", () => carregarPecas(true));
  $("#filtro-categoria").addEventListener("change", () => carregarPecas(true));
  $("#carregar-mais-pecas").addEventListener("click", () => carregarPecas(false));
  $("#tabela-pecas").addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-status]");
    if (!sel) return;
    const linha = sel.closest(".linha-peca");
    const anterior = [...sel.options].find((o) => o.defaultSelected)?.value;
    const { error } = await sb.from("pecas").update({ status: sel.value }).eq("id", linha.dataset.id);
    if (error) {
      sel.value = anterior;
      return avisar(mensagemDeErro(error), "erro");
    }
    [...sel.options].forEach((o) => (o.defaultSelected = o.value === sel.value));
    avisar(`Situação alterada para “${STATUS_PECA[sel.value]}”.`);
    contarPecas();
  });
  $("#tabela-pecas").addEventListener("click", async (e) => {
    const linha = e.target.closest(".linha-peca");
    if (!linha) return;
    if (e.target.closest("[data-editar]")) abrirEdicao(linha.dataset.id);
    const estrela = e.target.closest("[data-destaque]");
    if (estrela) {
      const ativo = !estrela.classList.contains("ativa");
      const { error } = await sb.from("pecas").update({ destaque: ativo }).eq("id", linha.dataset.id);
      if (error) return avisar(mensagemDeErro(error), "erro");
      estrela.classList.toggle("ativa", ativo);
      avisar(ativo ? "Peça destacada na página inicial." : "Destaque removido.");
    }
  });

  $$("dialog [data-fechar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // Pedidos
  $("#filtro-pedidos").addEventListener("change", carregarPedidos);
  $("#lista-pedidos").addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-status-pedido]");
    if (!sel) return;
    const id = sel.closest(".pedido").dataset.id;
    const novo = sel.value;
    if (novo === "cancelado" && !confirm("Cancelar este pedido? As peças voltam a ficar disponíveis na loja.")) {
      carregarPedidos();
      return;
    }
    const { error } = await sb.from("pedidos").update({ status: novo }).eq("id", id);
    if (error) return avisar(mensagemDeErro(error), "erro");
    avisar(`Pedido marcado como “${STATUS_PEDIDO[novo]}”.`);
    carregarPedidos();
  });

  $("#lista-pedidos").addEventListener("click", async (e) => {
    const botao = e.target.closest("[data-etiqueta]");
    if (!botao) return;
    const acao = botao.dataset.etiqueta;
    if (acao === "etiqueta" && !confirm("Gerar a etiqueta agora? O valor sai do saldo da sua conta no Melhor Envio.")) return;
    if (acao === "cancelar" && !confirm("Cancelar a etiqueta? Se já foi paga, o valor volta para o saldo do Melhor Envio.")) return;
    const id = botao.closest(".pedido").dataset.id;
    botao.disabled = true;
    botao.innerHTML = `<span class="girando"></span>`;
    try {
      const r = await chamarFuncao("frete", { acao, pedido_id: id });
      if (!r?.ok) avisar(r?.erro || "Não foi possível concluir. Tente de novo.", "erro");
      else if (acao === "cancelar") avisar("Etiqueta cancelada.");
      else avisar(r.url ? "Etiqueta pronta. Clique em Imprimir etiqueta." : r.aviso || "Etiqueta gerada.");
    } catch (erro) {
      avisar(mensagemDeErro(erro), "erro");
    }
    carregarPedidos();
  });

  // Envio e etiquetas
  const formEnvio = $("#form-envio");
  formEnvio.cep.addEventListener("input", async () => {
    const cep = soDigitos(formEnvio.cep.value).slice(0, 8);
    formEnvio.cep.value = cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
    if (cep.length !== 8) return;
    try {
      const d = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
      if (!d || d.erro) return;
      const preencher = (campo, valor) => {
        if (valor && !formEnvio[campo].value.trim()) formEnvio[campo].value = valor;
      };
      preencher("rua", d.logradouro);
      preencher("bairro", d.bairro);
      preencher("cidade", d.localidade);
      preencher("uf", d.uf);
    } catch {
      /* digita à mão */
    }
  });
  $("#lista-transportadoras").addEventListener("change", carregarAgencias);
  formEnvio.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const dados = {};
    ["nome", "telefone", "email", "rua", "numero", "complemento", "bairro", "cidade"].forEach((k) => (dados[k] = f[k].value.trim()));
    dados.documento = soDigitos(f.documento.value);
    const cep = soDigitos(f.cep.value);
    dados.cep = cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
    dados.uf = f.uf.value.trim().toUpperCase();
    dados.dias_postagem = Math.min(15, Math.max(0, parseInt(f.dias_postagem.value, 10) || 0));
    dados.declarar_valor = f.declarar_valor.checked;
    dados.transportadoras = $$("#lista-transportadoras input:checked").map((i) => i.value);
    const agencias = { ...(estado.envio?.agencias || {}) };
    $$("#agencias-envio [data-agencia]").forEach((s) => {
      if (s.value) agencias[s.dataset.agencia] = Number(s.value);
      else delete agencias[s.dataset.agencia];
    });
    dados.agencias = agencias;
    if (cep && cep.length !== 8) return avisar("O CEP tem 8 números.", "erro");
    if (dados.uf && !/^[A-Z]{2}$/.test(dados.uf)) return avisar("A UF tem duas letras, como RJ.", "erro");
    if (dados.documento && ![11, 14].includes(dados.documento.length)) return avisar("Confira o CPF ou CNPJ.", "erro");
    if (!dados.transportadoras.length) return avisar("Escolha pelo menos uma transportadora.", "erro");
    dados.atualizado_em = new Date().toISOString();
    const botao = f.querySelector('button[type="submit"]');
    botao.disabled = true;
    const { error } = await sb.from("envio_config").update(dados).eq("id", 1);
    botao.disabled = false;
    if (error) return avisar(mensagemDeErro(error), "erro");
    estado.envio = { ...estado.envio, ...dados };
    f.cep.value = dados.cep;
    avisar("Dados de envio salvos.");
    atualizarStatusEnvio();
  });

  // Loja
  $("#form-config").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const dados = {};
    ["nome", "slogan", "sobre", "whatsapp", "instagram", "email", "cidade", "envio_info", "retirada_info"].forEach(
      (k) => (dados[k] = f[k].value.trim()),
    );
    if (!dados.nome) return avisar("Informe o nome da loja.", "erro");
    dados.atualizado_em = new Date().toISOString();
    const { error } = await sb.from("loja_config").update(dados).eq("id", 1);
    if (error) return avisar(mensagemDeErro(error), "erro");
    estado.config = { ...estado.config, ...dados };
    $("#logo-painel").innerHTML = logotipoHtml(estado.config.nome);
    avisar("Dados da loja salvos.");
  });

  $("#lista-categorias").addEventListener("change", async (e) => {
    const input = e.target.closest("input");
    if (!input) return;
    const id = Number(input.closest("[data-id]").dataset.id);
    const nome = input.value.trim();
    if (!nome) return recarregarCategorias();
    const { error } = await sb.from("categorias").update({ nome, slug: slugificar(nome) }).eq("id", id);
    if (error) avisar(/duplicate|unique/i.test(error.message) ? "Já existe uma categoria com esse nome." : mensagemDeErro(error), "erro");
    else avisar("Categoria renomeada.");
    recarregarCategorias();
  });

  $("#lista-categorias").addEventListener("click", async (e) => {
    const linha = e.target.closest("[data-id]");
    if (!linha) return;
    const id = Number(linha.dataset.id);
    const i = estado.categorias.findIndex((c) => c.id === id);
    const mover = e.target.closest("[data-mover]");
    if (mover) {
      const j = i + Number(mover.dataset.mover);
      const lista = [...estado.categorias];
      [lista[i], lista[j]] = [lista[j], lista[i]];
      await Promise.all(lista.map((c, k) => sb.from("categorias").update({ ordem: k + 1 }).eq("id", c.id)));
      recarregarCategorias();
    }
    if (e.target.closest("[data-apagar]")) {
      const cat = estado.categorias[i];
      if (!confirm(`Excluir a categoria “${cat.nome}”? As peças dela ficam sem categoria.`)) return;
      const { error } = await sb.from("categorias").delete().eq("id", id);
      if (error) return avisar(mensagemDeErro(error), "erro");
      avisar("Categoria excluída.");
      recarregarCategorias();
    }
  });

  $("#form-categoria").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const nome = f.nome.value.trim();
    if (!nome) return;
    const ordem = Math.max(0, ...estado.categorias.map((c) => c.ordem || 0)) + 1;
    const { error } = await sb.from("categorias").insert({ nome, slug: slugificar(nome), ordem });
    if (error) return avisar(/duplicate|unique/i.test(error.message) ? "Essa categoria já existe." : mensagemDeErro(error), "erro");
    f.reset();
    avisar("Categoria adicionada.");
    recarregarCategorias();
  });

  $("#form-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.senha.value.length < 8) return avisar("Use pelo menos 8 caracteres.", "erro");
    if (f.senha.value !== f.senha2.value) return avisar("As senhas não conferem.", "erro");
    const { error } = await sb.auth.updateUser({ password: f.senha.value });
    if (error) return avisar(mensagemDeErro(error), "erro");
    f.reset();
    avisar("Senha alterada.");
  });
}

async function iniciar() {
  ligarEventos();
  // logotipo na tela de entrar
  sb.from("loja_config")
    .select("nome")
    .eq("id", 1)
    .maybeSingle()
    .then(({ data }) => ($("#logo-entrar").innerHTML = logotipoHtml(data?.nome || "Brechó da Natasha")));

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session?.user) await entrarNoPainel(session.user);
  else mostrarEntrar();

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") {
      estado.usuario = null;
      mostrarEntrar();
    }
  });
}

iniciar();
