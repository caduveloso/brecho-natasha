-- Frete calculado no checkout e etiquetas de envio (Melhor Envio).
-- Tudo aqui é aditivo: o site antigo continua funcionando com criar_pedido.

-- ---------------------------------------------------------------
-- Peso da peça (opcional; sem ele vale o padrão da categoria)
-- ---------------------------------------------------------------
alter table public.pecas
  add column if not exists peso_g integer
  check (peso_g is null or peso_g between 10 and 30000);

-- ---------------------------------------------------------------
-- Dados de quem envia e preferências de frete (só administradoras)
-- ---------------------------------------------------------------
create table if not exists public.envio_config (
  id              int primary key default 1 check (id = 1),
  nome            text not null default '',
  documento       text not null default '',   -- CPF ou CNPJ de quem envia
  telefone        text not null default '',
  email           text not null default '',
  cep             text not null default '',
  rua             text not null default '',
  numero          text not null default '',
  complemento     text not null default '',
  bairro          text not null default '',
  cidade          text not null default '',
  uf              text not null default '',
  -- transportadoras oferecidas no checkout (nome da empresa no Melhor Envio)
  transportadoras text[] not null default '{Correios,Jadlog,Loggi}',
  -- agência de postagem por transportadora que exige uma (ex.: {"2": 123} para Jadlog)
  agencias        jsonb not null default '{}'::jsonb,
  declarar_valor  boolean not null default true,  -- seguro pelo valor das peças
  dias_postagem   int not null default 2 check (dias_postagem between 0 and 15),
  atualizado_em   timestamptz not null default now()
);
insert into public.envio_config (id) values (1) on conflict do nothing;

alter table public.envio_config enable row level security;
create policy "envio: admin le" on public.envio_config
  for select to authenticated using ((select public.is_admin()));
create policy "envio: admin altera" on public.envio_config
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update on public.envio_config to authenticated;

-- ---------------------------------------------------------------
-- Pedidos: endereço em partes, CPF, frete escolhido e etiqueta
-- ---------------------------------------------------------------
alter table public.pedidos
  add column if not exists cpf               text not null default '',
  add column if not exists end_rua           text not null default '',
  add column if not exists end_numero        text not null default '',
  add column if not exists end_complemento   text not null default '',
  add column if not exists end_bairro        text not null default '',
  add column if not exists end_cidade        text not null default '',
  add column if not exists end_uf            text not null default '',
  add column if not exists frete_servico     integer,
  add column if not exists frete_nome        text not null default '',
  add column if not exists frete_empresa     text not null default '',
  add column if not exists frete_valor       numeric(10,2),
  add column if not exists frete_prazo       integer,
  add column if not exists etiqueta_ids      text[] not null default '{}',
  add column if not exists etiqueta_status   text not null default ''
    check (etiqueta_status in ('', 'carrinho', 'paga', 'gerada', 'cancelada')),
  add column if not exists etiqueta_url      text not null default '',
  add column if not exists etiqueta_rastreio text not null default '',
  add column if not exists etiqueta_valor    numeric(10,2),
  add column if not exists etiqueta_em       timestamptz;

