// Leitura local (sem IA): entende textos colados e, se preciso, lê o texto de prints com OCR.
// Usada quando a leitura automática pelo Claude não está configurada ou falha.

import { lerPreco } from "./comum.js";

export function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const MARCAS = [
  "Farm", "Animale", "Zara", "Shoulder", "Le Lis Blanc", "Maria Filó", "Cantão", "Osklen", "Mango", "H&M",
  "Forever 21", "Dudalina", "Lacoste", "Calvin Klein", "Tommy Hilfiger", "Schutz", "Arezzo", "Carmen Steffens",
  "Michael Kors", "Gucci", "Prada", "Louis Vuitton", "Chanel", "Dior", "Givenchy", "Burberry", "Ralph Lauren",
  "Levi's", "Colcci", "Ellus", "Forum", "Triton", "Morena Rosa", "Lança Perfume", "Cris Barros", "Reinaldo Lourenço",
  "Iódice", "Bo.Bô", "Agilitá", "Dress To", "Antix", "Adidas", "Nike", "Hering", "Renner", "C&A", "Riachuelo",
  "Shein", "Massimo Dutti", "Uniqlo", "Bimba y Lola", "Anacapri", "Melissa", "Santa Lolla", "Luiza Barcelos",
  "Corello", "Victor Hugo", "Capodarte", "Vans", "Converse", "Alphorria", "Amissima", "Spezzato", "Lez a Lez",
  "Maria Valentina", "Mixed", "Pinko", "Sandro", "Maje", "Max Mara", "Valentino", "Fendi", "Balenciaga",
  "Saint Laurent", "Bottega Veneta", "Miu Miu", "Loewe", "Celine", "Hermès", "Armani", "Hugo Boss", "Tory Burch",
  "Kate Spade", "Coach", "Guess", "Diesel", "Lança", "John John", "Zinco", "Richards", "Lenny Niemeyer",
  "Água de Coco", "Patbo", "Handred", "Amaro", "Youcom", "Le Postiche", "Bobstore", "Luigi Bertolli",
];

// palavra-chave -> trechos do nome da categoria da loja
const CATEGORIAS = [
  [/\b(vestido|chemise|tubinho)/, ["vestido"]],
  [/\b(macacao|macaquinho|jardineira)/, ["macac"]],
  [/\b(casaco|blazer|jaqueta|sobretudo|trench|colete|kimono|parka|corta-vento|capa)\b/, ["casaco", "blazer"]],
  [/\b(blusa|camisa|camiseta|regata|cropped|top|body|bata|t-?shirt|polo)\b/, ["blusa", "camisa"]],
  [/\b(calca|jeans|legging|pantalona|wide leg|skinny|mom jeans|alfaiataria)\b/, ["calca"]],
  [/\b(saia)/, ["saia"]],
  [/\b(short|bermuda)/, ["short"]],
  [/\b(trico|sueter|cardiga|cardigan|malha|pullover|moletom)/, ["trico"]],
  [/\b(bolsa|clutch|mochila|carteira|necessaire|pochete|tote)\b/, ["bolsa"]],
  [/\b(sapato|sandalia|tenis|bota|scarpin|mule|rasteira|sapatilha|mocassim|chinelo|anabela|salto|coturno|loafer)/, ["calcad", "sapato"]],
  [/\b(colar|brinco|pulseira|cinto|lenco|oculos|chapeu|anel|bijuteria|tiara|presilha|echarpe|bone)\b/, ["acessor"]],
];

const CORES = [
  "off white", "off-white", "preto", "preta", "branco", "branca", "bege", "nude", "caramelo", "marrom", "chocolate",
  "creme", "areia", "cinza", "grafite", "azul marinho", "marinho", "azul", "verde oliva", "verde militar", "verde",
  "oliva", "vermelho", "vermelha", "vinho", "bordô", "rosa", "pink", "lilás", "roxo", "roxa", "amarelo", "amarela",
  "mostarda", "laranja", "terracota", "dourado", "dourada", "prata", "estampado", "estampada", "listrado",
  "listrada", "xadrez", "floral", "animal print", "onça", "zebra", "jeans",
];

