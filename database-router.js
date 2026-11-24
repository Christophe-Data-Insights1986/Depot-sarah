// ======================================================
// DÉPÔT SARAH V2
// DATABASE-ROUTER.JS
// ROUTAGE AUTOMATIQUE DES BASES DE DONNÉES
// LEGACY : database.js
// SAAS   : tenant-business-database.js
// FIREBASE SDK 10.14.1
// ======================================================
//
// RÈGLES DE SÉCURITÉ :
//   - Mode "tenant" : EXIGE un currentTenantId valide
//     (chaîne non vide). Sinon → erreur explicite AVANT
//     d'appeler le moteur tenant.
//   - Mode inconnu (valeur ni "legacy", ni "tenant", ni null
//     ni undefined) : ERREUR EXPLICITE. Aucun repli
//     automatique vers LEGACY.
//   - Mode null/undefined : LEGACY (mode pré-authentification),
//     avec log warn unique.
//   - Les arguments (dont operationId) sont transmis TELS
//     QUELS aux moteurs. L'idempotence de la synchronisation
//     hors connexion est préservée.
//   - L'isolation multi-dépôt est assurée par
//     tenant-business-database.js (via requireTenant()).
//     Le routeur ne vérifie PAS l'appartenance de l'utilisateur
//     au dépôt : c'est le rôle du moteur + des règles Firestore.
// ======================================================

import * as legacyDatabase from "./database.js";

import * as tenantDatabase from "./tenant-business-database.js";

import { currentAccountMode } from "./auth.js";

import { currentTenantId } from "./tenant-context.js";

// ======================================================
// COLLECTIONS
// Les deux moteurs utilisent la même structure métier.
// Le routeur expose la version LEGACY.
// ⚠️ Une divergence future entre LEGACY et TENANT imposerait
//    de rendre cet export dynamique.
// ======================================================

export const COLLECTIONS = legacyDatabase.COLLECTIONS;

// ======================================================
// ÉTAT INTERNE (log warn unique pour le mode pré-auth)
// ======================================================

let warnedPreAuthMode = false;

// ======================================================
// VALIDATION DU CONTEXTE TENANT
// ======================================================
//
// Un currentTenantId valide est une chaîne non vide.
// Toute autre valeur (null, undefined, objet, chaîne vide,
// 0, false) est refusée.

function isValidTenantId(tenantId) {
    return (
        typeof tenantId === "string" &&
        tenantId.trim().length > 0
    );
}

// ======================================================
// SÉLECTION DU MOTEUR ACTIF
// ======================================================

function getActiveDatabase() {

    // --- Mode TENANT : contexte obligatoire ---
    if (currentAccountMode === "tenant") {

        if (!isValidTenantId(currentTenantId)) {
            throw new Error(
                "Router : mode tenant actif mais aucun contexte de dépôt valide. " +
                "Le contexte doit être chargé avant toute opération."
            );
        }

        return tenantDatabase;
    }

    // --- Mode LEGACY explicite ---
    if (currentAccountMode === "legacy") {
        return legacyDatabase;
    }

    // --- Mode pré-authentification (null/undefined) ---
    // auth.js initialise currentAccountMode à null. Avant
    // sarah-auth-ready, c'est l'état normal. On route LEGACY
    // en toute sécurité, avec un log warn unique.
    if (
        currentAccountMode === null ||
        currentAccountMode === undefined
    ) {
        if (!warnedPreAuthMode) {
            warnedPreAuthMode = true;
            console.warn(
                "Router : mode de compte non défini (pré-authentification). " +
                "Routage LEGACY par défaut."
            );
        }
        return legacyDatabase;
    }

    // --- Mode inconnu : ERREUR ---
    // Toute valeur inattendue ("guest", "admin", 0, {}, true, …)
    // est refusée. Aucun repli silencieux vers LEGACY.
    throw new Error(
        "Router : mode de compte inconnu (" +
        String(currentAccountMode) +
        "). Aucune opération de base de données n'est autorisée " +
        "dans cet état."
    );
}

