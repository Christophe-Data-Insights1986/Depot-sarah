// ======================================================
// DÉPÔT SARAH V2
// DATABASE-ROUTER.JS
// ROUTAGE AUTOMATIQUE DES BASES DE DONNÉES
// LEGACY : database.js
// SAAS   : tenant-business-database.js
// FIREBASE SDK 10.14.1
// ======================================================

import * as legacyDatabase from "./database.js";

import * as tenantDatabase from "./tenant-business-database.js";

import { currentAccountMode } from "./auth.js";

// ======================================================
// COLLECTIONS
// Les deux moteurs utilisent la même structure métier.
// ======================================================

export const COLLECTIONS = legacyDatabase.COLLECTIONS;

// ======================================================
// SÉLECTION DU MOTEUR ACTIF
// ======================================================

function getActiveDatabase() {

    if (currentAccountMode === "tenant") {

        return tenantDatabase;

    }

    return legacyDatabase;

}

// ======================================================
// EXÉCUTION D'UNE FONCTION DU MOTEUR ACTIF
// ======================================================

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
