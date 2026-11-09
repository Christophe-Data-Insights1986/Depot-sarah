// ======================================================
// DÉPÔT SARAH V2
// APP.JS — APPLICATION PRINCIPALE
// VERSION HARMONISÉE
// ======================================================

// ======================================================
// 1. IMPORTATIONS
// ======================================================

import {
    ADMIN_EMAIL,
    currentAccessUser,
    currentUserRole,
    approveUser,
    rejectUser
} from "./auth.js";

import {
    addProduct,
    getProducts,
    updateProduct,
    deleteProduct,
    updateStock,

    addCustomer,
    getCustomers,

    addSupplier,
    getSuppliers,

    createSale,
    getSales,

    recordCustomerPayment,
    getCustomerPayments,

    createPurchase,
    getPurchases,

    addExpense,
    getExpenses,

    recordLoss,
    getLosses,

    getStockMovements,
    getFinancialSummary,
    deleteSale
} from "./database.js";

import {
    enqueueOperation,
    syncPendingOperations,
    countPendingOperations,
    countFailedOperations,
    cleanCompletedOperations,
    isOnline,
    listenToConnection
} from "./offline.js";

import { db } from "./firebase.js";

import {
    collection,
    getDocs,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ======================================================
// 2. VARIABLES GLOBALES
// ======================================================

let products = [];
let customers = [];
let sales = [];
let suppliers = [];
let purchases = [];
let expenses = [];
let losses = [];
let customerPayments = [];
let stockMovements = [];

let financialSummary = {};

let loading = false;
let currentUser = null;
let currentRole = null;

let currentManagementSection = null;


// ======================================================
// 3. OUTILS GÉNÉRAUX
// ======================================================

const $ = (id) => document.getElementById(id);

function money(value) {

    return new Intl.NumberFormat("fr-FR", {
        maximumFractionDigits: 0
    }).format(Number(value) || 0) + " FCFA";
}

function number(value) {

    return Number(value) || 0;
}

function today() {

    const date = new Date();

    return date.toLocaleDateString("fr-CA");
}

function escapeHTML(value) {

    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function operationId() {

    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return "op-" + Date.now() + "-" +
        Math.random().toString(36).slice(2);
}

function showSyncStatus(message) {

    const element = $("sync-status");

    if (element) {
        element.textContent = message;
    }
}

function showMessage(message) {

    alert(message);
}

function getDate(value) {

    if (!value) return "Date inconnue";

    if (value.toDate) {
        return value.toDate().toLocaleString("fr-FR");
    }

    const date = new Date(value);

    return isNaN(date.getTime())
        ? "Date inconnue"
        : date.toLocaleString("fr-FR");
}

function isToday(value) {

    if (!value) return false;

    let date;

    if (value.toDate) {
        date = value.toDate();
    } else {
        date = new Date(value);
    }

    return !isNaN(date.getTime()) &&
        date.toLocaleDateString("fr-CA") === today();
}

function getStock(product) {

    return number(
        product.totalBottles ??
        product.qty ??
        product.quantity ??
        0
    );
}

function getUnits(product) {

    return Math.max(
        1,
        number(product.unitsPerCrate || product.units || 12)
    );
}

function getProductName(id) {

    return products.find(p => p.id === id)?.name ||
        "Produit inconnu";
}

function getCustomerName(id) {

    return customers.find(c => c.id === id)?.name ||
        "Client de passage";
}

function getSupplierName(id) {

    return suppliers.find(s => s.id === id)?.name ||
        "Fournisseur inconnu";
}

function requireAdmin() {

    if (currentRole !== "admin") {

        showMessage(
            "Cette opération est réservée à l'administrateur."
        );

        return false;
    }

    return true;
}


// ======================================================
// 4. CHARGEMENT DES DONNÉES
// ======================================================

async function loadAllData() {

    if (loading || !currentUser) return;

    loading = true;

    try {

        showSyncStatus("Chargement des données...");

        const results = await Promise.allSettled([

            getProducts(),
            getCustomers(),
            getSales(),
            getSuppliers(),
            getPurchases(),
            getExpenses(),
            getLosses(),
            getCustomerPayments(),
            getStockMovements(),
            getFinancialSummary()

        ]);

        const setters = [

            value => products = value,
            value => customers = value,
            value => sales = value,
            value => suppliers = value,
            value => purchases = value,
            value => expenses = value,
            value => losses = value,
            value => customerPayments = value,
            value => stockMovements = value,
            value => financialSummary = value

        ];

        const names = [

            "Produits",
            "Clients",
            "Ventes",
            "Fournisseurs",
            "Approvisionnements",
            "Dépenses",
            "Pertes",
            "Paiements clients",
            "Mouvements de stock",
            "Résumé financier"

        ];

        let errors = [];

        results.forEach((result, index) => {

            if (result.status === "fulfilled") {

                setters[index](
                    result.value || (index === 9 ? {} : [])
                );

            } else {

                errors.push(names[index]);

                console.error(
                    "Erreur chargement " + names[index],
                    result.reason
                );
            }
        });

        renderEverything();

        if (errors.length === 0) {

            showSyncStatus(
                isOnline()
                    ? "Connecté — données actualisées"
                    : "Hors connexion"
            );

        } else {

            showSyncStatus(
                "Chargement partiel — vérifie Firebase"
            );

            console.warn("Erreurs :", errors);
        }

    } catch (error) {

        console.error(error);

        showSyncStatus(
            "Erreur de chargement des données"
        );

    } finally {

        loading = false;
    }
}


// ======================================================
// 5. TABLEAU DE BORD
// ======================================================

function renderDashboard() {

    const summary = financialSummary || {};

    const stockBottles = products.reduce(
        (total, p) => total + getStock(p),
        0
    );

    const stockValue = products.reduce(
        (total, p) =>
            total + getStock(p) * number(p.purchasePrice),
        0
    );

    const dailySales = sales
        .filter(s => isToday(s.date || s.createdAt))
        .reduce((total, s) => total + number(s.total), 0);

    const dailyExpenses = expenses
        .filter(e => isToday(e.date || e.createdAt))
        .reduce((total, e) => total + number(e.amount), 0);

    const dailyProfit = sales
        .filter(s => isToday(s.date || s.createdAt))
        .reduce(
            (total, s) =>
                total + number(s.profit ?? s.estimatedProfit),
            0
        );

    const totalDebts = customers.reduce(
        (total, c) => total + number(c.debt),
        0
    );

    if ($("stat-products")) {
        $("stat-products").textContent = products.length;
    }

    if ($("stat-stock")) {
        $("stat-stock").textContent =
            stockBottles.toLocaleString("fr-FR");
    }

    if ($("stat-stock-cost")) {
        $("stat-stock-cost").textContent =
            money(summary.stockValue ?? stockValue);
    }

    if ($("stat-sales")) {
        $("stat-sales").textContent =
            money(summary.dailySales ?? dailySales);
    }

    if ($("stat-profit")) {
        $("stat-profit").textContent =
            money(summary.dailyProfit ?? dailyProfit);
    }

    if ($("stat-expenses")) {
        $("stat-expenses").textContent =
            money(summary.dailyExpenses ?? dailyExpenses);
    }

    if ($("stat-debts")) {
        $("stat-debts").textContent = money(
            summary.totalCustomerDebt ?? totalDebts
        );
    }

    renderLowStock();
}

function renderLowStock() {

    const container = $("low-stock-alerts");

    if (!container) return;

    const lowProducts = products.filter(product => {

        const threshold = number(
            product.lowStockThreshold ?? 12
        );

        return getStock(product) <= threshold;
    });

    if (!lowProducts.length) {

        container.innerHTML =
            "Aucune alerte de stock faible.";

        return;
    }

    container.innerHTML = lowProducts.map(product => `

        <div class="alert alert-warning">

            <strong>${escapeHTML(product.name)}</strong>

            — Stock restant :
            ${getStock(product)} bouteille(s)

        </div>

    `).join("");
}


// ======================================================
// 6. GESTION DU STOCK
// ======================================================

function renderProducts() {

    const container = $("products-table");

    if (!container) return;

    if (!products.length) {

        container.innerHTML = `
            <tr>
                <td colspan="5">
                    Aucun produit enregistré.
                </td>
            </tr>
        `;

        return;
    }

    container.innerHTML = products.map(product => `

        <tr>

            <td>
                <strong>${escapeHTML(product.name)}</strong>
                <br>
                ${escapeHTML(product.brand || product.format || "")}
            </td>

            <td>${getStock(product)} bouteilles</td>

            <td>${money(product.purchasePrice)}</td>

            <td>${money(product.sellingPrice)}</td>

            <td>

                <button
                    type="button"
                    data-action="adjust-stock"
                    data-id="${escapeHTML(product.id)}">
                    Ajuster
                </button>

                <button
                    type="button"
                    data-action="edit-product"
                    data-id="${escapeHTML(product.id)}">
                    Modifier
                </button>

                ${currentRole === "admin" ? `

                    <button
                        type="button"
                        data-action="delete-product"
                        data-id="${escapeHTML(product.id)}">
                        Supprimer
                    </button>

                ` : ""}

            </td>

        </tr>

    `).join("");
}

async function handleProductForm(event) {

    event.preventDefault();

    const data = {

        name: $("product-name").value.trim(),

        brand: $("product-brand").value.trim(),

        unitsPerCrate: number($("product-units").value),

        totalBottles: number($("product-quantity").value),

        purchasePrice: number($("product-cost").value),

        sellingPrice: number($("product-price").value),

        lowStockThreshold: number(
            $("product-threshold").value
        )

    };

    if (!data.name) {
        return showMessage("Le nom du produit est obligatoire.");
    }

    if (data.unitsPerCrate <= 0) {
        return showMessage("Le nombre de bouteilles par casier doit être positif.");
    }

    if (!isOnline()) {
        return showMessage(
            "L'ajout de produit nécessite une connexion Internet."
        );
    }

    try {

        await addProduct(data);

        event.target.reset();

        $("product-units").value = 12;
        $("product-quantity").value = 0;
        $("product-threshold").value = 12;

        await loadAllData();

        showMessage("Produit enregistré avec succès.");

    } catch (error) {

        console.error(error);

        showMessage("Impossible d'enregistrer le produit.");
    }
}

async function adjustProductStock(id) {

    const product = products.find(p => p.id === id);

    if (!product) return;

    const answer = prompt(
        "Stock actuel : " + getStock(product) +
        "\nEntrez la variation de stock.\n" +
        "Exemple : 24 pour ajouter, -12 pour retirer."
    );

    if (answer === null) return;

    const variation = Number(answer);

    if (!Number.isInteger(variation) || variation === 0) {

        return showMessage("Variation invalide.");
    }

    if (getStock(product) + variation < 0) {

        return showMessage("Stock insuffisant.");
    }

    try {

        await updateStock(
            id,
            variation,
            "Ajustement manuel"
        );

        await loadAllData();

        showMessage("Stock ajusté.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'ajustement.");
    }
}

async function editProduct(id) {

    const product = products.find(p => p.id === id);

    if (!product) return;

    const name = prompt("Nom du produit :", product.name);

    if (name === null || !name.trim()) return;

    const cost = prompt(
        "Prix d'achat par bouteille :",
        product.purchasePrice
    );

    if (cost === null) return;

    const price = prompt(
        "Prix de vente par bouteille :",
        product.sellingPrice
    );

    if (price === null) return;

    try {

        await updateProduct(id, {

            name: name.trim(),

            purchasePrice: number(cost),

            sellingPrice: number(price)

        });

        await loadAllData();

        showMessage("Produit modifié.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant la modification.");
    }
}

async function removeProduct(id) {

    if (!requireAdmin()) return;

    if (!confirm("Supprimer définitivement ce produit ?")) return;

    try {

        await deleteProduct(id);

        await loadAllData();

        showMessage("Produit supprimé.");

    } catch (error) {

        console.error(error);

        showMessage("Impossible de supprimer ce produit.");
    }
}


// ======================================================
// 7. LISTES DÉROULANTES
// ======================================================

function renderSelects() {

    const productSelect = $("sale-product");

    if (productSelect) {

        productSelect.innerHTML = `

            <option value="">Choisir une boisson</option>

            ${products.map(p => `

                <option value="${escapeHTML(p.id)}">

                    ${escapeHTML(p.name)}
                    — Stock : ${getStock(p)}

                </option>

            `).join("")}

        `;
    }

    const customerSelect = $("sale-customer");

    if (customerSelect) {

        customerSelect.innerHTML = `

            <option value="">Client de passage</option>

            ${customers.map(c => `

                <option value="${escapeHTML(c.id)}">

                    ${escapeHTML(c.name)}

                </option>

            `).join("")}

        `;
    }
}

function updateSalePrices() {

    const id = $("sale-product")?.value;

    const product = products.find(p => p.id === id);

    if (!product) return;

    const units = getUnits(product);

    if ($("sale-bottle-price")) {
        $("sale-bottle-price").value =
            number(product.sellingPrice);
    }

    if ($("sale-crate-price")) {
        $("sale-crate-price").value =
            number(product.cratePrice) ||
            number(product.sellingPrice) * units;
    }
}


// ======================================================
// 8. VENTES
// ======================================================

function calculateSaleTotal() {

    const crates = number($("sale-crates")?.value);

    const bottles = number($("sale-bottles")?.value);

    const cratePrice = number(
        $("sale-crate-price")?.value
    );

    const bottlePrice = number(
        $("sale-bottle-price")?.value
    );

    return crates * cratePrice + bottles * bottlePrice;
}

async function handleSaleForm(event) {

    event.preventDefault();

    const productId = $("sale-product").value;

    const product = products.find(p => p.id === productId);

    if (!product) {
        return showMessage("Choisis une boisson.");
    }

    const crates = number($("sale-crates").value);

    const extraBottles = number($("sale-bottles").value);

    const unitsPerCrate = getUnits(product);

    const quantity = crates * unitsPerCrate + extraBottles;

    if (quantity <= 0) {
        return showMessage("La quantité vendue doit être positive.");
    }

    if (quantity > getStock(product)) {
        return showMessage("Stock insuffisant.");
    }

    const cratePrice = number($("sale-crate-price").value);

    const bottlePrice = number($("sale-bottle-price").value);

    const total = crates * cratePrice +
        extraBottles * bottlePrice;

    const paymentMode = $("sale-payment").value;

    let amountPaid = number($("sale-amount-paid").value);

    if (paymentMode === "credit") {
        amountPaid = 0;
    } else if (
        paymentMode !== "partial" &&
        paymentMode !== "credit"
    ) {
        amountPaid = total;
    }

    if (amountPaid > total) {
        return showMessage("Le montant payé dépasse le montant de la vente.");
    }

    if (paymentMode === "partial" && amountPaid <= 0) {
        return showMessage("Indique le montant déjà payé.");
    }

    if (
        (paymentMode === "credit" || paymentMode === "partial") &&
        !$("sale-customer").value
    ) {
        return showMessage(
            "Un client doit être sélectionné pour une vente à crédit ou partielle."
        );
    }

    const payload = {

        operationId: operationId(),

        items: [{

            productId,

            crates,

            extraBottles,

            unitsPerCrate,

            cratePrice,

            bottlePrice

        }],

        customerId: $("sale-customer").value || null,

        customerName: $("sale-customer").selectedOptions[0]?.textContent || "Client de passage",

        paymentMode,

        paymentMethod: paymentMode,

        amountPaid

    };

    try {

        if (!isOnline()) {

            await enqueueOperation(
                "createSale",
                payload,
                payload.operationId,
                currentUser.uid
            );

            event.target.reset();

            await updatePendingStatus();

            showMessage(
                "Vente enregistrée localement. Elle sera synchronisée au retour d'Internet."
            );

            return;
        }

        await createSale(payload);

        event.target.reset();

        await loadAllData();

        showMessage("Vente enregistrée avec succès.");

    } catch (error) {

        console.error(error);

        showMessage(
            "Erreur pendant l'enregistrement de la vente : " +
            (error.message || "")
        );
    }
}

function renderSales() {

    const container = $("sales-history");

    if (!container) return;

    if (!sales.length) {

        container.innerHTML = "Aucune vente enregistrée.";

        return;
    }

    const sorted = [...sales].sort(
        (a, b) =>
            new Date(b.date || b.createdAt) -
            new Date(a.date || a.createdAt)
    );

    container.innerHTML = sorted.map(sale => `

        <div class="content-card">

            <strong>Vente : ${money(sale.total)}</strong>

            <p>Client : ${escapeHTML(
                sale.customerName || "Client de passage"
            )}</p>

            <p>Date : ${getDate(sale.date || sale.createdAt)}</p>

            <p>Payé : ${money(sale.amountPaid)}</p>

            <p>Crédit : ${money(sale.debt)}</p>

            <p>Mode : ${escapeHTML(sale.paymentMethod || "")}</p>

            ${currentRole === "admin" && number(sale.amountPaid) === 0 ? `

                <button
                    type="button"
                    data-action="delete-sale"
                    data-id="${escapeHTML(sale.id)}">
                    Annuler la vente
                </button>

            ` : ""}

        </div>

    `).join("");
}

async function removeSale(id) {

    if (!requireAdmin()) return;

    if (!confirm("Annuler cette vente ?")) return;

    try {

        await deleteSale(id);

        await loadAllData();

        showMessage("Vente annulée.");

    } catch (error) {

        console.error(error);

        showMessage(error.message || "Impossible d'annuler cette vente.");
    }
}


// ======================================================
// 9. CLIENTS ET CRÉDITS
// ======================================================

async function handleCustomerForm(event) {

    event.preventDefault();

    const data = {

        name: $("customer-name").value.trim(),

        phone: $("customer-phone").value.trim(),

        debt: 0,

        totalPurchases: 0

    };

    if (!data.name) {
        return showMessage("Le nom du client est obligatoire.");
    }

    try {

        await addCustomer(data);

        event.target.reset();

        await loadAllData();

        showMessage("Client enregistré.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'ajout du client.");
    }
}

function renderCustomers() {

    const container = $("customers-list");

    if (!container) return;

    if (!customers.length) {

        container.innerHTML = "Aucun client enregistré.";

        return;
    }

    container.innerHTML = customers.map(customer => `

        <div class="content-card">

            <h3>${escapeHTML(customer.name)}</h3>

            <p>Téléphone :
                ${escapeHTML(customer.phone || "Non renseigné")}
            </p>

            <p>Crédit restant :
                <strong>${money(customer.debt)}</strong>
            </p>

            <button
                type="button"
                data-action="customer-payment"
                data-id="${escapeHTML(customer.id)}">
                Enregistrer un remboursement
            </button>

        </div>

    `).join("");
}

async function registerCustomerPayment(id) {

    const customer = customers.find(c => c.id === id);

    if (!customer) return;

    const amount = Number(
        prompt(
            "Dette actuelle : " + money(customer.debt) +
            "\nMontant remboursé :"
        )
    );

    if (!Number.isFinite(amount) || amount <= 0) {
        return showMessage("Montant invalide.");
    }

    if (amount > number(customer.debt)) {
        return showMessage("Le montant dépasse la dette du client.");
    }

    const method = prompt(
        "Mode de paiement : espèces, Orange Money ou MTN MoMo",
        "Espèces"
    );

    if (method === null) return;

    const payload = {

        operationId: operationId(),

        customerId: id,

        amount,

        method,

        note: "Remboursement client"

    };

    try {

        if (!isOnline()) {

            await enqueueOperation(
                "recordCustomerPayment",
                payload,
                payload.operationId,
                currentUser.uid
            );

            await updatePendingStatus();

            showMessage(
                "Remboursement enregistré localement. Synchronisation en attente."
            );

            return;
        }

        await recordCustomerPayment(payload);

        await loadAllData();

        showMessage("Remboursement enregistré.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant le remboursement.");
    }
}


// ======================================================
// 10. FOURNISSEURS
// ======================================================

function renderSuppliers() {

    const container = $("suppliers-list");

    if (!container) return;

    container.innerHTML = `

        <form id="supplier-form">

            <label>Nom du fournisseur</label>

            <input id="supplier-name" required>

            <label>Téléphone</label>

            <input id="supplier-phone" type="tel">

            <label>Adresse</label>

            <input id="supplier-address">

            <button type="submit">
                Ajouter le fournisseur
            </button>

        </form>

        <hr>

        ${suppliers.map(s => `

            <div class="content-card">

                <strong>${escapeHTML(s.name)}</strong>

                <p>${escapeHTML(s.phone || "")}</p>

                <p>Dette fournisseur : ${money(s.debt)}</p>

            </div>

        `).join("")}

    `;

    $("supplier-form")?.addEventListener(
        "submit",
        handleSupplierForm
    );
}

async function handleSupplierForm(event) {

    event.preventDefault();

    try {

        await addSupplier({

            name: $("supplier-name").value.trim(),

            phone: $("supplier-phone").value.trim(),

            address: $("supplier-address").value.trim(),

            debt: 0

        });

        await loadAllData();

        showMessage("Fournisseur enregistré.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'ajout du fournisseur.");
    }
}


// ======================================================
// 11. APPROVISIONNEMENTS
// ======================================================

function renderPurchases() {

    const stockContainer = $("purchases-list");

    const managementContainer = $("management-purchases");

    const html = `

        <form id="purchase-form">

            <label>Fournisseur</label>

            <select id="purchase-supplier">

                <option value="">Aucun fournisseur</option>

                ${suppliers.map(s => `

                    <option value="${escapeHTML(s.id)}">
                        ${escapeHTML(s.name)}
                    </option>

                `).join("")}

            </select>

            <label>Boisson</label>

            <select id="purchase-product" required>

                <option value="">Choisir une boisson</option>

                ${products.map(p => `

                    <option value="${escapeHTML(p.id)}">
                        ${escapeHTML(p.name)}
                    </option>

                `).join("")}

            </select>

            <label>Nombre de casiers</label>

            <input
                type="number"
                id="purchase-crates"
                min="0"
                value="0"
            >

            <label>Bouteilles supplémentaires</label>

            <input
                type="number"
                id="purchase-bottles"
                min="0"
                value="0"
            >

            <label>Prix d'achat par bouteille</label>

            <input
                type="number"
                id="purchase-price"
                min="0"
                required
            >

            <label>Montant payé</label>

            <input
                type="number"
                id="purchase-paid"
                min="0"
                value="0"
            >

            <button type="submit">
                Enregistrer l'approvisionnement
            </button>

        </form>

    `;

    if (stockContainer) {
        stockContainer.innerHTML = html;
    }

    if (managementContainer) {
        managementContainer.innerHTML = html;
    }

    $("purchase-form")?.addEventListener(
        "submit",
        handlePurchaseForm
    );

    $("management-purchases")?.querySelector(
        "#purchase-form"
    )?.addEventListener("submit", handlePurchaseForm);

    const history = purchases.map(p => `

        <div class="content-card">

            <strong>Approvisionnement : ${money(p.total)}</strong>

            <p>Fournisseur :
                ${escapeHTML(p.supplierName || "Non renseigné")}
            </p>

            <p>Payé : ${money(p.amountPaid)}</p>

            <p>Dette : ${money(p.debt)}</p>

            <p>Date : ${getDate(p.date || p.createdAt)}</p>

        </div>

    `).join("");

    if (stockContainer) {
        stockContainer.innerHTML += history;
    }

    if (managementContainer) {
        managementContainer.innerHTML += history;
    }
}

async function handlePurchaseForm(event) {

    event.preventDefault();

    const productId = $("purchase-product")?.value;

    const product = products.find(p => p.id === productId);

    if (!product) {
        return showMessage("Choisis une boisson.");
    }

    const crates = number($("purchase-crates").value);

    const extraBottles = number($("purchase-bottles").value);

    const unitsPerCrate = getUnits(product);

    const quantity = crates * unitsPerCrate + extraBottles;

    const purchasePrice = number(
        $("purchase-price").value
    );

    const amountPaid = number(
        $("purchase-paid").value
    );

    if (quantity <= 0 || purchasePrice <= 0) {
        return showMessage("Quantité ou prix invalide.");
    }

    const total = quantity * purchasePrice;

    if (amountPaid > total) {
        return showMessage("Le paiement dépasse le total.");
    }

    const payload = {

        operationId: operationId(),

        supplierId: $("purchase-supplier").value || null,

        supplierName: $("purchase-supplier").selectedOptions[0]?.textContent || "",

        amountPaid,

        items: [{

            productId,

            crates,

            extraBottles,

            unitsPerCrate,

            purchasePrice

        }]

    };

    try {

        if (!isOnline()) {

            await enqueueOperation(
                "createPurchase",
                payload,
                payload.operationId,
                currentUser.uid
            );

            await updatePendingStatus();

            showMessage(
                "Approvisionnement enregistré localement. Synchronisation en attente."
            );

            return;
        }

        await createPurchase(payload);

        await loadAllData();

        showMessage("Approvisionnement enregistré.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'approvisionnement.");
    }
}


// ======================================================
// 12. DÉPENSES
// ======================================================

function renderExpenses() {

    const container = $("expenses-list");

    if (!container) return;

    container.innerHTML = `

        <form id="expense-form">

            <label>Libellé</label>

            <input id="expense-title" required>

            <label>Catégorie</label>

            <select id="expense-category">

                <option value="Transport">Transport</option>
                <option value="Électricité">Électricité</option>
                <option value="Loyer">Loyer</option>
                <option value="Personnel">Personnel</option>
                <option value="Entretien">Entretien</option>
                <option value="Autre">Autre</option>

            </select>

            <label>Montant (FCFA)</label>

            <input
                type="number"
                id="expense-amount"
                min="1"
                required
            >

            <label>Description</label>

            <textarea id="expense-description"></textarea>

            <button type="submit">
                Enregistrer la dépense
            </button>

        </form>

        <hr>

        ${expenses.map(e => `

            <div class="content-card">

                <strong>${escapeHTML(e.title || e.name || "Dépense")}</strong>

                <p>${escapeHTML(e.category || "")}</p>

                <p>${money(e.amount)}</p>

                <p>${getDate(e.date || e.createdAt)}</p>

            </div>

        `).join("")}

    `;

    $("expense-form")?.addEventListener(
        "submit",
        handleExpenseForm
    );
}

async function handleExpenseForm(event) {

    event.preventDefault();

    if (!isOnline()) {
        return showMessage(
            "Connecte-toi à Internet pour enregistrer cette dépense."
        );
    }

    try {

        await addExpense({

            title: $("expense-title").value.trim(),

            category: $("expense-category").value,

            amount: number($("expense-amount").value),

            description: $("expense-description").value.trim()

        });

        await loadAllData();

        showMessage("Dépense enregistrée.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'enregistrement.");
    }
}


// ======================================================
// 13. PERTES ET BOUTEILLES CASSÉES
// ======================================================

function renderLosses() {

    const container = $("losses-list");

    if (!container) return;

    container.innerHTML = `

        <form id="loss-form">

            <label>Boisson concernée</label>

            <select id="loss-product" required>

                <option value="">Choisir une boisson</option>

                ${products.map(p => `

                    <option value="${escapeHTML(p.id)}">
                        ${escapeHTML(p.name)}
                        — Stock : ${getStock(p)}
                    </option>

                `).join("")}

            </select>

            <label>Nombre de bouteilles perdues</label>

            <input
                type="number"
                id="loss-quantity"
                min="1"
                required
            >

            <label>Motif</label>

            <select id="loss-reason">

                <option value="Bouteilles cassées">Bouteilles cassées</option>
                <option value="Produits périmés">Produits périmés</option>
                <option value="Perte">Perte</option>
                <option value="Autre">Autre</option>

            </select>

            <button type="submit">
                Enregistrer la perte
            </button>

        </form>

        <hr>

        ${losses.map(loss => `

            <div class="content-card">

                <strong>${escapeHTML(loss.productName || "Produit")}</strong>

                <p>Quantité : ${number(loss.quantity)}</p>

                <p>Motif : ${escapeHTML(loss.reason || "")}</p>

                <p>Valeur estimée : ${money(loss.estimatedValue)}</p>

                <p>Date : ${getDate(loss.date || loss.createdAt)}</p>

            </div>

        `).join("")}

    `;

    $("loss-form")?.addEventListener(
        "submit",
        handleLossForm
    );
}

async function handleLossForm(event) {

    event.preventDefault();

    const productId = $("loss-product").value;

    const product = products.find(p => p.id === productId);

    const quantity = number(
        $("loss-quantity").value
    );

    if (!product || quantity <= 0) {
        return showMessage("Informations invalides.");
    }

    if (quantity > getStock(product)) {
        return showMessage("La perte dépasse le stock disponible.");
    }

    if (!isOnline()) {
        return showMessage(
            "Connecte-toi à Internet pour enregistrer une perte."
        );
    }

    try {

        await recordLoss({

            productId,

            quantity,

            reason: $("loss-reason").value,

            description: ""

        });

        await loadAllData();

        showMessage("Perte enregistrée.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'enregistrement de la perte.");
    }
}


// ======================================================
// 14. CLÔTURE DE CAISSE
// ======================================================

async function renderCashClosures() {

    const container = $("cash-closures");

    if (!container) return;

    try {

        const snapshot = await getDocs(
            collection(db, "cashClosures")
        );

        const closures = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        container.innerHTML = `

            <h3>Nouvelle clôture</h3>

            <form id="cash-form">

                <label>Montant en espèces</label>

                <input
                    type="number"
                    id="cash-amount"
                    min="0"
                    required
                >

                <label>Commentaire</label>

                <textarea id="cash-note"></textarea>

                <button type="submit">
                    Enregistrer la clôture
                </button>

            </form>

            <hr>

            <h3>Historique des clôtures</h3>

            ${closures.map(c => `

                <div class="content-card">

                    <strong>${money(c.amount)}</strong>

                    <p>${escapeHTML(c.note || "")}</p>

                    <p>${getDate(c.createdAt)}</p>

                </div>

            `).join("")}

        `;

        $("cash-form")?.addEventListener(
            "submit",
            handleCashForm
        );

    } catch (error) {

        console.error(error);

        container.textContent =
            "Impossible de charger les clôtures de caisse.";
    }
}

async function handleCashForm(event) {

    event.preventDefault();

    const amount = number($("cash-amount").value);

    if (!isOnline()) {
        return showMessage(
            "Une connexion Internet est nécessaire."
        );
    }

    try {

        await addDoc(collection(db, "cashClosures"), {

            amount,

            note: $("cash-note").value.trim(),

            date: new Date().toISOString(),

            createdBy: currentUser.uid,

            createdAt: serverTimestamp()

        });

        await renderCashClosures();

        showMessage("Clôture de caisse enregistrée.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant la clôture.");
    }
}


// ======================================================
// 15. RAPPORTS
// ======================================================

function renderReports() {

    const container = $("reports-content");

    if (!container) return;

    const summary = financialSummary || {};

    container.innerHTML = `

        <div class="content-card">

            <h3>Rapport financier</h3>

            <p>Ventes totales :
                <strong>${money(summary.totalSales)}</strong>
            </p>

            <p>Bénéfice total :
                <strong>${money(summary.totalProfit)}</strong>
            </p>

            <p>Dépenses :
                <strong>${money(summary.totalExpenses)}</strong>
            </p>

            <p>Achats :
                <strong>${money(summary.totalPurchases)}</strong>
            </p>

            <p>Pertes :
                <strong>${money(summary.totalLosses)}</strong>
            </p>

            <p>Dettes clients :
                <strong>${money(summary.totalCustomerDebt)}</strong>
            </p>

            <p>Dettes fournisseurs :
                <strong>${money(summary.totalSupplierDebt)}</strong>
            </p>

            <p>Résultat net estimé :
                <strong>${money(summary.estimatedNetResult)}</strong>
            </p>

        </div>

        <div class="content-card">

            <h3>Activité du jour</h3>

            <p>Ventes : ${money(summary.dailySales)}</p>

            <p>Bénéfice : ${money(summary.dailyProfit)}</p>

            <p>Dépenses : ${money(summary.dailyExpenses)}</p>

            <p>Pertes : ${money(summary.dailyLosses)}</p>

            <p>Résultat net : ${money(summary.dailyNetResult)}</p>

        </div>

    `;
}


// ======================================================
// 16. GESTION DES UTILISATEURS
// ======================================================

async function renderUsers() {

    const container = $("users-list");

    if (!container) return;

    if (!requireAdmin()) {

        container.innerHTML =
            "Accès réservé à l'administrateur.";

        return;
    }

    try {

        const snapshot = await getDocs(
            collection(db, "userRequests")
        );

        const requests = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        container.innerHTML = requests.map(user => `

            <div class="content-card">

                <strong>${escapeHTML(user.name || "Utilisateur")}</strong>

                <p>${escapeHTML(user.email || "")}</p>

                <p>Statut : ${escapeHTML(user.status || "En attente")}</p>

                ${user.status === "pending" ? `

                    <button
                        type="button"
                        data-action="approve-user"
                        data-id="${escapeHTML(user.uid || user.id)}"
                        data-email="${escapeHTML(user.email || "")}"
                        data-name="${escapeHTML(user.name || "")}">
                        Approuver
                    </button>

                    <button
                        type="button"
                        data-action="reject-user"
                        data-id="${escapeHTML(user.uid || user.id)}">
                        Refuser
                    </button>

                ` : ""}

            </div>

        `).join("");

    } catch (error) {

        console.error(error);

        container.textContent =
            "Impossible de charger les demandes.";
    }
}

async function handleApproveUser(button) {

    if (!requireAdmin()) return;

    try {

        await approveUser(
            button.dataset.id,
            button.dataset.email,
            button.dataset.name
        );

        await renderUsers();

        showMessage("Utilisateur approuvé comme opérateur.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant l'approbation.");
    }
}

async function handleRejectUser(id) {

    if (!requireAdmin()) return;

    if (!confirm("Refuser cette demande ?")) return;

    try {

        await rejectUser(id);

        await renderUsers();

        showMessage("Demande refusée.");

    } catch (error) {

        console.error(error);

        showMessage("Erreur pendant le refus.");
    }
}


// ======================================================
// 17. SAUVEGARDE DES DONNÉES
// ======================================================

function renderBackup() {

    const container = $("backup-content");

    if (!container) return;

    container.innerHTML = `

        <p>
            Télécharger une copie des données du dépôt
            au format JSON.
        </p>

        <button type="button" id="export-backup">
            Télécharger la sauvegarde
        </button>

    `;

    $("export-backup")?.addEventListener(
        "click",
        exportBackup
    );
}

async function exportBackup() {

    if (!requireAdmin()) return;

    const backup = {

        application: "Dépôt Sarah",

        version: 2,

        exportDate: new Date().toISOString(),

        products,

        customers,

        sales,

        suppliers,

        purchases,

        expenses,

        losses,

        customerPayments,

        stockMovements,

        financialSummary

    };

    const blob = new Blob(
        [JSON.stringify(backup, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download =
        "depot-sarah-sauvegarde-" + today() + ".json";

    link.click();

    URL.revokeObjectURL(url);
}


// ======================================================
// 18. SYNCHRONISATION HORS CONNEXION
// ======================================================

async function processOfflineOperation(operation) {

    const payload = {

        ...operation.payload,

        operationId: operation.operationId

    };

    switch (operation.type) {

        case "createSale":

            return await createSale(payload);

        case "createPurchase":

            return await createPurchase(payload);

        case "recordCustomerPayment":

            return await recordCustomerPayment(payload);

        default:

            throw new Error(
                "Opération hors connexion non reconnue : " +
                operation.type
            );
    }
}

async function synchronizeOfflineData() {

    if (!currentUser || !isOnline()) return;

    try {

        showSyncStatus("Synchronisation en cours...");

        await syncPendingOperations(
            processOfflineOperation,
            currentUser.uid
        );

        await cleanCompletedOperations();

        await updatePendingStatus();

        await loadAllData();

    } catch (error) {

        console.error("Erreur synchronisation :", error);

        showSyncStatus("Synchronisation incomplète.");
    }
}

async function updatePendingStatus() {

    if (!currentUser) return;

    const pending = await countPendingOperations(
        currentUser.uid
    );

    const failed = await countFailedOperations(
        currentUser.uid
    );

    if (pending > 0) {

        showSyncStatus(
            pending + " opération(s) en attente de synchronisation."
        );

    } else if (failed > 0) {

        showSyncStatus(
            failed + " opération(s) à vérifier."
        );

    } else {

        showSyncStatus(
            isOnline()
                ? "Connecté — synchronisation terminée"
                : "Hors connexion"
        );
    }
}


// ======================================================
// 19. NAVIGATION
// ======================================================

function initializeNavigation() {

    document.querySelectorAll(".nav-button").forEach(button => {

        button.addEventListener("click", () => {

            const page = button.dataset.page;

            document.querySelectorAll(".page").forEach(section => {

                section.hidden = section.id !== page;

                section.classList.toggle(
                    "active",
                    section.id === page
                );
            });

            document.querySelectorAll(".nav-button").forEach(nav => {

                nav.classList.toggle(
                    "active",
                    nav === button
                );
            });
        });
    });

    document.querySelectorAll(
        ".management-menu button"
    ).forEach(button => {

        button.addEventListener("click", async () => {

            const sectionId = button.dataset.section;

            document.querySelectorAll(
                ".management-section"
            ).forEach(section => {

                section.hidden = section.id !== sectionId;
            });

            currentManagementSection = sectionId;

            await renderManagementSection(sectionId);
        });
    });
}

async function renderManagementSection(sectionId) {

    switch (sectionId) {

        case "suppliers-section":
            renderSuppliers();
            break;

        case "purchases-section":
            renderPurchases();
            break;

        case "expenses-section":
            renderExpenses();
            break;

        case "losses-section":
            renderLosses();
            break;

        case "cash-section":
            await renderCashClosures();
            break;

        case "reports-section":
            renderReports();
            break;

        case "users-section":
            await renderUsers();
            break;

        case "backup-section":
            renderBackup();
            break;
    }
}


// ======================================================
// 20. ACTIONS DES TABLEAUX
// ======================================================

document.addEventListener("click", async event => {

    const button = event.target.closest("[data-action]");

    if (!button) return;

    const action = button.dataset.action;

    const id = button.dataset.id;

    try {

        switch (action) {

            case "adjust-stock":
                await adjustProductStock(id);
                break;

            case "edit-product":
                await editProduct(id);
                break;

            case "delete-product":
                await removeProduct(id);
                break;

            case "delete-sale":
                await removeSale(id);
                break;

            case "customer-payment":
                await registerCustomerPayment(id);
                break;

            case "approve-user":
                await handleApproveUser(button);
                break;

            case "reject-user":
                await handleRejectUser(id);
                break;
        }

    } catch (error) {

        console.error(error);

        showMessage("Une erreur est survenue.");
    }
});


// ======================================================
// 21. AFFICHAGE GLOBAL
// ======================================================

function renderEverything() {

    renderDashboard();

    renderProducts();

    renderSelects();

    renderSales();

    renderCustomers();

    renderSuppliers();

    renderPurchases();

    renderExpenses();

    renderLosses();

    renderReports();

    if (currentManagementSection === "cash-section") {
        renderCashClosures();
    }

    if (currentManagementSection === "users-section") {
        renderUsers();
    }

    if (currentManagementSection === "backup-section") {
        renderBackup();
    }
}


// ======================================================
// 22. INITIALISATION DES FORMULAIRES
// ======================================================

function initializeForms() {

    $("product-form")?.addEventListener(
        "submit",
        handleProductForm
    );

    $("sale-form")?.addEventListener(
        "submit",
        handleSaleForm
    );

    $("customer-form")?.addEventListener(
        "submit",
        handleCustomerForm
    );

    $("sale-product")?.addEventListener(
        "change",
        updateSalePrices
    );

    $("sale-crates")?.addEventListener(
        "input",
        () => {}
    );

    $("sale-bottles")?.addEventListener(
        "input",
        () => {}
    );
}


// ======================================================
// 23. RÔLES ET AFFICHAGE
// ======================================================

function applyUserPermissions() {

    const usersButton = document.querySelector(
        '[data-section="users-section"]'
    );

    if (usersButton) {

        usersButton.hidden = currentRole !== "admin";
    }

    const backupButton = document.querySelector(
        '[data-section="backup-section"]'
    );

    if (backupButton) {

        backupButton.hidden = currentRole !== "admin";
    }
}


// ======================================================
// 24. CONNEXION UTILISATEUR
// ======================================================

async function startApplication(event) {

    currentUser = event.detail.user;

    currentRole = event.detail.role ||
        (event.detail.isAdmin ? "admin" : "operator");

    applyUserPermissions();

    initializeNavigation();

    initializeForms();

    await loadAllData();

    await synchronizeOfflineData();

    listenToConnection(online => {

        if (online) {

            showSyncStatus("Connexion rétablie.");

            synchronizeOfflineData();

        } else {

            showSyncStatus("Mode hors connexion.");
        }
    });

    window.addEventListener("online", () => {
        synchronizeOfflineData();
    });
}


// ======================================================
// 25. ÉVÉNEMENTS D'AUTHENTIFICATION
// ======================================================

window.addEventListener(
    "sarah-auth-ready",
    startApplication
);

window.addEventListener(
    "sarah-auth-logged-out",
    () => {

        currentUser = null;

        currentRole = null;

        products = [];
        customers = [];
        sales = [];
        suppliers = [];
        purchases = [];
        expenses = [];
        losses = [];

        showSyncStatus("Déconnecté.");
    }
);


// ======================================================
// 26. INITIALISATION
// ======================================================

console.log("Dépôt Sarah V2 — Application principale chargée.");