const TAMANHOS_LETRA = ["XPP", "PP", "XP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "G1", "G2", "G3", "U"];

function primeiraMaiuscula(s) {
  const t = s.trim();
  return t ? t[0].toLocaleUpperCase("pt-BR") + t.slice(1) : t;
}

function limparLinha(l) {
  return l
    .replace(/^\s*\[?\d{1,2}[:h]\d{2}(?:[,\s]+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?\]?\s*[-–]?\s*/, "") // horário do WhatsApp
    .replace(/^\s*[^:\n]{1,30}:\s(?=\S)/, (m) => (/(r\$|tam|valor|preco|preço)/i.test(m) ? m : "")) // "Fulana: "
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "") // emojis
    .replace(/\s+/g, " ")
    .trim();
}

function encontrarPrecos(texto) {
  const precos = [];
  const re = /(?:r\$|\brs\b|\bvalor:?|\bpreço:?|\bpreco:?|\bpor:?)[ \t]*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)[ \t]*reais\b/gi;
  let m;
  while ((m = re.exec(texto))) {
    const v = lerPreco(m[1] || m[2]);
    if (v !== null && v > 0 && v < 100000) precos.push({ valor: v, indice: m.index, trecho: m[0] });
  }
  if (!precos.length) {
    // "89,90" solto
    const solto = /(?:^|\s)(\d{1,4},\d{2})(?=\s|$)/g;
    while ((m = solto.exec(texto))) {
      const v = lerPreco(m[1]);
      if (v) precos.push({ valor: v, indice: m.index, trecho: m[0] });
    }
  }
  return precos;
}

function encontrarTamanho(texto) {
  let m = texto.match(/\btam(?:anho)?\.?\s*:?\s*(xpp|pp|xp|p|m|gg|g|xgg|xg|egg|eg|g[123]|u|unico|único|\d{2})\b/i);
  if (m) return /^unico|único$/i.test(m[1]) ? "Único" : m[1].toUpperCase();
  m = texto.match(/\b(?:n[º°o]|num\.?|numero|número)\s*(\d{2})\b/i);
  if (m) return m[1];
  const letras = TAMANHOS_LETRA.join("|");
  m = texto.match(new RegExp(`(?:^|[\\s,;(/-])(${letras})(?=$|[\\s,;)/.!-])`));
  if (m) return m[1];
  if (/\b(tamanho [uú]nico|tam [uú]nico)\b/i.test(texto)) return "Único";
  // número solto típico de roupa/calçado (32 a 56) na primeira linha, que não seja preço nem medida
  const primeira = texto.split("\n")[0] || "";
  m = primeira.match(/(?:^|\s)(3[2-9]|4\d|5[0-6])(?=$|[\s,;.!)])(?!\s*(?:cm|reais|,\d|\.\d))/);
  if (m && !new RegExp(`(?:r\\$|rs|por|de|valor)\\s*${m[1]}\\b`, "i").test(primeira)) return m[1];
  return "";
}

