-- Brechó da Natasha: esquema inicial

-- ---------------------------------------------------------------
-- Configuração da loja (linha única)
-- ---------------------------------------------------------------
create table public.loja_config (
  id            int primary key default 1 check (id = 1),
  nome          text not null default 'Brechó da Natasha',
  slogan        text not null default 'Peças escolhidas a dedo, para durar.',
  sobre         text not null default 'Cada peça é selecionada pessoalmente, avaliada com cuidado e apresentada como merece. Trabalhamos com roupas e acessórios de qualidade, em ótimo estado, para quem valoriza estilo atemporal e consumo consciente.',
  whatsapp      text not null default '',
  instagram     text not null default '',
  email         text not null default '',
  cidade        text not null default '',
  envio_info    text not null default 'Enviamos para todo o Brasil. O valor do frete é combinado pelo WhatsApp depois do pedido.',
  retirada_info text not null default 'Retirada combinada pelo WhatsApp.',
  atualizado_em timestamptz not null default now()
);
insert into public.loja_config (id) values (1);

-- ---------------------------------------------------------------
-- Administradoras
-- ---------------------------------------------------------------
create table public.admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text,
  criado_em timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------
-- Categorias
-- ---------------------------------------------------------------
create table public.categorias (
  id    serial primary key,
  nome  text not null unique,
  slug  text not null unique,
  ordem int  not null default 0
);

insert into public.categorias (nome, slug, ordem) values
  ('Vestidos',          'vestidos',   1),
  ('Blusas e camisas',  'blusas',     2),
  ('Calças',            'calcas',     3),
  ('Saias',             'saias',      4),
  ('Shorts',            'shorts',     5),
  ('Macacões',          'macacoes',   6),
  ('Casacos e blazers', 'casacos',    7),
  ('Tricôs',            'tricos',     8),
  ('Bolsas',            'bolsas',     9),
  ('Calçados',          'calcados',  10),
  ('Acessórios',        'acessorios',11);

-- ---------------------------------------------------------------
-- Peças (cada peça é única)
-- ---------------------------------------------------------------
create sequence public.pecas_codigo_seq start 1;

create table public.pecas (
  id             uuid primary key default gen_random_uuid(),
  codigo         int  not null unique default nextval('public.pecas_codigo_seq'),
  titulo         text not null default '',
  descricao      text not null default '',
  categoria_id   int  references public.categorias(id) on delete set null,
  marca          text not null default '',
  tamanho        text not null default '',
  cor            text not null default '',
  estado         text not null default '',
  medidas        text not null default '',
  preco          numeric(10,2) check (preco is null or preco >= 0),
  preco_original numeric(10,2) check (preco_original is null or preco_original >= 0),
  status         text not null default 'rascunho'
                 check (status in ('rascunho','disponivel','reservado','vendido','oculto')),
  destaque       boolean not null default false,
  fotos          text[]  not null default '{}',
  origens        jsonb   not null default '[]'::jsonb,
  origem_texto   text,
  criado_em      timestamptz not null default now(),
  publicado_em   timestamptz,
  atualizado_em  timestamptz not null default now()
);
alter sequence public.pecas_codigo_seq owned by public.pecas.codigo;

create index pecas_status_publicado_idx on public.pecas (status, publicado_em desc);
create index pecas_categoria_idx on public.pecas (categoria_id);

create or replace function public.pecas_antes_de_salvar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  if new.status = 'disponivel' then
    if coalesce(trim(new.titulo), '') = '' or new.preco is null or cardinality(new.fotos) = 0 then
      raise exception 'Para publicar, a peça precisa de título, preço e pelo menos uma foto.'
        using errcode = 'P0001';
    end if;
    if new.publicado_em is null then
      new.publicado_em := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger pecas_antes_de_salvar
before insert or update on public.pecas
for each row execute function public.pecas_antes_de_salvar();

-- ---------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------
create sequence public.pedidos_numero_seq start 1001;

