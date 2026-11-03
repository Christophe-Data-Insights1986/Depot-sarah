// ==================================================
// DÉPÔT SARAH V2
// GESTION DU MODE HORS CONNEXION
// ==================================================

const DB_NAME = "DepotSarahOffline";
const DB_VERSION = 1;
const STORE_NAME = "pendingOperations";

let database = null;
let syncInProgress = false;


// ==================================================
// OUVERTURE DE LA BASE INDEXEDDB
// ==================================================

export function openOfflineDB() {

    return new Promise((resolve, reject) => {

        if (database) {
            resolve(database);
            return;
        }

        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB n'est pas disponible."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {

            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {

                const store = db.createObjectStore(
                    STORE_NAME,
                    { keyPath: "id" }
                );

                store.createIndex(
                    "status",
                    "status",
                    { unique: false }
                );

                store.createIndex(
                    "createdAt",
                    "createdAt",
                    { unique: false }
                );
            }
        };

        request.onsuccess = event => {
            database = event.target.result;
            resolve(database);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


// ==================================================
// CRÉATION D'UN IDENTIFIANT UNIQUE
// ==================================================

function createOperationId() {

    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2)
    );
}


// ==================================================
// AJOUTER UNE OPÉRATION EN ATTENTE
// ==================================================

export async function enqueueOperation(type, payload) {

    if (!type || !payload) {
        throw new Error("Opération invalide.");
    }

    const db = await openOfflineDB();

    const operation = {
        id: createOperationId(),
        type,
        payload,
        status: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
        lastAttemptAt: null,
        lastError: null
    };

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        store.add(operation);

        transaction.oncomplete = () => {
            resolve(operation);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}


// ==================================================
// RÉCUPÉRER LES OPÉRATIONS EN ATTENTE
// ==================================================

export async function getPendingOperations() {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(STORE_NAME);

        const request = store.getAll();

        request.onsuccess = () => {

            const operations = request.result
                .filter(item => item.status === "pending")
                .sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt)
                );

            resolve(operations);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


// ==================================================
// COMPTER LES OPÉRATIONS EN ATTENTE
// ==================================================

export async function countPendingOperations() {

    const operations = await getPendingOperations();

    return operations.length;
}


// ==================================================
// MODIFIER UNE OPÉRATION
// ==================================================

async function updateOperation(id, changes) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (!operation) {
                resolve(false);
                return;
            }

            Object.assign(operation, changes);

            store.put(operation);
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


// ==================================================
// MARQUER UNE OPÉRATION COMME TERMINÉE
// ==================================================

export async function markOperationCompleted(id) {

    return await updateOperation(id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        lastError: null
    });
}


// ==================================================
// ENREGISTRER UNE ERREUR DE SYNCHRONISATION
// ==================================================

export async function markOperationFailed(id, error) {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        const request = store.get(id);

        request.onsuccess = () => {

            const operation = request.result;

            if (!operation) {
                resolve(false);
                return;
            }

            operation.status = "pending";
            operation.attempts += 1;

            operation.lastAttemptAt =
                new Date().toISOString();

            operation.lastError =
                String(error?.message || error || "Erreur inconnue");

            store.put(operation);
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


// ==================================================
// SYNCHRONISATION DES OPÉRATIONS
// ==================================================

export async function syncPendingOperations(processor) {

    if (!navigator.onLine) {
        return {
            success: 0,
            failed: 0,
            message: "Aucune connexion Internet."
        };
    }

    if (typeof processor !== "function") {
        throw new Error(
            "Une fonction de traitement est nécessaire."
        );
    }

    if (syncInProgress) {
        return {
            success: 0,
            failed: 0,
            message: "Synchronisation déjà en cours."
        };
    }

    syncInProgress = true;

    let success = 0;
    let failed = 0;

    try {

        const operations = await getPendingOperations();

        for (const operation of operations) {

            if (!navigator.onLine) {
                break;
            }

            try {

                await processor(operation);

                await markOperationCompleted(operation.id);

                success++;

            } catch (error) {

                await markOperationFailed(
                    operation.id,
                    error
                );

                failed++;
            }
        }

        return {
            success,
            failed,
            message: "Synchronisation terminée."
        };

    } finally {

        syncInProgress = false;
    }
}


// ==================================================
// NETTOYAGE DES OPÉRATIONS TERMINÉES
// ==================================================

export async function cleanCompletedOperations() {

    const db = await openOfflineDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        const request = store.getAll();

        let removed = 0;

        request.onsuccess = () => {

            request.result.forEach(operation => {

                if (operation.status === "completed") {

                    store.delete(operation.id);

                    removed++;
                }
            });
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            resolve(removed);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}


// ==================================================
// ÉTAT DE LA CONNEXION
// ==================================================

export function isOnline() {
    return navigator.onLine;
}


// ==================================================
// ÉCOUTER LE RETOUR D'INTERNET
// ==================================================

export function listenToConnection(callback) {

    window.addEventListener("online", () => {
        callback(true);
    });

    window.addEventListener("offline", () => {
        callback(false);
    });
}


// ==================================================
// FIN DU MODULE HORS CONNEXION
// ==================================================
