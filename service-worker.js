// ======================================================
// DÉPÔT SARAH V2
// SERVICE WORKER
// ======================================================

const CACHE_NAME = "depot-sarah-v2-cache-2";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./auth.js",
    "./firebase.js",
    "./database.js",
    "./offline.js",
    "./manifest.json"
];

// INSTALLATION
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_FILES))
    );

    self.skipWaiting();
});

// ACTIVATION
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(cacheNames =>
            Promise.all(
                cacheNames
                    .filter(name =>
                        name.startsWith("depot-sarah-v2-cache-") &&
                        name !== CACHE_NAME
                    )
                    .map(name => caches.delete(name))
            )
        ).then(() => self.clients.claim())
    );
});

// GESTION DES REQUÊTES
self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Ne pas intercepter les services Firebase et Google
    if (
        url.hostname.includes("firebase") ||
        url.hostname.includes("googleapis.com") ||
        url.hostname.includes("gstatic.com")
    ) {
        return;
    }

    event.respondWith(

        fetch(request)
            .then(response => {

                if (
                    response &&
                    response.status === 200 &&
                    url.origin === self.location.origin
                ) {
                    const copy = response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, copy));
                }

                return response;
            })

            .catch(async () => {

                const cached = await caches.match(request);

                if (cached) return cached;

                if (request.mode === "navigate") {
                    return caches.match("./index.html");
                }

                return new Response(
                    "Ressource indisponible hors connexion.",
                    {
                        status: 503,
                        headers: {
                            "Content-Type": "text/plain; charset=utf-8"
                        }
                    }
                );
            })
    );
});