create table public.pedidos (
  id            uuid primary key default gen_random_uuid(),
  numero        int  not null unique default nextval('public.pedidos_numero_seq'),
  nome          text not null,
  telefone      text not null,
  email         text not null default '',
  entrega       text not null check (entrega in ('envio','retirada')),
  endereco      text not null default '',
  cep           text not null default '',
  observacoes   text not null default '',
  total         numeric(10,2) not null,
  status        text not null default 'novo'
                check (status in ('novo','pago','enviado','concluido','cancelado')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter sequence public.pedidos_numero_seq owned by public.pedidos.numero;

create table public.pedido_itens (
  id        bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  peca_id   uuid references public.pecas(id) on delete set null,
  titulo    text not null,
  preco     numeric(10,2) not null,
  foto      text
);
create index pedido_itens_pedido_idx on public.pedido_itens (pedido_id);
create index pedido_itens_peca_idx on public.pedido_itens (peca_id);
create index pedidos_criado_idx on public.pedidos (criado_em desc);

-- Quando o status do pedido muda, as peças acompanham:
-- cancelado -> peças voltam a ficar disponíveis; pago/enviado/concluído -> vendidas.
create or replace function public.pedidos_status_mudou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  if new.status is distinct from old.status then
    if new.status = 'cancelado' then
      update public.pecas p set status = 'disponivel'
       where p.status in ('reservado','vendido')
         and p.id in (select i.peca_id from public.pedido_itens i where i.pedido_id = new.id);
    elsif new.status in ('pago','enviado','concluido') then
      update public.pecas p set status = 'vendido'
       where p.status in ('reservado','disponivel')
         and p.id in (select i.peca_id from public.pedido_itens i where i.pedido_id = new.id);
    elsif new.status = 'novo' then
      update public.pecas p set status = 'reservado'
       where p.status in ('disponivel','vendido')
         and p.id in (select i.peca_id from public.pedido_itens i where i.pedido_id = new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger pedidos_status_mudou
before update on public.pedidos
for each row execute function public.pedidos_status_mudou();

-- Cria um pedido a partir da sacola. Reserva as peças de forma atômica.
create or replace function public.criar_pedido(
  p_nome text,
  p_telefone text,
  p_email text,
  p_entrega text,
  p_endereco text,
  p_cep text,
  p_observacoes text,
  p_pecas uuid[]
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_indisponiveis uuid[];
  v_total numeric(10,2);
  v_pedido public.pedidos;
begin
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_telefone), '') = '' then
    raise exception 'Informe seu nome e telefone.' using errcode = 'P0001';
  end if;
  if p_entrega is null or p_entrega not in ('envio','retirada') then
    raise exception 'Escolha envio ou retirada.' using errcode = 'P0001';
  end if;
  if p_entrega = 'envio' and coalesce(trim(p_endereco), '') = '' then
    raise exception 'Informe o endereço de entrega.' using errcode = 'P0001';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_pecas) as x where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Sua sacola está vazia.' using errcode = 'P0001';
  end if;
  if cardinality(v_ids) > 30 then
    raise exception 'Máximo de 30 peças por pedido.' using errcode = 'P0001';
  end if;

  -- trava as peças para evitar duas pessoas comprando a mesma
  perform 1 from public.pecas where id = any(v_ids) for update;

  select array_agg(x) into v_indisponiveis
    from unnest(v_ids) as x
   where not exists (select 1 from public.pecas p where p.id = x and p.status = 'disponivel');

  if v_indisponiveis is not null then
    return json_build_object('ok', false, 'indisponiveis', to_json(v_indisponiveis));
  end if;

  select sum(preco) into v_total from public.pecas where id = any(v_ids);

  insert into public.pedidos (nome, telefone, email, entrega, endereco, cep, observacoes, total)
  values (
    left(trim(p_nome), 120),
    left(trim(p_telefone), 40),
    left(coalesce(trim(p_email), ''), 160),
    p_entrega,
    left(coalesce(trim(p_endereco), ''), 500),
    left(coalesce(trim(p_cep), ''), 12),
    left(coalesce(trim(p_observacoes), ''), 1000),
    v_total
  )
  returning * into v_pedido;

  insert into public.pedido_itens (pedido_id, peca_id, titulo, preco, foto)
  select v_pedido.id, p.id, p.titulo, p.preco, p.fotos[1]
    from public.pecas p
   where p.id = any(v_ids);

  update public.pecas set status = 'reservado' where id = any(v_ids);

  return json_build_object('ok', true, 'numero', v_pedido.numero, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------
-- Segurança (RLS)
-- ---------------------------------------------------------------
alter table public.loja_config  enable row level security;
alter table public.admins       enable row level security;
alter table public.categorias   enable row level security;
alter table public.pecas        enable row level security;
alter table public.pedidos      enable row level security;
alter table public.pedido_itens enable row level security;

create policy "config: leitura publica" on public.loja_config
  for select using (true);
create policy "config: admin altera" on public.loja_config
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "admins: ver a si mesma" on public.admins
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "categorias: leitura publica" on public.categorias
  for select using (true);
create policy "categorias: admin insere" on public.categorias
  for insert to authenticated with check ((select public.is_admin()));
create policy "categorias: admin altera" on public.categorias
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "categorias: admin exclui" on public.categorias
  for delete to authenticated using ((select public.is_admin()));

create policy "pecas: leitura publica das publicadas" on public.pecas
  for select using (status in ('disponivel','reservado','vendido') or (select public.is_admin()));
create policy "pecas: admin insere" on public.pecas
  for insert to authenticated with check ((select public.is_admin()));
create policy "pecas: admin altera" on public.pecas
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pecas: admin exclui" on public.pecas
  for delete to authenticated using ((select public.is_admin()));

create policy "pedidos: admin le" on public.pedidos
  for select to authenticated using ((select public.is_admin()));
create policy "pedidos: admin altera" on public.pedidos
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pedidos: admin exclui" on public.pedidos
  for delete to authenticated using ((select public.is_admin()));

create policy "itens: admin le" on public.pedido_itens
  for select to authenticated using ((select public.is_admin()));

-- Permissões explícitas da API
grant select on public.loja_config, public.categorias, public.pecas to anon, authenticated;
grant update on public.loja_config to authenticated;
grant select on public.admins to authenticated;
grant insert, update, delete on public.categorias, public.pecas to authenticated;
grant select, update, delete on public.pedidos to authenticated;
grant select on public.pedido_itens to authenticated;
grant usage on sequence public.pecas_codigo_seq, public.categorias_id_seq to authenticated;

revoke execute on function public.criar_pedido(text,text,text,text,text,text,text,uuid[]) from public;
grant execute on function public.criar_pedido(text,text,text,text,text,text,text,uuid[]) to anon, authenticated;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
revoke execute on function public.pedidos_status_mudou() from public, anon, authenticated;
revoke execute on function public.pecas_antes_de_salvar() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Armazenamento de fotos
-- ---------------------------------------------------------------
-- "pecas": fotos publicadas da loja (leitura pública pela URL)
-- "originais": prints e fotos originais enviadas no cadastro (privado, só admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pecas', 'pecas', true, 10485760, array['image/webp','image/jpeg','image/png']),
  ('originais', 'originais', false, 15728640, array['image/webp','image/jpeg','image/png']);

create policy "fotos: admin ve" on storage.objects
  for select to authenticated
  using (bucket_id in ('pecas','originais') and (select public.is_admin()));
create policy "fotos: admin envia" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('pecas','originais') and (select public.is_admin()));
create policy "fotos: admin altera" on storage.objects
  for update to authenticated
  using (bucket_id in ('pecas','originais') and (select public.is_admin()));
create policy "fotos: admin exclui" on storage.objects
  for delete to authenticated
  using (bucket_id in ('pecas','originais') and (select public.is_admin()));
