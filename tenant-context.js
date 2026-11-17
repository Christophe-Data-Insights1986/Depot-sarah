// ======================================================
// DÉPÔT SARAH V2
// TENANT-CONTEXT.JS
// GESTION DU CONTEXTE MULTI-DÉPÔTS
// ======================================================

import { auth, db } from "./firebase.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ======================================================
// 1. CONTEXTE ACTUEL
// ======================================================

export let currentTenant = null;
export let currentTenantId = null;
export let currentTenantRole = null;
export let currentTenantPermissions = {};

// ======================================================
// 2. RÉINITIALISATION
// ======================================================

export function clearTenantContext() {

    currentTenant = null;
    currentTenantId = null;
    currentTenantRole = null;
    currentTenantPermissions = {};

}

// ======================================================
// 3. CHARGEMENT DU CONTEXTE UTILISATEUR
// ======================================================

export async function loadTenantContext(user = auth.currentUser) {

    clearTenantContext();

    if (!user) {
        throw new Error("Aucun utilisateur connecté.");
    }

    // Profil utilisateur
    const userRef = doc(db, "users", user.uid);

    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
        throw new Error("Profil utilisateur introuvable.");
    }

    const userData = userSnapshot.data();

    const tenantId = userData.activeTenantId;

    if (!tenantId) {
        throw new Error("Aucun dépôt associé à ce compte.");
    }

    // Vérification de l'appartenance au dépôt
    const memberRef = doc(
        db,
        "tenants",
        tenantId,
        "members",
        user.uid
    );

    const memberSnapshot = await getDoc(memberRef);

    if (!memberSnapshot.exists()) {
        throw new Error("Accès à ce dépôt non autorisé.");
    }

    const memberData = memberSnapshot.data();

    if (memberData.status !== "active") {
        throw new Error("Votre accès à ce dépôt est désactivé.");
    }

    // Informations du dépôt
    const tenantRef = doc(db, "tenants", tenantId);

    const tenantSnapshot = await getDoc(tenantRef);

    if (!tenantSnapshot.exists()) {
        throw new Error("Dépôt introuvable.");
    }

    // Enregistrement du contexte
    currentTenant = {
        id: tenantId,
        ...tenantSnapshot.data()
    };

    currentTenantId = tenantId;

    currentTenantRole = memberData.role || "employee";

    currentTenantPermissions =
        memberData.permissions || {};

    return {
        user,
        tenant: currentTenant,
        tenantId: currentTenantId,
        role: currentTenantRole,
        permissions: currentTenantPermissions
    };
}

// ======================================================
// 4. VÉRIFICATION DES PERMISSIONS
// ======================================================

export function hasTenantPermission(permission) {

    if (!currentTenantId) {
        return false;
    }

    if (currentTenantRole === "owner") {
        return true;
    }

    return currentTenantPermissions[permission] === true;
}

// ======================================================
// 5. VÉRIFICATION DU RÔLE
// ======================================================

export function isTenantOwner() {

    return currentTenantRole === "owner";

}

// ======================================================
// 6. VÉRIFICATION DU CONTEXTE
// ======================================================

export function hasTenantContext() {

    return Boolean(currentTenantId);

}
