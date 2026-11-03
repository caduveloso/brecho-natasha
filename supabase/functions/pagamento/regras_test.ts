// Testes das regras do pagamento: deno test supabase/functions/pagamento/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  dataMP,
  formaDoPagamento,
  montarPreferencia,
  pagamentoPrincipal,
  type PedidoPagamento,
  pedidoPublico,
  podePagar,
  resumoDoPagamento,
  situacaoDoMercadoPago,
  uuidValido,
} from "./regras.ts";

const ID = "6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f";

function pedido(extra: Partial<PedidoPagamento> = {}): PedidoPagamento {
  return {
    id: ID,
    numero: 1003,
    status: "novo",
    criado_em: "2026-11-03T15:00:00Z",
    nome: "Ana  Maria Souza",
    telefone: "(21) 99999-8888",
    email: "ana@exemplo.com",
    cpf: "529.982.247-25",
    entrega: "envio",
    cep: "01001-000",
    end_rua: "Rua X",
    end_numero: "10",
    total: "150.50",
    frete_valor: "25.90",
    frete_nome: "PAC",
    frete_empresa: "Correios",
    frete_prazo: 7,
    pagamento_situacao: "",
    pagamento_forma: "",
    pagamento_parcelas: null,
    pagamento_id: "",
    pagamento_link: "",
    pagamento_limite: null,
    pago_em: null,
    online: true,
    itens: [
      { titulo: "Camisa de linho", preco: "100.00", foto: "abc/1.webp", codigo: 12 },
      { titulo: "Bermuda", preco: 50.5, foto: null, codigo: null },
    ],
    ...extra,
  };
}

const OPCOES = {
  site: "https://caduveloso.github.io/brecho-natasha/",
  aviso: "https://x.supabase.co/functions/v1/pagamento?aviso=mp",
  fotos: "https://x.supabase.co/storage/v1/object/public/pecas",
  agora: new Date("2026-11-03T15:00:00Z"),
  limite: new Date("2026-11-03T17:00:00Z"),
};

Deno.test("preferência com as peças, o frete e a volta para a loja", () => {
  const p = montarPreferencia(pedido(), OPCOES);
  assertEquals(p.items.length, 3);
  assertEquals(p.items[0], {
    id: "peca-12",
    title: "Camisa de linho",
    quantity: 1,
    unit_price: 100,
    currency_id: "BRL",
    picture_url: "https://x.supabase.co/storage/v1/object/public/pecas/abc/1_p.webp",
  });
  assertEquals(p.items[1].id, "item-2");
  assertEquals(p.items[1].unit_price, 50.5);
  assert(!("picture_url" in p.items[1]));
  assertEquals(p.items[2], { id: "frete", title: "Frete Correios PAC", quantity: 1, unit_price: 25.9, currency_id: "BRL" });
  const soma = p.items.reduce((s, i) => s + Number(i.unit_price) * Number(i.quantity), 0);
  assertEquals(Math.round(soma * 100) / 100, 176.4);

  assertEquals(p.external_reference, ID);
  assertEquals(p.back_urls.success, `https://caduveloso.github.io/brecho-natasha/?pedido=${ID}`);
  assertEquals(p.back_urls.failure, p.back_urls.success);
  assertEquals(p.auto_return, "approved");
  assertEquals(p.notification_url, OPCOES.aviso);
  assertEquals(p.payment_methods, { excluded_payment_types: [{ id: "ticket" }] });
  assertEquals(p.payer, {
    name: "Ana",
    surname: "Maria Souza",
    email: "ana@exemplo.com",
    phone: { area_code: "21", number: "999998888" },
    identification: { type: "CPF", number: "52998224725" },
  });
});

Deno.test("prazos no horário de Brasília", () => {
  assertEquals(dataMP(new Date("2026-11-03T17:00:00Z")), "2026-11-03T14:00:00.000-03:00");
  const p = montarPreferencia(pedido(), OPCOES);
  assertEquals(p.expires, true);
  assertEquals(p.expiration_date_from, "2026-11-03T11:59:00.000-03:00");
  assertEquals(p.expiration_date_to, "2026-11-03T14:00:00.000-03:00");
  assertEquals(p.date_of_expiration, "2026-11-03T14:30:00.000-03:00");
});

Deno.test("retirada, sem e-mail e telefone com 55", () => {
  const p = montarPreferencia(
    pedido({ frete_valor: null, email: "", telefone: "+55 11 3333-4444", cpf: "", nome: "Bia" }),
    OPCOES,
  );
  assertEquals(p.items.length, 2);
  assertEquals(p.payer, { name: "Bia", phone: { area_code: "11", number: "33334444" } });
});