function encontrarMarca(texto) {
  const n = normalizar(texto);
  const ordenadas = [...MARCAS].sort((a, b) => b.length - a.length);
  for (const marca of ordenadas) {
    const alvo = normalizar(marca).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z])${alvo}($|[^a-z])`).test(n)) return marca;
  }
  const m = texto.match(/\bmarca:?\s*([A-ZÀ-Ú][\wÀ-ú&'.]*(?:\s[A-ZÀ-Ú][\wÀ-ú&'.]*)?)/);
  return m ? m[1] : "";
}

function encontrarCor(texto) {
  const n = normalizar(texto);
  for (const cor of CORES) {
    const alvo = normalizar(cor);
    if (new RegExp(`(^|[^a-z])${alvo}($|[^a-z])`).test(n)) return primeiraMaiuscula(cor);
  }
  return "";
}

function encontrarEstado(texto) {
  const n = normalizar(texto);
  if (/(com etiqueta|nunca usad|nov[ao] com)/.test(n)) return "Nova com etiqueta";
  if (/\bseminov/.test(n)) return "Seminova";
  if (/(usad[ao] (uma|1|duas|2|poucas) vez|impecavel|perfeito estado|excelente estado)/.test(n)) return "Excelente estado";
  if (/(otimo estado)/.test(n)) return "Ótimo estado";
  if (/(bom estado)/.test(n)) return "Bom estado";
  if (/\bnov[ao]\b/.test(n)) return "Nova";
  return "";
}

function encontrarMedidas(linhas) {
  return linhas
    .filter((l) => /(busto|cintura|quadril|comprimento|ombro|manga|largura|altura|cava|gancho)\b/i.test(l) && /\d/.test(l))
    .map((l) => l.replace(/^[-•*]\s*/, ""))
    .join(", ");
}

export function categoriaPorTexto(texto, categoriasDaLoja) {
  const n = normalizar(texto);
  for (const [re, trechos] of CATEGORIAS) {
    if (re.test(n)) {
      const cat = categoriasDaLoja.find((c) => trechos.some((t) => normalizar(c.nome).includes(t)));
      if (cat) return cat;
    }
  }
  return null;
}

function tituloDe(linhas, dados) {
  const tam = (dados.tamanho || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const linha of linhas) {
    let t = linha
      .replace(/(?:r\$|\brs\b)\s*[\d.,]+/gi, "")
      .replace(/[\d.,]+\s*reais\b/gi, "")
      .replace(/\b(?:n[º°o]|num\.?|numero|número)\s*\d{2}\b/gi, "")
      .replace(/\b(?:de|por|valor|preço|preco)\s*:?\s*[\d.,]+\s*(reais)?/gi, "")
      .replace(/\b\d+[.,]\d{2}\b/g, "")
      .replace(/\btam(?:anho)?\.?\s*:?\s*\S+/gi, "")
      // o estado vai para o campo próprio, não para o título
      .replace(/(?:,\s*|\s+|^)(?:em\s+)?(?:excelente|[óo]timo|bom|perfeito)\s+estado\b/gi, "")
      .replace(
        /(?:,\s*|\s+|^)(?:nova\s+com\s+etiqueta|com\s+etiqueta|nunca\s+usad[ao]|seminov[ao]|impec[áa]vel|usad[ao]\s+(?:uma|1|duas|2|poucas)\s+vez(?:es)?)(?![a-zà-ú])/gi,
        "",
      )
      .replace(/#\S+/g, "")
      .replace(/[|*_~]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    for (let i = 0; i < 3; i++) {
      t = t
        .replace(/[\s,;:.\-–—]+$/, "")
        .replace(/^\s*[-–—•:]+\s*/, "")
        .trim();
      const fim = t.match(/\s(\d{2,5}(?:[.,]\d{2})?)$/);
      if (fim && dados.preco !== null && lerPreco(fim[1]) === dados.preco) t = t.slice(0, fim.index).trim();
      if (tam) t = t.replace(new RegExp(`\\s(?:tam\\.?\\s*)?${tam}$`, "i"), "").trim();
    }
    if (t.length >= 3 && /[a-zà-ú]/i.test(t) && !/^(ola|oi|bom dia|boa tarde|boa noite)\b/i.test(normalizar(t))) {
      return primeiraMaiuscula(t.length > 70 ? t.slice(0, 70).replace(/\s\S*$/, "") : t);
    }
  }
  const partes = [dados.categoria?.nome?.replace(/s\b.*$/, ""), dados.marca].filter(Boolean);
  return partes.join(" ");
}

/** Lê um bloco de texto que descreve UMA peça. */
export function lerPeca(texto, categoriasDaLoja = []) {
  const linhas = texto.split("\n").map(limparLinha).filter(Boolean);
  const junto = linhas.join("\n");
  const precos = encontrarPrecos(junto);
  let preco = null;
  let precoOriginal = null;
  const dePor = junto.match(/\bde\s*:?\s*(?:r\$\s*)?([\d.,]+)\s*(?:reais)?\s*(?:por|\/)\s*:?\s*(?:r\$\s*)?([\d.,]+)/i);
  if (dePor) {
    precoOriginal = lerPreco(dePor[1]);
    preco = lerPreco(dePor[2]);
  } else if (precos.length) {
    preco = precos[precos.length > 1 && /\bpor\b/i.test(junto) ? precos.length - 1 : 0].valor;
  }
  const tamanho = encontrarTamanho(junto);
  if (preco === null) {
    // número solto no fim de uma linha ("Jaqueta Levi's M 150")
    for (const linha of linhas) {
      const m = linha.match(/(?:^|\s)(\d{2,5}(?:[.,]\d{2})?)\s*$/);
      if (m && m[1] !== tamanho && !/\b(cm|nº|n°)\s*$/i.test(linha.slice(0, m.index + 1))) {
        const v = lerPreco(m[1]);
        if (v && v >= 10) {
          preco = v;
          break;
        }
      }
    }
  }
  const marca = encontrarMarca(junto);
  const categoria = categoriaPorTexto(junto, categoriasDaLoja);
  const dados = {
    preco,
    preco_original: precoOriginal && preco && precoOriginal > preco ? precoOriginal : null,
    tamanho,
    marca,
    cor: encontrarCor(junto),
    estado: encontrarEstado(junto),
    medidas: encontrarMedidas(linhas),
    categoria,
  };
  dados.titulo = tituloDe(linhas, dados);
  dados.descricao = "";
  dados.trecho_texto = texto.trim();
  return dados;
}

function temPreco(linha) {
  return encontrarPrecos(linha).length > 0;
}

/** Divide um texto com várias peças em blocos, um por peça. */
export function dividirEmBlocos(texto) {
  const limpo = String(texto || "").replace(/\r/g, "").trim();
  if (!limpo) return [];
  const blocos = limpo.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const resultado = [];
  for (const bloco of blocos) {
    const linhas = bloco.split("\n").filter((l) => l.trim());
    const comPreco = linhas.filter(temPreco).length;
    if (comPreco <= 1) {
      resultado.push(bloco);
      continue;
    }
    // várias peças no mesmo bloco: fecha um grupo a cada linha com preço
    // (exceto "De R$ 299" seguido de "Por R$ 149" em linhas separadas)
    let grupo = [];
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      grupo.push(linha);
      const deSozinho = /(^|\s)de\s*:?\s*(r\$\s*)?[\d.,]+\s*(reais)?\s*$/i.test(limparLinha(linha));
      const proximaPor = /^\s*por\b/i.test(limparLinha(linhas[i + 1] || ""));
      if (temPreco(linha) && !(deSozinho && proximaPor)) {
        resultado.push(grupo.join("\n"));
        grupo = [];
      }
    }
    if (grupo.length) {
      if (resultado.length) resultado[resultado.length - 1] += "\n" + grupo.join("\n");
      else resultado.push(grupo.join("\n"));
    }
  }
  // descarta blocos que são só conversa (sem preço, sem tamanho, sem categoria)
  return resultado.filter((b) => temPreco(b) || encontrarTamanho(b) || CATEGORIAS.some(([re]) => re.test(normalizar(b))));
}

export function extrairDeTexto(texto, categoriasDaLoja = []) {
  return dividirEmBlocos(texto).map((b) => lerPeca(b, categoriasDaLoja));
}

/* ---------------- OCR (leitura do texto dos prints) ---------------- */

let tesseractPromessa = null;
let trabalhador = null;

function carregarTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromessa) {
    tesseractPromessa = new Promise((ok, erro) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = () => ok(window.Tesseract);
      s.onerror = () => {
        tesseractPromessa = null;
        erro(new Error("Não foi possível carregar o leitor de texto."));
      };
      document.head.appendChild(s);
    });
  }
  return tesseractPromessa;
}

/** Lê o texto de uma imagem (print). Retorna "" se não conseguir. */
export async function lerTextoDaImagem(blob) {
  try {
    const T = await carregarTesseract();
    if (!trabalhador) trabalhador = await T.createWorker("por");
    const { data } = await trabalhador.recognize(blob);
    return (data?.text || "").trim();
  } catch (e) {
    console.warn("OCR indisponível", e);
    return "";
  }
}
