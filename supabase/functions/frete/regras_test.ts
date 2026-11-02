// Testes das regras do frete: deno test supabase/functions/frete/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  cnpjValido,
  corpoDaCotacao,
  cpfValido,
  enderecoEmTexto,
  faltasDoRemetente,
  lerCotacao,
  medidasDaPeca,
  mensagemDoErro,
  montarCarrinho,
  pacoteUnico,
  type PecaFrete,
} from "./regras.ts";

const vestido: PecaFrete = { id: "a", titulo: "Vestido midi de linho", preco: 120, peso_g: null, categoria_slug: "vestidos" };
const bolsa: PecaFrete = { id: "b", titulo: "Bolsa de couro", preco: 180.5, peso_g: 950, categoria_slug: "bolsas" };

Deno.test("CPF e CNPJ conferem os dígitos", () => {
  assert(cpfValido("529.982.247-25"));
  assert(!cpfValido("529.982.247-24"));
  assert(!cpfValido("111.111.111-11"));
  assert(cnpjValido("11.222.333/0001-81"));
  assert(!cnpjValido("11.222.333/0001-80"));
});

Deno.test("medidas usam a categoria e o peso da peça quando existe", () => {
  assertEquals(medidasDaPeca(vestido), { altura: 5, largura: 25, comprimento: 30, peso: 0.4 });
  assertEquals(medidasDaPeca(bolsa).peso, 0.95);
  assertEquals(medidasDaPeca({ ...vestido, categoria_slug: "outra" }).peso, 0.5);
});

Deno.test("corpo da cotação traz CEPs só com dígitos e seguro opcional", () => {
  const c = corpoDaCotacao("20040-002", "01310-100", [vestido, bolsa], true, 2);
  assertEquals(c.from.postal_code, "20040002");
  assertEquals(c.to.postal_code, "01310100");
  assertEquals(c.products[1].insurance_value, 180.5);
  assertEquals(c.services, "2");
  assertEquals(corpoDaCotacao("20040002", "01310100", [vestido], false).products[0].insurance_value, 0);
});

const RESPOSTA = [
  {
    id: 1,
    name: "PAC",
    price: "25.10",
    custom_price: "23.47",
    delivery_time: 7,
    custom_delivery_time: 7,
    custom_delivery_range: { min: 6, max: 7 },
    packages: [{ weight: "1.35", dimensions: { height: 20, width: 30, length: 35 }, products: [{ id: "a" }, { id: "b" }] }],
    company: { id: 1, name: "Correios", picture: "x" },
  },
  { id: 2, name: "SEDEX", custom_price: "41.90", custom_delivery_range: { min: 2, max: 3 }, company: { id: 1, name: "Correios" } },
  { id: 17, name: "Mini Envios", error: "Peso excede o limite", company: { id: 1, name: "Correios" } },
  { id: 3, name: ".Package", custom_price: "19.90", delivery_range: { min: 5, max: 8 }, company: { id: 2, name: "Jadlog" } },
  { id: 22, name: "Rodoviário", price: "15.00", delivery_time: 9, company: { id: 9, name: "Buslog" } },
];

Deno.test("cotação descarta erros, filtra transportadoras e ordena pelo preço", () => {
  const opcoes = lerCotacao(RESPOSTA, ["Correios", "Jadlog", "Loggi"], 2);
  assertEquals(opcoes.map((o) => o.id), [3, 1, 2]);
  const pac = opcoes.find((o) => o.id === 1)!;
  assertEquals(pac.valor, 23.47);
  assertEquals([pac.prazo_min, pac.prazo_max], [8, 9]);
  assertEquals(pac.pacotes, [{ altura: 20, largura: 30, comprimento: 35, peso: 1.35, produtos: ["a", "b"] }]);
  assertEquals(lerCotacao(RESPOSTA, [], 0).length, 4);
  assertEquals(lerCotacao({ erro: true }, [], 0), []);
});

Deno.test("endereço em texto", () => {
  assertEquals(
    enderecoEmTexto({ rua: "Rua das Laranjeiras", numero: "120", complemento: "apto 302", bairro: "Laranjeiras", cidade: "Rio de Janeiro", uf: "rj" }),
    "Rua das Laranjeiras, 120 - apto 302, Laranjeiras, Rio de Janeiro/RJ",
  );
});

const remetente = {
  nome: "Natasha",
  documento: "52998224725",
  telefone: "(21) 99999-0000",
  email: "loja@exemplo.com",
  cep: "22240-003",
  rua: "Rua das Laranjeiras",
  numero: "120",
  complemento: "",
  bairro: "Laranjeiras",
  cidade: "Rio de Janeiro",
  uf: "RJ",
};

Deno.test("faltas do remetente", () => {
  assertEquals(faltasDoRemetente(remetente), []);
  assertEquals(faltasDoRemetente({ ...remetente, documento: "123", uf: "Rio" }), ["CPF ou CNPJ", "UF"]);
});

Deno.test("carrinho separa as peças do pacote e declara o valor", () => {
  const corpo = montarCarrinho({
    servico: 1,
    agencia: null,
    de: remetente,
    para: { ...remetente, nome: "Cliente", documento: "529.982.247-25", cep: "01310-100", uf: "sp" },
    pacote: { altura: 5, largura: 25, comprimento: 30, peso: 0.4, produtos: ["a"] },
    pecas: [vestido, bolsa],
    numeroPedido: 1001,
    declararValor: true,
    plataforma: "Brecho da Natasha",
  });
  assertEquals(corpo.products, [{ name: "Vestido midi de linho", quantity: 1, unitary_value: 120 }]);
  assertEquals(corpo.options.insurance_value, 120);
  assertEquals(corpo.to.postal_code, "01310100");
  assertEquals(corpo.to.state_abbr, "SP");
  assertEquals((corpo.from as Record<string, unknown>).document, "52998224725");
  assertEquals("agency" in corpo, false);
  assertEquals(corpo.options.tags[0].tag, "Pedido 1001");
});

Deno.test("pacote único soma alturas e pesos", () => {
  const p = pacoteUnico([vestido, bolsa]);
  assertEquals([p.altura, p.largura, p.comprimento, p.peso], [20, 30, 35, 1.35]);
});

Deno.test("mensagens de erro do Melhor Envio", () => {
  assertEquals(
    mensagemDoErro({ message: "The given data was invalid.", errors: { "to.document": ["CPF inválido"] } }, 422),
    "CPF inválido",
  );
  assertEquals(mensagemDoErro({ error: "Saldo insuficiente" }, 400), "Saldo insuficiente");
  assertEquals(mensagemDoErro(null, 401), "O token do Melhor Envio é inválido ou expirou.");
});
