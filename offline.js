// ======================================================
// DÉPÔT SARAH V2
// OFFLINE.JS
// GESTION DU MODE HORS CONNEXION
// ======================================================


// ======================================================
// 1. CONFIGURATION
// ======================================================

const DB_NAME = "DepotSarahOffline";
const DB_VERSION = 2;
const STORE_NAME = "pendingOperations";

let database = null;
let syncInProgress = false;

const MAX_ATTEMPTS = 10;
const PROCESSING_TIMEOUT = 5 * 60 * 1000;


// ======================================================
// 2. GÉNÉRATION DES IDENTIFIANTS
// ======================================================

function generateId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return "offline_" +
        Date.now() + "_" +
        Math.random().toString(36).slice(2);
}


// ======================================================
// 3. OUVERTURE DE LA BASE INDEXEDDB
// ======================================================

export function openOfflineDB() {

    return new Promise((resolve, reject) => {

        if (database) {
            resolve(database);
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

                store = event.target.transaction.objectStore(
                    STORE_NAME
                );

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

    });

}


// ======================================================
// 4. OUTIL DE TRANSACTION
// ======================================================

async function executeTransaction(mode, callback) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            mode
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        let result;

        try {
            result = callback(store);
        } catch (error) {
            reject(error);
            return;
        }

        transaction.oncomplete = () => {
            resolve(result?.result);
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

    });

}


// ======================================================
// 5. ENREGISTRER UNE OPÉRATION EN ATTENTE
// ======================================================

export async function enqueueOperation(
    type,
    payload,
    operationId = null
) {

    if (!type || !payload) {
        throw new Error("Opération ou données manquantes.");
    }

    const id = operationId || generateId();

    const operation = {

        id,

        operationId: id,

        type,

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

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(
            STORE_NAME
        );

        const request = store.add(operation);

        request.onsuccess = () => {
            resolve(id);
        };

        request.onerror = () => {
            reject(request.error);
        };

    });

}


// ======================================================
// 6. RÉCUPÉRER LES OPÉRATIONS EN ATTENTE
// ======================================================

export async function getPendingOperations() {

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

            const operations = request.result
                .filter(operation =>
                    operation.status === "pending" ||
                    operation.status === "processing"
                )
                .sort((a, b) =>
                    a.createdAt - b.createdAt
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

export async function countPendingOperations() {

    const operations = await getPendingOperations();

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
                return;
            }

            store.put({
                ...operation,
                ...updates
            });

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
// 9. MARQUER UNE OPÉRATION TERMINÉE
// ======================================================

export async function markOperationCompleted(id) {

    return await updateOperation(id, {

        status: "completed",

        completedAt: Date.now(),

        lastError: null

    });

}


// ======================================================
// 10. MARQUER UNE OPÉRATION ÉCHOUÉE
// ======================================================

export async function markOperationFailed(id, error) {

    const operations = await getPendingOperations();

    const operation = operations.find(
        item => item.id === id
    );

    if (!operation) {
        return false;
    }

    const attempts = operation.attempts + 1;

    const delay = Math.min(
        30000 * Math.pow(2, attempts - 1),
        60 * 60 * 1000
    );

    const permanentFailure = attempts >= MAX_ATTEMPTS;

    return await updateOperation(id, {

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

}


// ======================================================
// 11. RÉINITIALISER LES OPÉRATIONS BLOQUÉES
// ======================================================

async function recoverStuckOperations() {

    const operations = await getPendingOperations();

    const now = Date.now();

    for (const operation of operations) {

        if (
            operation.status === "processing" &&
            now - (operation.lastAttemptAt || 0) >
            PROCESSING_TIMEOUT
        ) {

            await updateOperation(operation.id, {

                status: "pending",

                lastError:
                    "Traitement interrompu. Nouvelle tentative prévue."

            });

        }

    }

}


// ======================================================
// 12. SYNCHRONISATION DES OPÉRATIONS
// ======================================================

export async function syncPendingOperations(processor) {

    if (syncInProgress) {
        return {
            success: false,
            reason: "Synchronisation déjà en cours."
        };
    }

    if (!navigator.onLine) {
        return {
            success: false,
            reason: "Aucune connexion Internet."
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

        await recoverStuckOperations();

        const operations = await getPendingOperations();

        for (const operation of operations) {

            if (!navigator.onLine) {
                break;
            }

            if (
                operation.status !== "pending" ||
                operation.attempts >= MAX_ATTEMPTS
            ) {
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

                // Le module app.js fournira le processeur.
                await processor(operation);

                await markOperationCompleted(
                    operation.id
                );

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
            pending: await countPendingOperations()
        };

    } finally {

        syncInProgress = false;

    }

}


// ======================================================
// 13. SUPPRIMER LES OPÉRATIONS TERMINÉES
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

            if (operation && operation.status === "failed") {
                store.delete(id);
            }

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

    return await updateOperation(id, {

        status: "pending",

        attempts: 0,

        nextAttemptAt: 0,

        lastError: null

    });

}


// ======================================================
// 16. ÉTAT DE LA CONNEXION
// ======================================================

export function isOnline() {

    return navigator.onLine;

}


export function listenToConnection(callback) {

    window.addEventListener(
        "online",
        () => callback(true)
    );

    window.addEventListener(
        "offline",
        () => callback(false)
    );

}


// ======================================================
// 17. NOMBRE D'OPÉRATIONS ÉCHOUÉES
// ======================================================

export async function countFailedOperations() {

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

            const count = request.result.filter(
                operation => operation.status === "failed"
            ).length;

            resolve(count);

        };

        request.onerror = () => {
            reject(request.error);
        };

    });

}


// ======================================================
// FIN OFFLINE.JS
// DÉPÔT SARAH V2
// ======================================================
