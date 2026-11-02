// Loja: vitrine, página da peça, sacola e finalização do pedido.
import {
  sb,
  fotoUrl,
  formatarPreco,
  escapar,
  linkWhatsapp,
  avisar,
  logotipoHtml,
  mensagemDeErro,
  numeroWhatsapp,
  soDigitos,
  chamarFuncao,
} from "./comum.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const POR_PAGINA = 24;
const CAMPOS_LISTA = "id,codigo,titulo,marca,tamanho,preco,preco_original,status,fotos,categoria_id,publicado_em";
const CAMPOS_PECA =
  "id,codigo,titulo,descricao,marca,tamanho,cor,estado,medidas,preco,preco_original,status,fotos,categoria_id,publicado_em,categorias(nome,slug)";

const CONFIG_PADRAO = {
  nome: "Brechó da Natasha",
  slogan: "Peças escolhidas a dedo, para durar.",
  sobre: "",
  whatsapp: "",
  instagram: "",
  email: "",
  cidade: "",
  envio_info: "",
  retirada_info: "",
};

const estado = {
  config: { ...CONFIG_PADRAO },
  categorias: [],
  resumo: null, // { categorias: Set<id>, tamanhos: string[] }
  sacola: carregarSacola(),
  rotaAnterior: "",
  freteAtivo: undefined, // o cálculo de frete (Melhor Envio) está ligado?
};

let idRender = 0;

/* ------------------------------------------------------------------ */
/* Sacola                                                              */
/* ------------------------------------------------------------------ */

