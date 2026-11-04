// ======================================================
// DÉPÔT SARAH V2
// APP.JS — APPLICATION PRINCIPALE
// ======================================================

// AUTHENTIFICATION
import "./auth.js";

// FIREBASE
import { auth, db } from "./firebase.js";

import {
    collection,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// BASE DE DONNÉES
import {
    addProduct,
    getProducts,
    updateProduct,
    deleteProduct,
    createSale,
    getSales,
    addCustomer,
    getCustomers,
    addSupplier,
    getSuppliers,
    createPurchase,
    getPurchases,
    addExpense,
    getExpenses,
    recordLoss,
    getLosses,
    recordCustomerPayment,
    getFinancialSummary,
    getCustomerPayments,
    getStockMovements
} from "./database.js";

// MODE HORS CONNEXION
import {
    openOfflineDB,
    enqueueOperation,
    syncPendingOperations,
    countPendingOperations,
    countFailedOperations,
    listenToConnection,
    isOnline
} from "./offline.js";


// ======================================================
// 1. VARIABLES GÉNÉRALES
// ======================================================

const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let currentUser = null;
let currentIsAdmin = false;

let products = [];
let customers = [];
let sales = [];
let suppliers = [];
let purchases = [];
let expenses = [];
let losses = [];

let loading = false;

const $ = id => document.getElementById(id);


// ======================================================
// 2. OUTILS
// ======================================================

function money(value) {

    return new Intl.NumberFormat("fr-FR").format(
        Number(value || 0)
    ) + " FCFA";

}


function number(value) {

    return Number(value || 0);

}


function escapeHTML(value) {

    return String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[character]
    );

}


function notify(message) {

    alert(message);

}


function dateFormat(value) {

    if (!value) return "Date inconnue";

    const date = value.toDate
        ? value.toDate()
        : new Date(value);

    if (isNaN(date.getTime())) {
        return "Date inconnue";
    }

    return date.toLocaleString("fr-FR");

}


function today() {

    return new Date().toDateString();

}


function isToday(item) {

    const date = item.date?.toDate
        ? item.date.toDate()
        : new Date(item.date);

    return !isNaN(date.getTime()) &&
        date.toDateString() === today();

}


function showSyncStatus(message) {

    const element = $("sync-status");

    if (element) {
        element.textContent = message;
    }

}


// ======================================================
// 3. NAVIGATION
// ======================================================

function initializeNavigation() {

    document.querySelectorAll(".nav-button").forEach(button => {

        button.addEventListener("click", () => {

            const page = button.dataset.page;

            document.querySelectorAll(".page").forEach(section => {

                section.hidden = true;
                section.classList.remove("active");

            });

            document.querySelectorAll(".nav-button").forEach(item => {

                item.classList.remove("active");

            });

            const selectedPage = $(page);

            if (selectedPage) {

                selectedPage.hidden = false;
                selectedPage.classList.add("active");

            }

            button.classList.add("active");

        });

    });


    document.querySelectorAll(".management-menu button").forEach(button => {

        button.addEventListener("click", () => {

            document.querySelectorAll(".management-section").forEach(section => {

                section.hidden = true;

            });

            const section = $(button.dataset.section);

            if (section) {
                section.hidden = false;
            }

        });

    });

}


// ======================================================
// 4. CHARGEMENT DES DONNÉES
// ======================================================

async function loadAllData() {

    if (loading) return;

    loading = true;

    try {

        showSyncStatus("Chargement des données...");

        const results = await Promise.all([

            getProducts(),
            getCustomers(),
            getSales(),
            getSuppliers(),
            getPurchases(),
            getExpenses(),
            getLosses()

        ]);

        products = results[0];
        customers = results[1];
        sales = results[2];
        suppliers = results[3];
        purchases = results[4];
        expenses = results[5];
        losses = results[6];

        renderEverything();

        showSyncStatus(
            isOnline()
                ? "Connecté — données synchronisées"
                : "Hors connexion"
        );

    } catch (error) {

        console.error(error);

        showSyncStatus("Erreur de chargement des données");

        notify(
            "Impossible de charger les données. Vérifie ta connexion et les règles Firebase."
        );

    } finally {

        loading = false;

    }

}


