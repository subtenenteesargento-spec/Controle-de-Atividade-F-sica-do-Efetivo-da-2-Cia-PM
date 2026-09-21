-- CONTROLE DE ATIVIDADE FÍSICA DO EFETIVO
-- Trava definitiva: registro ASSINADO não pode ser alterado nem excluído.

create or replace function public.bloquear_alteracao_atividade_assinada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'ASSINADO' then
    raise exception 'REGISTRO ASSINADO E BLOQUEADO: não é permitido alterar ou excluir uma atividade após a assinatura.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_bloquear_atividade_assinada on public.activities;

create trigger trg_bloquear_atividade_assinada
before update or delete on public.activities
for each row
execute function public.bloquear_alteracao_atividade_assinada();