function carregarSacola() {
  try {
    const dados = JSON.parse(localStorage.getItem("sacola") || "[]");
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

function salvarSacola() {
  try {
    localStorage.setItem("sacola", JSON.stringify(estado.sacola));
  } catch {
    /* navegação privada: a sacola vale só nesta visita */
  }
  atualizarContador();
}

function itemDaPeca(p) {
  return {
    id: p.id,
    codigo: p.codigo,
    titulo: p.titulo,
    marca: p.marca || "",
    tamanho: p.tamanho || "",
    preco: Number(p.preco),
    foto: p.fotos?.[0] || "",
  };
}

function estaNaSacola(id) {
  return estado.sacola.some((i) => i.id === id);
}

function adicionarNaSacola(peca) {
  if (!estaNaSacola(peca.id)) {
    estado.sacola.push(itemDaPeca(peca));
    salvarSacola();
  }
  abrirSacola();
}

function removerDaSacola(id) {
  estado.sacola = estado.sacola.filter((i) => i.id !== id);
  salvarSacola();
  desenharSacola();
}

function totalDaSacola(itens = estado.sacola) {
  return itens.reduce((soma, i) => soma + (Number(i.preco) || 0), 0);
}

function atualizarContador() {
  const el = $("#contador-sacola");
  const n = estado.sacola.length;
  el.textContent = String(n);
  el.classList.toggle("oculto", n === 0);
  $("#abrir-sacola").setAttribute("aria-label", n ? `Abrir sacola (${n} ${n === 1 ? "peça" : "peças"})` : "Abrir sacola");
}

function itemSacolaHtml(i, comRemover = true) {
  return `
    <div class="item-sacola ${i.indisponivel ? "indisponivel" : ""}" data-id="${escapar(i.id)}">
      <a href="#/peca/${i.codigo}">${
        i.foto ? `<img src="${fotoUrl(i.foto, "p")}" alt="" loading="lazy">` : `<span class="sem-foto"></span>`
      }</a>
      <div>
        ${i.marca ? `<span class="rotulo">${escapar(i.marca)}</span>` : ""}
        <h3><a href="#/peca/${i.codigo}">${escapar(i.titulo)}</a></h3>
        ${
          comRemover
            ? `<div class="detalhe">${i.tamanho ? `Tam. ${escapar(i.tamanho)} · ` : ""}${formatarPreco(i.preco)}</div>`
            : i.tamanho ? `<div class="detalhe">Tam. ${escapar(i.tamanho)}</div>` : ""
        }
        ${i.indisponivel ? `<div class="detalhe" style="color:var(--erro)">Esta peça não está mais disponível</div>` : ""}
      </div>
      ${comRemover ? `<button class="remover" data-remover="${escapar(i.id)}">Remover</button>` : `<span>${formatarPreco(i.preco)}</span>`}
    </div>`;
}

function desenharSacola() {
  const itens = $("#sacola-itens");
  const rodape = $("#sacola-rodape");
  if (estado.sacola.length === 0) {
    itens.innerHTML = `
      <div class="sacola-vazia">
        <p>Sua sacola está vazia.</p>
        <a class="botao contorno" href="#/colecao">Ver a coleção</a>
      </div>`;
    rodape.innerHTML = "";
    return;
  }
  itens.innerHTML = estado.sacola.map((i) => itemSacolaHtml(i)).join("");
  rodape.innerHTML = `
    <div class="linha-total"><span>Subtotal</span><strong>${formatarPreco(totalDaSacola())}</strong></div>
    <a class="botao largo" href="#/finalizar">Finalizar pedido</a>`;
}

function abrirSacola() {
  desenharSacola();
  const s = $("#sacola");
  $("#sacola-fundo").hidden = false;
  s.classList.add("aberta");
  s.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#fechar-sacola").focus(), 50);
}

function fecharSacola() {
  const s = $("#sacola");
  if (!s.classList.contains("aberta")) return;
  s.classList.remove("aberta");
  s.setAttribute("aria-hidden", "true");
  $("#sacola-fundo").hidden = true;
  document.body.style.overflow = "";
}

/* ------------------------------------------------------------------ */
/* Dados                                                               */
/* ------------------------------------------------------------------ */

async function carregarBasico() {
  const [config, categorias] = await Promise.all([
    sb.from("loja_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("categorias").select("id,nome,slug,ordem").order("ordem").order("nome"),
  ]);
  if (config.data) estado.config = { ...CONFIG_PADRAO, ...config.data };
  estado.categorias = categorias.data || [];
}

async function carregarResumo() {
  if (estado.resumo) return estado.resumo;
  const { data } = await sb
    .from("pecas")
    .select("categoria_id,tamanho")
    .eq("status", "disponivel")
    .limit(5000);
  const categorias = new Set();
  const tamanhos = new Set();
  (data || []).forEach((p) => {
    if (p.categoria_id) categorias.add(p.categoria_id);
    if (p.tamanho) tamanhos.add(p.tamanho.trim());
  });
  estado.resumo = { categorias, tamanhos: ordenarTamanhos([...tamanhos]) };
  return estado.resumo;
}

const ORDEM_TAMANHOS = ["PP", "XP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "U", "ÚNICO", "UNICO"];

function ordenarTamanhos(lista) {
  const peso = (t) => {
    const s = t.toUpperCase();
    const i = ORDEM_TAMANHOS.indexOf(s);
    if (i > -1) return i;
    const n = parseFloat(s);
    return isNaN(n) ? 500 : 100 + n;
  };
  return lista.sort((a, b) => peso(a) - peso(b) || a.localeCompare(b));
}

function categoriasComPecas() {
  if (!estado.resumo) return estado.categorias;
  return estado.categorias.filter((c) => estado.resumo.categorias.has(c.id));
}

/* ------------------------------------------------------------------ */
/* Pedaços de interface                                                */
/* ------------------------------------------------------------------ */

function precoHtml(p) {
  const promo = p.preco_original && Number(p.preco_original) > Number(p.preco);
  return `${promo ? `<span class="preco-antigo">${formatarPreco(p.preco_original)}</span>` : ""}${formatarPreco(p.preco)}`;
}

function cartaoHtml(p) {
  const [f1, f2] = p.fotos || [];
  const indisponivel = p.status !== "disponivel";
  let selo = "";
  if (p.status === "reservado") selo = `<span class="selo">Reservada</span>`;
  else if (p.status === "vendido") selo = `<span class="selo escuro">Vendida</span>`;
  else if (p.preco_original && Number(p.preco_original) > Number(p.preco)) selo = `<span class="selo">Preço especial</span>`;
  return `
    <article class="cartao ${indisponivel ? "indisponivel" : ""}">
      <a class="cartao-foto" href="#/peca/${p.codigo}" aria-label="${escapar(p.titulo)}">
        ${selo}
        ${f1 ? `<img src="${fotoUrl(f1, "p")}" alt="${escapar(p.titulo)}" loading="lazy" decoding="async">` : ""}
        ${f2 ? `<img class="segunda" src="${fotoUrl(f2, "p")}" alt="" loading="lazy" decoding="async">` : ""}
      </a>
      <div class="cartao-info">
        ${p.marca ? `<span class="rotulo">${escapar(p.marca)}</span>` : ""}
        <a href="#/peca/${p.codigo}" class="cartao-titulo">${escapar(p.titulo)}</a>
        <div class="cartao-linha">
          <span class="preco">${precoHtml(p)}</span>
          ${p.tamanho ? `<span class="tamanho">Tam. ${escapar(p.tamanho)}</span>` : ""}
        </div>
      </div>
    </article>`;
}

function esqueletoGrade(n = 8) {
  return Array.from(
    { length: n },
    () => `
      <article class="cartao cartao-esqueleto" aria-hidden="true">
        <div class="cartao-foto esqueleto"></div>
        <div class="cartao-info"><span class="esqueleto" style="height:14px;width:60%"></span></div>
      </article>`,
  ).join("");
}

function definirTitulo(titulo) {
  document.title = titulo ? `${titulo} · ${estado.config.nome}` : estado.config.nome;
}

function sloganHtml(slogan) {
  const s = escapar(slogan || CONFIG_PADRAO.slogan);
  const i = s.lastIndexOf(",");
  return i > 0 ? `${s.slice(0, i + 1)} <em>${s.slice(i + 1).trim()}</em>` : s;
}

/* ------------------------------------------------------------------ */
/* Páginas                                                             */
/* ------------------------------------------------------------------ */

async function paginaInicial(main, id) {
  definirTitulo("");
  const c = estado.config;
  main.innerHTML = `
    <section class="abertura">
      <div class="abertura-texto">
        <span class="rotulo">Curadoria · Peças únicas</span>
        <h1>${sloganHtml(c.slogan)}</h1>
        <p>Roupas e acessórios selecionados um a um, em excelente estado. Cada peça existe uma única vez: quando encontra sua dona, não volta.</p>
        <a class="botao" href="#/colecao">Ver a coleção</a>
      </div>
      <div class="abertura-imagens" id="abertura-imagens">
        <a class="esqueleto" aria-hidden="true"></a><a class="esqueleto" aria-hidden="true"></a>
      </div>
    </section>
    <nav class="categorias-faixa oculto" id="categorias-faixa" aria-label="Categorias">
      <div class="categorias-lista" id="categorias-lista"></div>
    </nav>
    <section class="secao">
      <div class="secao-titulo">
        <h2>Recém-chegadas</h2>
        <a class="link rotulo" href="#/colecao">Ver toda a coleção</a>
      </div>
      <div class="grade" id="grade-inicial">${esqueletoGrade(8)}</div>
    </section>
    <section class="valores">
      <div><h3>Peças únicas</h3><p>Cada item é exclusivo. Reservamos a peça assim que você faz o pedido.</p></div>
      <div><h3>Curadoria cuidadosa</h3><p>Avaliamos tecido, caimento e conservação antes de qualquer peça chegar aqui.</p></div>
      <div><h3>Para todo o Brasil</h3><p>${escapar(c.envio_info || "Enviamos para todo o Brasil.")}</p></div>
    </section>`;

  const [destaques, recentes] = await Promise.all([
    sb.from("pecas").select(CAMPOS_LISTA).eq("status", "disponivel").eq("destaque", true)
      .order("publicado_em", { ascending: false }).limit(2),
    sb.from("pecas").select(CAMPOS_LISTA).eq("status", "disponivel")
      .order("publicado_em", { ascending: false }).limit(8),
    carregarResumo(),
  ]);
  if (id !== idRender) return;

  const lista = recentes.data || [];
  const capa = [...(destaques.data || [])];
  for (const p of lista) {
    if (capa.length >= 2) break;
    if (!capa.some((x) => x.id === p.id) && p.fotos?.length) capa.push(p);
  }
  const imagens = $("#abertura-imagens");
  if (capa.length >= 1) {
    imagens.innerHTML = capa
      .slice(0, 2)
      .map(
        (p, i) =>
          `<a href="#/peca/${p.codigo}" aria-label="${escapar(p.titulo)}"><img src="${fotoUrl(p.fotos[0], i === 0 ? "g" : "p")}" alt="${escapar(p.titulo)}"></a>`,
      )
      .join("");
    if (capa.length === 1) imagens.style.gridTemplateColumns = "1fr";
  } else {
    imagens.outerHTML = `<div class="abertura-vazia" aria-hidden="true"><span>${escapar((estado.config.nome.trim().split(/\s+/).pop() || "N")[0])}</span></div>`;
  }

  const cats = categoriasComPecas();
  if (cats.length) {
    $("#categorias-lista").innerHTML = cats
      .map((cat) => `<a href="#/colecao?cat=${encodeURIComponent(cat.slug)}">${escapar(cat.nome)}</a>`)
      .join("");
    $("#categorias-faixa").classList.remove("oculto");
  }

  const grade = $("#grade-inicial");
  if (recentes.error) {
    grade.outerHTML = `<div class="aviso erro">${escapar(mensagemDeErro(recentes.error))}</div>`;
  } else if (lista.length === 0) {
    grade.outerHTML = `<div class="vazio"><h3>Novas peças chegando em breve</h3><p>Estamos preparando a próxima seleção.</p></div>`;
  } else {
    grade.innerHTML = lista.map(cartaoHtml).join("");
  }
  desenharMenuCelular();
}

async function paginaColecao(main, id, params) {
  const catSlug = params.get("cat") || "";
  const tam = params.get("tam") || "";
  const ordem = params.get("ordem") || "recentes";
  const busca = (params.get("busca") || "").trim();
  const categoria = estado.categorias.find((c) => c.slug === catSlug);
  // No celular os filtros ficam lado a lado; rótulos curtos cabem sem cortar.
  const telaPequena = window.matchMedia("(max-width: 480px)").matches;

  const titulo = busca ? `“${busca}”` : categoria ? categoria.nome : ordem === "recentes" && params.has("ordem") ? "Novidades" : "Coleção";
  definirTitulo(busca ? `Busca: ${busca}` : titulo);

  main.innerHTML = `
    <div class="colecao-cabeca">
      <span class="rotulo">${busca ? "Resultados da busca" : "Peças disponíveis"}</span>
      <h1>${escapar(titulo)}</h1>
    </div>
    <div class="filtros">
      <div class="filtros-grupo">
        <label class="sr" for="f-cat">Categoria</label>
        <select class="filtro" id="f-cat">
          <option value="">${telaPequena ? "Categoria" : "Todas as categorias"}</option>
          ${estado.categorias.map((c) => `<option value="${escapar(c.slug)}" ${c.slug === catSlug ? "selected" : ""}>${escapar(c.nome)}</option>`).join("")}
        </select>
        <label class="sr" for="f-tam">Tamanho</label>
        <select class="filtro" id="f-tam"><option value="">${telaPequena ? "Tamanho" : "Todos os tamanhos"}</option></select>
        <label class="sr" for="f-ordem">Ordenar</label>
        <select class="filtro" id="f-ordem">
          <option value="recentes" ${ordem === "recentes" ? "selected" : ""}>Mais recentes</option>
          <option value="menor" ${ordem === "menor" ? "selected" : ""}>Menor preço</option>
          <option value="maior" ${ordem === "maior" ? "selected" : ""}>Maior preço</option>
        </select>
        ${busca ? `<button class="limpar-busca" id="limpar-busca">Limpar busca ✕</button>` : ""}
      </div>
      <span class="contagem" id="contagem"></span>
    </div>
    <section class="secao" style="padding-top:40px">
      <div class="grade" id="grade">${esqueletoGrade(8)}</div>
      <div class="mais oculto" id="mais"><button class="botao contorno" id="ver-mais">Ver mais peças</button></div>
    </section>`;

  const irPara = (mudancas) => {
    const p = new URLSearchParams(params);
    Object.entries(mudancas).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    const qs = p.toString();
    location.hash = `#/colecao${qs ? "?" + qs : ""}`;
  };
  $("#f-cat").addEventListener("change", (e) => irPara({ cat: e.target.value }));
  $("#f-tam").addEventListener("change", (e) => irPara({ tam: e.target.value }));
  $("#f-ordem").addEventListener("change", (e) => irPara({ ordem: e.target.value }));
  $("#limpar-busca")?.addEventListener("click", () => irPara({ busca: "" }));

  carregarResumo().then((r) => {
    if (id !== idRender) return;
    const sel = $("#f-tam");
    const lista = r.tamanhos.includes(tam) || !tam ? r.tamanhos : [tam, ...r.tamanhos];
    sel.insertAdjacentHTML(
      "beforeend",
      lista.map((t) => `<option value="${escapar(t)}" ${t === tam ? "selected" : ""}>Tamanho ${escapar(t)}</option>`).join(""),
    );
  });

  let carregadas = 0;
  const carregarPagina = async () => {
    let q = sb.from("pecas").select(CAMPOS_LISTA, { count: "exact" }).in("status", ["disponivel", "reservado"]);
    if (categoria) q = q.eq("categoria_id", categoria.id);
    if (tam) q = q.eq("tamanho", tam);
    if (busca) {
      const t = busca.replace(/[%,()"'*\\:]/g, " ").replace(/\s+/g, " ").trim();
      if (t) q = q.or(["titulo", "marca", "cor", "descricao"].map((c) => `${c}.ilike."%${t}%"`).join(","));
    }
    if (ordem === "menor") q = q.order("preco", { ascending: true });
    else if (ordem === "maior") q = q.order("preco", { ascending: false });
    else q = q.order("status", { ascending: true }).order("publicado_em", { ascending: false });
    q = q.order("codigo", { ascending: false }).range(carregadas, carregadas + POR_PAGINA - 1);
    return q;
  };

  const { data, error, count } = await carregarPagina();
  if (id !== idRender) return;
  const grade = $("#grade");
  if (error) {
    grade.outerHTML = `<div class="aviso erro">${escapar(mensagemDeErro(error))}</div>`;
    return;
  }
  const total = count ?? data.length;
  $("#contagem").textContent = total === 1 ? "1 peça" : `${total} peças`;
  if (!data.length) {
    grade.outerHTML = `
      <div class="vazio">
        <h3>Nenhuma peça encontrada</h3>
        <p>${busca || categoria || tam ? "Tente outros filtros ou veja toda a coleção." : "Novas peças chegam em breve."}</p>
        ${busca || categoria || tam ? `<p style="margin-top:24px"><a class="botao contorno" href="#/colecao">Ver toda a coleção</a></p>` : ""}
      </div>`;
    return;
  }
  grade.innerHTML = data.map(cartaoHtml).join("");
  carregadas = data.length;
  const mais = $("#mais");
  mais.classList.toggle("oculto", carregadas >= total);
  $("#ver-mais").addEventListener("click", async (e) => {
    const botao = e.currentTarget;
    botao.disabled = true;
    botao.innerHTML = `<span class="girando"></span>`;
    const r = await carregarPagina();
    if (id !== idRender) return;
    botao.disabled = false;
    botao.textContent = "Ver mais peças";
    if (r.error) return avisar(mensagemDeErro(r.error), "erro");
    grade.insertAdjacentHTML("beforeend", r.data.map(cartaoHtml).join(""));
    carregadas += r.data.length;
    mais.classList.toggle("oculto", carregadas >= total || r.data.length === 0);
  });
}

async function paginaPeca(main, id, codigo) {
  main.innerHTML = `
    <div class="peca">
      <div class="galeria"><div class="galeria-miniaturas"></div><div class="galeria-principal esqueleto" style="aspect-ratio:3/4"></div></div>
      <div class="peca-info"><span class="esqueleto" style="display:block;height:44px;width:80%"></span></div>
    </div>`;
  const n = parseInt(codigo, 10);
  const { data: p, error } = isNaN(n)
    ? { data: null, error: null }
    : await sb.from("pecas").select(CAMPOS_PECA).eq("codigo", n).maybeSingle();
  if (id !== idRender) return;
  if (error) {
    main.innerHTML = `<div class="secao"><div class="aviso erro">${escapar(mensagemDeErro(error))}</div></div>`;
    return;
  }
  if (!p) return paginaNaoEncontrada(main, "Esta peça não está mais disponível.");

  definirTitulo(p.titulo);
  const c = estado.config;
  const fotos = p.fotos || [];
  const disponivel = p.status === "disponivel";
  const naSacola = estaNaSacola(p.id);
  const detalhes = [
    ["Tamanho", p.tamanho],
    ["Marca", p.marca],
    ["Cor", p.cor],
    ["Estado", p.estado],
    ["Medidas", p.medidas],
  ].filter(([, v]) => v && String(v).trim());
  const urlPeca = `${location.origin}${location.pathname}#/peca/${p.codigo}`;
  const msgWhats = `Olá! Tenho interesse na peça "${p.titulo}" (cód. ${p.codigo}), de ${formatarPreco(p.preco)}.\n${urlPeca}`;

  let acoes;
  if (disponivel) {
    acoes = `
      <button class="botao largo" id="botao-sacola">${naSacola ? "Ver na sacola" : "Adicionar à sacola"}</button>
      ${c.whatsapp ? `<a class="botao contorno largo" href="${linkWhatsapp(c.whatsapp, msgWhats)}" target="_blank" rel="noopener">Perguntar pelo WhatsApp</a>` : ""}`;
  } else {
    acoes = `
      <button class="botao largo" disabled>${p.status === "reservado" ? "Peça reservada" : "Peça vendida"}</button>
      ${c.whatsapp && p.status === "reservado" ? `<a class="botao contorno largo" href="${linkWhatsapp(c.whatsapp, `Olá! A peça "${p.titulo}" (cód. ${p.codigo}) está reservada. Se ela voltar a ficar disponível, pode me avisar?`)}" target="_blank" rel="noopener">Avise-me se liberar</a>` : ""}`;
  }

  main.innerHTML = `
    <div class="peca">
      <nav class="trilha" aria-label="Você está em">
        <a href="#/">Início</a><span>/</span>
        <a href="#/colecao">Coleção</a>
        ${p.categorias ? `<span>/</span><a href="#/colecao?cat=${encodeURIComponent(p.categorias.slug)}">${escapar(p.categorias.nome)}</a>` : ""}
      </nav>
      <div>
        <div class="galeria">
          <div class="galeria-miniaturas">
            ${fotos.length > 1 ? fotos.map((f, i) => `<button class="${i === 0 ? "ativa" : ""}" data-foto="${i}" aria-label="Foto ${i + 1}"><img src="${fotoUrl(f, "p")}" alt=""></button>`).join("") : ""}
          </div>
          <div class="galeria-principal" id="galeria-principal">
            ${fotos.map((f, i) => `<figure><img src="${fotoUrl(f)}" alt="${escapar(p.titulo)}${fotos.length > 1 ? `, foto ${i + 1}` : ""}" ${i ? 'loading="lazy"' : ""}></figure>`).join("") || `<figure></figure>`}
          </div>
        </div>
        ${fotos.length > 1 ? `<div class="galeria-pontos" id="galeria-pontos">${fotos.map((_, i) => `<span class="${i === 0 ? "ativo" : ""}"></span>`).join("")}</div>` : ""}
      </div>
      <div class="peca-info">
        ${p.marca ? `<span class="rotulo">${escapar(p.marca)}</span>` : `<span class="rotulo">Cód. ${p.codigo}</span>`}
        <h1>${escapar(p.titulo)}</h1>
        <div class="peca-preco preco">${precoHtml(p)}</div>
        ${detalhes.length ? `<dl class="peca-detalhes">${detalhes.map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join("")}</dl>` : ""}
        ${p.descricao ? `<p class="peca-descricao">${escapar(p.descricao)}</p>` : ""}
        <div class="peca-acoes">${acoes}</div>
        <div class="peca-nota">Peça única · Cód. ${p.codigo}</div>
        <div class="dobras">
          <details><summary>Envio</summary><p>${escapar(c.envio_info || "Enviamos para todo o Brasil.")}</p></details>
          <details><summary>Retirada</summary><p>${escapar(c.retirada_info || "Retirada combinada pelo WhatsApp.")}</p></details>
          <details><summary>Pagamento</summary><p>PIX ou cartão de crédito. Depois do pedido, enviamos pelo WhatsApp a chave PIX ou o link para pagar com cartão.</p></details>
          <details><summary>Como funciona</summary><p>Ao finalizar o pedido, a peça fica reservada para você. Em seguida, mandamos os dados de pagamento pelo WhatsApp e, assim que o pagamento é confirmado, enviamos a peça ou combinamos a retirada.</p></details>
        </div>
      </div>
    </div>
    <section class="secao oculto" id="relacionadas">
      <div class="secao-titulo"><h2>Você também pode gostar</h2></div>
      <div class="grade" id="grade-relacionadas"></div>
    </section>
    ${
      disponivel
        ? `<div class="barra-compra" id="barra-compra" aria-hidden="true">
             <div class="barra-compra-info">
               <span class="barra-compra-titulo">${escapar(p.titulo)}</span>
               <span class="preco">${precoHtml(p)}</span>
             </div>
             <button class="botao" type="button" id="barra-compra-botao" tabindex="-1">${naSacola ? "Ver na sacola" : "Adicionar à sacola"}</button>
           </div>`
        : ""
    }`;

  $("#botao-sacola")?.addEventListener("click", () => {
    adicionarNaSacola(p);
    $("#botao-sacola").textContent = "Ver na sacola";
    const botaoBarra = $("#barra-compra-botao");
    if (botaoBarra) botaoBarra.textContent = "Ver na sacola";
  });

  // No celular, a barra de compra aparece no rodapé da tela sempre que o botão
  // principal não está à vista (por exemplo, enquanto a pessoa vê as fotos).
  estado.observadorBarra?.disconnect();
  const barra = $("#barra-compra");
  if (barra && "IntersectionObserver" in window) {
    $("#barra-compra-botao").addEventListener("click", () => $("#botao-sacola")?.click());
    estado.observadorBarra = new IntersectionObserver(([e]) => barra.classList.toggle("visivel", !e.isIntersecting));
    estado.observadorBarra.observe($("#botao-sacola"));
  }

  const principal = $("#galeria-principal");
  $$(".galeria-miniaturas button").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.foto);
      principal.scrollTo({ left: principal.clientWidth * i, behavior: "smooth" });
    }),
  );
  principal.addEventListener(
    "scroll",
    () => {
      const i = Math.round(principal.scrollLeft / Math.max(1, principal.clientWidth));
      $$(".galeria-miniaturas button").forEach((b, j) => b.classList.toggle("ativa", j === i));
      $$("#galeria-pontos span").forEach((s, j) => s.classList.toggle("ativo", j === i));
    },
    { passive: true },
  );

  // Relacionadas
  let q = sb.from("pecas").select(CAMPOS_LISTA).eq("status", "disponivel").neq("id", p.id)
    .order("publicado_em", { ascending: false }).limit(4);
  if (p.categoria_id) q = q.eq("categoria_id", p.categoria_id);
  const { data: rel } = await q;
  if (id !== idRender || !rel?.length) return;
  $("#grade-relacionadas").innerHTML = rel.map(cartaoHtml).join("");
  $("#relacionadas").classList.remove("oculto");
}

async function revalidarSacola() {
  if (!estado.sacola.length) return [];
  const ids = estado.sacola.map((i) => i.id);
  const { data, error } = await sb.from("pecas").select(CAMPOS_LISTA).in("id", ids);
  if (error) return [];
  const mapa = new Map((data || []).map((p) => [p.id, p]));
  const removidas = [];
  estado.sacola = estado.sacola.filter((i) => {
    const p = mapa.get(i.id);
    if (!p || p.status !== "disponivel") {
      removidas.push(i);
      return false;
    }
    Object.assign(i, itemDaPeca(p));
    return true;
  });
  salvarSacola();
  return removidas;
}

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// Por enquanto o pagamento é feito à parte: depois do pedido, a loja manda pelo
// WhatsApp a chave PIX ou um link para pagar com cartão.
const NOMES_PAGAMENTO = { pix: "PIX", cartao: "Cartão de crédito" };

function textoDadosPagamento(pagamento) {
  if (pagamento === NOMES_PAGAMENTO.pix) return "a chave PIX";
  if (pagamento === NOMES_PAGAMENTO.cartao) return "o link para pagar com cartão";
  return "os dados de pagamento";
}

/** Confere os dígitos verificadores do CPF. */
function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[tamanho])) return false;
  }
  return true;
}

