// ======================================================
// DÉPÔT SARAH V2
// TENANT-CONTEXT.JS
// GESTION DU CONTEXTE MULTI-DÉPÔTS
// VERSION v2 — validations renforcées
// ======================================================
//
// Ce module est PASSIF :
//   - il lit le contexte du dépôt actif de l'utilisateur connecté ;
//   - il n'active JAMAIS le mode TENANT ;
//   - il n'importe PAS auth.js.
// L'activation du mode TENANT est pilotée par app.js via
// setCurrentAccountMode("tenant", role).
//
// RÈGLES DE SÉCURITÉ :
//   - activeTenantId doit être une chaîne non vide ;
//   - role doit valoir exactement "owner" ou "employee" ;
//   - status du membre doit valoir "active" ;
//   - permissions doit être un objet (hors tableau) sinon {} ;
//   - les variables globales ne sont affectées QU'APRÈS
//     validation complète de toutes les informations.
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

// Rôles autorisés pour un membre d'un dépôt.
const ALLOWED_TENANT_ROLES = Object.freeze([
    "owner",
    "employee"
]);

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

    // ----------------------------------------------------
    // 3.1. Profil utilisateur
    // ----------------------------------------------------

    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
        throw new Error("Profil utilisateur introuvable.");
    }

    const userData = userSnapshot.data() || {};

    const tenantId = userData.activeTenantId;

    // Validation stricte : chaîne non vide uniquement.
    if (
        typeof tenantId !== "string" ||
        !tenantId.trim()
    ) {
        throw new Error("Aucun dépôt associé à ce compte.");
    }

    // ----------------------------------------------------
    // 3.2. Appartenance au dépôt
    // ----------------------------------------------------

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

    const memberData = memberSnapshot.data() || {};

    if (memberData.status !== "active") {
        throw new Error("Votre accès à ce dépôt est désactivé.");
    }

    // Validation stricte du rôle : exactement "owner" ou "employee".
    // Aucun fallback automatique vers "employee".
    const memberRole = memberData.role;

    if (!ALLOWED_TENANT_ROLES.includes(memberRole)) {
        throw new Error(
            "Rôle de dépôt invalide ou manquant. " +
            "Contactez le propriétaire du dépôt."
        );
    }

    // Validation des permissions : objet exploitable, hors tableau.
    // Sinon, objet vide sûr.
    const rawPermissions = memberData.permissions;
    const tenantPermissions =
        rawPermissions &&
        typeof rawPermissions === "object" &&
        !Array.isArray(rawPermissions)
            ? rawPermissions
            : {};

    // ----------------------------------------------------
    // 3.3. Informations du dépôt
    // ----------------------------------------------------

    const tenantRef = doc(db, "tenants", tenantId);
    const tenantSnapshot = await getDoc(tenantRef);

    if (!tenantSnapshot.exists()) {
        throw new Error("Dépôt introuvable.");
    }

    const tenantData = tenantSnapshot.data() || {};

    // ----------------------------------------------------
    // 3.4. Affectation APRÈS validation complète
    // ----------------------------------------------------

    currentTenant = {
        id: tenantId,
        ...tenantData
    };

    currentTenantId = tenantId;
    currentTenantRole = memberRole;
    currentTenantPermissions = tenantPermissions;

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