// ======================================================
// 5. AFFICHAGE GÉNÉRAL
// ======================================================

function renderEverything() {

    renderDashboard();

    renderProducts();

    renderProductOptions();

    renderCustomers();

    renderCustomerOptions();

    renderSales();

    renderSuppliers();

    renderPurchases();

    renderExpenses();

    renderLosses();

    renderReports();

    renderUsers();

}


// ======================================================
// 6. TABLEAU DE BORD
// ======================================================

function renderDashboard() {

    const totalStock = products.reduce(
        (sum, product) => sum + number(product.totalBottles),
        0
    );

    const stockCost = products.reduce(
        (sum, product) =>
            sum +
            number(product.totalBottles) *
            number(product.purchasePrice),
        0
    );

    const dailySales = sales
        .filter(isToday)
        .reduce((sum, sale) => sum + number(sale.total), 0);

    const dailyProfit = sales
        .filter(isToday)
        .reduce((sum, sale) => sum + number(sale.profit), 0);

    const dailyExpenses = expenses
        .filter(isToday)
        .reduce((sum, expense) => sum + number(expense.amount), 0);

    const debts = customers.reduce(
        (sum, customer) => sum + number(customer.debt),
        0
    );

    $("stat-products").textContent = products.length;

    $("stat-stock").textContent = totalStock;

    $("stat-stock-cost").textContent = money(stockCost);

    $("stat-sales").textContent = money(dailySales);

    $("stat-profit").textContent = money(dailyProfit);

    $("stat-expenses").textContent = money(dailyExpenses);

    $("stat-debts").textContent = money(debts);


    const alerts = products.filter(product =>

        number(product.totalBottles) <=
        number(product.lowStockThreshold)

    );

    $("low-stock-alerts").innerHTML = alerts.length

        ? alerts.map(product => `

            <p>
                ⚠️ ${escapeHTML(product.name)}
                : ${number(product.totalBottles)} bouteilles restantes
            </p>

        `).join("")

        : "Aucune alerte de stock faible.";

}


// ======================================================
// 7. GESTION DES PRODUITS
// ======================================================

async function handleProductForm(event) {

    event.preventDefault();

    try {

        const data = {

            name: $("product-name").value.trim(),

            brand: $("product-brand").value.trim(),

            unitsPerCrate: number($("product-units").value),

            totalBottles: number($("product-quantity").value),

            purchasePrice: number($("product-cost").value),

            sellingPrice: number($("product-price").value),

            lowStockThreshold: number($("product-threshold").value)

        };

        await addProduct(data);

        notify("Boisson enregistrée avec succès.");

        event.target.reset();

        $("product-units").value = 12;

        $("product-quantity").value = 0;

        $("product-threshold").value = 12;

        await loadAllData();

    } catch (error) {

        console.error(error);

        notify(error.message || "Erreur lors de l'ajout du produit.");

    }

}


function renderProducts() {

    const table = $("products-table");

    if (!table) return;

    if (!products.length) {

        table.innerHTML = `
            <tr>
                <td colspan="5">Aucun produit enregistré.</td>
            </tr>
        `;

        return;

    }

    table.innerHTML = products.map(product => `

        <tr>

            <td>
                ${escapeHTML(product.name)}
                <br>
                <small>${escapeHTML(product.brand || "")}</small>
            </td>

            <td>${number(product.totalBottles)} bouteilles</td>

            <td>${money(product.purchasePrice)}</td>

            <td>${money(product.sellingPrice)}</td>

            <td>

                <button
                    type="button"
                    data-stock="${product.id}"
                >
                    Ajuster
                </button>

                <button
                    type="button"
                    data-delete-product="${product.id}"
                >
                    Supprimer
                </button>

            </td>

        </tr>

    `).join("");

}


function renderProductOptions() {

    const select = $("sale-product");

    if (!select) return;

    select.innerHTML = `
        <option value="">Choisir une boisson</option>
    `;

    products.forEach(product => {

        select.innerHTML += `

            <option value="${product.id}">

                ${escapeHTML(product.name)}
                — Stock : ${number(product.totalBottles)}

            </option>

        `;

    });

}


// ======================================================
// 8. AJUSTEMENT DU STOCK
// ======================================================