function formatarCpf(valor) {
  const d = soDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function prazoTexto(min, max) {
  if (!max) return "";
  if (min === max) return max === 1 ? "1 dia útil" : `${max} dias úteis`;
  return `${min} a ${max} dias úteis`;
}

function nomeDoFrete(o) {
  const empresa = (o.empresa || "").trim();
  const nome = (o.nome || "").trim();
  return nome.toLowerCase().startsWith(empresa.toLowerCase()) ? nome : `${empresa} ${nome}`.trim();
}

function enderecoEmTexto(e) {
  const linha1 = [e.rua, e.numero].map((x) => (x || "").trim()).filter(Boolean).join(", ");
  const comComplemento = e.complemento?.trim() ? `${linha1} - ${e.complemento.trim()}` : linha1;
  const cidade = [e.cidade?.trim(), e.uf?.trim().toUpperCase()].filter(Boolean).join("/");
  return [comComplemento, e.bairro?.trim(), cidade].filter(Boolean).join(", ");
}

/** O frete automático (Melhor Envio) está ligado? Guardado durante a visita. */
async function freteAtivo() {
  if (estado.freteAtivo !== undefined) return estado.freteAtivo;
  try {
    const r = await chamarFuncao("frete", { acao: "ativo" });
    estado.freteAtivo = Boolean(r?.ativo);
  } catch {
    estado.freteAtivo = false;
  }
  return estado.freteAtivo;
}

async function paginaFinalizar(main, id) {
  definirTitulo("Finalizar pedido");
  main.innerHTML = `<div class="finalizar"><h1>Finalizar pedido</h1><div class="esqueleto" style="height:320px"></div></div>`;
  const [removidas, ativoNaEntrada] = await Promise.all([revalidarSacola(), freteAtivo()]);
  let ativo = ativoNaEntrada;
  if (id !== idRender) return;

  if (!estado.sacola.length) {
    main.innerHTML = `
      <div class="confirmacao">
        <span class="rotulo">Sacola</span>
        <h1>Sua sacola está vazia</h1>
        ${removidas.length ? `<p>As peças que estavam na sua sacola já foram reservadas por outra pessoa.</p>` : `<p>Escolha suas peças na coleção.</p>`}
        <div class="botoes"><a class="botao" href="#/colecao">Ver a coleção</a></div>
      </div>`;
    return;
  }

  const c = estado.config;
  let dados = {};
  try {
    dados = JSON.parse(localStorage.getItem("dados-cliente") || "{}");
  } catch {
    dados = {};
  }
  const d = (k) => escapar(dados[k] || "");
  const textoEnvio = ativo
    ? "Correios, Jadlog ou Loggi. O valor aparece assim que você informar o CEP."
    : c.envio_info || "Frete combinado pelo WhatsApp.";

  main.innerHTML = `
    <div class="finalizar">
      <h1>Finalizar pedido</h1>
      <form class="formulario" id="form-pedido" novalidate>
        ${removidas.length ? `<div class="aviso">Saíram da sua sacola por já estarem reservadas: ${removidas.map((r) => escapar(r.titulo)).join(", ")}.</div>` : ""}
        <fieldset>
          <legend>Seus dados</legend>
          <div class="formulario">
            <label class="campo"><span>Nome completo</span><input name="nome" autocomplete="name" required value="${d("nome")}"></label>
            <div class="dupla">
              <label class="campo"><span>WhatsApp</span><input name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(21) 99999-9999" required value="${d("telefone")}"></label>
              <label class="campo"><span>E-mail (opcional)</span><input name="email" type="email" autocomplete="email" value="${d("email")}"></label>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Entrega</legend>
          <div class="opcoes-entrega">
            <label class="opcao"><input type="radio" name="entrega" value="envio" ${dados.entrega !== "retirada" ? "checked" : ""}><strong>Envio</strong><small>${escapar(textoEnvio)}</small></label>
            <label class="opcao"><input type="radio" name="entrega" value="retirada" ${dados.entrega === "retirada" ? "checked" : ""}><strong>Retirada</strong><small>${escapar(c.retirada_info || "Combinada pelo WhatsApp.")}</small></label>
          </div>
        </fieldset>
        <fieldset id="campos-endereco">
          <legend>Endereço de entrega</legend>
          <div class="formulario">
            <div class="dupla dupla-cep">
              <label class="campo"><span>CEP</span><input name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" value="${d("cep")}"></label>
              <a class="link-cep" href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Não sei meu CEP</a>
            </div>
            <label class="campo"><span>Rua</span><input name="rua" autocomplete="address-line1" value="${d("rua")}"></label>
            <div class="dupla">
              <label class="campo"><span>Número</span><input name="numero" autocomplete="off" value="${d("numero")}"></label>
              <label class="campo"><span>Complemento (opcional)</span><input name="complemento" autocomplete="address-line2" placeholder="Apto, bloco, casa" value="${d("complemento")}"></label>
            </div>
            <div class="dupla">
              <label class="campo"><span>Bairro</span><input name="bairro" value="${d("bairro")}"></label>
              <div class="cidade-uf">
                <label class="campo"><span>Cidade</span><input name="cidade" autocomplete="address-level2" value="${d("cidade")}"></label>
                <label class="campo"><span>UF</span><select name="uf" autocomplete="address-level1"><option value=""></option>${UFS.map((u) => `<option ${dados.uf === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
              </div>
            </div>
            <label class="campo"><span>CPF <em>para a etiqueta de envio</em></span><input name="cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00"></label>
            <div class="frete" id="frete" aria-live="polite"></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Pagamento</legend>
          <div class="opcoes-entrega">
            <label class="opcao"><input type="radio" name="pagamento" value="pix" ${dados.pagamento !== "cartao" ? "checked" : ""}><strong>PIX</strong><small>Enviamos a chave PIX pelo WhatsApp para você concluir o pagamento.</small></label>
            <label class="opcao"><input type="radio" name="pagamento" value="cartao" ${dados.pagamento === "cartao" ? "checked" : ""}><strong>Cartão de crédito</strong><small>Enviamos pelo WhatsApp um link para pagar com cartão.</small></label>
          </div>
        </fieldset>
        <label class="campo"><span>Observações (opcional)</span><textarea name="observacoes" rows="2"></textarea></label>
        <div class="aviso erro oculto" id="erro-pedido"></div>
        <button class="botao largo" type="submit" id="enviar-pedido">Confirmar pedido</button>
        <small style="color:var(--taupe)" id="nota-pedido"></small>
      </form>
      <aside class="resumo">
        <h2>Resumo</h2>
        ${estado.sacola.map((i) => itemSacolaHtml(i, false)).join("")}
        <div class="linha-resumo"><span>Peças</span><span>${formatarPreco(totalDaSacola())}</span></div>
        <div class="linha-resumo"><span>Frete</span><span id="resumo-frete">—</span></div>
        <div class="linha-resumo"><span>Pagamento</span><span id="resumo-pagamento">${dados.pagamento === "cartao" ? NOMES_PAGAMENTO.cartao : NOMES_PAGAMENTO.pix}</span></div>
        <div class="linha-total"><span>Total</span><strong id="resumo-total">${formatarPreco(totalDaSacola())}</strong></div>
      </aside>
    </div>`;

  const form = $("#form-pedido");
  const frete = { cep: "", carregando: false, opcoes: [], erro: "", escolhido: Number(dados.frete) || null, pedido: 0 };

  const ehEnvio = () => form.entrega.value === "envio";
  const cepDigitado = () => soDigitos(form.cep.value);
  const opcaoEscolhida = () => (ativo ? frete.opcoes.find((o) => o.id === frete.escolhido) : null);
  const freteACombinar = () => !ativo || Boolean(frete.erro) || (frete.cep && !frete.carregando && !frete.opcoes.length);

  function desenharFrete() {
    const el = $("#frete");
    let html = "";
    if (!ativo) {
      html = `<p class="frete-aviso">O frete é combinado pelo WhatsApp depois do pedido.</p>`;
    } else if (cepDigitado().length !== 8) {
      html = `<p class="frete-aviso">Informe o CEP para ver as opções de frete.</p>`;
    } else if (frete.carregando) {
      html = `<p class="frete-aviso"><span class="girando"></span>Calculando o frete…</p>`;
    } else if (frete.erro) {
      html = `<p class="frete-aviso">${escapar(frete.erro)} Se preferir, confirme assim mesmo: o frete fica para combinar pelo WhatsApp.</p>`;
    } else if (!frete.opcoes.length && frete.cep) {
      html = `<p class="frete-aviso">Nenhuma transportadora atende este CEP pelo site. O frete fica para combinar pelo WhatsApp.</p>`;
    } else if (frete.opcoes.length) {
      html = `<span class="frete-titulo">Frete</span>
        <div class="opcoes-frete">
          ${frete.opcoes
            .map(
              (o) => `
            <label class="opcao-frete">
              <input type="radio" name="frete" value="${o.id}" ${o.id === frete.escolhido ? "checked" : ""}>
              <span class="frete-servico"><strong>${escapar(nomeDoFrete(o))}</strong><small>${prazoTexto(o.prazo_min, o.prazo_max)}</small></span>
              <span class="frete-valor">${formatarPreco(o.valor)}</span>
            </label>`,
            )
            .join("")}
        </div>`;
    }
    el.innerHTML = html;
    atualizarResumo();
  }

  function atualizarResumo() {
    const pecas = totalDaSacola();
    const opcao = ehEnvio() ? opcaoEscolhida() : null;
    let textoFrete = "—";
    if (!ehEnvio()) textoFrete = "Retirada";
    else if (opcao) textoFrete = formatarPreco(opcao.valor);
    else if (freteACombinar()) textoFrete = "A combinar";
    $("#resumo-frete").textContent = textoFrete;
    $("#resumo-total").textContent = formatarPreco(pecas + (opcao ? opcao.valor : 0));
    $("#nota-pedido").textContent =
      ehEnvio() && !freteACombinar()
        ? "Ao confirmar, as peças ficam reservadas para você e enviamos os dados de pagamento pelo WhatsApp."
        : "Ao confirmar, as peças ficam reservadas para você. Pelo WhatsApp enviamos os dados de pagamento e combinamos a entrega.";
  }

  async function cotar() {
    const cep = cepDigitado();
    if (!ativo || cep.length !== 8 || !ehEnvio()) {
      desenharFrete();
      return;
    }
    if (cep === frete.cep && (frete.carregando || frete.opcoes.length)) return;
    const pedido = ++frete.pedido;
    Object.assign(frete, { cep, carregando: true, erro: "", opcoes: [] });
    desenharFrete();
    let resposta = null;
    try {
      resposta = await chamarFuncao("frete", { acao: "cotar", cep, pecas: estado.sacola.map((i) => i.id) });
    } catch (e) {
      resposta = { ok: false, erro: mensagemDeErro(e) };
    }
    if (pedido !== frete.pedido || id !== idRender) return;
    frete.carregando = false;
    if (resposta?.ok && resposta.ativo === false) {
      // o frete automático foi desligado no meio da visita: volta a ser combinado
      estado.freteAtivo = false;
      ativo = false;
      desenharFrete();
      return;
    }
    if (!resposta?.ok) {
      frete.erro = resposta?.erro || "Não foi possível calcular o frete agora.";
    } else {
      frete.opcoes = resposta.opcoes || [];
      if (!frete.opcoes.some((o) => o.id === frete.escolhido)) frete.escolhido = frete.opcoes[0]?.id ?? null;
    }
    desenharFrete();
  }

  const atualizarEntrega = () => {
    $("#campos-endereco").classList.toggle("oculto", !ehEnvio());
    cotar();
    atualizarResumo();
  };

  form.addEventListener("change", (e) => {
    if (e.target.name === "entrega") atualizarEntrega();
    if (e.target.name === "frete") {
      frete.escolhido = Number(e.target.value);
      atualizarResumo();
    }
    if (e.target.name === "pagamento") {
      $("#resumo-pagamento").textContent = NOMES_PAGAMENTO[e.target.value] || NOMES_PAGAMENTO.pix;
    }
  });
  form.addEventListener("input", () => $("#erro-pedido").classList.add("oculto"));

  form.cep.addEventListener("input", () => {
    const cep = cepDigitado().slice(0, 8);
    form.cep.value = cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
    if (cep.length === 8) {
      buscarCep(cep, form);
      cotar();
    } else if (frete.cep) {
      Object.assign(frete, { cep: "", opcoes: [], erro: "", carregando: false });
      frete.pedido++;
      desenharFrete();
    }
  });
  form.cpf.addEventListener("input", () => {
    form.cpf.value = formatarCpf(form.cpf.value);
  });

  atualizarEntrega();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#erro-pedido");
    const mostrarErro = (texto) => {
      erro.textContent = texto;
      erro.classList.remove("oculto");
    };
    erro.classList.add("oculto");
    const v = Object.fromEntries(new FormData(form).entries());
    const envio = v.entrega === "envio";
    const pagamento = NOMES_PAGAMENTO[v.pagamento] || NOMES_PAGAMENTO.pix;
    // A forma de pagamento escolhida vai na primeira linha das observações do pedido.
    const observacoes = [`Pagamento: ${pagamento}`, (v.observacoes || "").trim()].filter(Boolean).join("\n");
    const endereco = {
      rua: (v.rua || "").trim(),
      numero: (v.numero || "").trim(),
      complemento: (v.complemento || "").trim(),
      bairro: (v.bairro || "").trim(),
      cidade: (v.cidade || "").trim(),
      uf: (v.uf || "").trim().toUpperCase(),
    };
    const problemas = [];
    if (!v.nome?.trim()) problemas.push("seu nome");
    if (soDigitos(v.telefone).length < 10) problemas.push("um WhatsApp com DDD");
    if (envio) {
      if (soDigitos(v.cep).length !== 8) problemas.push("o CEP");
      if (!endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.uf) {
        problemas.push("o endereço completo (rua, número, bairro, cidade e UF)");
      }
      if (!cpfValido(v.cpf)) problemas.push("um CPF válido");
    }
    if (problemas.length) {
      mostrarErro(`Falta informar ${problemas.join(", ")}.`);
      return;
    }
    const comFrete = envio && ativo && frete.opcoes.length > 0 && !frete.erro;
    if (envio && ativo && frete.carregando) {
      mostrarErro("Aguarde o cálculo do frete.");
      return;
    }
    if (comFrete && !opcaoEscolhida()) {
      mostrarErro("Escolha uma opção de frete.");
      return;
    }
    try {
      localStorage.setItem(
        "dados-cliente",
        JSON.stringify({
          nome: v.nome, telefone: v.telefone, email: v.email, entrega: v.entrega, cep: v.cep,
          ...endereco, frete: frete.escolhido, pagamento: v.pagamento,
        }),
      );
    } catch {
      /* ignora */
    }

    const botao = $("#enviar-pedido");
    botao.disabled = true;
    botao.innerHTML = `<span class="girando"></span>`;
    const itens = [...estado.sacola];
    const textoEndereco = envio ? enderecoEmTexto(endereco) : "";
    let data = null;
    let falha = null;
    try {
      if (comFrete) {
        data = await chamarFuncao("frete", {
          acao: "pedido",
          servico: frete.escolhido,
          pecas: itens.map((i) => i.id),
          dados: {
            nome: v.nome, telefone: v.telefone, email: v.email || "", cpf: v.cpf, cep: v.cep,
            observacoes, ...endereco,
          },
        });
      } else {
        const r = await sb.rpc("fazer_pedido", {
          p_nome: v.nome,
          p_telefone: v.telefone,
          p_email: v.email || "",
          p_entrega: v.entrega,
          p_endereco: textoEndereco,
          p_cep: envio ? v.cep : "",
          p_observacoes: observacoes,
          p_pecas: itens.map((i) => i.id),
          p_cpf: envio ? soDigitos(v.cpf) : "",
          p_end: envio ? endereco : null,
        });
        if (r.error) falha = r.error;
        data = r.data;
      }
    } catch (e2) {
      falha = e2;
    }
    botao.disabled = false;
    botao.textContent = "Confirmar pedido";

    if (falha) {
      mostrarErro(mensagemDeErro(falha));
      return;
    }
    if (!data?.ok && data?.indisponiveis) {
      const fora = new Set(data.indisponiveis);
      const nomes = itens.filter((i) => fora.has(i.id)).map((i) => i.titulo);
      estado.sacola = estado.sacola.filter((i) => !fora.has(i.id));
      salvarSacola();
      estado.resumo = null;
      avisar(`Acabou de ser reservada: ${nomes.join(", ")}.`, "erro");
      renderizar();
      return;
    }
    if (!data?.ok) {
      mostrarErro(data?.erro || "Não foi possível confirmar o pedido. Tente de novo.");
      if (data?.recotar) {
        frete.cep = "";
        cotar();
      }
      return;
    }

    const pedido = {
      numero: data.numero,
      total: Number(data.total),
      itens,
      nome: v.nome.trim(),
      entrega: v.entrega,
      endereco: envio ? `${textoEndereco} (CEP ${v.cep})` : "",
      frete: comFrete && data.frete ? data.frete : null,
      pagamento,
    };
    try {
      sessionStorage.setItem(`pedido-${data.numero}`, JSON.stringify(pedido));
    } catch {
      /* ignora */
    }
    estado.sacola = [];
    estado.resumo = null;
    salvarSacola();
    location.hash = `#/pedido/${data.numero}`;
  });
}

