-- Cobrança pelo site: PIX e cartão no Mercado Pago (Checkout Pro).
--
-- O site cria o pedido como antes (as peças ficam reservadas). Com a cobrança ligada,
-- a Edge Function "pagamento" abre o pagamento no Mercado Pago e confirma sozinha:
--   pagamento aprovado         -> pedido "pago" (as peças viram "vendidas")
--   reserva vencida, sem pagar -> pedido "cancelado" (as peças voltam para a vitrine)
-- Tudo aqui é aditivo: com a cobrança desligada, o site funciona como antes.

-- ---------------------------------------------------------------
-- Liga e desliga a cobrança pelo site (painel › Loja)
-- ---------------------------------------------------------------
alter table public.loja_config
  add column if not exists pagamento_online boolean not null default false;

-- ---------------------------------------------------------------
-- Situação do pagamento no pedido
--   aguardando  link de pagamento criado, nada pago ainda
--   pendente    pagamento iniciado e ainda não pago (ex.: PIX gerado)
--   em_analise  cartão em análise no Mercado Pago
--   aprovado    pago
--   recusado    a última tentativa não foi aprovada (dá para tentar de novo)
--   expirado    a reserva venceu sem pagamento
--   devolvido   o valor foi devolvido (estorno ou contestação)
--   divergente  o valor pago não bate com o pedido
-- ---------------------------------------------------------------
alter table public.pedidos
  add column if not exists pagamento_situacao text not null default ''
    check (pagamento_situacao in ('', 'aguardando', 'pendente', 'em_analise', 'aprovado',
                                  'recusado', 'expirado', 'devolvido', 'divergente')),
  add column if not exists pagamento_forma       text not null default '',
  add column if not exists pagamento_parcelas    integer,
  add column if not exists pagamento_id          text not null default '',
  add column if not exists pagamento_preferencia text not null default '',
  add column if not exists pagamento_link        text not null default '',
  add column if not exists pagamento_limite      timestamptz,
  add column if not exists pagamento_alerta      text not null default '',
  add column if not exists pago_em               timestamptz;

create index if not exists pedidos_pagamento_limite_idx
  on public.pedidos (pagamento_limite)
  where status = 'novo' and pagamento_limite is not null;

-- ---------------------------------------------------------------
-- registrar_pedido passa a devolver também o id do pedido,
-- que o site usa para abrir o pagamento. O resto não muda.
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
    'id', v_pedido.id,
    'numero', v_pedido.numero,
    'total', v_total,
    'frete', v_frete_valor
  );
end;
$$;

-- ---------------------------------------------------------------
-- Funções usadas só pela Edge Function "pagamento" (service_role)
-- ---------------------------------------------------------------

-- O pedido com as peças, para montar o pagamento e mostrar a situação.
create or replace function public.pagamento_pedido(p_pedido uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'id', p.id,
    'numero', p.numero,
    'status', p.status,
    'criado_em', p.criado_em,
    'nome', p.nome,
    'telefone', p.telefone,
    'email', p.email,
    'cpf', p.cpf,
    'entrega', p.entrega,
    'cep', p.cep,
    'end_rua', p.end_rua,
    'end_numero', p.end_numero,
    'total', p.total,
    'frete_valor', p.frete_valor,
    'frete_nome', p.frete_nome,
    'frete_empresa', p.frete_empresa,
    'frete_prazo', p.frete_prazo,
    'pagamento_situacao', p.pagamento_situacao,
    'pagamento_forma', p.pagamento_forma,
    'pagamento_parcelas', p.pagamento_parcelas,
    'pagamento_id', p.pagamento_id,
    'pagamento_link', p.pagamento_link,
    'pagamento_limite', p.pagamento_limite,
    'pago_em', p.pago_em,
    'online', coalesce((select c.pagamento_online from public.loja_config c where c.id = 1), false),
    'itens', coalesce((
      select json_agg(json_build_object(
               'titulo', i.titulo, 'preco', i.preco, 'foto', i.foto, 'codigo', pc.codigo
             ) order by i.id)
        from public.pedido_itens i
        left join public.pecas pc on pc.id = i.peca_id
       where i.pedido_id = p.id
    ), '[]'::json)
  )
  from public.pedidos p
  where p.id = p_pedido;
$$;

