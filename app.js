// ======================================================
// DÉPÔT SARAH V2 — APPLICATION PRINCIPALE
// ======================================================

import {
    auth,
    db,
    googleProvider
} from "./firebase.js";

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    query,
    where,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
    addProduct,
    getProducts,
    createSale,
    addCustomer,
    getCustomers,
    recordCustomerPayment,
    addExpense,
    recordLoss,
    getAll
} from "./database.js";

import {
    openOfflineDB,
    countPendingOperations,
    listenToConnection,
    isOnline
} from "./offline.js";


// ======================================================
// CONFIGURATION
// ======================================================

const ADMIN_EMAIL = "christopheatangana2@gmail.com";

const COLLECTIONS = {
    products: "products",
    sales: "sales",
    customers: "customers",
    expenses: "expenses",
    losses: "losses",
    suppliers: "suppliers",
    purchases: "purchases",
    userRequests: "userRequests",
    authorizedUsers: "authorizedUsers"
};

let currentUser = null;
let currentRole = null;
let products = [];
let customers = [];
let sales = [];
let expenses = [];
let losses = [];
let unsubscribeSales = null;


// ======================================================
// OUTILS
// ======================================================

const $ = selector => document.querySelector(selector);

const money = value =>
    new Intl.NumberFormat("fr-FR").format(
        Number(value || 0)
    ) + " FCFA";

const number = value => Number(value || 0);

function notify(message) {
    alert(message);
}

function setMessage(message) {
    const element = $("#auth-message");

    if (element) {
        element.textContent = message;
    }
}

function setSyncStatus(message) {
    const element = $("#sync-status");

    if (element) {
        element.textContent = message;
    }
}

