// ====================================================== // DÉPÔT SARAH V2 // SERVICE WORKER - VERSION STABLE // ======================================================
const CACHE_NAME = "depot-sarah-v2-cache-3";
const APP_FILES = [ "./", "./index.html", "./style.css", "./app.js", "./auth.js", "./firebase.js", "./database.js", "./offline.js", "./manifest.json", "./icon-512.svg" ];
// ====================================================== // INSTALLATION // ======================================================
self.addEventListener("install", event => {
event.waitUntil(
    caches.open(CACHE_NAME)
        .then(async cache => {
            await cache.addAll(APP_FILES);
        })
);

self.skipWaiting();
});
// ====================================================== // ACTIVATION // ======================================================
self.addEventListener("activate", event => {
event.waitUntil(
    caches.keys()
        .then(cacheNames => {

            return Promise.all(
                cacheNames
                    .filter(name =>
                        name.startsWith("depot-sarah-v2-cache-") &&
                        name !== CACHE_NAME
                    )
                    .map(name => caches.delete(name))
            );

        })
        .then(() => self.clients.claim())
);
});
// ====================================================== // GESTION DES REQUÊTES // ======================================================
self.addEventListener("fetch", event => {
const request = event.request;

if (request.method !== "GET") {
    return;
}

const url = new URL(request.url);

// Ne pas intercepter Firebase et les services Google.

if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com")
) {
    return;
}

// Ne pas mettre en cache les requêtes externes.

if (url.origin !== self.location.origin) {
    return;
}

// Éviter la mise en cache des requêtes non destinées
// aux fichiers de l'application.

event.respondWith(

    (async () => {

        try {

            const response = await fetch(request);

            if (
                response &&
                response.ok &&
                response.type === "basic"
            ) {

                const cache = await caches.open(CACHE_NAME);

                await cache.put(request, response.clone());

            }

            return response;

        } catch (error) {

            const cachedResponse = await caches.match(request);

            if (cachedResponse) {
                return cachedResponse;
            }

            if (request.mode === "navigate") {

                const offlinePage = await caches.match("./index.html");

                if (offlinePage) {
                    return offlinePage;
                }

            }

            return new Response(
                "Cette ressource n'est pas disponible hors connexion.",
                {
                    status: 503,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8"
                    }
                }
            );

        }

    })()

);
});