-- Guarda o link de pagamento criado no Mercado Pago e até quando a reserva vale.
create or replace function public.pagamento_salvar_link(
  p_pedido uuid,
  p_preferencia text,
  p_link text,
  p_limite timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pedidos
     set pagamento_preferencia = left(coalesce(p_preferencia, ''), 120),
         pagamento_link = left(coalesce(p_link, ''), 500),
         pagamento_limite = coalesce(pagamento_limite, p_limite),
         pagamento_situacao = case when pagamento_situacao = '' then 'aguardando' else pagamento_situacao end
   where id = p_pedido
     and status = 'novo'
     and pagamento_situacao in ('', 'aguardando', 'pendente', 'recusado');
  return found;
end;
$$;

-- Aplica ao pedido o que o Mercado Pago informou sobre um pagamento.
-- p_pagamento: { id, status_mp, situacao, valor, forma, parcelas, aprovado_em }
-- Pode ser chamada várias vezes com o mesmo pagamento (avisos repetidos): o resultado é o mesmo.
create or replace function public.aplicar_pagamento(p_pedido uuid, p_pagamento jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.pedidos;
  v_id text := left(coalesce(p_pagamento ->> 'id', ''), 40);
  v_sit text := coalesce(p_pagamento ->> 'situacao', '');
  v_status_mp text := coalesce(p_pagamento ->> 'status_mp', '');
  v_valor numeric := nullif(p_pagamento ->> 'valor', '')::numeric;
  v_forma text := left(coalesce(p_pagamento ->> 'forma', ''), 60);
  v_parcelas int := nullif(p_pagamento ->> 'parcelas', '')::int;
  v_aprovado timestamptz := coalesce(nullif(p_pagamento ->> 'aprovado_em', '')::timestamptz, now());
  v_esperado numeric;
  v_mesmo boolean;
  v_pecas_livres boolean;
begin
  if v_id = '' or v_sit not in ('aprovado', 'pendente', 'em_analise', 'recusado', 'devolvido') then
    return json_build_object('ok', false, 'erro', 'Pagamento sem identificação ou situação.');
  end if;

  select * into v from public.pedidos where id = p_pedido for update;
  if not found then
    return json_build_object('ok', false, 'erro', 'Pedido não encontrado.');
  end if;

  v_esperado := v.total + coalesce(v.frete_valor, 0);
  v_mesmo := v.pagamento_id = v_id;

  -- Pedido já pago por outro pagamento: só registra o alerta se entrar um segundo pagamento aprovado.
  if v.pagamento_situacao in ('aprovado', 'divergente') and v.pagamento_id <> '' and not v_mesmo then
    if v_sit = 'aprovado' and position(v_id in v.pagamento_alerta) = 0 then
      update public.pedidos
         set pagamento_alerta = trim(both ' ' from v.pagamento_alerta || ' ' || format(
               'Entrou um segundo pagamento aprovado (Mercado Pago nº %s) para este pedido. Devolva um deles pelo Mercado Pago.', v_id))
       where id = v.id;
      return json_build_object('ok', true, 'mudou', true, 'situacao', v.pagamento_situacao);
    end if;
    return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
  end if;

  if v_sit = 'aprovado' then
    if v_mesmo and v.pagamento_situacao in ('aprovado', 'divergente') then
      return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
    end if;

    if v_valor is null or v_valor + 0.01 < v_esperado then
      update public.pedidos
         set pagamento_situacao = 'divergente',
             pagamento_id = v_id,
             pagamento_forma = v_forma,
             pagamento_parcelas = v_parcelas,
             pagamento_alerta = format(
               'O Mercado Pago aprovou R$ %s, mas o pedido é de R$ %s. Confira no Mercado Pago antes de enviar.',
               replace(to_char(coalesce(v_valor, 0), 'FM9999990.00'), '.', ','),
               replace(to_char(v_esperado, 'FM9999990.00'), '.', ','))
       where id = v.id;
      return json_build_object('ok', true, 'mudou', true, 'situacao', 'divergente');
    end if;

    if v.status = 'cancelado' then
      -- A reserva tinha vencido. Volta a valer só se todas as peças ainda estiverem livres.
      select not exists (
               select 1
                 from public.pedido_itens i
                 left join public.pecas pc on pc.id = i.peca_id
                where i.pedido_id = v.id
                  and (pc.id is null or pc.status <> 'disponivel')
             ) into v_pecas_livres;
      if v_pecas_livres then
        update public.pedidos
           set status = 'pago',
               pagamento_situacao = 'aprovado',
               pagamento_id = v_id,
               pagamento_forma = v_forma,
               pagamento_parcelas = v_parcelas,
               pago_em = v_aprovado,
               pagamento_alerta = 'O pagamento foi aprovado depois que a reserva tinha vencido. As peças ainda estavam livres e o pedido voltou como pago.'
         where id = v.id;
        return json_build_object('ok', true, 'mudou', true, 'situacao', 'aprovado');
      end if;
      update public.pedidos
         set pagamento_situacao = 'aprovado',
             pagamento_id = v_id,
             pagamento_forma = v_forma,
             pagamento_parcelas = v_parcelas,
             pago_em = v_aprovado,
             pagamento_alerta = 'O pagamento foi aprovado depois que a reserva tinha vencido, e alguma peça já tinha ido para outra pessoa. Devolva o valor pelo Mercado Pago ou combine com a cliente.'
       where id = v.id;
      return json_build_object('ok', true, 'mudou', true, 'situacao', 'aprovado');
    end if;

    update public.pedidos
       set status = case when status = 'novo' then 'pago' else status end,
           pagamento_situacao = 'aprovado',
           pagamento_id = v_id,
           pagamento_forma = v_forma,
           pagamento_parcelas = v_parcelas,
           pago_em = v_aprovado
     where id = v.id;
    return json_build_object('ok', true, 'mudou', true, 'situacao', 'aprovado');
  end if;

  if v_sit = 'devolvido' then
    if v_mesmo or v.pagamento_id = '' then
      if v.pagamento_situacao = 'devolvido' then
        return json_build_object('ok', true, 'mudou', false, 'situacao', 'devolvido');
      end if;
      update public.pedidos
         set pagamento_situacao = 'devolvido',
             pagamento_id = v_id,
             pagamento_alerta = case
               when v.status in ('pago', 'enviado', 'concluido')
                 then 'O valor foi devolvido à cliente no Mercado Pago (estorno ou contestação). Se o pedido não vai seguir, cancele-o aqui.'
               else '' end
       where id = v.id;
      return json_build_object('ok', true, 'mudou', true, 'situacao', 'devolvido');
    end if;
    return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
  end if;

  -- Reclamação aberta depois de pago: avisa no painel.
  if v_status_mp = 'in_mediation' and v.pagamento_situacao = 'aprovado' then
    if position('reclamação' in v.pagamento_alerta) = 0 then
      update public.pedidos
         set pagamento_alerta = trim(both ' ' from v.pagamento_alerta || ' A cliente abriu uma reclamação no Mercado Pago. Veja os detalhes lá antes de enviar.')
       where id = v.id;
      return json_build_object('ok', true, 'mudou', true, 'situacao', v.pagamento_situacao);
    end if;
    return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
  end if;

  -- pendente, em análise ou recusado: só vale enquanto o pedido espera pagamento.
  if v.status <> 'novo' or v.pagamento_situacao in ('aprovado', 'divergente', 'expirado', 'devolvido') then
    return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
  end if;
  -- Uma recusa de outra tentativa não apaga um pagamento que ainda está andando.
  if v_sit = 'recusado' and v.pagamento_situacao in ('pendente', 'em_analise') and not v_mesmo then
    return json_build_object('ok', true, 'mudou', false, 'situacao', v.pagamento_situacao);
  end if;
  if v_mesmo and v.pagamento_situacao = v_sit then
    return json_build_object('ok', true, 'mudou', false, 'situacao', v_sit);
  end if;

  update public.pedidos
     set pagamento_situacao = v_sit,
         pagamento_id = v_id,
         pagamento_forma = v_forma,
         pagamento_parcelas = v_parcelas
   where id = v.id;
  return json_build_object('ok', true, 'mudou', true, 'situacao', v_sit);
end;
$$;

-- Pedidos com a reserva vencida e sem pagamento confirmado (no máximo 20 por vez).
-- Cartão em análise espera até 3 dias antes de ser conferido de novo.
create or replace function public.pagamento_vencidos(p_folga_minutos int default 45)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(x.id), '[]'::json)
    from (
      select id
        from public.pedidos
       where status = 'novo'
         and pagamento_limite is not null
         and (
           (pagamento_situacao in ('aguardando', 'pendente', 'recusado')
             and pagamento_limite < now() - make_interval(mins => greatest(p_folga_minutos, 0)))
           or (pagamento_situacao = 'em_analise' and pagamento_limite < now() - interval '3 days')
         )
       order by pagamento_limite
       limit 20
    ) x;
$$;

-- Cancela o pedido cuja reserva venceu sem pagamento. As peças voltam para a vitrine
-- (o gatilho pedidos_status_mudou cuida disso).
create or replace function public.expirar_pedido(p_pedido uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pedidos
     set status = 'cancelado',
         pagamento_situacao = 'expirado'
   where id = p_pedido
     and status = 'novo'
     and pagamento_limite is not null
     and pagamento_limite < now()
     and pagamento_situacao in ('aguardando', 'pendente', 'recusado', 'em_analise');
  return found;
end;
$$;

revoke execute on function public.pagamento_pedido(uuid) from public, anon, authenticated;
revoke execute on function public.pagamento_salvar_link(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.aplicar_pagamento(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.pagamento_vencidos(int) from public, anon, authenticated;
revoke execute on function public.expirar_pedido(uuid) from public, anon, authenticated;
grant execute on function public.pagamento_pedido(uuid) to service_role;
grant execute on function public.pagamento_salvar_link(uuid, text, text, timestamptz) to service_role;
grant execute on function public.aplicar_pagamento(uuid, jsonb) to service_role;
grant execute on function public.pagamento_vencidos(int) to service_role;
grant execute on function public.expirar_pedido(uuid) to service_role;

-- ---------------------------------------------------------------
-- A cada 10 minutos, libera as reservas vencidas (Edge Function "pagamento").
-- Sem o Mercado Pago conectado, a função não faz nada.
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'liberar-reservas-vencidas',
      '*/10 * * * *',
      $cron$
        select net.http_post(
          url := 'https://vmhbvlyxpxzqclghxvtj.supabase.co/functions/v1/pagamento',
          body := '{"acao": "expirar"}'::jsonb,
          timeout_milliseconds := 10000
        );
      $cron$
    );
  end if;
end;
$$;
