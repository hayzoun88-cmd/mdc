// =====================================================================
//  CONFIGURATION — c'est le SEUL fichier à modifier pour brancher la base.
//  (README, étape 2)
//
//  Ces deux valeurs sont PUBLIQUES par conception : elles finissent dans le
//  navigateur de chaque visiteur. La sécurité est assurée par les règles de la
//  base (lecture seule pour tous, écriture uniquement avec le code promo,
//  vérifié côté serveur). Ne mettez JAMAIS ici la clé "service_role".
//
//  Tant que ces valeurs sont vides, l'application tourne en "mode démo" :
//  les livrables sont enregistrés seulement dans votre navigateur.
// =====================================================================
window.CONFIG = {
  SUPABASE_URL: "https://wfnddfzbsgkidvztukhk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_wZBdwScjcBCLzPC-8OmywQ_g8bjuHg5", // clé publique "publishable" (jamais la clé secrète)

  // Clé PUBLIQUE des notifications push (VAPID). La clé privée, elle, n'est que dans Supabase.
  VAPID_PUBLIQUE: "BA_QIUOoL_DfrQ2UjYY5BWxPI4TiFxdbnDuOqLTDHRmjU_rYM8NF1jDz5dxPcvGsMcnU9GEIscap2JzMel7tmtY",
};