-- ---------------------------------------------------------------
-- Registro do pedido (uso interno) e as portas de entrada:
--   criar_pedido            -> versão antiga do site (continua valendo)
--   fazer_pedido            -> site novo: retirada ou frete a combinar
--   fazer_pedido_com_frete  -> só a Edge Function "frete", que recalcula o valor
-- ---------------------------------------------------------------
create or replace function public.registrar_pedido(
  p_nome text,
  p_telefone text,
  p_email text,
  p_entrega text,
  p_endereco text,
  p_cep text,
  p_observacoes text,
  p_pecas uuid[],
  p_cpf text,
  p_end jsonb,
  p_frete jsonb
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
  v_end jsonb := coalesce(p_end, '{}'::jsonb);
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_frete_valor numeric(10,2);
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
  if v_cpf <> '' and length(v_cpf) <> 11 then
    raise exception 'CPF inválido.' using errcode = 'P0001';
  end if;
  if p_frete is not null then
    v_frete_valor := (p_frete ->> 'valor')::numeric;
    if p_entrega <> 'envio' or v_frete_valor is null or v_frete_valor < 0
       or (p_frete ->> 'servico') is null or v_cpf = ''
       or coalesce(v_end ->> 'rua', '') = '' or coalesce(v_end ->> 'numero', '') = ''
       or coalesce(v_end ->> 'cidade', '') = '' or coalesce(v_end ->> 'uf', '') = '' then
      raise exception 'Dados de envio incompletos.' using errcode = 'P0001';
    end if;
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

  insert into public.pedidos (
    nome, telefone, email, entrega, endereco, cep, observacoes, total, cpf,
    end_rua, end_numero, end_complemento, end_bairro, end_cidade, end_uf,
    frete_servico, frete_nome, frete_empresa, frete_valor, frete_prazo
  )
  values (
    left(trim(p_nome), 120),
    left(trim(p_telefone), 40),
    left(coalesce(trim(p_email), ''), 160),
    p_entrega,
    left(coalesce(trim(p_endereco), ''), 500),
    left(coalesce(trim(p_cep), ''), 12),
    left(coalesce(trim(p_observacoes), ''), 1000),
    v_total,
    case when p_entrega = 'envio' then v_cpf else '' end,
    left(coalesce(trim(v_end ->> 'rua'), ''), 160),
    left(coalesce(trim(v_end ->> 'numero'), ''), 20),
    left(coalesce(trim(v_end ->> 'complemento'), ''), 80),
    left(coalesce(trim(v_end ->> 'bairro'), ''), 80),
    left(coalesce(trim(v_end ->> 'cidade'), ''), 80),
    upper(left(coalesce(trim(v_end ->> 'uf'), ''), 2)),
    (p_frete ->> 'servico')::int,
    left(coalesce(p_frete ->> 'nome', ''), 80),
    left(coalesce(p_frete ->> 'empresa', ''), 80),
    v_frete_valor,
    (p_frete ->> 'prazo')::int
  )
  returning * into v_pedido;

  insert into public.pedido_itens (pedido_id, peca_id, titulo, preco, foto)
  select v_pedido.id, p.id, p.titulo, p.preco, p.fotos[1]
    from public.pecas p
   where p.id = any(v_ids);

  update public.pecas set status = 'reservado' where id = any(v_ids);

  return json_build_object(
    'ok', true,
    'numero', v_pedido.numero,
    'total', v_total,
    'frete', v_frete_valor
  );
end;
$$;

-- Versão antiga (8 parâmetros): mesma assinatura, agora delega ao registro novo.
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
language sql
security definer
set search_path = ''
as $$
  select public.registrar_pedido(
    p_nome, p_telefone, p_email, p_entrega, p_endereco, p_cep, p_observacoes, p_pecas,
    '', null, null
  );
$$;

create or replace function public.fazer_pedido(
  p_nome text,
  p_telefone text,
  p_email text,
  p_entrega text,
  p_endereco text,
  p_cep text,
  p_observacoes text,
  p_pecas uuid[],
  p_cpf text,
  p_end jsonb
)
returns json
language sql
security definer
set search_path = ''
as $$
  select public.registrar_pedido(
    p_nome, p_telefone, p_email, p_entrega, p_endereco, p_cep, p_observacoes, p_pecas,
    p_cpf, p_end, null
  );
$$;

create or replace function public.fazer_pedido_com_frete(
  p_nome text,
  p_telefone text,
  p_email text,
  p_entrega text,
  p_endereco text,
  p_cep text,
  p_observacoes text,
  p_pecas uuid[],
  p_cpf text,
  p_end jsonb,
  p_frete jsonb
)
returns json
language sql
security definer
set search_path = ''
as $$
  select public.registrar_pedido(
    p_nome, p_telefone, p_email, p_entrega, p_endereco, p_cep, p_observacoes, p_pecas,
    p_cpf, p_end, p_frete
  );
$$;

revoke execute on function public.registrar_pedido(text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.fazer_pedido_com_frete(text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.fazer_pedido_com_frete(text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb)
  to service_role;
revoke execute on function public.fazer_pedido(text,text,text,text,text,text,text,uuid[],text,jsonb)
  from public;
grant execute on function public.fazer_pedido(text,text,text,text,text,text,text,uuid[],text,jsonb)
  to anon, authenticated;
