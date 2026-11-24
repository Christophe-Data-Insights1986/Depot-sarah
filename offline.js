// ======================================================
// DÉPÔT SARAH V2
// OFFLINE.JS — MODE HORS CONNEXION (IndexedDB)
// VERSION v5
// ======================================================
//
// CONTRAINTES FORTES :
//   - DB_NAME = "DepotSarahOffline" (conservé)
//   - STORE_NAME = "pendingOperations" (conservé)
//   - keyPath: "id" SANS autoIncrement (conservé)
//   - DB_VERSION = 3 (migration non destructive)
//   - userId OBLIGATOIRE partout (sauf listOrphanOperations)
//   - updateOperation protège id/userId/tenantId/operationId
//   - markOperationCompleted/Failed exigent processingToken
//   - recoverStuckOperations : vérif + écriture atomiques
//   - syncPendingOperations : heartbeat + sessionToken
//   - offlineResetSession() invalide la sync en cours
// ======================================================

// ======================================================
// 1. CONFIGURATION
// ======================================================

const DB_NAME = "DepotSarahOffline";
const DB_VERSION = 3;
const STORE_NAME = "pendingOperations";

const MAX_ATTEMPTS = 10;

// Une réservation est valide pendant PROCESSING_TIMEOUT.
// Le heartbeat la renouvelle toutes les PROCESSING_TIMEOUT/3.
const PROCESSING_TIMEOUT = 5 * 60 * 1000;

let database = null;

// Jeton de session volatile. Incrémenté par offlineResetSession().
let sessionToken = 0;

export function offlineResetSession() {
    sessionToken++;
}

// ======================================================
// 2. UTILITAIRES
// ======================================================

function generateId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "offline_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

function requireUserId(userId, caller) {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
        throw new Error(caller + " : userId obligatoire (chaîne non vide).");
    }
    return userId;
}

function normalizeTenantId(tenantId) {
    if (tenantId === undefined || tenantId === null) return null;
    const s = String(tenantId).trim();
    return s ? s : null;
}

function requireExpectedContext(expectedUserId, expectedTenantId, caller) {
    requireUserId(expectedUserId, caller);
    if (expectedTenantId === undefined) {
        throw new Error(
            caller + " : expectedTenantId doit être fourni (null autorisé pour LEGACY)."
        );
    }
    return {
        userId: expectedUserId,
        tenantId: normalizeTenantId(expectedTenantId)
    };
}

function requireProcessingToken(token, caller) {
    if (!token || typeof token !== "string") {
        throw new Error(caller + " : processingToken obligatoire.");
    }
    return token;
}

// Vérification stricte : l'opération appartient-elle au contexte ?
// tenantId null attendu ⇔ uniquement LEGACY.
// tenantId non null attendu ⇔ uniquement ce dépôt.
function operationMatchesContext(op, userId, tenantId) {
    if (!op) return false;
    if (!op.userId) return false;
    if (op.userId !== userId) return false;
    return normalizeTenantId(op.tenantId) === normalizeTenantId(tenantId);
}

// ======================================================
// 3. OUVERTURE INDEXEDDB (compatible base existante)
// ======================================================

export function openOfflineDB() {
    return new Promise((resolve, reject) => {

        if (database) { resolve(database); return; }

        if (!globalThis.indexedDB) {
            reject(new Error("IndexedDB n'est pas disponible."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const db = event.target.result;
            const oldVersion = event.oldVersion || 0;

            let store;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            } else {
                store = event.target.transaction.objectStore(STORE_NAME);
            }

            const ensureIndex = (name, keyPath, options = {}) => {
                try {
                    if (!store.indexNames.contains(name)) {
                        store.createIndex(name, keyPath, options);
                    }
                } catch (error) {
                    console.warn("Index '" + name + "' : création impossible.", error);
                }
            };

            ensureIndex("status", "status", { unique: false });
            ensureIndex("createdAt", "createdAt", { unique: false });
            ensureIndex("operationId", "operationId", { unique: false });
            ensureIndex("userId", "userId", { unique: false });
            ensureIndex("tenantId", "tenantId", { unique: false });
            ensureIndex(
                "userTenantStatus",
                ["userId", "tenantId", "status"],
                { unique: false }
            );

            if (oldVersion < DB_VERSION) {
                console.info(
                    "Dépôt Sarah — Migration IndexedDB v" +
                    oldVersion + " → v" + DB_VERSION +
                    " (données préservées)."
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

        request.onerror = () => reject(request.error);
        request.onblocked = () => {
            console.warn("Ouverture IndexedDB bloquée par un autre onglet.");
        };
    });
}

// ======================================================
// 4. TRANSACTIONS
// ======================================================

function runStoreTransaction(mode, action) {
    return openOfflineDB().then(db =>
        new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, mode);
            const store = transaction.objectStore(STORE_NAME);

            let result;
            try {
                result = action(store, transaction);
            } catch (error) {
                try { transaction.abort(); } catch (_) { /* noop */ }
                reject(error);
                return;
            }

            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(
                transaction.error ||
                new Error("Transaction IndexedDB annulée.")
            );
        })
    );
}

function getAllRaw() {
    return runStoreTransaction("readonly", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    });
}

