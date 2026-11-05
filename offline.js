// ======================================================
// DÉPÔT SARAH V2
// OFFLINE.JS — MODE HORS CONNEXION
// ======================================================

// ======================================================
// 1. CONFIGURATION
// ======================================================

const DB_NAME = "DepotSarahOffline";
const DB_VERSION = 2;
const STORE_NAME = "pendingOperations";

const MAX_ATTEMPTS = 10;
const PROCESSING_TIMEOUT = 5 * 60 * 1000;

let database = null;
let syncInProgress = false;

// ======================================================
// 2. IDENTIFIANTS
// ======================================================

function generateId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return "offline_" +
        Date.now() + "_" +
        Math.random().toString(36).slice(2);
}

// ======================================================
// 3. OUVERTURE INDEXEDDB
// ======================================================

export function openOfflineDB() {
    return new Promise((resolve, reject) => {

        if (database) {
            resolve(database);
            return;
        }

        if (!globalThis.indexedDB) {
            reject(new Error("IndexedDB n'est pas disponible."));
            return;
        }

        const request = indexedDB.open(
            DB_NAME,
            DB_VERSION
        );

        request.onupgradeneeded = event => {
            const db = event.target.result;

            let store;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(
                    STORE_NAME,
                    { keyPath: "id" }
                );
            } else {
                store = event.target.transaction
                    .objectStore(STORE_NAME);
            }

            if (!store.indexNames.contains("status")) {
                store.createIndex(
                    "status",
                    "status",
                    { unique: false }
                );
            }

            if (!store.indexNames.contains("createdAt")) {
                store.createIndex(
                    "createdAt",
                    "createdAt",
                    { unique: false }
                );
            }

            if (!store.indexNames.contains("operationId")) {
                store.createIndex(
                    "operationId",
                    "operationId",
                    { unique: false }
                );
            }
        };

        request.onsuccess = () => {
            database = request.result;

            database.onversionchange = () => {
                database.close();
                database = null;
            };

            resolve(database);
        };

        request.onerror = () => {
            reject(request.error);
        };

        request.onblocked = () => {
            console.warn(
                "Ouverture IndexedDB bloquée par un autre onglet."
            );
        };
    });
}

// ======================================================
// 4. TRANSACTION INDEXEDDB
// ======================================================

function runStoreTransaction(mode, action) {
    return openOfflineDB().then(db =>
        new Promise((resolve, reject) => {

            const transaction = db.transaction(
                STORE_NAME,
                mode
            );

            const store = transaction.objectStore(
                STORE_NAME
            );

            let result;

            try {
                result = action(store);
            } catch (error) {
                transaction.abort();
                reject(error);
                return;
            }

            transaction.oncomplete = () => {
                resolve(result);
            };

            transaction.onerror = () => {
                reject(transaction.error);
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ||
                    new Error("Transaction IndexedDB annulée.")
                );
            };
        })
    );
}

// ======================================================
// 5. ENREGISTRER UNE OPÉRATION
// ======================================================

export async function enqueueOperation(
    type,
    payload,
    operationId = null,
    userId = null
) {
    if (!type || !payload) {
        throw new Error("Opération ou données manquantes.");
    }

    const id = operationId || generateId();

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.get(id);

        request.onsuccess = () => {

            const existing = request.result;

            // Éviter d'ajouter deux fois la même opération.
            if (existing) {
                resolve(id);
                return;
            }

            const operation = {
                id,
                operationId: id,
                type,

                userId: userId || null,

                payload: {
                    ...payload,
                    operationId: id
                },

                status: "pending",
                attempts: 0,

                createdAt: Date.now(),
                lastAttemptAt: null,
                nextAttemptAt: 0,

                lastError: null
            };

            store.add(operation);
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(id);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };

        transaction.onabort = () => {
            reject(
                transaction.error ||
                new Error("Enregistrement local impossible.")
            );
        };
    });
}

// ======================================================
// 6. LIRE LES OPÉRATIONS EN ATTENTE
// ======================================================

