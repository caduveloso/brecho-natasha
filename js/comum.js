// Funções compartilhadas entre a loja e o painel.
import { SUPABASE_URL, SUPABASE_CHAVE } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const BUCKET_FOTOS = "pecas";
export const BUCKET_ORIGINAIS = "originais";

/** URL pública de uma foto. tamanho: "g" (grande) ou "p" (miniatura). */
export function fotoUrl(caminho, tamanho = "g") {
  if (!caminho) return "";
  if (/^(https?:|data:|blob:)/.test(caminho)) return caminho;
  const final = tamanho === "p" ? caminho.replace(/(\.\w+)$/, "_p$1") : caminho;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_FOTOS}/${final
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

const formatoReal = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarPreco(valor) {
  if (valor === null || valor === undefined || valor === "" || isNaN(Number(valor))) return "";
  return formatoReal.format(Number(valor));
}

/**
 * Converte textos de preço em número: "R$ 1.234,90", "89,9", "89.90", "120", "120 reais".
 * Retorna null se não houver número.
 */
export function lerPreco(texto) {
  if (texto === null || texto === undefined) return null;
  if (typeof texto === "number") return isFinite(texto) ? Math.round(texto * 100) / 100 : null;
  let s = String(texto).replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");
  if (ultimaVirgula > -1 && ultimoPonto > -1) {
    // o separador decimal é o último que aparece
    if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (ultimaVirgula > -1) {
    const decimais = s.length - ultimaVirgula - 1;
    s = decimais === 3 && (s.match(/,/g) || []).length >= 1 && s.length > 4
      ? s.replace(/,/g, "")
      : s.replace(/\./g, "").replace(/,(?=[^,]*$)/, ".").replace(/,/g, "");
  } else if (ultimoPonto > -1) {
    const decimais = s.length - ultimoPonto - 1;
    // "1.200" é mil e duzentos; "89.90" é decimal
    if (decimais === 3) s = s.replace(/\./g, "");
    else s = s.replace(/\.(?=.*\.)/g, "");
  }
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function soDigitos(texto) {
  return String(texto ?? "").replace(/\D/g, "");
}

/** Número de WhatsApp no formato internacional (assume Brasil se faltar o 55). */
export function numeroWhatsapp(texto) {
  let d = soDigitos(texto);
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;
  return d;
}

export function linkWhatsapp(numero, mensagem) {
  const n = numeroWhatsapp(numero);
  const base = n ? `https://wa.me/${n}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(mensagem)}`;
}

let timerToast;
export function avisar(mensagem, tipo = "") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.className = `toast visivel ${tipo}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove("visivel"), tipo === "erro" ? 6000 : 3200);
}

/** Separa o nome da loja em duas linhas para o logotipo: "Brechó da" + "Natasha". */
export function partesDoNome(nome) {
  const limpo = String(nome || "").trim();
  const m = limpo.match(/^(.*\S)\s+(\S+)$/);
  if (!m) return { menor: "", maior: limpo };
  return { menor: m[1], maior: m[2] };
}

export function logotipoHtml(nome) {
  const { menor, maior } = partesDoNome(nome);
  return `${menor ? `<span class="logo-menor">${escapar(menor)}</span>` : ""}<span class="logo-maior">${escapar(maior)}</span>`;
}

/**
 * Chama uma Edge Function e devolve o JSON da resposta, inclusive quando ela
 * responde com erro (400, 403...), para mostrar a mensagem que a função mandou.
 */
export async function chamarFuncao(nome, corpo) {
  const { data, error } = await sb.functions.invoke(nome, { body: corpo });
  if (!error) return data;
  const resposta = error.context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const dados = await resposta.json();
      if (dados && typeof dados === "object") return dados;
    } catch {
      /* resposta sem JSON: cai no erro original */
    }
  }
  throw error;
}

export function mensagemDeErro(erro) {
  const msg = erro?.message || String(erro || "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Sem conexão. Verifique a internet e tente de novo.";
  return msg || "Algo deu errado. Tente de novo.";
}