async function adjustStock(productId) {

    const product = products.find(item => item.id === productId);

    if (!product) return;

    const answer = prompt(
        "Entrez la variation du stock en bouteilles.\n" +
        "Exemple : 12 pour ajouter 12 bouteilles.\n" +
        "-3 pour retirer 3 bouteilles."
    );

    if (answer === null) return;

    const variation = Number(answer);

    if (!Number.isInteger(variation) || variation === 0) {

        notify("Quantité invalide.");

        return;

    }

    try {

        const { updateStock } = await import("./database.js");

        await updateStock(
            productId,
            variation,
            "Ajustement manuel"
        );

        notify("Stock actualisé.");

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 9. SUPPRESSION D'UN PRODUIT
// ======================================================

async function removeProduct(productId) {

    if (!currentIsAdmin) {

        notify("Seul l'administrateur peut supprimer un produit.");

        return;

    }

    if (!confirm("Confirmer la suppression de cette boisson ?")) {
        return;
    }

    try {

        await deleteProduct(productId);

        notify("Produit supprimé.");

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 10. GESTION DES CLIENTS
// ======================================================

async function handleCustomerForm(event) {

    event.preventDefault();

    try {

        await addCustomer({

            name: $("customer-name").value.trim(),

            phone: $("customer-phone").value.trim()

        });

        notify("Client enregistré.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


function renderCustomers() {

    const container = $("customers-list");

    if (!container) return;

    if (!customers.length) {

        container.textContent = "Aucun client enregistré.";

        return;

    }

    container.innerHTML = customers.map(customer => `

        <div class="content-card">

            <h4>${escapeHTML(customer.name)}</h4>

            <p>Téléphone : ${escapeHTML(customer.phone || "-")}</p>

            <p>Dette : <strong>${money(customer.debt)}</strong></p>

            ${
                number(customer.debt) > 0
                    ? `<button data-pay-customer="${customer.id}">
                        Enregistrer un paiement
                       </button>`
                    : ""
            }

        </div>

    `).join("");

}


function renderCustomerOptions() {

    const select = $("sale-customer");

    if (!select) return;

    select.innerHTML = `
        <option value="">Client de passage</option>
    `;

    customers.forEach(customer => {

        select.innerHTML += `

            <option value="${customer.id}">

                ${escapeHTML(customer.name)}

            </option>

        `;

    });

}


// ======================================================
// 11. PAIEMENT DES DETTES CLIENTS
// ======================================================

async function payCustomer(customerId) {

    const customer = customers.find(item => item.id === customerId);

    if (!customer) return;

    const answer = prompt(
        `Dette actuelle : ${money(customer.debt)}\nMontant reçu :`
    );

    if (answer === null) return;

    const amount = Number(answer);

    if (!Number.isFinite(amount) || amount <= 0) {

        notify("Montant invalide.");

        return;

    }

    const method = prompt(
        "Mode de paiement : Espèces, Orange Money ou MTN MoMo",
        "Espèces"
    );

    if (method === null) return;

    try {

        await recordCustomerPayment({

            customerId,

            amount,

            method

        });

        notify("Paiement enregistré.");

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 12. GESTION DES VENTES
// ======================================================

async function handleSaleForm(event) {

    event.preventDefault();

    const productId = $("sale-product").value;

    const product = products.find(item => item.id === productId);

    if (!product) {

        notify("Sélectionne une boisson.");

        return;

    }

    const crates = number($("sale-crates").value);

    const extraBottles = number($("sale-bottles").value);

    if (crates <= 0 && extraBottles <= 0) {

        notify("Entre une quantité à vendre.");

        return;

    }

    const quantity =
        crates * number(product.unitsPerCrate) +
        extraBottles;

    if (quantity > number(product.totalBottles)) {

        notify("Stock insuffisant.");

        return;

    }

    const customerId = $("sale-customer").value || null;

    const customer = customers.find(
        item => item.id === customerId
    );

    const paymentMode = $("sale-payment").value;

    const cratePriceInput = $("sale-crate-price").value;

    const bottlePriceInput = $("sale-bottle-price").value;

    const cratePrice = cratePriceInput === ""
        ? number(product.cratePrice)
        : number(cratePriceInput);

    const bottlePrice = bottlePriceInput === ""
        ? number(product.sellingPrice)
        : number(bottlePriceInput);

    const total =
        crates * cratePrice +
        extraBottles * bottlePrice;

    if (total <= 0) {

        notify("Le montant de la vente est invalide.");

        return;

    }

    let amountPaid;

    if (paymentMode === "credit") {

        amountPaid = 0;

    } else if (paymentMode === "partial") {

        amountPaid = number($("sale-amount-paid").value);

    } else {

        amountPaid = total;

    }

    if (amountPaid < 0 || amountPaid > total) {

        notify("Montant payé invalide.");

        return;

    }

    if (amountPaid < total && !customerId) {

        notify("Sélectionne un client pour enregistrer une dette.");

        return;

    }

    const saleData = {

        items: [{

            productId,

            crates,

            extraBottles,

            cratePrice,

            bottlePrice

        }],

        customerId,

        customerName: customer?.name || "Client comptant",

        paymentMode,

        paymentMethod: paymentMode,

        amountPaid

    };


    try {

        if (!isOnline()) {

            const operationId = await enqueueOperation(
                "createSale",
                saleData
            );

            notify(
                "Vente conservée sur ce téléphone. " +
                "Elle sera envoyée à Firebase dès le retour d'Internet.\n" +
                "Référence : " + operationId
            );

            event.target.reset();

            await updateSyncStatus();

            return;

        }


        await createSale(saleData);

        notify("Vente enregistrée avec succès.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        console.error(error);

        notify(error.message || "Impossible d'enregistrer la vente.");

    }

}


// ======================================================
// 13. HISTORIQUE DES VENTES
// ======================================================

function renderSales() {

    const container = $("sales-history");

    if (!container) return;

    if (!sales.length) {

        container.textContent = "Aucune vente enregistrée.";

        return;

    }

    const ordered = [...sales].sort((a, b) =>

        new Date(b.date) - new Date(a.date)

    );

    container.innerHTML = ordered.map(sale => `

        <div class="content-card">

            <h4>Vente du ${dateFormat(sale.date)}</h4>

            <p>Client : ${escapeHTML(sale.customerName || "Client comptant")}</p>

            <p>Montant : <strong>${money(sale.total)}</strong></p>

            <p>Payé : ${money(sale.amountPaid)}</p>

            <p>Dette : ${money(sale.debt)}</p>

            <p>Bénéfice estimé : ${money(sale.profit)}</p>

            <p>Mode : ${escapeHTML(sale.paymentMethod || "-")}</p>

        </div>

    `).join("");

}


// ======================================================
// 14. FOURNISSEURS
// ======================================================

function renderSuppliers() {

    const container = $("suppliers-list");

    if (!container) return;

    container.innerHTML = suppliers.length

        ? suppliers.map(supplier => `

            <div class="content-card">

                <h4>${escapeHTML(supplier.name)}</h4>

                <p>Téléphone : ${escapeHTML(supplier.phone || "-")}</p>

                <p>Dette : ${money(supplier.debt)}</p>

            </div>

        `).join("")

        : "Aucun fournisseur enregistré.";

}


// ======================================================
// 15. APPROVISIONNEMENTS
// ======================================================

function renderPurchases() {

    const html = purchases.length

        ? purchases.map(purchase => `

            <div class="content-card">

                <p>Date : ${dateFormat(purchase.date)}</p>

                <p>Fournisseur : ${escapeHTML(purchase.supplierName || "-")}</p>

                <p>Total : ${money(purchase.total)}</p>

                <p>Payé : ${money(purchase.amountPaid)}</p>

                <p>Dette : ${money(purchase.debt)}</p>

            </div>

        `).join("")

        : "Aucun approvisionnement enregistré.";

    if ($("purchases-list")) {
        $("purchases-list").innerHTML = html;
    }

    if ($("management-purchases")) {
        $("management-purchases").innerHTML = html;
    }

}


// ======================================================
// 16. DÉPENSES
// ======================================================

function renderExpenses() {

    const container = $("expenses-list");

    if (!container) return;

    container.innerHTML = expenses.length

        ? expenses.map(expense => `

            <div class="content-card">

                <h4>${escapeHTML(expense.title)}</h4>

                <p>Catégorie : ${escapeHTML(expense.category)}</p>

                <p>Montant : ${money(expense.amount)}</p>

                <p>Date : ${dateFormat(expense.date)}</p>

            </div>

        `).join("")

        : "Aucune dépense enregistrée.";

}


// ======================================================
// 17. PERTES
// ======================================================

function renderLosses() {

    const container = $("losses-list");

    if (!container) return;

    container.innerHTML = losses.length

        ? losses.map(loss => `

            <div class="content-card">

                <h4>${escapeHTML(loss.productName)}</h4>

                <p>Quantité perdue : ${number(loss.quantity)}</p>

                <p>Motif : ${escapeHTML(loss.reason)}</p>

                <p>Valeur estimée : ${money(loss.estimatedValue)}</p>

            </div>

        `).join("")

        : "Aucune perte enregistrée.";

}


// ======================================================
// 18. FORMULAIRES DE GESTION
// ======================================================

function createManagementForms() {

    // FOURNISSEURS

    $("suppliers-section").insertAdjacentHTML(
        "afterbegin",
        `
        <form id="supplier-form">

            <h4>Ajouter un fournisseur</h4>

            <input id="supplier-name"
                placeholder="Nom du fournisseur"
                required>

            <input id="supplier-phone"
                placeholder="Téléphone">

            <button>Enregistrer</button>

        </form>
        `
    );


    // APPROVISIONNEMENTS

    $("purchases-section").insertAdjacentHTML(
        "afterbegin",
        `
        <form id="purchase-form">

            <h4>Nouvel approvisionnement</h4>

            <label>Boisson</label>

            <select id="purchase-product" required></select>

            <label>Nombre de casiers</label>

            <input id="purchase-crates"
                type="number" min="0" value="0">

            <label>Bouteilles supplémentaires</label>

            <input id="purchase-bottles"
                type="number" min="0" value="0">

            <label>Prix d'achat par bouteille</label>

            <input id="purchase-cost"
                type="number" min="0" required>

            <label>Montant payé</label>

            <input id="purchase-paid"
                type="number" min="0" value="0">

            <label>Fournisseur</label>

            <select id="purchase-supplier">
                <option value="">Aucun fournisseur</option>
            </select>

            <button>Enregistrer l'achat</button>

        </form>
        `
    );


    // DÉPENSES

    $("expenses-section").insertAdjacentHTML(
        "afterbegin",
        `
        <form id="expense-form">

            <h4>Nouvelle dépense</h4>

            <input id="expense-title"
                placeholder="Nom de la dépense"
                required>

            <input id="expense-category"
                placeholder="Catégorie">

            <input id="expense-amount"
                type="number" min="1"
                placeholder="Montant FCFA"
                required>

            <textarea id="expense-description"
                placeholder="Description"></textarea>

            <button>Enregistrer la dépense</button>

        </form>
        `
    );


    // PERTES

    $("losses-section").insertAdjacentHTML(
        "afterbegin",
        `
        <form id="loss-form">

            <h4>Enregistrer une perte</h4>

            <select id="loss-product" required></select>

            <input id="loss-quantity"
                type="number" min="1"
                placeholder="Nombre de bouteilles"
                required>

            <input id="loss-reason"
                placeholder="Motif : casse, perte..."
                required>

            <button>Enregistrer la perte</button>

        </form>
        `
    );


    refreshManagementOptions();

}


function refreshManagementOptions() {

    const productSelect = $("purchase-product");

    const supplierSelect = $("purchase-supplier");

    const lossSelect = $("loss-product");


    if (productSelect) {

        productSelect.innerHTML = products.map(product => `

            <option value="${product.id}">
                ${escapeHTML(product.name)}
            </option>

        `).join("");

    }


    if (lossSelect) {

        lossSelect.innerHTML = products.map(product => `

            <option value="${product.id}">
                ${escapeHTML(product.name)}
            </option>

        `).join("");

    }


    if (supplierSelect) {

        supplierSelect.innerHTML = `
            <option value="">Aucun fournisseur</option>
        `;

        suppliers.forEach(supplier => {

            supplierSelect.innerHTML += `

                <option value="${supplier.id}">
                    ${escapeHTML(supplier.name)}
                </option>

            `;

        });

    }

}


// ======================================================
// 19. ENREGISTREMENT FOURNISSEUR
// ======================================================

async function handleSupplierForm(event) {

    event.preventDefault();

    try {

        await addSupplier({

            name: $("supplier-name").value.trim(),

            phone: $("supplier-phone").value.trim()

        });

        notify("Fournisseur enregistré.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 20. ENREGISTREMENT ACHAT
// ======================================================

async function handlePurchaseForm(event) {

    event.preventDefault();

    const productId = $("purchase-product").value;

    const product = products.find(item => item.id === productId);

    if (!product) {

        notify("Produit introuvable.");

        return;

    }

    const crates = number($("purchase-crates").value);

    const extraBottles = number($("purchase-bottles").value);

    const purchasePrice = number($("purchase-cost").value);

    const quantity =
        crates * number(product.unitsPerCrate) +
        extraBottles;

    if (quantity <= 0 || purchasePrice <= 0) {

        notify("Vérifie les quantités et le prix d'achat.");

        return;

    }

    const total = quantity * purchasePrice;

    let amountPaid = $("purchase-paid").value === ""
        ? total
        : number($("purchase-paid").value);

    if (amountPaid > total) {

        notify("Le paiement dépasse le montant de l'achat.");

        return;

    }

    const supplierId = $("purchase-supplier").value || null;

    if (amountPaid < total && !supplierId) {

        notify("Sélectionne un fournisseur pour enregistrer une dette.");

        return;

    }

    try {

        await createPurchase({

            items: [{

                productId,

                quantity,

                purchasePrice

            }],

            supplierId,

            amountPaid

        });

        notify("Approvisionnement enregistré.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 21. ENREGISTREMENT DÉPENSE
// ======================================================

async function handleExpenseForm(event) {

    event.preventDefault();

    try {

        await addExpense({

            title: $("expense-title").value.trim(),

            category: $("expense-category").value.trim(),

            amount: number($("expense-amount").value),

            description: $("expense-description").value.trim()

        });

        notify("Dépense enregistrée.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 22. ENREGISTREMENT PERTE
// ======================================================

async function handleLossForm(event) {

    event.preventDefault();

    try {

        await recordLoss({

            productId: $("loss-product").value,

            quantity: number($("loss-quantity").value),

            reason: $("loss-reason").value.trim()

        });

        notify("Perte enregistrée.");

        event.target.reset();

        await loadAllData();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 23. RAPPORTS
// ======================================================

async function renderReports() {

    const container = $("reports-content");

    if (!container) return;

    try {

        const summary = await getFinancialSummary();

        container.innerHTML = `

            <h3>Situation financière</h3>

            <p>Chiffre d'affaires : ${money(summary.totalSales)}</p>

            <p>Bénéfice estimé : ${money(summary.totalProfit)}</p>

            <p>Dépenses : ${money(summary.totalExpenses)}</p>

            <p>Pertes : ${money(summary.totalLosses)}</p>

            <p>Résultat net estimé :
                <strong>${money(summary.estimatedNetResult)}</strong>
            </p>

            <hr>

            <p>Dettes clients : ${money(summary.totalCustomerDebt)}</p>

            <p>Dettes fournisseurs : ${money(summary.totalSupplierDebt)}</p>

            <p>Valeur du stock : ${money(summary.stockValue)}</p>

            <p>Total bouteilles : ${summary.totalStockBottles}</p>

        `;

    } catch (error) {

        console.error(error);

        container.textContent = "Impossible de charger les rapports.";

    }

}


// ======================================================
// 24. GESTION DES UTILISATEURS
// ======================================================

function renderUsers() {

    const container = $("users-list");

    if (!container) return;

    if (!currentIsAdmin) {

        container.textContent =
            "Cette fonction est réservée à l'administrateur.";

        return;

    }

    container.innerHTML = `

        <h4>Administration des accès</h4>

        <p>Administrateur principal :</p>

        <strong>${ADMIN_EMAIL}</strong>

        <p>
            Les demandes d'accès et les autorisations seront
            gérées depuis cette section.
        </p>

        <button id="refresh-users">
            Actualiser les demandes
        </button>

        <div id="user-requests-list">
            Chargement...
        </div>

    `;

}


// ======================================================
// 25. CHARGEMENT DES DEMANDES D'ACCÈS
// ======================================================

async function loadUserRequests() {

    if (!currentIsAdmin) return;

    const container = $("user-requests-list");

    if (!container) return;

    try {

        const snapshot = await getDocs(
            collection(db, "userRequests")
        );

        const requests = snapshot.docs.map(item => ({

            id: item.id,

            ...item.data()

        }));

        const pending = requests.filter(item =>
            item.status === "pending"
        );

        if (!pending.length) {

            container.textContent = "Aucune demande en attente.";

            return;

        }

        container.innerHTML = pending.map(request => `

            <div class="content-card">

                <p>Nom : ${escapeHTML(request.name || "-")}</p>

                <p>Email : ${escapeHTML(request.email || "-")}</p>

                <button data-approve-user="${request.id}">
                    Autoriser
                </button>

                <button data-deny-user="${request.id}">
                    Refuser
                </button>

            </div>

        `).join("");

    } catch (error) {

        console.error(error);

        container.textContent =
            "Impossible de récupérer les demandes. Vérifie les règles Firestore.";

    }

}


// ======================================================
// 26. APPROBATION D'UN UTILISATEUR
// ======================================================

async function approveUser(uid) {

    if (!currentIsAdmin) return;

    try {

        await setDoc(
            doc(db, "authorizedUsers", uid),
            {

                approved: true,

                role: "user",

                approvedBy: currentUser.email,

                approvedAt: serverTimestamp()

            },
            { merge: true }
        );

        await updateDoc(
            doc(db, "userRequests", uid),
            {

                status: "approved",

                approvedAt: serverTimestamp()

            }
        );

        notify("Utilisateur autorisé.");

        await loadUserRequests();

    } catch (error) {

        console.error(error);

        notify(
            "Autorisation impossible. Vérifie les règles Firestore."
        );

    }

}


// ======================================================
// 27. REFUS D'UN UTILISATEUR
// ======================================================

async function denyUser(uid) {

    if (!currentIsAdmin) return;

    if (!confirm("Refuser cette demande d'accès ?")) return;

    try {

        await updateDoc(
            doc(db, "userRequests", uid),
            {

                status: "rejected",

                rejectedAt: serverTimestamp()

            }
        );

        notify("Demande refusée.");

        await loadUserRequests();

    } catch (error) {

        notify(error.message);

    }

}


// ======================================================
// 28. SYNCHRONISATION HORS CONNEXION
// ======================================================

async function processOfflineOperation(operation) {

    switch (operation.type) {

        case "createSale":

            return await createSale({

                ...operation.payload,

                operationId: operation.operationId

            });


        case "createPurchase":

            return await createPurchase({

                ...operation.payload,

                operationId: operation.operationId

            });


        default:

            throw new Error(
                "Type d'opération hors connexion non reconnu : " +
                operation.type
            );

    }

}


async function synchronizeOfflineData() {

    if (!isOnline()) {

        showSyncStatus("Hors connexion — opérations conservées");

        return;

    }

    try {

        showSyncStatus("Synchronisation en cours...");

        const result = await syncPendingOperations(
            processOfflineOperation
        );

        await updateSyncStatus();

        if (result.completed > 0) {

            await loadAllData();

        }

    } catch (error) {

        console.error(error);

        showSyncStatus("Erreur de synchronisation");

    }

}


async function updateSyncStatus() {

    const pending = await countPendingOperations();

    const failed = await countFailedOperations();

    if (!isOnline()) {

        showSyncStatus(
            `Hors connexion — ${pending} opération(s) en attente`
        );

        return;

    }

    showSyncStatus(

        `${pending} opération(s) en attente — ` +
        `${failed} échec(s)`

    );

}


// ======================================================
// 29. SAUVEGARDE DES DONNÉES
// ======================================================

async function exportBackup() {

    try {

        const data = {

            exportDate: new Date().toISOString(),

            products,

            customers,

            sales,

            suppliers,

            purchases,

            expenses,

            losses

        };

        const blob = new Blob(

            [JSON.stringify(data, null, 2)],

            { type: "application/json" }

        );

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;

        link.download =
            "sarah-stock-sauvegarde-" +
            new Date().toISOString().slice(0, 10) +
            ".json";

        link.click();

        URL.revokeObjectURL(url);

        notify("Sauvegarde téléchargée.");

    } catch (error) {

        notify("Erreur lors de la sauvegarde.");

    }

}


function initializeBackup() {

    const container = $("backup-content");

    if (!container) return;

    container.innerHTML = `

        <p>Exporter une copie des données du dépôt.</p>

        <button id="export-backup">
            Télécharger la sauvegarde
        </button>

    `;

}


// ======================================================
// 30. ÉCOUTE DES ACTIONS
// ======================================================

function initializeForms() {

    $("product-form")?.addEventListener(
        "submit",
        handleProductForm
    );

    $("customer-form")?.addEventListener(
        "submit",
        handleCustomerForm
    );

    $("sale-form")?.addEventListener(
        "submit",
        handleSaleForm
    );

    $("supplier-form")?.addEventListener(
        "submit",
        handleSupplierForm
    );

    $("purchase-form")?.addEventListener(
        "submit",
        handlePurchaseForm
    );

    $("expense-form")?.addEventListener(
        "submit",
        handleExpenseForm
    );

    $("loss-form")?.addEventListener(
        "submit",
        handleLossForm
    );


    $("logout-button")?.addEventListener("click", async () => {

        const { signOut } = await import(
            "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"
        );

        await signOut(auth);

    });


    document.addEventListener("click", async event => {

        const stockButton = event.target.closest("[data-stock]");

        if (stockButton) {

            await adjustStock(stockButton.dataset.stock);

            return;

        }


        const deleteButton = event.target.closest(
            "[data-delete-product]"
        );

        if (deleteButton) {

            await removeProduct(
                deleteButton.dataset.deleteProduct
            );

            return;

        }


        const paymentButton = event.target.closest(
            "[data-pay-customer]"
        );

        if (paymentButton) {

            await payCustomer(
                paymentButton.dataset.payCustomer
            );

            return;

        }


        const approveButton = event.target.closest(
            "[data-approve-user]"
        );

        if (approveButton) {

            await approveUser(
                approveButton.dataset.approveUser
            );

            return;

        }


        const denyButton = event.target.closest(
            "[data-deny-user]"
        );

        if (denyButton) {

            await denyUser(
                denyButton.dataset.denyUser
            );

            return;

        }


        if (event.target.id === "refresh-users") {

            await loadUserRequests();

            return;

        }


        if (event.target.id === "export-backup") {

            await exportBackup();

        }

    });

}


// ======================================================
// 31. INITIALISATION APRÈS CONNEXION
// ======================================================

async function initializeApplication(user, isAdmin) {

    if (currentUser?.uid === user.uid) return;

    currentUser = user;

    currentIsAdmin = Boolean(isAdmin);

    $("current-user").textContent =
        user.displayName || user.email;

    initializeNavigation();

    createManagementForms();

    initializeBackup();

    initializeForms();

    await openOfflineDB();

    await loadAllData();

    await updateSyncStatus();

    if (currentIsAdmin) {

        await loadUserRequests();

    }

    await synchronizeOfflineData();

    listenToConnection(async online => {

        if (online) {

            showSyncStatus("Connexion rétablie — synchronisation...");

            await synchronizeOfflineData();

        } else {

            showSyncStatus("Hors connexion — données locales conservées");

        }

    });

    console.log(
        "DÉPÔT SARAH V2 initialisé.",
        user.email
    );

}


// ======================================================
// 32. RÉCEPTION DE L'ÉVÉNEMENT D'AUTHENTIFICATION
// ======================================================

window.addEventListener(
    "sarah-auth-ready",
    async event => {

        const { user, isAdmin } = event.detail;

        try {

            await initializeApplication(user, isAdmin);

        } catch (error) {

            console.error(
                "Erreur d'initialisation de l'application :",
                error
            );

            notify(
                "Erreur lors du démarrage de l'application."
            );

        }

    }
);


// ======================================================
// 33. FIN APP.JS
// ======================================================
