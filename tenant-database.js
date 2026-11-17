// ======================================================
// DÉPÔT SARAH V2
// TENANT-DATABASE.JS
// MOTEUR DE DONNÉES MULTI-DÉPÔTS
// FIREBASE SDK 10.14.1
// ======================================================

import { db } from "./firebase.js";

import {
    currentTenantId,
    hasTenantContext
} from "./tenant-context.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ======================================================
// 1. COLLECTIONS AUTORISÉES
// ======================================================

export const TENANT_COLLECTIONS = {

    products: "products",
    sales: "sales",
    customers: "customers",
    customerPayments: "customerPayments",
    suppliers: "suppliers",
    purchases: "purchases",
    expenses: "expenses",
    losses: "losses",
    stockMovements: "stockMovements",
    cashClosures: "cashClosures"

};

// ======================================================
// 2. VÉRIFICATION DU CONTEXTE
// ======================================================

function requireTenant() {

    if (!hasTenantContext() || !currentTenantId) {

        throw new Error(
            "Aucun dépôt actif. Impossible d'accéder aux données."
        );

    }

    return currentTenantId;

}

// ======================================================
// 3. VÉRIFICATION DE LA COLLECTION
// ======================================================

function validateCollection(collectionName) {

    const allowed = Object.values(TENANT_COLLECTIONS);

    if (!allowed.includes(collectionName)) {

        throw new Error(
            "Collection non autorisée : " + collectionName
        );

    }

    return collectionName;

}

// ======================================================
// 4. RÉFÉRENCE À UNE COLLECTION
// ======================================================

export function getTenantCollection(collectionName) {

    const tenantId = requireTenant();

    const safeCollection = validateCollection(collectionName);

    return collection(
        db,
        "tenants",
        tenantId,
        safeCollection
    );

}

// ======================================================
// 5. RÉFÉRENCE À UN DOCUMENT
// ======================================================

export function getTenantDocument(collectionName, documentId) {

    const tenantId = requireTenant();

    const safeCollection = validateCollection(collectionName);

    if (!documentId) {

        throw new Error("Identifiant du document manquant.");

    }

    return doc(
        db,
        "tenants",
        tenantId,
        safeCollection,
        documentId
    );

}

// ======================================================
// 6. RÉCUPÉRER TOUS LES DOCUMENTS
// ======================================================

export async function getTenantAll(collectionName) {

    const reference = getTenantCollection(collectionName);

    const snapshot = await getDocs(reference);

    return snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
    }));

}

// ======================================================
// 7. RÉCUPÉRER UN DOCUMENT
// ======================================================

export async function getTenantById(collectionName, documentId) {

    const reference = getTenantDocument(
        collectionName,
        documentId
    );

    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    };

}

// ======================================================
// 8. CRÉER UN DOCUMENT
// ======================================================

export async function createTenantRecord(
    collectionName,
    data,
    documentId = null
) {

    if (!data || typeof data !== "object" || Array.isArray(data)) {

        throw new Error("Données invalides.");

    }

    const reference = getTenantCollection(collectionName);

    const record = {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    if (documentId) {

        const documentReference = getTenantDocument(
            collectionName,
            documentId
        );

        await setDoc(documentReference, record);

        return documentId;

    }

    const result = await addDoc(reference, record);

    return result.id;

}

// ======================================================
// 9. MODIFIER UN DOCUMENT
// ======================================================

export async function updateTenantRecord(
    collectionName,
    documentId,
    data
) {

    if (!data || typeof data !== "object" || Array.isArray(data)) {

        throw new Error("Données de modification invalides.");

    }

    const reference = getTenantDocument(
        collectionName,
        documentId
    );

    const changes = {
        ...data,
        updatedAt: serverTimestamp()
    };

    delete changes.id;
    delete changes.createdAt;

    await updateDoc(reference, changes);

    return true;

}

// ======================================================
// 10. SUPPRIMER UN DOCUMENT
// ======================================================

export async function deleteTenantRecord(
    collectionName,
    documentId
) {

    const reference = getTenantDocument(
        collectionName,
        documentId
    );

    await deleteDoc(reference);

    return true;

}

// ======================================================
// 11. VÉRIFIER L'EXISTENCE D'UN DOCUMENT
// ======================================================

export async function tenantRecordExists(
    collectionName,
    documentId
) {

    const reference = getTenantDocument(
        collectionName,
        documentId
    );

    const snapshot = await getDoc(reference);

    return snapshot.exists();

}

// ======================================================
// 12. IDENTIFIANT DU DÉPÔT ACTIF
// ======================================================

export function getActiveTenantId() {

    return requireTenant();

}