async function buscarCep(cep, form) {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = await r.json();
    if (!d || d.erro || soDigitos(form.cep.value) !== cep) return;
    const preencher = (campo, valor) => {
      if (valor && !form[campo].value.trim()) form[campo].value = valor;
    };
    preencher("rua", d.logradouro);
    preencher("bairro", d.bairro);
    preencher("cidade", d.localidade);
    if (d.uf && !form.uf.value) form.uf.value = d.uf;
    if (d.logradouro && !form.numero.value.trim() && document.activeElement === form.cep) form.numero.focus();
  } catch {
    /* sem problema: a pessoa digita o endereço */
  }
}

function mensagemDoPedido(pedido) {
  const f = pedido.frete;
  const linhas = [
    `Olá! Acabei de fazer o pedido nº ${pedido.numero} no site.`,
    "",
    ...pedido.itens.map((i) => `• ${i.titulo}${i.tamanho ? ` (tam. ${i.tamanho})` : ""}, cód. ${i.codigo}: ${formatarPreco(i.preco)}`),
    "",
  ];
  if (f) {
    linhas.push(
      `Peças: ${formatarPreco(pedido.total)}`,
      `Frete: ${nomeDoFrete(f)}, ${formatarPreco(f.valor)} (${prazoTexto(f.prazo_min, f.prazo_max)})`,
      `Total: ${formatarPreco(pedido.total + Number(f.valor))}`,
      `Entrega: envio para ${pedido.endereco}`,
    );
  } else {
    linhas.push(
      `Total das peças: ${formatarPreco(pedido.total)}`,
      pedido.entrega === "envio" ? `Entrega: envio para ${pedido.endereco} (frete a combinar)` : "Entrega: retirada",
    );
  }
  if (pedido.pagamento) linhas.push(`Pagamento: ${pedido.pagamento}`);
  linhas.push(`Nome: ${pedido.nome}`);
  return linhas.join("\n");
}

