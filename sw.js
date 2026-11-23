// =====================================================================
//  « Service worker » : petit programme que le téléphone garde en mémoire,
//  même site fermé. Il reçoit les notifications push et les affiche.
// =====================================================================
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// Réception d'une notification envoyée par la fonction Supabase « notifier »
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "📌 Nouveau devoir – MDC G1", {
    body: d.body || "Un devoir a été ajouté.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag,
    data: { url: d.url || "./" },
  }));
});

// Toucher la notification ouvre (ou ramène au premier plan) l'appli
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const cible = new URL(e.notification.data && e.notification.data.url ? e.notification.data.url : "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(fenetres => {
    for (const f of fenetres) if (f.url.startsWith(self.registration.scope) && "focus" in f) return f.focus();
    return self.clients.openWindow(cible);
  }));
});
