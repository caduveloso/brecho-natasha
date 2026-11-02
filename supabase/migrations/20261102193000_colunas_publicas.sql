-- Visitantes (anon) só enxergam as colunas públicas das peças.
-- O texto original do cadastro e os caminhos dos prints ficam restritos ao painel.
revoke select on public.pecas from anon;
grant select (
  id, codigo, titulo, descricao, categoria_id, marca, tamanho, cor, estado, medidas,
  preco, preco_original, status, destaque, fotos, publicado_em
) on public.pecas to anon;