function paginaConfirmacao(main, id, numero) {
  definirTitulo("Pedido recebido");
  let pedido = null;
  try {
    pedido = JSON.parse(sessionStorage.getItem(`pedido-${numero}`) || "null");
  } catch {
    pedido = null;
  }
  const c = estado.config;
  const temWhats = Boolean(numeroWhatsapp(c.whatsapp));
  const f = pedido?.frete;
  const combinar = !pedido ? "" : pedido.entrega === "envio" ? (f ? "" : " e combinamos o frete") : " e combinamos a retirada";
  const dadosPagamento = textoDadosPagamento(pedido?.pagamento);
  const linhaPagamento = pedido?.pagamento
    ? `<div class="linha-resumo"><span>Pagamento</span><span>${escapar(pedido.pagamento)}</span></div>`
    : "";
  main.innerHTML = `
    <div class="confirmacao">
      <span class="rotulo">Pedido nº ${escapar(numero)}</span>
      <h1>Obrigada! Suas peças estão reservadas.</h1>
      ${
        pedido && temWhats
          ? `<p>Para concluir, envie o pedido pelo WhatsApp. Por lá mandamos ${dadosPagamento}${combinar}.</p>
             <div class="botoes">
               <a class="botao argila" href="${linkWhatsapp(c.whatsapp, mensagemDoPedido(pedido))}" target="_blank" rel="noopener">Enviar pedido pelo WhatsApp</a>
               <a class="link rotulo" href="#/colecao">Continuar olhando</a>
             </div>`
          : `<p>Recebemos seu pedido. Vamos chamar você no WhatsApp informado para enviar ${dadosPagamento}${combinar}.</p>
             <div class="botoes"><a class="botao" href="#/colecao">Continuar olhando</a></div>`
      }
      ${
        pedido?.itens?.length
          ? `<div class="pedido-resumo">
               ${pedido.itens.map((i) => itemSacolaHtml(i, false)).join("")}
               ${
                 f
                   ? `<div class="linha-resumo"><span>Peças</span><span>${formatarPreco(pedido.total)}</span></div>
                      <div class="linha-resumo"><span>${escapar(nomeDoFrete(f))}<small>${prazoTexto(f.prazo_min, f.prazo_max)}</small></span><span>${formatarPreco(f.valor)}</span></div>
                      <div class="linha-total"><span>Total</span><strong>${formatarPreco(pedido.total + Number(f.valor))}</strong></div>`
                   : `<div class="linha-total"><span>Total das peças</span><strong>${formatarPreco(pedido.total)}</strong></div>`
               }
               ${linhaPagamento}
             </div>`
          : ""
      }
    </div>`;
}

