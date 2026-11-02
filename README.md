# Brechó da Natasha

Loja online de peças únicas, com vitrine elegante, sacola, pedido com reserva automática da peça e conversa final pelo WhatsApp. Por trás, um painel de **cadastro rápido** que lê fotos, prints de conversa e textos colados e transforma cada peça em um rascunho pronto para revisar e publicar.

- **Loja:** `index.html` (no ar em `https://caduveloso.github.io/brecho-natasha/`)
- **Painel:** `admin.html` (no ar em `https://caduveloso.github.io/brecho-natasha/admin.html`)

Tudo roda sem servidor próprio: as páginas são estáticas (GitHub Pages) e os dados, fotos e login ficam no Supabase.

---

## Como usar o painel

### Entrar

Abra o painel e entre com o e-mail e a senha da administração. Troque a senha inicial logo no primeiro acesso, em **Loja › Trocar senha**. Só contas cadastradas como administradoras conseguem entrar; qualquer outra conta é recusada.

### Cadastro rápido

1. Em **Cadastro rápido**, envie as imagens das peças: arraste para a área tracejada, cole um print com Ctrl+V ou toque em **Escolher da galeria** no celular.
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
2. Informa nome, WhatsApp e se quer envio (com CEP e endereço, preenchido pelo CEP) ou retirada.
3. Ao confirmar, as peças ficam **Reservadas** na hora (duas pessoas nunca compram a mesma peça) e o pedido aparece na aba **Pedidos**, com um aviso de novo pedido.
4. A cliente é convidada a enviar o pedido pelo WhatsApp da loja, já com peças, total e endereço escritos.

Na aba **Pedidos**, o botão **WhatsApp** abre a conversa com a cliente. Ao mudar a situação, as peças acompanham:

- **Novo**: peças reservadas.
- **Pago**, **Enviado**, **Concluído**: peças vendidas.
- **Cancelado**: peças voltam a ficar disponíveis.

Pagamento e frete são combinados pelo WhatsApp.

### Loja

Em **Loja** ficam o nome, a frase de abertura, o texto "Sobre", WhatsApp, Instagram, e-mail, cidade, os textos de envio e retirada, as categorias (criar, renomear, reordenar, excluir) e a troca de senha. **Preencha o WhatsApp**: é para ele que os pedidos são enviados.

---

## Como funciona por dentro

```
index.html, admin.html   páginas da loja e do painel
css/                     base.css (cores, letras, botões), loja.css, admin.css
js/config.js             endereço do Supabase e chave pública
js/comum.js              cliente Supabase, preços, WhatsApp, avisos
js/loja.js               vitrine, coleção, peça, sacola, checkout
js/admin.js              painel (cadastro rápido, peças, pedidos, loja)
js/extrator.js           leitura simples de textos e prints (regras + OCR)
js/imagem.js             redução, recorte e conversão das fotos para WebP
vendor/                  supabase-js 2.118.0
supabase/migrations/     banco de dados (tabelas, regras de acesso, funções)
supabase/functions/      extrair-peca (leitura automática com o Claude)
```

**Supabase** (projeto `brecho-natasha`, região São Paulo):

- Tabelas `pecas`, `categorias`, `pedidos`, `pedido_itens`, `loja_config` e `admins`, todas com Row Level Security. O público só lê peças publicadas, categorias e os dados da loja; não lê pedidos nem campos internos.
- Pedidos entram só pela função `criar_pedido`, que trava as peças, confere se ainda estão disponíveis e reserva tudo de uma vez.
- Um gatilho acerta a situação das peças quando o pedido muda de situação, e outro impede publicar peça sem título, preço ou foto.
- Fotos no Storage: `pecas` (público, WebP em 1600 px e miniatura de 640 px) e `originais` (privado, a imagem original de cada cadastro, usada para recortar de novo).
- Edge Function `extrair-peca`: só atende administradoras logadas e usa o segredo `ANTHROPIC_API_KEY`.

A chave em `js/config.js` é a chave **pública** do Supabase, feita para ficar no navegador; a segurança vem das regras de acesso do banco. Nenhum segredo fica no código.

### Publicar mudanças

- **Site:** qualquer commit na branch `main` é publicado pelo GitHub Pages em cerca de um minuto (Settings › Pages, origem "Deploy from a branch", `main`, pasta raiz).
- **Banco:** as migrações em `supabase/migrations` já foram aplicadas. Mudanças novas entram como novos arquivos nessa pasta.
- **Função:** `supabase functions deploy extrair-peca --no-verify-jwt` (a função faz a própria checagem de login).

### Cuidados

- No plano gratuito, o Supabase pausa projetos sem nenhum acesso por 7 dias. Com a loja recebendo visitas isso não acontece; se acontecer, basta reativar o projeto no painel do Supabase.
- Para incluir outra administradora, crie o usuário em Authentication › Users e adicione o id dele na tabela `admins`.