// ======================================================
// EXÉCUTION D'UNE FONCTION DU MOTEUR ACTIF
// ======================================================
//
// - Retourne la Promise du moteur (les deux moteurs sont
//   asynchrones). Aucune Promise intermédiaire ajoutée.
// - Les arguments (dont operationId) sont transmis SANS
//   modification.

function executeDatabaseFunction(functionName, args) {

    const database = getActiveDatabase();

    const databaseFunction = database[functionName];

    if (typeof databaseFunction !== "function") {

        throw new Error(
            `Fonction de base de données introuvable : ${functionName}`
        );

    }

    return databaseFunction(...args);

}

// ======================================================
// FONCTIONS GÉNÉRALES
// ======================================================

export function getAll(...args) {
    return executeDatabaseFunction("getAll", args);
}

export function getById(...args) {
    return executeDatabaseFunction("getById", args);
}

export function createRecord(...args) {
    return executeDatabaseFunction("createRecord", args);
}

export function updateRecord(...args) {
    return executeDatabaseFunction("updateRecord", args);
}

export function removeRecord(...args) {
    return executeDatabaseFunction("removeRecord", args);
}

// ======================================================
// PRODUITS ET STOCK
// ======================================================

export function addProduct(...args) {
    return executeDatabaseFunction("addProduct", args);
}

export function getProducts(...args) {
    return executeDatabaseFunction("getProducts", args);
}

export function updateProduct(...args) {
    return executeDatabaseFunction("updateProduct", args);
}

export function deleteProduct(...args) {
    return executeDatabaseFunction("deleteProduct", args);
}

export function updateStock(...args) {
    return executeDatabaseFunction("updateStock", args);
}

// ======================================================
// CLIENTS
// ======================================================

export function addCustomer(...args) {
    return executeDatabaseFunction("addCustomer", args);
}

export function getCustomers(...args) {
    return executeDatabaseFunction("getCustomers", args);
}

export function updateCustomer(...args) {
    return executeDatabaseFunction("updateCustomer", args);
}

// ======================================================
// FOURNISSEURS
// ======================================================

export function addSupplier(...args) {
    return executeDatabaseFunction("addSupplier", args);
}

export function getSuppliers(...args) {
    return executeDatabaseFunction("getSuppliers", args);
}

// ======================================================
// VENTES
// ======================================================

export function createSale(...args) {
    return executeDatabaseFunction("createSale", args);
}

export function getSales(...args) {
    return executeDatabaseFunction("getSales", args);
}

export function deleteSale(...args) {
    return executeDatabaseFunction("deleteSale", args);
}

// ======================================================
// PAIEMENTS CLIENTS
// ======================================================

export function recordCustomerPayment(...args) {
    return executeDatabaseFunction("recordCustomerPayment", args);
}

export function getCustomerPayments(...args) {
    return executeDatabaseFunction("getCustomerPayments", args);
}

// ======================================================
// ACHATS
// ======================================================

export function createPurchase(...args) {
    return executeDatabaseFunction("createPurchase", args);
}

export function getPurchases(...args) {
    return executeDatabaseFunction("getPurchases", args);
}

// ======================================================
// DÉPENSES
// ======================================================

export function addExpense(...args) {
    return executeDatabaseFunction("addExpense", args);
}

export function getExpenses(...args) {
    return executeDatabaseFunction("getExpenses", args);
}

// ======================================================
// PERTES ET CASSES
// ======================================================

export function recordLoss(...args) {
    return executeDatabaseFunction("recordLoss", args);
}

export function getLosses(...args) {
    return executeDatabaseFunction("getLosses", args);
}

// ======================================================
// MOUVEMENTS DE STOCK
// ======================================================

export function getStockMovements(...args) {
    return executeDatabaseFunction("getStockMovements", args);
}

// ======================================================
// HISTORIQUE CLIENT
// ======================================================

export function getCustomerSales(...args) {
    return executeDatabaseFunction("getCustomerSales", args);
}

// ======================================================
// RÉSUMÉ FINANCIER
// ======================================================

export function getFinancialSummary(...args) {
    return executeDatabaseFunction("getFinancialSummary", args);
}

// ======================================================
// FIN DU ROUTEUR
// ======================================================