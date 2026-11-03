# Brechó da Natasha

Loja online de peças únicas, com vitrine elegante, sacola, frete calculado pelo CEP (Correios, Jadlog, Loggi), pedido com reserva automática da peça e conversa final pelo WhatsApp. Por trás, um painel de **cadastro rápido** que lê fotos, prints de conversa, prints de anúncios do Enjoei e textos colados e transforma cada peça em um rascunho pronto para revisar e publicar, e que gera a **etiqueta de envio** de cada pedido.

- **Loja:** `index.html` (no ar em `https://caduveloso.github.io/brecho-natasha/`)
- **Painel:** `admin.html` (no ar em `https://caduveloso.github.io/brecho-natasha/admin.html`)

Tudo roda sem servidor próprio: as páginas são estáticas (GitHub Pages) e os dados, fotos e login ficam no Supabase.

---

## Como usar o painel

### Entrar

Abra o painel e entre com o e-mail e a senha da administração. Troque a senha inicial logo no primeiro acesso, em **Loja › Trocar senha**. Só contas cadastradas como administradoras conseguem entrar; qualquer outra conta é recusada.

### Cadastro rápido

1. Em **Cadastro rápido**, envie as imagens das peças: arraste para a área tracejada, cole um print com Ctrl+V ou toque em **Escolher da galeria** no celular. Prints de anúncios do Enjoei funcionam do mesmo jeito: a leitura ignora botões, parcelas e frete do aplicativo e reescreve a descrição no tom da loja.
2. Se tiver texto (a mensagem com descrição e preço), cole no campo **Texto colado**. Dá para colar várias peças de uma vez, uma por linha ou separadas por uma linha em branco.
3. Diga como as imagens se agrupam:
   - **Detectar automaticamente**: o sistema decide.
   - **Uma peça por imagem**: cada foto ou print é uma peça diferente.
   - **Todas da mesma peça**: várias fotos de uma peça só.
4. Clique em **Ler e criar rascunhos**. Cada peça vira um rascunho com título, preço, tamanho, marca, categoria, cor, estado e a foto já recortada.
5. Revise. Campos que faltam ficam destacados. Dá para trocar a capa, recortar de novo a partir da imagem original, incluir mais fotos e ajustar qualquer texto (tudo é salvo sozinho).
6. Clique em **Publicar** na peça, ou em **Publicar prontos** para publicar de uma vez todos os rascunhos que já têm título, preço e foto.

Formatos que o sistema entende sem esforço:

```
Vestido midi de linho Farm, tam M, R$ 120
Blazer Zara preto P, de 299 por 149
Saia plissada Maria Filó 36 — 89,90
Bolsa Arezzo caramelo, ótimo estado, 180 reais
```

"De X por Y" vira preço riscado (X) e preço de venda (Y).

### Leitura automática com IA (recomendada)

Sem configurar nada, o painel usa uma **leitura simples**: entende textos na hora e lê o texto dos prints (OCR), mas não recorta as fotos sozinho.

Com a **leitura automática**, o Claude olha cada foto e print, separa as peças, recorta a foto do produto (sem balões, horários e barras do aplicativo), escreve uma descrição sóbria e escolhe a categoria. Para ligar:

1. Crie uma chave de API em [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. No Supabase, abra [Edge Functions › Secrets](https://supabase.com/dashboard/project/vmhbvlyxpxzqclghxvtj/functions/secrets) e adicione o segredo `ANTHROPIC_API_KEY` com a chave.
3. Pronto. Em **Loja › Leitura automática** o painel mostra se está ativa.

Cada leitura é uma chamada à API da Anthropic, cobrada na conta dona da chave. Opcional: o segredo `CLAUDE_MODEL` troca o modelo usado (padrão `claude-opus-5-5`).

### Peças

A aba **Peças** lista tudo, com busca por nome, marca ou código e filtros por situação e categoria. Na própria lista dá para mudar a situação, destacar a peça na página inicial (estrela) e abrir a edição completa.

| Situação | Onde aparece |
| --- | --- |
| Rascunho | Só no painel |
| Disponível | Na loja, pode ir para a sacola |
| Reservada | Na loja com o selo "Reservada"; ninguém mais consegue comprar |
| Vendida | Sai da coleção (o link direto mostra "Peça vendida") |
| Oculta | Só no painel |

Uma peça só pode ser publicada com título, preço e pelo menos uma foto; o banco recusa o resto.

### Pedidos

1. A cliente coloca as peças na sacola e clica em **Finalizar pedido**.
2. Informa nome, WhatsApp e se quer envio ou retirada. No envio, o CEP preenche rua, bairro, cidade e UF; ela completa número, complemento e CPF (exigido na etiqueta).
3. Com o Melhor Envio ligado, as opções de frete aparecem na hora, com transportadora, prazo e preço, e o total já inclui o frete escolhido. Sem ele (ou se a cotação falhar), o pedido segue com frete a combinar.
4. Ao confirmar, as peças ficam **Reservadas** na hora (duas pessoas nunca compram a mesma peça) e o pedido aparece na aba **Pedidos**, com um aviso de novo pedido.
5. O pagamento depende da cobrança pelo site (veja abaixo):
   - **Ligada:** a cliente vai direto para a página segura do Mercado Pago e paga com PIX ou cartão (à vista ou parcelado). Quando o pagamento é aprovado, o pedido vira **Pago** sozinho.
   - **Desligada:** ela escolhe PIX ou cartão no site e é convidada a enviar o pedido pelo WhatsApp da loja, já com peças, frete, total, endereço e forma de pagamento escritos. A cobrança é combinada por lá.

Na aba **Pedidos**, o botão **WhatsApp** abre a conversa com a cliente. Ao mudar a situação, as peças acompanham:

- **Novo**: peças reservadas.
- **Pago**, **Enviado**, **Concluído**: peças vendidas.
- **Cancelado**: peças voltam a ficar disponíveis.

Cada pedido mostra como foi pago: **Pago pelo site** (com a forma, as parcelas e o número do pagamento no Mercado Pago), **Aguardando pagamento pelo site** (com o horário até quando as peças ficam reservadas) ou, com a cobrança desligada, a forma que a cliente escolheu. Quando algo pede sua atenção (valor pago diferente do pedido, pagamento em dobro, estorno, reclamação ou pagamento que chegou depois da reserva vencer), um alerta aparece no pedido.

Pedidos com frete escolhido no site mostram o botão **Gerar etiqueta** (veja abaixo).

### Pagamento pelo site (PIX e cartão no Mercado Pago)

O site cobra pelo [Mercado Pago](https://www.mercadopago.com.br) (Checkout Pro): a cliente paga numa página segura do próprio Mercado Pago, com PIX ou cartão, e o dinheiro cai na conta Mercado Pago da loja. O site nunca vê os dados do cartão. Enquanto a cobrança estiver desligada, tudo funciona como antes, com o pagamento combinado pelo WhatsApp.

Para ligar:

1. Use a conta Mercado Pago de quem vai receber o dinheiro, com uma **chave PIX cadastrada** nela (sem chave, o PIX não aparece como opção).
2. Com essa conta, abra [Suas integrações](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação (pagamentos online, Checkout Pro) e, em **Credenciais › Produção**, toque em **Ativar ambiente de produção** (ele pede o setor e o site da loja).
3. Copie o **Access Token** de produção (começa com `APP_USR-`). No Supabase, em [Edge Functions › Secrets](https://supabase.com/dashboard/project/vmhbvlyxpxzqclghxvtj/functions/secrets), crie o segredo `MERCADO_PAGO_ACCESS_TOKEN` com ele. O token é como uma senha da conta: não mande por mensagem nem cole em outro lugar.
4. No painel, em **Loja › Pagamento pelo site**, confira se aparece **Conectado ao Mercado Pago** e marque **Cobrar pelo site**.
5. Faça uma compra de teste de verdade com um PIX de valor baixo (uma peça barata ou criada só para isso) e depois devolva o valor pelo Mercado Pago.

Como funciona:

- Ao confirmar o pedido, as peças ficam **reservadas por 2 horas** e a cliente vai para o Mercado Pago. O boleto fica de fora, porque leva dias para compensar.
- Pagou, o pedido vira **Pago** e as peças viram **Vendidas**, sem você fazer nada. A cliente volta para a loja e vê a confirmação; se o PIX demorar a cair, a página atualiza sozinha.
- Se ela fechar a página sem pagar, um aviso discreto no topo da loja a lembra de voltar e pagar (**Pagar agora**), enquanto a reserva durar.
- Sem pagamento, o pedido é **cancelado sozinho** um pouco depois do fim da reserva e as peças voltam para a vitrine. Se você combinar outro jeito de pagar com a cliente, mude o pedido para **Pago** antes disso.
- A taxa do Mercado Pago é descontada de cada venda, conforme as condições da conta (PIX costuma sair mais barato que cartão). O valor líquido de cada venda aparece no Mercado Pago.

Para desligar, é só desmarcar **Cobrar pelo site**: os pedidos novos voltam a ser combinados pelo WhatsApp, e os que já estão no Mercado Pago continuam sendo confirmados.

### Frete e etiquetas (Melhor Envio)

O frete do site e as etiquetas usam o [Melhor Envio](https://melhorenvio.com.br), que reúne Correios, Jadlog, Loggi e outras transportadoras. A conta é grátis; as etiquetas são pagas com o saldo da conta (você põe saldo por Pix ou cartão no próprio Melhor Envio).

Para ligar:

1. Crie a conta no Melhor Envio.
2. Em **Gerenciar › Tokens** (`melhorenvio.com.br/painel/gerenciar/tokens`), clique em **Novo token**, marque **Selecionar todos** e salve. Copie o token.
3. No Supabase, em [Edge Functions › Secrets](https://supabase.com/dashboard/project/vmhbvlyxpxzqclghxvtj/functions/secrets), crie o segredo `MELHOR_ENVIO_TOKEN` com o token.
4. No painel, em **Loja › Envio e etiquetas**, preencha os dados de quem envia (nome, CPF ou CNPJ, telefone, e-mail e endereço com CEP) e escolha as transportadoras oferecidas no site. Se a Jadlog estiver marcada, escolha também a agência onde você vai deixar os pacotes.

O quadro no topo do cartão mostra se a conta está conectada e o saldo disponível. Opcional: o segredo `MELHOR_ENVIO_SANDBOX` com o valor `true` usa o ambiente de testes do Melhor Envio (o token, nesse caso, é o da conta de testes).

Para enviar um pedido:

1. Em **Pedidos**, clique em **Gerar etiqueta**. O sistema compra a etiqueta com o saldo do Melhor Envio (o valor é o mesmo frete que a cliente pagou) e gera o documento.
2. Clique em **Imprimir etiqueta**, imprima e cole no pacote. O código de barras já vai nela.
3. Leve o pacote à agência da transportadora escolhida pela cliente. Depois da postagem, **Atualizar rastreio** traz o código de rastreio para mandar à cliente.

Sem saldo, o painel avisa e a etiqueta fica no carrinho do Melhor Envio; é só pôr saldo e clicar em **Continuar etiqueta**. **Cancelar etiqueta** devolve o valor ao saldo quando a etiqueta ainda não foi usada.

O frete é calculado com o tamanho e o peso típicos de cada categoria (um vestido, por exemplo, vai como pacote de 30 × 25 × 5 cm com 400 g). Para peças pesadas ou volumosas, preencha o **Peso (g)** na edição da peça.

### Peças que já estão no Enjoei

Há dois caminhos para trazer anúncios do Enjoei para a loja, sempre como rascunho para revisar antes de publicar:

- **Por print (o dia a dia):** no app do Enjoei, tire um print de cada anúncio, com a foto e o preço aparecendo, e solte os prints em **Cadastro rápido**. Cada print vira um rascunho com a foto recortada e a descrição reescrita no tom da loja.
- **Importação em lote:** a Edge Function `importar-pecas` cria rascunhos a partir dos dados e das fotos de vários anúncios de uma vez, copiando as fotos para a loja e evitando duplicar o mesmo anúncio (ela guarda o link de origem). Foi o caminho usado na primeira carga: as 39 peças da loja da Natasha no Enjoei, com as fotos dos anúncios e as descrições reescritas. Para repetir, é só pedir ao Claude para atualizar a partir da loja do Enjoei: ele lê os anúncios no Chrome e traz só os que ainda não estão aqui.

#### Mantendo as duas lojas iguais

Cada peça é única e pode estar à venda nos dois lugares, então o cuidado é não vender a mesma peça duas vezes:

- **Vendeu no Enjoei:** no painel, mude a peça para **Vendida** (ou **Oculta**) no mesmo dia.
- **Vendeu aqui na loja:** pause ou exclua o anúncio no Enjoei assim que o pedido chegar (a peça já fica **Reservada** aqui sozinha).
- **Peça nova no Enjoei:** tire um print do anúncio e solte em **Cadastro rápido**, ou junte várias e peça uma nova importação em lote.
- **Mudou o preço no Enjoei:** edite o preço da peça no painel. Lembre que o Enjoei mostra às vezes um preço promocional de primeira compra; o preço do anúncio é o outro.

### Loja

Em **Loja** ficam o nome, a frase de abertura, o texto "Sobre", WhatsApp, Instagram, e-mail, cidade, os textos de envio e retirada, as categorias (criar, renomear, reordenar, excluir), a cobrança pelo site, os dados de envio e a troca de senha. **Preencha o WhatsApp**: é para ele que os pedidos são enviados e é por ele que a cliente fala com a loja.

---

## Como funciona por dentro

```
index.html, admin.html   páginas da loja e do painel
css/                     base.css (cores, letras, botões), loja.css, admin.css
js/config.js             endereço do Supabase e chave pública
js/comum.js              cliente Supabase, preços, WhatsApp, avisos
js/loja.js               vitrine, coleção, peça, sacola, checkout
js/admin.js              painel (cadastro rápido, peças, pedidos, loja, envio)
js/extrator.js           leitura simples de textos e prints (regras + OCR)
js/imagem.js             redução, recorte e conversão das fotos para WebP
vendor/                  supabase-js 2.118.0
supabase/migrations/     banco de dados (tabelas, regras de acesso, funções)
supabase/functions/      extrair-peca (leitura com o Claude), frete (cotação, pedido
                         com frete e etiquetas), importar-pecas (carga de anúncios),
                         pagamento (cobrança no Mercado Pago)
```

**Supabase** (projeto `brecho-natasha`, região São Paulo):

- Tabelas `pecas`, `categorias`, `pedidos`, `pedido_itens`, `loja_config` e `admins`, todas com Row Level Security. O público só lê peças publicadas, categorias e os dados da loja; não lê pedidos nem campos internos.
- Pedidos entram só por funções do banco que travam as peças, conferem se ainda estão disponíveis e reservam tudo de uma vez: `fazer_pedido` (retirada ou frete a combinar) e `fazer_pedido_com_frete`, que só a Edge Function `frete` pode chamar, depois de recalcular o frete no Melhor Envio (assim ninguém altera o valor do frete pelo navegador).
- `envio_config` guarda os dados de quem envia e só é lida pelo painel. Os pedidos guardam CPF, endereço em partes, frete escolhido e a situação da etiqueta.
- Um gatilho acerta a situação das peças quando o pedido muda de situação, e outro impede publicar peça sem título, preço ou foto.
- Fotos no Storage: `pecas` (público, WebP em 1600 px e miniatura de 640 px) e `originais` (privado, a imagem original de cada cadastro, usada para recortar de novo).
- Edge Function `extrair-peca`: só atende administradoras logadas e usa o segredo `ANTHROPIC_API_KEY`.
- Edge Function `frete`: cotação e pedido são públicos (o site usa); status, transportadoras, agências e etiquetas só atendem administradoras. Usa o segredo `MELHOR_ENVIO_TOKEN`.
- Edge Function `importar-pecas`: só atende administradoras logadas ou quem tiver uma chave temporária de importação; baixa fotos apenas de endereços do Enjoei.
- Edge Function `pagamento`: abre o pagamento do pedido no Mercado Pago (`criar`), mostra a situação na volta da cliente (`situacao`, sem dados pessoais) e recebe os avisos do Mercado Pago (`?aviso=mp`). Não confia no conteúdo do aviso: lê o pagamento direto na API do Mercado Pago, com o segredo `MERCADO_PAGO_ACCESS_TOKEN`, e só aplica ao pedido indicado pelo próprio pagamento (`external_reference`). O valor cobrado vem do banco, nunca do navegador. As funções do banco que ela usa (`pagamento_pedido`, `pagamento_salvar_link`, `aplicar_pagamento`, `pagamento_vencidos`, `expirar_pedido`) só podem ser chamadas pelo servidor. `status` só atende administradoras.
- A cada 10 minutos, o `pg_cron` do banco chama a ação `expirar`, que confere no Mercado Pago os pedidos com a reserva vencida e cancela os que não têm pagamento aprovado ou em análise. Sem o token, ela não faz nada.

A chave em `js/config.js` é a chave **pública** do Supabase, feita para ficar no navegador; a segurança vem das regras de acesso do banco. Nenhum segredo fica no código.

### Publicar mudanças

- **Site:** qualquer commit na branch `main` é publicado pelo GitHub Pages em cerca de um minuto (Settings › Pages, origem "Deploy from a branch", `main`, pasta raiz).
- **Banco:** as migrações ficam em `supabase/migrations`, em ordem de data. Mudanças novas entram como novos arquivos nessa pasta.
- **Funções:** `supabase functions deploy extrair-peca --no-verify-jwt` (e o mesmo para `frete`, `importar-pecas` e `pagamento`). Todas fazem a própria checagem de acesso; `pagamento` precisa do `--no-verify-jwt` também porque o Mercado Pago chama a função sem login.
- **Testes das regras:** `deno test supabase/functions/frete/` e `deno test supabase/functions/pagamento/`.

### Cuidados

- No plano gratuito, o Supabase pausa projetos sem nenhum acesso por 7 dias. Com a loja recebendo visitas isso não acontece; se acontecer, basta reativar o projeto no painel do Supabase.
- Para incluir outra administradora, crie o usuário em Authentication › Users e adicione o id dele na tabela `admins`.