function paginaSobre(main) {
  const c = estado.config;
  definirTitulo("Sobre");
  const contatos = [];
  if (numeroWhatsapp(c.whatsapp))
    contatos.push(`<a class="botao" href="${linkWhatsapp(c.whatsapp, "Olá! Vim pelo site.")}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (c.instagram)
    contatos.push(`<a class="botao contorno" href="https://instagram.com/${encodeURIComponent(c.instagram.replace(/^@/, ""))}" target="_blank" rel="noopener">Instagram</a>`);
  if (c.email) contatos.push(`<a class="botao contorno" href="mailto:${escapar(c.email)}">E-mail</a>`);
  main.innerHTML = `
    <section class="sobre">
      <div class="abertura-vazia" aria-hidden="true"><span>${escapar((c.nome.trim().split(/\s+/).pop() || "N")[0])}</span></div>
      <div>
        <span class="rotulo">Sobre</span>
        <h1>${escapar(c.nome)}</h1>
        <p>${escapar(c.sobre || CONFIG_PADRAO.slogan)}</p>
        ${c.cidade ? `<p class="rotulo" style="margin-top:24px">${escapar(c.cidade)}</p>` : ""}
        ${contatos.length ? `<div class="contatos">${contatos.join("")}</div>` : ""}
      </div>
    </section>`;
}

function paginaNaoEncontrada(main, texto = "Não encontramos esta página.") {
  definirTitulo("Não encontrada");
  main.innerHTML = `
    <div class="confirmacao">
      <span class="rotulo">Ops</span>
      <h1>${escapar(texto)}</h1>
      <div class="botoes"><a class="botao" href="#/colecao">Ver a coleção</a></div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Moldura (topo, menu, rodapé)                                        */
/* ------------------------------------------------------------------ */

function desenharMoldura() {
  const c = estado.config;
  $("#logo").innerHTML = logotipoHtml(c.nome);
  $("#logo-rodape").innerHTML = logotipoHtml(c.nome);
  $("#rodape-slogan").textContent = c.slogan;
  $("#rodape-copy").textContent = `© ${new Date().getFullYear()} ${c.nome}`;
  $("#faixa").innerHTML = `<span>Peças únicas</span><span class="faixa-extra">Curadoria cuidadosa</span><span>${
    c.cidade ? escapar(c.cidade) : "Envio para todo o Brasil"
  }</span>`;
  const contato = $("#rodape-contato");
  const links = [];
  if (numeroWhatsapp(c.whatsapp))
    links.push(`<a href="${linkWhatsapp(c.whatsapp, "Olá! Vim pelo site.")}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (c.instagram)
    links.push(`<a href="https://instagram.com/${encodeURIComponent(c.instagram.replace(/^@/, ""))}" target="_blank" rel="noopener">Instagram</a>`);
  if (c.email) links.push(`<a href="mailto:${escapar(c.email)}">${escapar(c.email)}</a>`);
  if (c.cidade) links.push(`<span>${escapar(c.cidade)}</span>`);
  contato.innerHTML = `<span class="rotulo">Contato</span>${links.join("") || `<a href="#/sobre">Fale conosco</a>`}`;
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", c.nome);
  desenharMenuCelular();
}

function desenharMenuCelular() {
  const cats = categoriasComPecas();
  $("#menu-celular-links").innerHTML = `
    <a href="#/colecao">Coleção</a>
    <a href="#/colecao?ordem=recentes">Novidades</a>
    <a href="#/sobre">Sobre</a>
    ${cats.length ? `<span class="rotulo">Categorias</span>${cats.map((c) => `<a class="sub" href="#/colecao?cat=${encodeURIComponent(c.slug)}">${escapar(c.nome)}</a>`).join("")}` : ""}`;
}

function abrirMenu() {
  $("#menu-celular").hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharMenu() {
  if ($("#menu-celular").hidden) return;
  $("#menu-celular").hidden = true;
  document.body.style.overflow = "";
}

/* ------------------------------------------------------------------ */
/* Roteamento                                                          */
/* ------------------------------------------------------------------ */

function rotaAtual() {
  const h = decodeURI(location.hash.replace(/^#/, "")) || "/";
  const [caminho, query = ""] = h.split("?");
  return { caminho, partes: caminho.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

async function renderizar() {
  const id = ++idRender;
  fecharSacola();
  fecharMenu();
  const { caminho, partes, params } = rotaAtual();
  if (caminho !== estado.rotaAnterior) window.scrollTo(0, 0);
  estado.rotaAnterior = caminho;

  $$(".menu-principal a").forEach((a) => {
    const r = a.dataset.rota;
    const ativo =
      (r === "colecao" && partes[0] === "colecao" && !params.has("ordem")) ||
      (r === "novidades" && partes[0] === "colecao" && params.has("ordem")) ||
      (r === "sobre" && partes[0] === "sobre");
    a.classList.toggle("ativo", ativo);
  });

  const main = $("#conteudo");
  try {
    switch (partes[0]) {
      case undefined:
        return await paginaInicial(main, id);
      case "colecao":
        return await paginaColecao(main, id, params);
      case "peca":
        return await paginaPeca(main, id, partes[1]);
      case "finalizar":
        return await paginaFinalizar(main, id);
      case "pedido":
        return paginaConfirmacao(main, id, partes[1]);
      case "sobre":
        return paginaSobre(main);
      default:
        return paginaNaoEncontrada(main);
    }
  } catch (e) {
    console.error(e);
    if (id === idRender) {
      main.innerHTML = `<div class="secao"><div class="aviso erro">${escapar(mensagemDeErro(e))}</div></div>`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */

function ligarEventos() {
  $("#abrir-sacola").addEventListener("click", abrirSacola);
  $("#fechar-sacola").addEventListener("click", fecharSacola);
  $("#sacola-fundo").addEventListener("click", fecharSacola);
  $("#sacola").addEventListener("click", (e) => {
    const id = e.target.closest("[data-remover]")?.dataset.remover;
    if (id) removerDaSacola(id);
    else if (e.target.closest("a")) fecharSacola();
  });
  $("#abrir-menu").addEventListener("click", abrirMenu);
  $("#fechar-menu").addEventListener("click", fecharMenu);
  $("#menu-celular").addEventListener("click", (e) => {
    if (e.target.id === "menu-celular" || e.target.closest("a")) fecharMenu();
  });
  $("#abrir-busca").addEventListener("click", () => {
    const f = $("#busca");
    f.hidden = !f.hidden;
    if (!f.hidden) $("#campo-busca").focus();
  });
  $("#busca").addEventListener("submit", (e) => {
    e.preventDefault();
    const termo = $("#campo-busca").value.trim();
    $("#busca").hidden = true;
    location.hash = termo ? `#/colecao?busca=${encodeURIComponent(termo)}` : "#/colecao";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      fecharSacola();
      fecharMenu();
      $("#busca").hidden = true;
    }
  });
  window.addEventListener("hashchange", renderizar);
  window.addEventListener("storage", (e) => {
    if (e.key === "sacola") {
      estado.sacola = carregarSacola();
      atualizarContador();
    }
  });
}

async function iniciar() {
  ligarEventos();
  atualizarContador();
  desenharMoldura();
  try {
    await carregarBasico();
  } catch (e) {
    console.error(e);
  }
  desenharMoldura();
  renderizar();
}

iniciar();
