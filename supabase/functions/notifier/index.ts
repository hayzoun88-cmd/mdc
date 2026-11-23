// =====================================================================
//  Fonction Supabase « notifier » : envoie une notification push à tous
//  les abonnés quand un nouveau devoir est ajouté.
//
//  Elle est appelée automatiquement par la base (déclencheur dans
//  supabase/notifications.sql) juste après l'ajout d'un devoir.
//  Elle ne reçoit aucune donnée : elle demande elle-même à la base les
//  devoirs pas encore annoncés (fonction SQL protégée par NOTIF_SECRET).
//  L'appeler plusieurs fois n'envoie donc jamais deux fois la même chose.
//
//  Réglages (« secrets » Supabase) :
//    VAPID_PUBLIQUE, VAPID_PRIVEE, VAPID_SUJET, NOTIF_SECRET, CLE_PUBLIQUE
//  (SUPABASE_URL est fourni automatiquement par Supabase)
// =====================================================================
import { envoyerPush } from "./webpush.ts";

const URL_PROJET = Deno.env.get("SUPABASE_URL")!;
const CLE = Deno.env.get("CLE_PUBLIQUE")!;
const SECRET = Deno.env.get("NOTIF_SECRET")!;
const VAPID = {
  publique: Deno.env.get("VAPID_PUBLIQUE")!,
  privee: Deno.env.get("VAPID_PRIVEE")!,
  sujet: Deno.env.get("VAPID_SUJET") ?? "https://hayzoun88-cmd.github.io/mdc/",
};

type Devoir = { id: string; titre: string; cree_par: string; date_limite: string | null; sans_heure: boolean };
type Abonne = { endpoint: string; p256dh: string; auth: string; prenom: string };

/** Appel d'une fonction SQL de la base */
async function rpc(nom: string, params: Record<string, unknown>) {
  const r = await fetch(`${URL_PROJET}/rest/v1/rpc/${nom}`, {
    method: "POST",
    headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`${nom} : ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const memeNom = (a: string, b: string) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

/** « pour le mardi 24 novembre » (heure de Paris) */
function quand(d: Devoir): string {
  if (!d.date_limite) return "";
  const date = new Date(d.date_limite);
  const jour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(date);
  const h = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(date).replace(":", "h");
  return d.sans_heure ? ` – pour le ${jour}` : ` – pour le ${jour} à ${h}`;
}

Deno.serve(async () => {
  try {
    const { livrables, abonnements } = (await rpc("prendre_notifications", { p_secret: SECRET })) as
      { livrables: Devoir[]; abonnements: Abonne[] };
    let envoyes = 0, expires = 0;
    for (const d of livrables) {
      const message = {
        title: "📌 Nouveau devoir – MDC G1",
        body: `${d.cree_par || "Quelqu'un"} a ajouté « ${d.titre} »${quand(d)}`,
        tag: "devoir-" + d.id,
        url: "./",
      };
      // Tout le monde sauf la personne qui a ajouté le devoir
      for (const ab of abonnements.filter((a) => !memeNom(a.prenom, d.cree_par))) {
        try {
          const statut = await envoyerPush(ab, message, VAPID);
          if (statut === 404 || statut === 410) {
            // Abonnement expiré (appli désinstallée, notifications coupées…) : on l'oublie
            await rpc("supprimer_abonnement_expire", { p_secret: SECRET, p_endpoint: ab.endpoint });
            expires++;
          } else if (statut < 300) envoyes++;
        } catch (e) {
          console.error("Envoi impossible :", e);
        }
      }
    }
    return Response.json({ devoirs: livrables.length, envoyes, expires });
  } catch (e) {
    console.error(e);
    return Response.json({ erreur: String(e) }, { status: 500 });
  }
});
