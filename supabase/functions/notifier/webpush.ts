// =====================================================================
//  Envoi d'une notification « push » à un navigateur (norme Web Push).
//  Écrit uniquement avec WebCrypto (intégré à Supabase/Deno et à Node) :
//  aucune bibliothèque externe à installer.
//   - RFC 8291 : chiffrement du message (aes128gcm)
//   - RFC 8292 : identification de l'expéditeur (VAPID, jeton ES256)
// =====================================================================

const enc = new TextEncoder();

/** base64url -> octets */
export function deB64(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** octets -> base64url (sans « = ») */
export function enB64(o: ArrayBuffer | Uint8Array): string {
  const u = o instanceof Uint8Array ? o : new Uint8Array(o);
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const r = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { r.set(p, i); i += p.length; }
  return r;
}

/** HKDF-SHA256 (extraction + expansion) */
async function hkdf(sel: Uint8Array, ikm: Uint8Array, info: Uint8Array, longueur: number): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info }, cle, longueur * 8));
}

/** Chiffre le message pour un abonnement (RFC 8291). Renvoie le corps de la requête. */
export async function chiffrer(p256dh: string, authSecret: string, message: Uint8Array): Promise<Uint8Array> {
  const clePubliqueNavigateur = deB64(p256dh);          // 65 octets (point P-256 non compressé)
  const auth = deB64(authSecret);                        // 16 octets
  // Clé éphémère de l'expéditeur
  const paire = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const clePubliqueServeur = new Uint8Array(await crypto.subtle.exportKey("raw", paire.publicKey));
  const cleNavigateur = await crypto.subtle.importKey("raw", clePubliqueNavigateur, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secretPartage = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: cleNavigateur }, paire.privateKey, 256));
  // Dérivation des clés (RFC 8291, section 3.4)
  const infoCle = concat(enc.encode("WebPush: info\0"), clePubliqueNavigateur, clePubliqueServeur);
  const ikm = await hkdf(auth, secretPartage, infoCle, 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sel, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  // Un seul bloc : message + délimiteur 0x02
  const cleAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cleAes, concat(message, new Uint8Array([2]))));
  // En-tête aes128gcm : sel (16) | taille de bloc (4) | longueur de l'id (1) | id = clé publique serveur (65)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(sel, rs, new Uint8Array([clePubliqueServeur.length]), clePubliqueServeur, chiffre);
}

/** Jeton VAPID (JWT ES256) qui prouve au service push que c'est bien notre serveur qui envoie. */
export async function jetonVapid(audience: string, sujet: string, vapidPublique: string, vapidPrivee: string): Promise<string> {
  const pub = deB64(vapidPublique); // 0x04 | x (32) | y (32)
  const jwk = { kty: "EC", crv: "P-256", d: vapidPrivee, x: enB64(pub.slice(1, 33)), y: enB64(pub.slice(33, 65)), ext: true };
  const cle = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const entete = enB64(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const contenu = enB64(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujet })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, enc.encode(`${entete}.${contenu}`));
  return `${entete}.${contenu}.${enB64(signature)}`;
}

export type Abonnement = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publique: string; privee: string; sujet: string };

/** Envoie une notification. Renvoie le code HTTP du service push (201 = OK, 404/410 = abonnement expiré). */
export async function envoyerPush(ab: Abonnement, donnees: unknown, vapid: Vapid): Promise<number> {
  const corps = await chiffrer(ab.p256dh, ab.auth, enc.encode(JSON.stringify(donnees)));
  const jwt = await jetonVapid(new URL(ab.endpoint).origin, vapid.sujet, vapid.publique, vapid.privee);
  const r = await fetch(ab.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",            // le service garde la notification 24 h si le téléphone est éteint
      Urgency: "normal",
      Authorization: `vapid t=${jwt}, k=${vapid.publique}`,
    },
    body: corps,
  });
  await r.body?.cancel();
  return r.status;
}

/** Fabrique une paire de clés VAPID (à faire une seule fois). */
export async function nouvellesClesVapid(): Promise<{ publique: string; privee: string }> {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  const publique = new Uint8Array(await crypto.subtle.exportKey("raw", paire.publicKey));
  return { publique: enB64(publique), privee: jwk.d as string };
}