// ======================================================
// 5. ENREGISTREMENT — signature historique rétablie
// ======================================================
//
// enqueueOperation(type, payload, operationId = null, userId, tenantId = null)
//
// userId OBLIGATOIRE (validation interne : erreur si absent).
// tenantId null ⇔ LEGACY.
// Idempotence : (userId, tenantId, operationId) → retourne l'id existant.
// Collision : même operationId pour un autre contexte → refus.

export async function enqueueOperation(
    type,
    payload,
    operationId = null,
    userId = null,
    tenantId = null
) {
    requireUserId(userId, "enqueueOperation");

    if (!type || typeof type !== "string") {
        throw new Error("enqueueOperation : type obligatoire.");
    }
    if (!payload || typeof payload !== "object") {
        throw new Error("enqueueOperation : payload obligatoire.");
    }

    const safeTenantId = normalizeTenantId(tenantId);
    const finalOperationId = operationId || generateId();

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {

            let lookup = null;
            try {
                lookup = store.index("operationId").getAll(finalOperationId);
            } catch (_) {
                lookup = null;
            }

            const afterLookup = (existingList) => {
                const existing = existingList || [];

                const same = existing.find(op =>
                    op.userId === userId &&
                    normalizeTenantId(op.tenantId) === safeTenantId
                );
                if (same) { resolve(same.id); return; }

                if (existing.length > 0) {
                    reject(new Error(
                        "enqueueOperation : operationId déjà utilisé dans un autre contexte."
                    ));
                    return;
                }

                const operation = {
                    id: finalOperationId,
                    operationId: finalOperationId,
                    type,
                    userId,
                    tenantId: safeTenantId,
                    payload: { ...payload, operationId: finalOperationId },
                    status: "pending",
                    attempts: 0,
                    createdAt: Date.now(),
                    lastAttemptAt: null,
                    nextAttemptAt: 0,
                    lastError: null,
                    processingToken: null,
                    processingExpiresAt: null
                };

                const add = store.add(operation);
                add.onsuccess = () => resolve(finalOperationId);
                add.onerror = () => reject(new Error(
                    "enqueueOperation : identifiant déjà présent, aucun écrasement."
                ));
            };

            if (lookup) {
                lookup.onsuccess = () => afterLookup(lookup.result);
                lookup.onerror = () => afterLookup([]);
            } else {
                afterLookup([]);
            }
        });
    });
}

// ======================================================
// 6. LECTURES CONTEXTUALISÉES (userId obligatoire)
// ======================================================

function applyContextFilter(operations, userId, tenantId) {
    const wantedTenant = normalizeTenantId(tenantId);
    return (operations || []).filter(op =>
        operationMatchesContext(op, userId, wantedTenant)
    );
}

