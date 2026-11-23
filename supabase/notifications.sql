-- =====================================================================
--  Déclencheur des notifications push (à coller APRÈS schema.sql).
--  Dès qu'un devoir est ajouté, la base appelle la fonction « notifier »
--  de ce projet Supabase, qui envoie les notifications aux abonnés.
--  (L'adresse ci-dessous est celle du projet : elle n'est pas secrète.)
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create or replace function public._declencher_notifications() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Appel en arrière-plan (n'empêche jamais l'ajout du devoir, même si l'envoi échoue)
  perform net.http_post(
    url := 'https://wfnddfzbsgkidvztukhk.supabase.co/functions/v1/notifier',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists notifier_nouveau_devoir on public.livrables;
create trigger notifier_nouveau_devoir
  after insert on public.livrables
  for each row execute function public._declencher_notifications();