export async function getPendingOperations(userId = null) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.getAll();

        request.onsuccess = () => {

            const operations = request.result.filter(
                operation => {

                    const active =
                        operation.status === "pending" ||
                        operation.status === "processing";

                    const belongsToUser =
                        userId === null ||
                        operation.userId === userId;

                    return active && belongsToUser;
                }
            );

            operations.sort(
                (a, b) => a.createdAt - b.createdAt
            );

            resolve(operations);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// ======================================================
// 7. COMPTER LES OPÉRATIONS EN ATTENTE
// ======================================================

export async function countPendingOperations(userId = null) {

    const operations = await getPendingOperations(userId);

    return operations.length;
}

// ======================================================
// 8. MODIFIER UNE OPÉRATION
// ======================================================

export async function updateOperation(id, updates) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (!operation) {
                resolve(false);
                return;
            }

            store.put({
                ...operation,
                ...updates
            });
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(true);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// ======================================================
// 9. TERMINER UNE OPÉRATION
// ======================================================

export async function markOperationCompleted(id) {

    return await updateOperation(id, {
        status: "completed",
        completedAt: Date.now(),
        lastError: null
    });
}

// ======================================================
// 10. ENREGISTRER UN ÉCHEC
// ======================================================

export async function markOperationFailed(id, error) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (!operation) {
                resolve(false);
                return;
            }

            const attempts = (operation.attempts || 0) + 1;

            const delay = Math.min(
                30000 * Math.pow(2, attempts - 1),
                60 * 60 * 1000
            );

            const permanentFailure =
                attempts >= MAX_ATTEMPTS;

            store.put({
                ...operation,

                status: permanentFailure
                    ? "failed"
                    : "pending",

                attempts,

                nextAttemptAt: Date.now() + delay,

                lastAttemptAt: Date.now(),

                lastError:
                    error?.message ||
                    String(error || "Erreur inconnue")
            });
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(true);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// ======================================================
// 11. RÉCUPÉRER LES OPÉRATIONS BLOQUÉES
// ======================================================

async function recoverStuckOperations(userId = null) {

    const operations = await getPendingOperations(userId);

    const now = Date.now();

    for (const operation of operations) {

        if (
            operation.status === "processing" &&
            now - (operation.lastAttemptAt || 0) >
            PROCESSING_TIMEOUT
        ) {
            await updateOperation(operation.id, {
                status: "pending",
                nextAttemptAt: 0,
                lastError:
                    "Traitement interrompu. Nouvelle tentative."
            });
        }
    }
}

// ======================================================
// 12. SYNCHRONISATION
// ======================================================

export async function syncPendingOperations(
    processor,
    userId = null
) {
    if (syncInProgress) {
        return {
            success: false,
            reason: "Synchronisation déjà en cours.",
            completed: 0,
            failed: 0
        };
    }

    if (!navigator.onLine) {
        return {
            success: false,
            reason: "Aucune connexion Internet.",
            completed: 0,
            failed: 0
        };
    }

    if (typeof processor !== "function") {
        throw new Error(
            "Un processeur d'opérations est nécessaire."
        );
    }

    syncInProgress = true;

    let completed = 0;
    let failed = 0;

    try {

        await recoverStuckOperations(userId);

        const operations = await getPendingOperations(userId);

        for (const operation of operations) {

            if (!navigator.onLine) {
                break;
            }

            if (operation.status !== "pending") {
                continue;
            }

            if (operation.attempts >= MAX_ATTEMPTS) {
                continue;
            }

            if (
                operation.nextAttemptAt &&
                operation.nextAttemptAt > Date.now()
            ) {
                continue;
            }

            try {

                await updateOperation(operation.id, {
                    status: "processing",
                    lastAttemptAt: Date.now()
                });

                await processor(operation);

                await markOperationCompleted(operation.id);

                completed++;

            } catch (error) {

                console.error(
                    "Erreur de synchronisation :",
                    operation.type,
                    error
                );

                await markOperationFailed(
                    operation.id,
                    error
                );

                failed++;
            }
        }

        return {
            success: true,
            completed,
            failed,
            pending: await countPendingOperations(userId)
        };

    } finally {

        syncInProgress = false;

    }
}

// ======================================================
// 13. NETTOYER LES OPÉRATIONS TERMINÉES
// ======================================================

export async function cleanCompletedOperations() {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.getAll();

        let deleted = 0;

        request.onsuccess = () => {

            request.result.forEach(operation => {

                if (operation.status === "completed") {

                    store.delete(operation.id);

                    deleted++;
                }
            });
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(deleted);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// ======================================================
// 14. SUPPRIMER UNE OPÉRATION ÉCHOUÉE
// ======================================================

export async function deleteFailedOperation(id) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (
                operation &&
                operation.status === "failed"
            ) {
                store.delete(id);
            }
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(true);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// ======================================================
// 15. RELANCER UNE OPÉRATION ÉCHOUÉE
// ======================================================

export async function retryFailedOperation(id) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (!operation || operation.status !== "failed") {
                resolve(false);
                return;
            }

            store.put({
                ...operation,
                status: "pending",
                attempts: 0,
                nextAttemptAt: 0,
                lastError: null
            });
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(true);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}

// ======================================================
// 16. COMPTER LES ÉCHECS
// ======================================================

export async function countFailedOperations(userId = null) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.getAll();

        request.onsuccess = () => {

            const count = request.result.filter(operation => {

                const failed = operation.status === "failed";

                const belongsToUser =
                    userId === null ||
                    operation.userId === userId;

                return failed && belongsToUser;

            }).length;

            resolve(count);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// ======================================================
// 17. CONNEXION INTERNET
// ======================================================

export function isOnline() {
    return navigator.onLine;
}

export function listenToConnection(callback) {

    window.addEventListener("online", () => {
        callback(true);
    });

    window.addEventListener("offline", () => {
        callback(false);
    });
}

// ======================================================
// FIN OFFLINE.JS
// DÉPÔT SARAH V2
// ======================================================