export async function getPendingOperations(userId, tenantId = null) {
    requireUserId(userId, "getPendingOperations");
    const all = await getAllRaw();
    return applyContextFilter(all, userId, tenantId)
        .filter(op => op.status === "pending" || op.status === "processing")
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function countPendingOperations(userId, tenantId = null) {
    requireUserId(userId, "countPendingOperations");
    const all = await getAllRaw();
    return applyContextFilter(all, userId, tenantId)
        .filter(op => op.status === "pending")
        .length;
}

export async function countFailedOperations(userId, tenantId = null) {
    requireUserId(userId, "countFailedOperations");
    const all = await getAllRaw();
    return applyContextFilter(all, userId, tenantId)
        .filter(op => op.status === "failed")
        .length;
}

export async function listOperationsForContext(userId, tenantId = null) {
    requireUserId(userId, "listOperationsForContext");
    const all = await getAllRaw();
    return applyContextFilter(all, userId, tenantId);
}

// Diagnostic uniquement. Aucune suppression, aucune synchronisation.
export async function listOrphanOperations() {
    const all = await getAllRaw();
    return all.filter(op => op && !op.userId);
}

// ======================================================
// 7. MODIFICATIONS PROTÉGÉES
// ======================================================

// Champs d'identité INVIOLABLES : toute tentative de les modifier
// via `updates` est ignorée (les valeurs originales sont conservées).
const PROTECTED_FIELDS = ["id", "userId", "tenantId", "operationId"];

function applyProtectedFields(current, updates) {
    const safe = { ...(updates || {}) };
    for (const field of PROTECTED_FIELDS) {
        delete safe[field];
    }
    // Réinjecte les valeurs originales pour garantir l'intégrité.
    safe.id = current.id;
    safe.userId = current.userId;
    safe.tenantId = normalizeTenantId(current.tenantId);
    safe.operationId = current.operationId;
    return safe;
}

export async function updateOperation(id, updates, expectedUserId, expectedTenantId) {
    const ctx = requireExpectedContext(expectedUserId, expectedTenantId, "updateOperation");

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (!operationMatchesContext(op, ctx.userId, ctx.tenantId)) {
                    resolve(false);
                    return;
                }

                const safe = applyProtectedFields(op, updates);
                const merged = { ...op, ...safe };

                try {
                    store.put(merged);
                } catch (error) {
                    reject(error);
                    return;
                }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

export async function markOperationCompleted(
    id,
    expectedUserId,
    expectedTenantId,
    expectedProcessingToken
) {
    const ctx = requireExpectedContext(expectedUserId, expectedTenantId, "markOperationCompleted");
    requireProcessingToken(expectedProcessingToken, "markOperationCompleted");

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (!operationMatchesContext(op, ctx.userId, ctx.tenantId)) {
                    resolve(false);
                    return;
                }
                if (op.status !== "processing") { resolve(false); return; }
                if (op.processingToken !== expectedProcessingToken) {
                    resolve(false);
                    return;
                }

                const updated = {
                    ...op,
                    status: "completed",
                    completedAt: Date.now(),
                    lastError: null,
                    processingToken: null,
                    processingExpiresAt: null
                };

                try { store.put(updated); } catch (e) { reject(e); return; }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

export async function markOperationFailed(
    id,
    error,
    expectedUserId,
    expectedTenantId,
    expectedProcessingToken
) {
    const ctx = requireExpectedContext(expectedUserId, expectedTenantId, "markOperationFailed");
    requireProcessingToken(expectedProcessingToken, "markOperationFailed");

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (!operationMatchesContext(op, ctx.userId, ctx.tenantId)) {
                    resolve(false);
                    return;
                }
                if (op.status !== "processing") { resolve(false); return; }
                if (op.processingToken !== expectedProcessingToken) {
                    resolve(false);
                    return;
                }

                const attempts = (op.attempts || 0) + 1;
                const delay = Math.min(
                    30 * Math.pow(2, attempts - 1) * 1000,
                    60 * 60 * 1000
                );
                const permanentFailure = attempts >= MAX_ATTEMPTS;

                const updated = {
                    ...op,
                    status: permanentFailure ? "failed" : "pending",
                    attempts,
                    nextAttemptAt: Date.now() + delay,
                    lastAttemptAt: Date.now(),
                    lastError: String(
                        error?.message || error || "Erreur inconnue"
                    ).slice(0, 500),
                    processingToken: null,
                    processingExpiresAt: null
                };

                try { store.put(updated); } catch (e) { reject(e); return; }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

export async function deleteFailedOperation(id, expectedUserId, expectedTenantId) {
    const ctx = requireExpectedContext(expectedUserId, expectedTenantId, "deleteFailedOperation");

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (op.status !== "failed") { resolve(false); return; }
                if (!operationMatchesContext(op, ctx.userId, ctx.tenantId)) {
                    resolve(false);
                    return;
                }

                try { store.delete(id); } catch (e) { reject(e); return; }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

export async function retryFailedOperation(id, expectedUserId, expectedTenantId) {
    const ctx = requireExpectedContext(expectedUserId, expectedTenantId, "retryFailedOperation");

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (op.status !== "failed") { resolve(false); return; }
                if (!operationMatchesContext(op, ctx.userId, ctx.tenantId)) {
                    resolve(false);
                    return;
                }

                const updated = {
                    ...op,
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: 0,
                    lastError: null,
                    processingToken: null,
                    processingExpiresAt: null
                };

                try { store.put(updated); } catch (e) { reject(e); return; }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

// ======================================================
// 8. RÉSERVATION ATOMIQUE
// ======================================================

function reserveOperationAtomically(id, userId, tenantId) {
    const wantedTenant = normalizeTenantId(tenantId);
    const token = generateId();
    const now = Date.now();

    return runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(null); return; }

                if (!operationMatchesContext(op, userId, wantedTenant)) {
                    resolve(null);
                    return;
                }

                if (op.status !== "pending" && op.status !== "failed") {
                    resolve(null);
                    return;
                }

                if (op.nextAttemptAt && op.nextAttemptAt > now) {
                    resolve(null);
                    return;
                }

                if ((op.attempts || 0) >= MAX_ATTEMPTS) {
                    resolve(null);
                    return;
                }

                const updated = {
                    ...op,
                    status: "processing",
                    lastAttemptAt: now,
                    processingToken: token,
                    processingExpiresAt: now + PROCESSING_TIMEOUT
                };

                try {
                    store.put(updated);
                } catch (error) {
                    reject(error);
                    return;
                }

                resolve(updated);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

// Heartbeat : renouvelle processingExpiresAt uniquement si le
// processingToken correspond (protection contre les reprises
// par une autre sync ou une autre session).
function heartbeatReservation(id, expectedToken, userId, tenantId) {
    const wantedTenant = normalizeTenantId(tenantId);

    return runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.get(id);

            request.onsuccess = () => {
                const op = request.result;
                if (!op) { resolve(false); return; }
                if (op.status !== "processing") { resolve(false); return; }
                if (op.processingToken !== expectedToken) { resolve(false); return; }
                if (!operationMatchesContext(op, userId, wantedTenant)) {
                    resolve(false);
                    return;
                }

                const updated = {
                    ...op,
                    processingExpiresAt: Date.now() + PROCESSING_TIMEOUT
                };

                try { store.put(updated); } catch (e) { reject(e); return; }
                resolve(true);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

// ======================================================
// 9. RÉCUPÉRATION ATOMIQUE DES OPÉRATIONS BLOQUÉES
// ======================================================
//
// Vérifications ET écriture dans la MÊME transaction :
//   - status === "processing" ;
//   - contexte (userId + tenantId) strict ;
//   - processingExpiresAt dépassé ;
//   - processingToken TOUJOURS celui observé (sinon le heartbeat
//     a renouvelé entre-temps → on ne libère pas).

export async function recoverStuckOperations(userId, tenantId = null) {
    requireUserId(userId, "recoverStuckOperations");
    const wantedTenant = normalizeTenantId(tenantId);

    // 1) Lecture préalable pour cibler les IDs candidats
    const all = await getAllRaw();
    const now = Date.now();
    const candidateIds = [];

    for (const op of all) {
        if (!op) continue;
        if (op.status !== "processing") continue;
        if (!operationMatchesContext(op, userId, wantedTenant)) continue;
        if ((op.processingExpiresAt || 0) > now) continue;
        candidateIds.push(op.id);
    }

    // 2) Pour chaque candidat, transaction readwrite qui re-vérifie
    //    TOUT et libère uniquement si les conditions tiennent encore.
    let recovered = 0;
    for (const id of candidateIds) {
        const ok = await runStoreTransaction("readwrite", (store) => {
            return new Promise((resolve, reject) => {
                const request = store.get(id);

                request.onsuccess = () => {
                    const op = request.result;
                    if (!op) { resolve(false); return; }

                    if (op.status !== "processing") { resolve(false); return; }
                    if (!operationMatchesContext(op, userId, wantedTenant)) {
                        resolve(false);
                        return;
                    }
                    if ((op.processingExpiresAt || 0) > Date.now()) {
                        // Heartbeat a renouvelé : ne pas libérer.
                        resolve(false);
                        return;
                    }

                    const updated = {
                        ...op,
                        status: "pending",
                        nextAttemptAt: 0,
                        lastError: "Traitement interrompu. Nouvelle tentative.",
                        processingToken: null,
                        processingExpiresAt: null
                    };

                    try { store.put(updated); } catch (e) { reject(e); return; }
                    resolve(true);
                };

                request.onerror = () => reject(request.error);
            });
        });
        if (ok) recovered++;
    }

    return recovered;
}

// ======================================================
// 10. NETTOYAGE
// ======================================================
// Fonction explicite, jamais appelée par syncPendingOperations.
// Supprime uniquement les "completed" du contexte demandé.

export async function cleanCompletedOperations(userId, tenantId = null) {
    requireUserId(userId, "cleanCompletedOperations");
    const wantedTenant = normalizeTenantId(tenantId);

    return await runStoreTransaction("readwrite", (store) => {
        return new Promise((resolve, reject) => {
            const request = store.getAll();

            let deleted = 0;

            request.onsuccess = () => {
                const ops = request.result || [];
                for (const op of ops) {
                    if (!op) continue;
                    if (op.status !== "completed") continue;
                    if (!operationMatchesContext(op, userId, wantedTenant)) continue;
                    try { store.delete(op.id); deleted++; }
                    catch (error) {
                        console.warn("cleanCompletedOperations : suppression impossible :", error);
                    }
                }
                resolve(deleted);
            };

            request.onerror = () => reject(request.error);
        });
    });
}

// ======================================================
// 11. SYNCHRONISATION
// ======================================================

export async function syncPendingOperations(processor, userId, tenantId = null) {
    requireUserId(userId, "syncPendingOperations");

    if (!navigator.onLine) {
        return {
            success: false,
            reason: "Aucune connexion Internet.",
            completed: 0, failed: 0, skipped: 0, pending: 0
        };
    }

    if (typeof processor !== "function") {
        throw new Error("Un processeur d'opérations est nécessaire.");
    }

    const token = sessionToken;
    const wantedTenant = normalizeTenantId(tenantId);

    await recoverStuckOperations(userId, wantedTenant);

    const candidates = await getPendingOperations(userId, wantedTenant);

    let completed = 0, failed = 0, skipped = 0;

    for (const op of candidates) {
        if (token !== sessionToken) break;
        if (!navigator.onLine) break;

        if (op.status !== "pending") {
            if (op.status === "processing") skipped++;
            continue;
        }

        // Réservation atomique.
        const reserved = await reserveOperationAtomically(
            op.id, userId, wantedTenant
        );
        if (!reserved) { skipped++; continue; }

        const processingToken = reserved.processingToken;

        // Vérification session avant traitement.
        if (token !== sessionToken) {
            // Relâche sans marquer d'échec.
            await updateOperation(
                reserved.id,
                {
                    status: "pending",
                    processingToken: null,
                    processingExpiresAt: null
                },
                userId,
                wantedTenant
            );
            break;
        }

        // Heartbeat périodique pendant le traitement.
        const heartbeatInterval = setInterval(() => {
            heartbeatReservation(
                reserved.id, processingToken, userId, wantedTenant
            ).catch(() => { /* silencieux */ });
        }, Math.floor(PROCESSING_TIMEOUT / 3));

        try {
            await processor(reserved);
        } catch (error) {
            clearInterval(heartbeatInterval);
            console.error("Erreur de synchronisation :", reserved.type, error);

            if (token !== sessionToken) {
                // Session changée : on ne marque pas "failed".
                // L'opération reste "processing" ; recover la libérera.
                break;
            }

            await markOperationFailed(
                reserved.id, error, userId, wantedTenant, processingToken
            );
            failed++;
            continue;
        } finally {
            clearInterval(heartbeatInterval);
        }

        // Vérification session après processing.
        if (token !== sessionToken) {
            // Ne pas marquer "completed". Le heartbeat est arrêté,
            // processingExpiresAt finira par expirer, une nouvelle
            // sync pourra reprendre — idempotence côté database.js
            // garantit l'absence de doublon métier.
            break;
        }

        await markOperationCompleted(
            reserved.id, userId, wantedTenant, processingToken
        );
        completed++;
    }

    return {
        success: true,
        completed, failed, skipped,
        pending: await countPendingOperations(userId, wantedTenant)
    };
}

// ======================================================
// 12. RÉSEAU
// ======================================================

export function isOnline() {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine !== false;
}

export function listenToConnection(callback) {
    if (typeof callback !== "function") {
        throw new Error("listenToConnection : callback obligatoire.");
    }

    if (typeof window === "undefined") {
        return () => { /* noop */ };
    }

    const onOnline = () => {
        try { callback(true); } catch (e) {
            console.error("listenToConnection(cb) a échoué :", e);
        }
    };
    const onOffline = () => {
        try { callback(false); } catch (e) {
            console.error("listenToConnection(cb) a échoué :", e);
        }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
    };
}

// ======================================================
// FIN OFFLINE.JS
// ======================================================