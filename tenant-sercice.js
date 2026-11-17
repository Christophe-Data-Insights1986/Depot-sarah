// ======================================================
// DÉPÔT SARAH V2
// TENANT-SERVICE.JS
// CRÉATION ET GESTION DES DÉPÔTS
// FIREBASE SDK 10.14.1
// ======================================================

import { auth, db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ======================================================
// 1. CONSTANTES
// ======================================================

export const TRIAL_DURATION_DAYS = 7;

export const SUBSCRIPTION_PLANS = {
    monthly: {
        name: "Mensuel",
        price: 2500,
        durationDays: 30
    },

    quarterly: {
        name: "Trimestriel",
        price: 6000,
        durationDays: 90
    },

    yearly: {
        name: "Annuel",
        price: 20000,
        durationDays: 365
    }
};

// ======================================================
// 2. NETTOYAGE DES DONNÉES
// ======================================================

function cleanText(value, maxLength = 100) {

    if (typeof value !== "string") {
        return "";
    }

    return value.trim().slice(0, maxLength);

}

// ======================================================
// 3. CRÉATION DU PREMIER DÉPÔT
// ======================================================

export async function createFirstTenant({
    user = auth.currentUser,
    tenantName,
    ownerName
} = {}) {

    if (!user) {
        throw new Error("Vous devez être connecté.");
    }

    if (!user.email) {
        throw new Error("Adresse e-mail introuvable.");
    }

    tenantName = cleanText(tenantName, 100);
    ownerName = cleanText(ownerName, 100);

    if (!tenantName) {
        throw new Error("Le nom du dépôt est obligatoire.");
    }

    if (!ownerName) {
        throw new Error("Le nom du propriétaire est obligatoire.");
    }

    // Vérifier si un profil existe déjà
    const userRef = doc(db, "users", user.uid);

    const existingUser = await getDoc(userRef);

    if (existingUser.exists()) {

        throw new Error(
            "Ce compte possède déjà un profil. " +
            "La création d'un second dépôt doit passer " +
            "par une procédure distincte."
        );

    }

    // Génération d'un identifiant unique
    const tenantRef = doc(collection(db, "tenants"));

    const tenantId = tenantRef.id;

    const memberRef = doc(
        db,
        "tenants",
        tenantId,
        "members",
        user.uid
    );

    // Une seule opération atomique
    const batch = writeBatch(db);

    // Profil du propriétaire
    batch.set(userRef, {

        uid: user.uid,
        email: user.email,
        displayName: ownerName,

        activeTenantId: tenantId,

        createdAt: serverTimestamp()

    });

    // Informations du dépôt
    batch.set(tenantRef, {

        name: tenantName,

        ownerId: user.uid,

        status: "active",

        subscriptionStatus: "trial",

        plan: "free_trial",

        trialDurationDays: TRIAL_DURATION_DAYS,

        trialStartedAt: serverTimestamp(),

        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp()

    });

    // Appartenance du propriétaire
    batch.set(memberRef, {

        uid: user.uid,

        email: user.email,

        name: ownerName,

        role: "owner",

        status: "active",

        permissions: {
            dashboard: true,
            products: true,
            sales: true,
            customers: true,
            suppliers: true,
            purchases: true,
            expenses: true,
            losses: true,
            reports: true,
            employees: true,
            settings: true
        },

        invitedBy: user.uid,

        createdAt: serverTimestamp()

    });

    // Enregistrement simultané
    await batch.commit();

    return {

        success: true,

        tenantId,

        tenantName,

        ownerId: user.uid,

        subscriptionStatus: "trial",

        trialDurationDays: TRIAL_DURATION_DAYS

    };

}

// ======================================================
// 4. RÉCUPÉRER LES INFORMATIONS D'UN DÉPÔT
// ======================================================

export async function getTenantById(tenantId) {

    if (!tenantId) {
        throw new Error("Identifiant du dépôt manquant.");
    }

    const tenantRef = doc(db, "tenants", tenantId);

    const snapshot = await getDoc(tenantRef);

    if (!snapshot.exists()) {
        throw new Error("Dépôt introuvable.");
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    };

}

// ======================================================
// 5. MODIFIER LE NOM DU DÉPÔT
// ======================================================

export async function updateTenantName(tenantId, newName) {

    if (!tenantId) {
        throw new Error("Identifiant du dépôt manquant.");
    }

    const name = cleanText(newName, 100);

    if (!name) {
        throw new Error("Le nouveau nom est obligatoire.");
    }

    const tenantRef = doc(db, "tenants", tenantId);

    await updateDoc(tenantRef, {

        name,

        updatedAt: serverTimestamp()

    });

    return true;

}

// ======================================================
// 6. VÉRIFIER LA PÉRIODE D'ESSAI
// ======================================================

export function getTrialStatus(tenant) {

    if (!tenant || !tenant.trialStartedAt) {

        return {
            valid: false,
            remainingDays: 0,
            message: "Période d'essai indisponible."
        };

    }

    const startDate = tenant.trialStartedAt.toDate();

    const trialEndDate = new Date(
        startDate.getTime() +
        TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000
    );

    const remainingTime = trialEndDate.getTime() - Date.now();

    const remainingDays = Math.max(
        0,
        Math.ceil(remainingTime / (24 * 60 * 60 * 1000))
    );

    return {

        valid: remainingTime > 0,

        remainingDays,

        trialEndDate,

        message: remainingTime > 0
            ? `${remainingDays} jour(s) d'essai restant(s).`
            : "Votre période d'essai est terminée."

    };

}
