-- =====================================================================
--  Base de données "Livrables MDC" — à coller UNE FOIS dans Supabase
--  (menu SQL Editor > New query > coller > Run). Voir README, étape 1.
--
--  Principe de sécurité :
--   * Tout le monde peut LIRE les livrables et l'historique (avec la clé "anon").
--   * Personne ne peut ÉCRIRE directement dans les tables.
--   * Les écritures passent par des fonctions qui vérifient le code promo
--     côté serveur. Le code est stocké haché dans une table illisible.
--   * Le code promo n'est PAS écrit dans ce fichier (il est public sur GitHub) :
--     on le définit à part (README, étape 1.4).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Table des livrables ----------
create table if not exists public.livrables (
  id               uuid primary key default gen_random_uuid(),
  matiere          text not null check (char_length(matiere) between 1 and 120),
  titre            text not null check (char_length(titre) between 1 and 200),
  description      text not null default '' check (char_length(description) <= 5000),
  date_limite      timestamptz not null,
  groupe           text not null default 'G1' check (char_length(groupe) <= 20),
  type             text not null check (type in ('devoir','dossier','oral','projet','etude','examen','rapport','autre')),
  mode_rendu       text not null default '' check (char_length(mode_rendu) <= 60),
  lien             text not null default '' check (char_length(lien) <= 500),
  membres          text not null default '' check (char_length(membres) <= 1000),
  date_soutenance  timestamptz,
  cree_le          timestamptz not null default now(),
  modifie_le       timestamptz not null default now(),
  supprime_le      timestamptz           -- rempli = dans la corbeille
);

-- Prénom de la personne qui a ajouté le devoir (« Ajouté par Ema »)
alter table public.livrables add column if not exists cree_par text not null default '';

-- (re)pose la liste des types autorisés, même si la table existait déjà
alter table public.livrables drop constraint if exists livrables_type_check;
alter table public.livrables add constraint livrables_type_check
  check (type in ('devoir','dossier','oral','projet','etude','examen','rapport','autre'));

-- ---------- Historique minimal ----------
create table if not exists public.historique (
  id           bigint generated always as identity primary key,
  livrable_id  uuid,
  titre        text not null default '',
  prenom       text not null,
  action       text not null,            -- ajout | modification | suppression | restauration
  le           timestamptz not null default now()
);

-- ---------- Configuration privée (code promo haché) ----------
create table if not exists public.config_privee (
  id         int primary key default 1 check (id = 1),
  code_hash  text not null
);

-- ---------- Droits ----------
alter table public.livrables     enable row level security;
alter table public.historique    enable row level security;
alter table public.config_privee enable row level security;

drop policy if exists "lecture publique" on public.livrables;
create policy "lecture publique" on public.livrables for select to anon, authenticated using (true);
drop policy if exists "lecture publique" on public.historique;
create policy "lecture publique" on public.historique for select to anon, authenticated using (true);
-- config_privee : aucune règle => illisible depuis le site.

revoke insert, update, delete on public.livrables, public.historique from anon, authenticated;
revoke all on public.config_privee from anon, authenticated;

-- ---------- Fonctions ----------
-- Vérification interne du code (non appelable depuis le site)
create or replace function public._code_ok(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.config_privee
                 where code_hash = extensions.crypt(coalesce(p_code, ''), code_hash));
$$;
revoke execute on function public._code_ok(text) from public, anon, authenticated;