function today() {
    return new Date().toISOString().slice(0, 10);
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


// ======================================================
// AFFICHAGE DES ÉCRANS
// ======================================================

function showLogin() {

    const login = $("#login-screen");
    const app = $("#app-container");

    if (login) login.hidden = false;
    if (app) app.hidden = true;
}

function showApplication() {

    const login = $("#login-screen");
    const app = $("#app-container");

    if (login) login.hidden = true;
    if (app) app.hidden = false;
}


// ======================================================
// GESTION DES ACCÈS
// ======================================================

async function checkUserAccess(user) {

    const userReference = doc(
        db,
        COLLECTIONS.authorizedUsers,
        user.uid
    );

    const userSnapshot = await getDoc(userReference);

    if (user.email?.toLowerCase() === ADMIN_EMAIL) {

        await setDoc(userReference, {
            uid: user.uid,
            email: user.email,
            name: user.displayName || "Administrateur",
            role: "admin",
            status: "approved",
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return {
            approved: true,
            role: "admin"
        };
    }

    if (!userSnapshot.exists()) {

        const requestReference = doc(
            db,
            COLLECTIONS.userRequests,
            user.uid
        );

        await setDoc(requestReference, {
            uid: user.uid,
            email: user.email,
            name: user.displayName || "",
            status: "pending",
            requestedAt: new Date().toISOString()
        }, { merge: true });

        return {
            approved: false,
            role: null
        };
    }

    const data = userSnapshot.data();

    return {
        approved: data.status === "approved",
        role: data.role || "operator"
    };
}


function showPendingAccess() {

    const container = $("#app-container");

    if (!container) return;

    container.innerHTML = `
        <div class="login-card">
            <h2>Demande d'accès envoyée</h2>

            <p>
                Votre compte a été créé.
                L'administrateur doit autoriser
                votre accès au dépôt.
            </p>

            <p>
                Vous pourrez utiliser l'application
                après validation.
            </p>

            <button id="pending-logout">
                Déconnexion
            </button>
        </div>
    `;

    container.hidden = false;

    $("#pending-logout")?.addEventListener(
        "click",
        () => signOut(auth)
    );
}


// ======================================================
// CONNEXION
// ======================================================

$("#login-form")?.addEventListener("submit", async event => {

    event.preventDefault();

    const email = $("#login-email")?.value.trim();
    const password = $("#login-password")?.value;

    try {

        setMessage("Connexion en cours...");

        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        setMessage("");

    } catch (error) {

        setMessage("Erreur : " + error.message);
    }
});


// ======================================================
// INSCRIPTION
// ======================================================

$("#show-register")?.addEventListener("click", () => {

    const form = $("#register-form");

    if (form) {
        form.hidden = !form.hidden;
    }
});


$("#register-form")?.addEventListener("submit", async event => {

    event.preventDefault();

    const name = $("#register-name")?.value.trim();
    const email = $("#register-email")?.value.trim();
    const password = $("#register-password")?.value;

    try {

        if (!name || !email || !password) {
            throw new Error("Veuillez remplir tous les champs.");
        }

        setMessage("Création du compte...");

        const result = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        await updateProfile(result.user, {
            displayName: name
        });

        setMessage(
            "Compte créé. Demande d'accès en attente."
        );

    } catch (error) {

        setMessage("Erreur : " + error.message);
    }
});


// ======================================================
// CONNEXION GOOGLE
// ======================================================

$("#google-login")?.addEventListener("click", async () => {

    try {

        setMessage("Connexion Google...");

        await signInWithPopup(auth, googleProvider);

        setMessage("");

    } catch (error) {

        setMessage("Erreur Google : " + error.message);
    }
});


// ======================================================
// DÉCONNEXION
// ======================================================

$("#logout-button")?.addEventListener("click", async () => {

    if (confirm("Voulez-vous vous déconnecter ?")) {
        await signOut(auth);
    }
});


// ======================================================
// CHARGEMENT DES DONNÉES
// ======================================================

async function loadData() {

    try {

        products = await getProducts();
        customers = await getCustomers();

        sales = await getAll(COLLECTIONS.sales);
        expenses = await getAll(COLLECTIONS.expenses);
        losses = await getAll(COLLECTIONS.losses);

        renderDashboard();
        renderProducts();
        renderCustomers();
        renderSales();

        setSyncStatus(
            isOnline()
                ? "🟢 Connecté"
                : "🔴 Hors connexion"
        );

    } catch (error) {

        console.error("Chargement des données :", error);

        notify(
            "Impossible de charger les données. Vérifiez les autorisations Firebase."
        );
    }
}


// ======================================================
// TABLEAU DE BORD
// ======================================================

function renderDashboard() {

    const productCount = products.length;

    const stockCount = products.reduce(
        (sum, product) =>
            sum + number(product.quantity),
        0
    );

    const stockCost = products.reduce(
        (sum, product) =>
            sum +
            number(product.quantity) *
            number(product.cost),
        0
    );

    const todaySales = sales.filter(
        sale => String(sale.createdAt || "").slice(0, 10) === today()
    );

    const todayExpenses = expenses
        .filter(expense =>
            String(expense.createdAt || "").slice(0, 10) === today()
        )
        .reduce(
            (sum, expense) =>
                sum + number(expense.amount),
            0
        );

    const revenue = todaySales.reduce(
        (sum, sale) =>
            sum + number(sale.total),
        0
    );

    const profit = todaySales.reduce(
        (sum, sale) =>
            sum + number(sale.profit),
        0
    );

    const debts = customers.reduce(
        (sum, customer) =>
            sum + number(customer.balance),
        0
    );

    if ($("#stat-products"))
        $("#stat-products").textContent = productCount;

    if ($("#stat-stock"))
        $("#stat-stock").textContent = stockCount;

    if ($("#stat-stock-cost"))
        $("#stat-stock-cost").textContent = money(stockCost);

    if ($("#stat-sales"))
        $("#stat-sales").textContent = money(revenue);

    if ($("#stat-profit"))
        $("#stat-profit").textContent = money(profit);

    if ($("#stat-expenses"))
        $("#stat-expenses").textContent = money(todayExpenses);

    if ($("#stat-debts"))
        $("#stat-debts").textContent = money(debts);

    renderLowStock();
}


// ======================================================
// ALERTES DE STOCK
// ======================================================

function renderLowStock() {

    const container = $("#low-stock-alerts");

    if (!container) return;

    const lowProducts = products.filter(product =>
        number(product.quantity) <=
        number(product.threshold)
    );

    if (lowProducts.length === 0) {

        container.innerHTML =
            "<p>Aucune alerte de stock.</p>";

        return;
    }

    container.innerHTML = lowProducts.map(product => `
        <div class="alert-item">
            ⚠️ ${escapeHTML(product.name)}
            : ${number(product.quantity)} bouteilles restantes
        </div>
    `).join("");
}


// ======================================================
// AFFICHAGE DES PRODUITS
// ======================================================

function renderProducts() {

    const container = $("#products-table");

    if (!container) return;

    if (products.length === 0) {

        container.innerHTML =
            "<p>Aucun produit enregistré.</p>";

        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Boisson</th>
                    <th>Stock</th>
                    <th>Coût</th>
                    <th>Prix bouteille</th>
                </tr>
            </thead>

            <tbody>
                ${products.map(product => `
                    <tr>
                        <td>${escapeHTML(product.name)}</td>
                        <td>${number(product.quantity)}</td>
                        <td>${money(product.cost)}</td>
                        <td>${money(product.price)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;

    updateSaleProductOptions();
}


// ======================================================
// AJOUTER UN PRODUIT
// ======================================================

$("#product-form")?.addEventListener("submit", async event => {

    event.preventDefault();

    try {

        const product = {
            name: $("#product-name").value.trim(),
            brand: $("#product-brand").value.trim(),
            unitsPerCrate: number($("#product-units").value) || 12,
            quantity: number($("#product-quantity").value),
            cost: number($("#product-cost").value),
            price: number($("#product-price").value),
            threshold: number($("#product-threshold").value),
            createdAt: new Date().toISOString()
        };

        if (!product.name) {
            throw new Error("Le nom de la boisson est obligatoire.");
        }

        if (product.quantity < 0 || product.cost < 0 || product.price < 0) {
            throw new Error("Les valeurs ne peuvent pas être négatives.");
        }

        await addProduct(product);

        event.target.reset();

        await loadData();

        notify("Produit ajouté avec succès.");

    } catch (error) {

        notify("Erreur : " + error.message);
    }
});


// ======================================================
// LISTE DES PRODUITS POUR LES VENTES
// ======================================================

function updateSaleProductOptions() {

    const select = $("#sale-product");

    if (!select) return;

    select.innerHTML = `
        <option value="">Choisir une boisson</option>
        ${products.map(product => `
            <option value="${escapeHTML(product.id)}">
                ${escapeHTML(product.name)}
            </option>
        `).join("")}
    `;
}


// ======================================================
// CLIENTS
// ======================================================

function renderCustomers() {

    const container = $("#customers-list");

    if (!container) return;

    if (customers.length === 0) {

        container.innerHTML =
            "<p>Aucun client enregistré.</p>";

        return;
    }

    container.innerHTML = customers.map(customer => `
        <div class="customer-card">
            <h3>${escapeHTML(customer.name)}</h3>

            <p>Téléphone : ${escapeHTML(customer.phone || "-")}</p>

            <p>Dette : ${money(customer.balance)}</p>
        </div>
    `).join("");
}


// ======================================================
// AJOUTER UN CLIENT
// ======================================================

$("#customer-form")?.addEventListener("submit", async event => {

    event.preventDefault();

    try {

        const customer = {
            name: $("#customer-name").value.trim(),
            phone: $("#customer-phone").value.trim(),
            balance: 0,
            createdAt: new Date().toISOString()
        };

        if (!customer.name) {
            throw new Error("Le nom du client est obligatoire.");
        }

        await addCustomer(customer);

        event.target.reset();

        await loadData();

        notify("Client enregistré.");

    } catch (error) {

        notify("Erreur : " + error.message);
    }
});


// ======================================================
// VENTES
// ======================================================

$("#sale-form")?.addEventListener("submit", async event => {

    event.preventDefault();

    try {

        const productId = $("#sale-product").value;

        const product = products.find(
            item => item.id === productId
        );

        if (!product) {
            throw new Error("Veuillez choisir une boisson.");
        }

        const crates = number($("#sale-crates").value);
        const bottles = number($("#sale-bottles").value);

        const cratePrice = number($("#sale-crate-price").value);
        const bottlePrice = number($("#sale-bottle-price").value);

        const totalBottles =
            crates * number(product.unitsPerCrate) + bottles;

        if (totalBottles <= 0) {
            throw new Error("La quantité vendue doit être positive.");
        }

        if (totalBottles > number(product.quantity)) {
            throw new Error("Stock insuffisant.");
        }

        const customerId = $("#sale-customer").value || null;

        const customer = customers.find(
            item => item.id === customerId
        );

        const total =
            crates * cratePrice +
            bottles * bottlePrice;

        const amountPaid = number(
            $("#sale-amount-paid").value
        );

        if (amountPaid < 0 || amountPaid > total) {
            throw new Error("Montant payé invalide.");
        }

        const sale = {
            productId,
            productName: product.name,
            customerId,
            customerName: customer?.name || "Client de passage",
            crates,
            bottles,
            totalBottles,
            cratePrice,
            bottlePrice,
            total,
            amountPaid,
            remaining: total - amountPaid,
            paymentMethod: $("#sale-payment").value,
            createdAt: new Date().toISOString()
        };

        const result = await createSale(sale);

        event.target.reset();

        await loadData();

        notify("Vente enregistrée avec succès.");

    } catch (error) {

        notify("Erreur de vente : " + error.message);
    }
});


// ======================================================
// HISTORIQUE DES VENTES
// ======================================================

function renderSales() {

    const container = $("#sales-history");

    if (!container) return;

    if (sales.length === 0) {

        container.innerHTML =
            "<p>Aucune vente enregistrée.</p>";

        return;
    }

    const sortedSales = [...sales].sort(
        (a, b) =>
            String(b.createdAt || "").localeCompare(
                String(a.createdAt || "")
            )
    );

    container.innerHTML = sortedSales.map(sale => `
        <div class="sale-card">

            <strong>${escapeHTML(sale.productName || "Boisson")}</strong>

            <p>Client : ${escapeHTML(sale.customerName || "Passage")}</p>

            <p>Quantité : ${number(sale.totalBottles)} bouteilles</p>

            <p>Total : ${money(sale.total)}</p>

            <p>Payé : ${money(sale.amountPaid)}</p>

            <p>Reste : ${money(sale.remaining)}</p>

            <small>${escapeHTML(sale.createdAt || "")}</small>

        </div>
    `).join("");
}


// ======================================================
// MENU DE NAVIGATION
// ======================================================

document.querySelectorAll("[data-page]").forEach(button => {

    button.addEventListener("click", () => {

        const page = button.dataset.page;

        document.querySelectorAll("[data-page]")
            .forEach(item => item.classList.remove("active"));

        button.classList.add("active");

        document.querySelectorAll(".page")
            .forEach(section => {
                section.hidden = section.id !== page;
            });
    });
});


// ======================================================
// MENU GESTION
// ======================================================

document.querySelectorAll("[data-section]").forEach(button => {

    button.addEventListener("click", () => {

        const sectionId = button.dataset.section;

        document.querySelectorAll("[id$='-section']")
            .forEach(section => {
                section.hidden = section.id !== sectionId;
            });
    });
});


// ======================================================
// CONNEXION ET INITIALISATION
// ======================================================

onAuthStateChanged(auth, async user => {

    currentUser = user;

    if (!user) {

        currentRole = null;

        showLogin();

        return;
    }

    try {

        setSyncStatus("Vérification des autorisations...");

        const access = await checkUserAccess(user);

        if (!access.approved) {

            showPendingAccess();

            return;
        }

        currentRole = access.role;

        showApplication();

        if ($("#current-user")) {
            $("#current-user").textContent =
                user.displayName || user.email;
        }

        if (currentRole !== "admin") {

            document.querySelectorAll("[data-section='users-section']")
                .forEach(button => button.hidden = true);
        }

        await openOfflineDB();

        await loadData();

        setSyncStatus(
            isOnline()
                ? "🟢 Connecté"
                : "🔴 Hors connexion"
        );

    } catch (error) {

        console.error("Initialisation :", error);

        setSyncStatus("Erreur de vérification des accès.");

        notify(
            "Impossible de vérifier votre accès Firebase. Les règles de sécurité devront être configurées."
        );
    }
});


// ======================================================
// SURVEILLANCE DE LA CONNEXION
// ======================================================

listenToConnection(async online => {

    if (online) {

        setSyncStatus("🟢 Internet disponible");

    } else {

        setSyncStatus("🔴 Mode hors connexion");
    }

    try {

        const pending = await countPendingOperations();

        if (pending > 0) {
            setSyncStatus(
                `${online ? "🟢" : "🔴"} ${pending} opération(s) en attente`
            );
        }

    } catch (error) {

        console.error(error);
    }
});


// ======================================================
// FIN DE L'APPLICATION
// ======================================================

console.log("Dépôt Sarah V2 initialisé.");
