// ==================================================
// DÉPÔT SARAH V2
// SERVICE WORKER - CACHE ET MODE HORS LIGNE
// ==================================================

const CACHE_NAME = "depot-sarah-v2-cache-1";

const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./firebase.js",
    "./database.js",
    "./offline.js",
    "./manifest.json"
];


// ==================================================
// INSTALLATION
// ==================================================

self.addEventListener("install", event => {

    event.waitUntil(

        caches.open(CACHE_NAME).then(cache => {

            return cache.addAll(APP_FILES);

        })

    );

    self.skipWaiting();
});


// ==================================================
// ACTIVATION
// ==================================================

self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys().then(cacheNames => {

            return Promise.all(

                cacheNames
                    .filter(name =>
                        name.startsWith("depot-sarah-v2-cache-") &&
                        name !== CACHE_NAME
                    )
                    .map(name => caches.delete(name))

            );

        })

    );

    self.clients.claim();
});


// ==================================================
// GESTION DES REQUÊTES
// ==================================================

self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Ne jamais mettre en cache les appels Firebase.
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

                    const responseCopy = response.clone();

                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseCopy);
                    });
                }

                return response;
            })

            .catch(async () => {

                const cachedResponse =
                    await caches.match(request);

                if (cachedResponse) {
                    return cachedResponse;
                }

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


// ==================================================
// FIN DU SERVICE WORKER
// ==================================================