-- Contrôle commun : code + prénom. La petite pause freine les essais au hasard.
create or replace function public._controle(p_code text, p_prenom text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._code_ok(p_code) then
    perform pg_sleep(1);
    raise exception 'Code promo incorrect' using errcode = '28000';
  end if;
  if char_length(trim(coalesce(p_prenom, ''))) not between 1 and 40 then
    raise exception 'Prénom requis (40 caractères max)';
  end if;
end $$;
revoke execute on function public._controle(text, text) from public, anon, authenticated;

-- Le site appelle cette fonction pour savoir si le code saisi est bon
create or replace function public.verifier_code(p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public._code_ok(p_code) then return true; end if;
  perform pg_sleep(1);
  return false;
end $$;

-- Ajouter (p_id null) ou modifier un livrable
create or replace function public.enregistrer_livrable(p_code text, p_prenom text, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform public._controle(p_code, p_prenom);
  if p_id is null then
    insert into public.livrables (matiere, titre, description, date_limite, groupe, type,
                                  mode_rendu, lien, membres, date_soutenance, cree_par)
    values (p_data->>'matiere', p_data->>'titre', coalesce(p_data->>'description', ''),
            (p_data->>'date_limite')::timestamptz, coalesce(p_data->>'groupe', 'G1'), p_data->>'type',
            coalesce(p_data->>'mode_rendu', ''), coalesce(p_data->>'lien', ''),
            coalesce(p_data->>'membres', ''), nullif(p_data->>'date_soutenance', '')::timestamptz, trim(p_prenom))
    returning id into v_id;
    insert into public.historique (livrable_id, titre, prenom, action)
    values (v_id, p_data->>'titre', trim(p_prenom), 'ajout');
  else
    update public.livrables set
      matiere = p_data->>'matiere', titre = p_data->>'titre',
      description = coalesce(p_data->>'description', ''),
      date_limite = (p_data->>'date_limite')::timestamptz,
      groupe = coalesce(p_data->>'groupe', 'G1'), type = p_data->>'type',
      mode_rendu = coalesce(p_data->>'mode_rendu', ''), lien = coalesce(p_data->>'lien', ''),
      membres = coalesce(p_data->>'membres', ''),
      date_soutenance = nullif(p_data->>'date_soutenance', '')::timestamptz,
      modifie_le = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Livrable introuvable'; end if;
    insert into public.historique (livrable_id, titre, prenom, action)
    values (v_id, p_data->>'titre', trim(p_prenom), 'modification');
  end if;
  return v_id;
end $$;

-- Mettre à la corbeille (p_restaurer = false) ou restaurer (p_restaurer = true)
create or replace function public.corbeille_livrable(p_code text, p_prenom text, p_id uuid, p_restaurer boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_titre text;
begin
  perform public._controle(p_code, p_prenom);
  update public.livrables
     set supprime_le = case when p_restaurer then null else now() end, modifie_le = now()
   where id = p_id returning titre into v_titre;
  if v_titre is null then raise exception 'Livrable introuvable'; end if;
  insert into public.historique (livrable_id, titre, prenom, action)
  values (p_id, v_titre, trim(p_prenom), case when p_restaurer then 'restauration' else 'suppression' end);
end $$;

grant execute on function public.verifier_code(text) to anon, authenticated;
grant execute on function public.enregistrer_livrable(text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.corbeille_livrable(text, text, uuid, boolean) to anon, authenticated;

-- Devoirs ajoutés avant l'existence de « cree_par » : on retrouve le prénom dans l'historique
update public.livrables l set cree_par = h.prenom
from public.historique h
where h.livrable_id = l.id and h.action = 'ajout' and l.cree_par = '';

-- ---------- Compléments à la consigne (commentaires) ----------
-- livrable_ref = id du devoir, ou « pdf:… » pour un CC / rendu du planning officiel.
create table if not exists public.commentaires (
  id            uuid primary key default gen_random_uuid(),
  livrable_ref  text not null check (char_length(livrable_ref) between 1 and 120),
  prenom        text not null,
  texte         text not null check (char_length(texte) between 1 and 1000),
  le            timestamptz not null default now()
);
alter table public.commentaires enable row level security;
drop policy if exists "lecture publique" on public.commentaires;
create policy "lecture publique" on public.commentaires for select to anon, authenticated using (true);
revoke insert, update, delete on public.commentaires from anon, authenticated;

create or replace function public.ajouter_commentaire(p_code text, p_prenom text, p_livrable text, p_texte text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._controle(p_code, p_prenom);
  if (select count(*) from public.commentaires where livrable_ref = p_livrable) >= 100 then
    raise exception '100 compléments maximum par devoir';
  end if;
  insert into public.commentaires (livrable_ref, prenom, texte) values (p_livrable, trim(p_prenom), trim(p_texte));
end $$;

-- On ne peut supprimer que ses propres compléments
create or replace function public.supprimer_commentaire(p_code text, p_prenom text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._controle(p_code, p_prenom);
  if exists (select 1 from public.commentaires where id = p_id and lower(prenom) <> lower(trim(p_prenom))) then
    raise exception 'Tu ne peux supprimer que tes propres compléments.';
  end if;
  delete from public.commentaires where id = p_id;
end $$;

grant execute on function public.ajouter_commentaire(text, text, text, text) to anon, authenticated;
grant execute on function public.supprimer_commentaire(text, text, uuid) to anon, authenticated;

-- ---------- Pièces jointes ----------
-- Les fichiers sont stockés dans la base (en base64), 5 Mo max chacun, 10 max par livrable.
-- Lecture libre (comme les livrables), ajout/suppression uniquement avec le code.
create table if not exists public.pieces_jointes (
  id           uuid primary key default gen_random_uuid(),
  livrable_id  uuid not null references public.livrables(id) on delete cascade,
  nom          text not null check (char_length(nom) between 1 and 200),
  type_mime    text not null default 'application/octet-stream' check (char_length(type_mime) <= 120),
  taille       int  not null,
  contenu      text not null,
  cree_le      timestamptz not null default now()
);
alter table public.pieces_jointes enable row level security;
drop policy if exists "lecture publique" on public.pieces_jointes;
create policy "lecture publique" on public.pieces_jointes for select to anon, authenticated using (true);
revoke insert, update, delete on public.pieces_jointes from anon, authenticated;

-- (les fonctions qui touchent aux équipes sont plus bas, après la création des tables d'équipes)

-- ---------- Travail de groupe ----------
-- Un livrable peut avoir plusieurs groupes (table "equipes"). Un prénom n'est que dans un groupe par livrable.
-- Chaque groupe peut déposer ses fichiers (pieces_jointes.equipe_id).
create table if not exists public.equipes (
  id           uuid primary key default gen_random_uuid(),
  livrable_id  uuid not null references public.livrables(id) on delete cascade,
  nom          text not null check (char_length(nom) between 1 and 60),
  membres      text[] not null default '{}',
  cree_le      timestamptz not null default now()
);
-- Fichiers d'équipe : une pièce jointe peut appartenir à une équipe (sinon : au livrable)
alter table public.pieces_jointes add column if not exists equipe_id uuid references public.equipes(id) on delete cascade;

-- Version simplifiée : plus de tâches ni de discussion (supprimées si une ancienne version les avait créées)
drop table if exists public.taches, public.messages;
drop function if exists public.ajouter_tache(text, text, uuid, text, text);
drop function if exists public.maj_tache(text, text, uuid, boolean, text);
drop function if exists public.supprimer_tache(text, text, uuid);
drop function if exists public.envoyer_message(text, text, uuid, text);
drop function if exists public.supprimer_message(text, text, uuid);
drop function if exists public.supprimer_equipe(text, text, uuid);

alter table public.equipes enable row level security;
drop policy if exists "lecture publique" on public.equipes;
create policy "lecture publique" on public.equipes for select to anon, authenticated using (true);
revoke insert, update, delete on public.equipes from anon, authenticated;

-- Le prénom fait-il partie de l'équipe ? (comparaison sans tenir compte des majuscules)
create or replace function public._membre(p_equipe uuid, p_prenom text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipes e, unnest(e.membres) m
                 where e.id = p_equipe and lower(m) = lower(trim(p_prenom)));
$$;
revoke execute on function public._membre(uuid, text) from public, anon, authenticated;

create or replace function public._exiger_membre(p_equipe uuid, p_prenom text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.equipes where id = p_equipe) then raise exception 'Groupe introuvable'; end if;
  if not public._membre(p_equipe, p_prenom) then raise exception 'Rejoins le groupe pour participer.'; end if;
end $$;
revoke execute on function public._exiger_membre(uuid, text) from public, anon, authenticated;

-- Retire un prénom de toutes les équipes d'un livrable
create or replace function public._retirer_partout(p_livrable uuid, p_prenom text) returns void
language sql security definer set search_path = public as $$
  update public.equipes set membres = array(select m from unnest(membres) m where lower(m) <> lower(trim(p_prenom)))
  where livrable_id = p_livrable;
  delete from public.equipes where livrable_id = p_livrable and cardinality(membres) = 0;
$$;
revoke execute on function public._retirer_partout(uuid, text) from public, anon, authenticated;

-- Créer une équipe (le créateur en fait partie automatiquement)
create or replace function public.creer_equipe(p_code text, p_prenom text, p_livrable uuid, p_nom text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform public._controle(p_code, p_prenom);
  if not exists (select 1 from public.livrables where id = p_livrable and supprime_le is null) then
    raise exception 'Livrable introuvable';
  end if;
  if (select count(*) from public.equipes where livrable_id = p_livrable) >= 20 then
    raise exception '20 groupes maximum par livrable';
  end if;
  perform public._retirer_partout(p_livrable, p_prenom);
  insert into public.equipes (livrable_id, nom, membres) values (p_livrable, trim(p_nom), array[trim(p_prenom)])
  returning id into v_id;
  return v_id;
end $$;

-- Rejoindre une équipe (p_membre null), ou y ajouter un camarade (il faut alors en faire partie)
create or replace function public.rejoindre_equipe(p_code text, p_prenom text, p_equipe uuid, p_membre text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_livrable uuid; v_qui text := trim(coalesce(nullif(p_membre, ''), p_prenom));
begin
  perform public._controle(p_code, p_prenom);
  select livrable_id into v_livrable from public.equipes where id = p_equipe;
  if v_livrable is null then raise exception 'Groupe introuvable'; end if;
  if lower(v_qui) <> lower(trim(p_prenom)) then perform public._exiger_membre(p_equipe, p_prenom); end if;
  if char_length(v_qui) not between 1 and 40 then raise exception 'Prénom invalide'; end if;
  perform public._retirer_partout(v_livrable, v_qui);
  if (select cardinality(membres) from public.equipes where id = p_equipe) >= 12 then
    raise exception '12 membres maximum par groupe';
  end if;
  update public.equipes set membres = array_append(membres, v_qui) where id = p_equipe;
end $$;

-- Quitter un groupe (p_membre null), ou en retirer un camarade (il faut en faire partie).
-- Un groupe qui n'a plus personne est supprimé (avec ses fichiers).
create or replace function public.quitter_equipe(p_code text, p_prenom text, p_equipe uuid, p_membre text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_qui text := trim(coalesce(nullif(p_membre, ''), p_prenom));
begin
  perform public._controle(p_code, p_prenom);
  if lower(v_qui) <> lower(trim(p_prenom)) then perform public._exiger_membre(p_equipe, p_prenom); end if;
  update public.equipes set membres = array(select m from unnest(membres) m where lower(m) <> lower(v_qui))
  where id = p_equipe;
  delete from public.equipes where id = p_equipe and cardinality(membres) = 0;
end $$;

grant execute on function public.creer_equipe(text, text, uuid, text) to anon, authenticated;
grant execute on function public.rejoindre_equipe(text, text, uuid, text) to anon, authenticated;
grant execute on function public.quitter_equipe(text, text, uuid, text) to anon, authenticated;

-- ---------- Pièces jointes : ajout (au livrable, ou à une équipe si p_equipe est donné) ----------
drop function if exists public.ajouter_piece_jointe(text, text, uuid, text, text, text);
create or replace function public.ajouter_piece_jointe(p_code text, p_prenom text, p_livrable uuid,
                                                      p_nom text, p_type text, p_base64 text, p_equipe uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_taille int; v_titre text;
begin
  perform public._controle(p_code, p_prenom);
  select titre into v_titre from public.livrables where id = p_livrable;
  if v_titre is null then raise exception 'Livrable introuvable'; end if;
  if p_equipe is not null then
    perform public._exiger_membre(p_equipe, p_prenom);
    if not exists (select 1 from public.equipes where id = p_equipe and livrable_id = p_livrable) then
      raise exception 'Groupe introuvable';
    end if;
  end if;
  v_taille := octet_length(decode(p_base64, 'base64'));
  if v_taille > 5 * 1024 * 1024 then raise exception 'Fichier trop lourd (5 Mo maximum)'; end if;
  if (select count(*) from public.pieces_jointes where livrable_id = p_livrable
      and equipe_id is not distinct from p_equipe) >= 20 then
    raise exception '20 fichiers maximum';
  end if;
  insert into public.pieces_jointes (livrable_id, equipe_id, nom, type_mime, taille, contenu)
  values (p_livrable, p_equipe, p_nom, coalesce(nullif(p_type, ''), 'application/octet-stream'), v_taille, p_base64)
  returning id into v_id;
  insert into public.historique (livrable_id, titre, prenom, action)
  values (p_livrable, v_titre || ' – ' || p_nom, trim(p_prenom), 'ajout pièce jointe');
  return v_id;
end $$;

create or replace function public.supprimer_piece_jointe(p_code text, p_prenom text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_livrable uuid; v_nom text;
begin
  perform public._controle(p_code, p_prenom);
  delete from public.pieces_jointes where id = p_id returning livrable_id, nom into v_livrable, v_nom;
  if v_nom is null then raise exception 'Pièce jointe introuvable'; end if;
  insert into public.historique (livrable_id, titre, prenom, action)
  values (v_livrable, v_nom, trim(p_prenom), 'suppression pièce jointe');
end $$;

grant execute on function public.ajouter_piece_jointe(text, text, uuid, text, text, text, uuid) to anon, authenticated;
grant execute on function public.supprimer_piece_jointe(text, text, uuid) to anon, authenticated;

-- ---------- Temps réel ----------
-- (n'ajoute que les tables pas encore inscrites : on peut relancer ce fichier sans erreur)
do $$
declare t text;
begin
  foreach t in array array['livrables', 'historique', 'equipes', 'commentaires'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 3 livrables d'EXEMPLE (pour tester) ----------
-- Pour les supprimer plus tard : voir README, section "Supprimer les exemples".
-- (ajoutés seulement s'il n'y a encore aucun exemple : on peut relancer ce fichier sans doublons)
insert into public.livrables (matiere, titre, description, date_limite, groupe, type, mode_rendu, lien, membres, date_soutenance)
select * from (values
 ('data-driven-commercial', '[Exemple] Tableau de bord commercial',
  'Construire un tableau de bord de 5 indicateurs sur votre entreprise d''accueil. 3 pages max + annexe Excel.',
  date_trunc('day', now()) + interval '1 day 23 hours 59 minutes', 'G1', 'dossier', 'Plateforme de l''école', '', '', null),
 ('business-plan', '[Exemple] Business plan – projet de groupe',
  'Business plan complet d''un nouveau service. Dossier à rendre, puis soutenance de 15 min par groupe.',
  date_trunc('day', now()) + interval '5 days 18 hours', 'G1', 'projet', 'Mail', '',
  '', date_trunc('day', now()) + interval '12 days 9 hours'),
 ('leadership-et-coaching', '[Exemple] Étude de cas – style de management',
  'Analyse d''un cas réel : identifier le style de leadership et proposer un plan de coaching.',
  date_trunc('day', now()) + interval '16 days 12 hours', 'G1', 'etude', 'Papier', '', '', null::timestamptz)
) as v
where not exists (select 1 from public.livrables where titre like '[Exemple]%');