Deno.test("situações do Mercado Pago", () => {
  assertEquals(situacaoDoMercadoPago("approved"), "aprovado");
  assertEquals(situacaoDoMercadoPago("pending"), "pendente");
  assertEquals(situacaoDoMercadoPago("in_process"), "em_analise");
  assertEquals(situacaoDoMercadoPago("authorized"), "em_analise");
  assertEquals(situacaoDoMercadoPago("rejected"), "recusado");
  assertEquals(situacaoDoMercadoPago("cancelled"), "recusado");
  assertEquals(situacaoDoMercadoPago("refunded"), "devolvido");
  assertEquals(situacaoDoMercadoPago("charged_back"), "devolvido");
  assertEquals(situacaoDoMercadoPago("outra"), null);
  assertEquals(situacaoDoMercadoPago(undefined), null);
});

Deno.test("forma de pagamento", () => {
  assertEquals(formaDoPagamento({ id: 1, payment_method_id: "pix", payment_type_id: "bank_transfer" }), "PIX");
  assertEquals(formaDoPagamento({ id: 1, payment_method_id: "master", payment_type_id: "credit_card" }), "Cartão de crédito");
  assertEquals(formaDoPagamento({ id: 1, payment_method_id: "debelo", payment_type_id: "debit_card" }), "Cartão de débito");
  assertEquals(formaDoPagamento({ id: 1, payment_type_id: "account_money" }), "Saldo no Mercado Pago");
  assertEquals(formaDoPagamento({ id: 1 }), "Mercado Pago");
});

Deno.test("resumo do pagamento para o banco", () => {
  assertEquals(
    resumoDoPagamento({
      id: 123,
      status: "approved",
      transaction_amount: "176.4",
      payment_method_id: "visa",
      payment_type_id: "credit_card",
      installments: 3,
      date_approved: "2026-11-03T12:10:00.000-03:00",
    }),
    {
      id: "123",
      status_mp: "approved",
      situacao: "aprovado",
      valor: 176.4,
      forma: "Cartão de crédito",
      parcelas: 3,
      aprovado_em: "2026-11-03T12:10:00.000-03:00",
    },
  );
  const pix = resumoDoPagamento({ id: 9, status: "pending", transaction_amount: 80, payment_method_id: "pix", payment_type_id: "bank_transfer" });
  assertEquals(pix?.situacao, "pendente");
  assertEquals(pix?.parcelas, null);
  assertEquals(pix?.aprovado_em, null);
  assertEquals(resumoDoPagamento({ id: 9, status: "esquisito" }), null);
});

Deno.test("entre várias tentativas, vale a aprovada", () => {
  const lista = [
    { id: 1, status: "rejected", date_created: "2026-11-03T12:00:00Z" },
    { id: 2, status: "approved", date_created: "2026-11-03T12:05:00Z" },
    { id: 3, status: "pending", date_created: "2026-11-03T12:10:00Z" },
  ];
  assertEquals(pagamentoPrincipal(lista)?.id, 2);
  assertEquals(pagamentoPrincipal(lista.filter((p) => p.id !== 2))?.id, 3);
  assertEquals(
    pagamentoPrincipal([
      { id: 4, status: "rejected", date_created: "2026-11-03T12:00:00Z" },
      { id: 5, status: "rejected", date_created: "2026-11-03T12:20:00Z" },
    ])?.id,
    5,
  );
  assertEquals(pagamentoPrincipal([]), null);
});

Deno.test("quando o pedido ainda pode ser pago", () => {
  const agora = new Date("2026-11-03T16:00:00Z");
  assert(podePagar(pedido(), agora), "pedido novo, dentro das 2 horas");
  assert(!podePagar(pedido({ criado_em: "2026-11-03T13:00:00Z" }), agora), "pedido antigo sem prazo não abre pagamento");
  assert(podePagar(pedido({ pagamento_limite: "2026-11-03T16:30:00Z", pagamento_situacao: "recusado" }), agora));
  assert(!podePagar(pedido({ pagamento_limite: "2026-11-03T15:59:00Z", pagamento_situacao: "aguardando" }), agora));
  assert(!podePagar(pedido({ status: "pago", pagamento_situacao: "aprovado" }), agora));
  assert(!podePagar(pedido({ pagamento_situacao: "em_analise", pagamento_limite: "2026-11-03T17:00:00Z" }), agora));
});

Deno.test("o site recebe o pedido sem dados pessoais", () => {
  const publico = pedidoPublico(pedido(), new Date("2026-11-03T16:00:00Z"));
  const texto = JSON.stringify(publico);
  for (const dado of ["Ana", "99999", "52998224725", "ana@exemplo.com", "Rua X"]) {
    assert(!texto.includes(dado), `não expõe ${dado}`);
  }
  assertEquals(publico.total, 150.5);
  assertEquals(publico.frete?.valor, 25.9);
  assertEquals(publico.pode_pagar, true);
});

Deno.test("uuid", () => {
  assertEquals(uuidValido(ID.toUpperCase()), ID);
  assertEquals(uuidValido("1003"), null);
  assertEquals(uuidValido(undefined), null);
});
