-- Importação de peças já anunciadas em outro lugar (ex.: a loja da Natasha no Enjoei).

-- Link do anúncio de origem: evita importar a mesma peça duas vezes.
alter table public.pecas add column if not exists origem_url text;
create unique index if not exists pecas_origem_url_idx
  on public.pecas (origem_url) where origem_url is not null;

-- Chaves temporárias para importações feitas pela equipe (Edge Function importar-pecas).
-- Guardamos só o hash; ninguém lê esta tabela pela API.
create table if not exists public.chaves_importacao (
  hash      text primary key,
  expira_em timestamptz not null,
  criada_em timestamptz not null default now()
);
alter table public.chaves_importacao enable row level security;
revoke all on public.chaves_importacao from anon, authenticated;
