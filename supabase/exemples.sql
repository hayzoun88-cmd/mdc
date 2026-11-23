-- =====================================================================
--  FACULTATIF : 3 devoirs d'exemple pour tester l'application.
--  À coller dans Supabase > SQL Editor > New query > Run, APRÈS schema.sql.
--  Pour les supprimer : delete from public.livrables where titre like '[Exemple]%';
-- =====================================================================
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
