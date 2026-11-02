// Utilidades de imagem: abrir, recortar, reduzir e converter (tudo no navegador).

/** Abre um arquivo de imagem respeitando a rotação da câmera (EXIF). */
export async function carregarBitmap(arquivo) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    } catch {
      /* tenta pelo caminho clássico */
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export function dimensoes(fonte) {
  return {
    largura: fonte.naturalWidth || fonte.width,
    altura: fonte.naturalHeight || fonte.height,
  };
}

function limitar(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Normaliza um recorte {x, y, largura, altura} (0 a 1). Devolve null se for a imagem inteira. */
export function normalizarRecorte(r) {
  if (!r) return null;
  let x = limitar(Number(r.x) || 0, 0, 1);
  let y = limitar(Number(r.y) || 0, 0, 1);
  let l = limitar(Number(r.largura ?? r.w) || 1, 0, 1);
  let a = limitar(Number(r.altura ?? r.h) || 1, 0, 1);
  if (x + l > 1) l = 1 - x;
  if (y + a > 1) a = 1 - y;
  if (l < 0.03 || a < 0.03) return null;
  if (x < 0.01 && y < 0.01 && l > 0.98 && a > 0.98) return null;
  return { x, y, largura: l, altura: a };
}

/**
 * Gera um arquivo reduzido (e opcionalmente recortado) a partir da imagem.
 * Reduz em etapas para manter a nitidez.
 */
export async function gerarBlob(fonte, { maxLado = 1600, recorte = null, tipo = "image/webp", qualidade = 0.86 } = {}) {
  const { largura: w, altura: h } = dimensoes(fonte);
  const r = normalizarRecorte(recorte);
  const sx = r ? Math.round(r.x * w) : 0;
  const sy = r ? Math.round(r.y * h) : 0;
  const sw = r ? Math.max(8, Math.round(r.largura * w)) : w;
  const sh = r ? Math.max(8, Math.round(r.altura * h)) : h;

  const escala = Math.min(1, maxLado / Math.max(sw, sh));
  const destinoL = Math.max(1, Math.round(sw * escala));
  const destinoA = Math.max(1, Math.round(sh * escala));

  // primeira etapa: recorte em tamanho original (ou metade, se for muito grande)
  let atual = document.createElement("canvas");
  let cl = sw;
  let ca = sh;
  while (cl / 2 >= destinoL * 1.0001 && ca / 2 >= destinoA * 1.0001 && cl > 4096) {
    cl = Math.round(cl / 2);
    ca = Math.round(ca / 2);
  }
  atual.width = cl;
  atual.height = ca;
  let ctx = atual.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, cl, ca);

  // etapas seguintes: reduz pela metade até chegar perto do destino
  while (cl / 2 >= destinoL && ca / 2 >= destinoA) {
    const proximo = document.createElement("canvas");
    proximo.width = Math.round(cl / 2);
    proximo.height = Math.round(ca / 2);
    const pctx = proximo.getContext("2d");
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(atual, 0, 0, proximo.width, proximo.height);
    atual = proximo;
    cl = proximo.width;
    ca = proximo.height;
  }

  const final = document.createElement("canvas");
  final.width = destinoL;
  final.height = destinoA;
  const fctx = final.getContext("2d");
  if (tipo !== "image/png") {
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, destinoL, destinoA);
  }
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(atual, 0, 0, destinoL, destinoA);

  let blob = await new Promise((ok) => final.toBlob(ok, tipo, qualidade));
  if (!blob || blob.type !== tipo) {
    // navegadores sem WebP: usa JPEG
    blob = await new Promise((ok) => final.toBlob(ok, "image/jpeg", qualidade));
  }
  return blob;
}

export function extensao(blob) {
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/png") return "png";
  return "jpg";
}

export function paraBase64(blob) {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).split(",")[1] || "");
    leitor.onerror = () => erro(leitor.error);
    leitor.readAsDataURL(blob);
  });
}
