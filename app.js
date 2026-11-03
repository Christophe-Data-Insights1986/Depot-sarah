import { auth, db, googleProvider } from "./firebase.js";

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
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
    addProduct,
    getProducts,
    createSale,
    addCustomer,
    getCustomers,
    getAll
} from "./database.js";

import {
    openOfflineDB,
    countPendingOperations,
    listenToConnection,
    isOnline
} from "./offline.js";


/* =====================================
   CONFIGURATION GÉNÉRALE
===================================== */

const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let currentUser = null;
let currentRole = null;

let products = [];
let customers = [];
let sales = [];
let expenses = [];
let losses = [];

const $ = (id) => document.getElementById(id);

function showMessage(elementId, message, type = "error") {
    const element = $(elementId);

    if (!element) return;

    element.textContent = message;
    element.className = `message ${type}`;
}

function formatMoney(value) {
    return new Intl.NumberFormat("fr-FR").format(
        Number(value || 0)
    ) + " FCFA";
}

function localDate() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}

function showElement(id) {
    const element = $(id);
    if (element) element.hidden = false;
}

function hideElement(id) {
    const element = $(id);
    if (element) element.hidden = true;
}


/* =====================================
   ÉCRANS DE CONNEXION ET D'ACCÈS
===================================== */

let pendingPanel = null;

function createPendingPanel() {
    if (pendingPanel) return;

    pendingPanel = document.createElement("div");
    pendingPanel.id = "pending-access-screen";

    pendingPanel.innerHTML = `
        <div class="login-card">
            <h2>Demande d'accès envoyée</h2>

            <p>
                Votre compte a été créé.
                L'administrateur doit encore autoriser votre accès.
            </p>

            <p>
                Vous pourrez utiliser le dépôt après validation.
            </p>

            <button id="pending-logout">
                Se déconnecter
            </button>
        </div>
    `;

    document.body.appendChild(pendingPanel);

    $("pending-logout").addEventListener("click", async () => {
        await signOut(auth);
    });
}

function showPendingAccess() {
    hideElement("login-screen");
    hideElement("app-container");

    createPendingPanel();
    pendingPanel.hidden = false;
}

function hidePendingAccess() {
    if (pendingPanel) {
        pendingPanel.hidden = true;
    }
}

function showLogin() {
    hidePendingAccess();
    showElement("login-screen");
    hideElement("app-container");
}

function showApplication() {
    hidePendingAccess();
    hideElement("login-screen");
    showElement("app-container");
}


/* =====================================
   CONNEXION PAR EMAIL
===================================== */

const loginForm = $("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = $("login-email")?.value.trim();
        const password = $("login-password")?.value;

        if (!email || !password) {
            showMessage("auth-message", "Remplissez tous les champs.");
            return;
        }

        try {
            showMessage("auth-message", "Connexion en cours...", "info");

            await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

        } catch (error) {
            console.error(error);

            showMessage(
                "auth-message",
                "Connexion impossible. Vérifiez votre email et votre mot de passe."
            );
        }
    });
}


/* =====================================
   INSCRIPTION
===================================== */

const registerForm = $("register-form");

if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = $("register-name")?.value.trim();
        const email = $("register-email")?.value.trim();
        const password = $("register-password")?.value;

        if (!name || !email || !password) {
            showMessage("auth-message", "Remplissez tous les champs.");
            return;
        }

        if (password.length < 6) {
            showMessage(
                "auth-message",
                "Le mot de passe doit contenir au moins 6 caractères."
            );
            return;
        }

        try {
            showMessage("auth-message", "Création du compte...", "info");

            const credential = await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

            await updateProfile(credential.user, {
                displayName: name
            });

            await setDoc(
                doc(db, "userRequests", credential.user.uid),
                {
                    uid: credential.user.uid,
                    name,
                    email,
                    status: "pending",
                    requestedAt: serverTimestamp()
                },
                { merge: true }
            );

            showMessage(
                "auth-message",
                "Compte créé. Votre demande attend l'autorisation de l'administrateur.",
                "success"
            );

        } catch (error) {
            console.error(error);

            showMessage(
                "auth-message",
                "Impossible de créer le compte. Vérifiez les informations et les autorisations Firebase."
            );
        }
    });
}


/* =====================================
   AFFICHER LE FORMULAIRE D'INSCRIPTION
===================================== */

const showRegisterButton = $("show-register");

if (showRegisterButton) {
    showRegisterButton.addEventListener("click", () => {
        if (loginForm) loginForm.hidden = true;
        if (registerForm) registerForm.hidden = false;
    });
}


/* =====================================
   CONNEXION GOOGLE
===================================== */

const googleButton = $("google-login");

if (googleButton) {
    googleButton.addEventListener("click", async () => {
        try {
            showMessage("auth-message", "Connexion Google...", "info");

            await signInWithPopup(auth, googleProvider);

        } catch (error) {
            console.error(error);

            showMessage(
                "auth-message",
                "La connexion Google a échoué."
            );
        }
    });
}


/* =====================================
   DÉCONNEXION
===================================== */

const logoutButton = $("logout-button");

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error(error);
            alert("Erreur pendant la déconnexion.");
        }
    });
}


/* =====================================
   VÉRIFICATION DES DROITS
===================================== */

async function checkUserAccess(user) {
    const userRef = doc(db, "authorizedUsers", user.uid);

    const userSnapshot = await getDoc(userRef);

    // Administrateur principal
    if (user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {

        await setDoc(userRef, {
            uid: user.uid,
            name: user.displayName || "Administrateur",
            email: user.email,
            role: "admin",
            status: "approved",
            updatedAt: serverTimestamp()
        }, { merge: true });

        currentRole = "admin";

        return true;
    }

    // Utilisateur déjà autorisé
    if (userSnapshot.exists()) {
        const userData = userSnapshot.data();

        if (
            userData.status === "approved" &&
            ["admin", "operator"].includes(userData.role)
        ) {
            currentRole = userData.role;
            return true;
        }
    }

    // Demande d'accès en attente
    await setDoc(
        doc(db, "userRequests", user.uid),
        {
            uid: user.uid,
            name: user.displayName || "",
            email: user.email || "",
            status: "pending",
            requestedAt: serverTimestamp()
        },
        { merge: true }
    );

    return false;
}


/* =====================================
   CHARGEMENT DES DONNÉES
===================================== */

async function loadData() {
    try {
        products = await getProducts();

        customers = await getCustomers();

        sales = await getAll("sales");

        expenses = await getAll("expenses");

        losses = await getAll("losses");

        renderDashboard();
        renderProducts();
        renderCustomers();
        renderSales();
        updateSaleProductOptions();
        updateSaleCustomerOptions();

    } catch (error) {
        console.error("Erreur de chargement :", error);

        alert(
            "Impossible de charger les données. Vérifiez les règles Firestore et votre connexion Internet."
        );
    }
}


/* =====================================
   TABLEAU DE BORD
===================================== */

function renderDashboard() {
    const today = localDate();

    const todaySales = sales.filter((sale) => {
        return String(sale.createdAt || "").slice(0, 10) === today;
    });

    const todayExpenses = expenses.filter((expense) => {
        return String(expense.createdAt || "").slice(0, 10) === today;
    });

    const totalProducts = products.length;

    const totalStock = products.reduce((sum, product) => {
        return sum + Number(product.quantity || 0);
    }, 0);

    const stockCost = products.reduce((sum, product) => {
        return sum +
            Number(product.quantity || 0) *
            Number(product.cost || 0);
    }, 0);

    const dailyRevenue = todaySales.reduce((sum, sale) => {
        return sum + Number(sale.total || 0);
    }, 0);

    const dailyProfit = todaySales.reduce((sum, sale) => {
        return sum + Number(sale.profit || 0);
    }, 0);

    const dailyExpenses = todayExpenses.reduce((sum, expense) => {
        return sum + Number(expense.amount || 0);
    }, 0);

    const totalDebts = customers.reduce((sum, customer) => {
        return sum + Number(customer.balance || 0);
    }, 0);

    if ($("stat-products")) {
        $("stat-products").textContent = totalProducts;
    }

    if ($("stat-stock")) {
        $("stat-stock").textContent = totalStock;
    }

    if ($("stat-stock-cost")) {
        $("stat-stock-cost").textContent = formatMoney(stockCost);
    }

    if ($("stat-sales")) {
        $("stat-sales").textContent = formatMoney(dailyRevenue);
    }

    if ($("stat-profit")) {
        $("stat-profit").textContent = formatMoney(
            dailyProfit - dailyExpenses
        );
    }

    if ($("stat-expenses")) {
        $("stat-expenses").textContent = formatMoney(dailyExpenses);
    }

    if ($("stat-debts")) {
        $("stat-debts").textContent = formatMoney(totalDebts);
    }

    renderLowStockAlerts();
}


/* =====================================
   ALERTES DE STOCK
===================================== */

function renderLowStockAlerts() {
    const container = $("low-stock-alerts");

    if (!container) return;

    const lowStock = products.filter((product) => {
        return Number(product.quantity || 0) <=
            Number(product.threshold || 12);
    });

    if (lowStock.length === 0) {
        container.innerHTML = "<p>Aucune alerte de stock.</p>";
        return;
    }

    container.innerHTML = lowStock.map((product) => `
        <div class="alert-item">
            ⚠️ ${escapeHTML(product.name)}
            : ${Number(product.quantity || 0)} bouteilles restantes
        </div>
    `).join("");
}


/* =====================================
   GESTION DES PRODUITS
===================================== */

function renderProducts() {
    const table = $("products-table");

    if (!table) return;

    if (products.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="5">Aucun produit enregistré.</td>
            </tr>
        `;
        return;
    }

    table.innerHTML = products.map((product) => `
        <tr>
            <td>${escapeHTML(product.name)}</td>

            <td>
                ${Number(product.quantity || 0)}
            </td>

            <td>
                ${formatMoney(product.cost)}
            </td>

            <td>
                ${formatMoney(product.price)}
            </td>

            <td>
                ${Number(product.unitsPerCrate || 12)} / casier
            </td>
        </tr>
    `).join("");
}


const productForm = $("product-form");

if (productForm) {
    productForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!currentUser) return;

        const product = {
            name: $("product-name")?.value.trim(),
            brand: $("product-brand")?.value.trim(),
            unitsPerCrate: Number($("product-units")?.value || 12),
            quantity: Number($("product-quantity")?.value || 0),
            cost: Number($("product-cost")?.value || 0),
            price: Number($("product-price")?.value || 0),
            threshold: Number($("product-threshold")?.value || 12),
            active: true,
            createdBy: currentUser.uid
        };

        if (!product.name) {
            alert("Le nom du produit est obligatoire.");
            return;
        }

        if (
            product.quantity < 0 ||
            product.cost < 0 ||
            product.price < 0 ||
            product.unitsPerCrate <= 0
        ) {
            alert("Vérifiez les quantités et les prix.");
            return;
        }

        try {
            await addProduct(product);

            productForm.reset();

            await loadData();

            alert("Produit enregistré avec succès.");

        } catch (error) {
            console.error(error);
            alert("Impossible d'enregistrer le produit.");
        }
    });
}


/* =====================================
   LISTE DES PRODUITS POUR LES VENTES
===================================== */

function updateSaleProductOptions() {
    const select = $("sale-product");

    if (!select) return;

    select.innerHTML = `
        <option value="">Choisir une boisson</option>
    `;

    products.forEach((product) => {
        const option = document.createElement("option");

        option.value = product.id;

        option.textContent =
            `${product.name} (${product.quantity || 0} bouteilles)`;

        select.appendChild(option);
    });
}


/* =====================================
   LISTE DES CLIENTS POUR LES VENTES
===================================== */

function updateSaleCustomerOptions() {
    const select = $("sale-customer");

    if (!select) return;

    select.innerHTML = `
        <option value="">Client de passage</option>
    `;

    customers.forEach((customer) => {
        const option = document.createElement("option");

        option.value = customer.id;

        option.textContent = customer.name;

        select.appendChild(option);
    });
}


/* =====================================
   PRÉREMPLIR LES PRIX D'UNE VENTE
===================================== */

const saleProductSelect = $("sale-product");

if (saleProductSelect) {
    saleProductSelect.addEventListener("change", () => {
        const product = products.find((item) => {
            return item.id === saleProductSelect.value;
        });

        if (!product) return;

        if ($("sale-crate-price")) {
            $("sale-crate-price").value =
                Number(product.price || 0) *
                Number(product.unitsPerCrate || 12);
        }

        if ($("sale-bottle-price")) {
            $("sale-bottle-price").value =
                Number(product.price || 0);
        }
    });
}


/* =====================================
   ENREGISTREMENT D'UNE VENTE
===================================== */

const saleForm = $("sale-form");

if (saleForm) {
    saleForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!currentUser) return;

        const productId = $("sale-product")?.value;

        const product = products.find((item) => {
            return item.id === productId;
        });

        if (!product) {
            alert("Choisissez une boisson.");
            return;
        }

        const crates = Number($("sale-crates")?.value || 0);
        const bottles = Number($("sale-bottles")?.value || 0);

        const units = Number(product.unitsPerCrate || 12);

        const totalBottles = crates * units + bottles;

        if (totalBottles <= 0) {
            alert("Indiquez une quantité à vendre.");
            return;
        }

        if (totalBottles > Number(product.quantity || 0)) {
            alert("Stock insuffisant pour cette vente.");
            return;
        }

        const cratePrice = Number(
            $("sale-crate-price")?.value ||
            Number(product.price || 0) * units
        );

        const bottlePrice = Number(
            $("sale-bottle-price")?.value ||
            product.price ||
            0
        );

        const total =
            crates * cratePrice +
            bottles * bottlePrice;

        const paymentMethod = $("sale-payment")?.value || "cash";

        const enteredAmount = Number(
            $("sale-amount-paid")?.value || 0
        );

        let amountPaid = enteredAmount;

        if (paymentMethod === "credit") {
            amountPaid = 0;
        } else if (paymentMethod !== "partial" && enteredAmount === 0) {
            amountPaid = total;
        }

        if (amountPaid < 0 || amountPaid > total) {
            alert("Vérifiez le montant payé.");
            return;
        }

        const customerId = $("sale-customer")?.value || null;

        const customer = customers.find((item) => {
            return item.id === customerId;
        });

        if (amountPaid < total && !customerId) {
            alert("Une vente à crédit ou partiellement payée doit être associée à un client.");
            return;
        }

        const sale = {
            productId,
            productName: product.name,
            customerId,
            customerName: customer?.name || "Client de passage",
            crates,
            bottles,
            totalBottles,
            quantity: totalBottles,
            cratePrice,
            bottlePrice,
            total,
            amountPaid,
            remaining: total - amountPaid,
            paymentMethod,
            userId: currentUser.uid
        };

        try {
            await createSale(sale);

            saleForm.reset();

            await loadData();

            alert("Vente enregistrée avec succès.");

        } catch (error) {
            console.error(error);

            alert(
                error.message || "Impossible d'enregistrer cette vente."
            );
        }
    });
}


/* =====================================
   HISTORIQUE DES VENTES
===================================== */

function renderSales() {
    const container = $("sales-history");

    if (!container) return;

    if (sales.length === 0) {
        container.innerHTML = "<p>Aucune vente enregistrée.</p>";
        return;
    }

    const sortedSales = [...sales].sort((a, b) => {
        return String(b.createdAt || "").localeCompare(
            String(a.createdAt || "")
        );
    });

    container.innerHTML = sortedSales.map((sale) => `
        <div class="sale-card">
            <h4>${escapeHTML(sale.productName || "Boisson")}</h4>

            <p>
                Client :
                ${escapeHTML(sale.customerName || "Client de passage")}
            </p>

            <p>
                Quantité :
                ${Number(sale.totalBottles || sale.quantity || 0)}
                bouteilles
            </p>

            <p>
                Total :
                ${formatMoney(sale.total)}
            </p>

            <p>
                Payé :
                ${formatMoney(sale.amountPaid)}
            </p>

            <p>
                Reste :
                ${formatMoney(sale.remaining)}
            </p>

            <p>
                Date :
                ${escapeHTML(
                    String(sale.createdAt || "").slice(0, 16)
                )}
            </p>
        </div>
    `).join("");
}


/* =====================================
   GESTION DES CLIENTS
===================================== */

function renderCustomers() {
    const container = $("customers-list");

    if (!container) return;

    if (customers.length === 0) {
        container.innerHTML = "<p>Aucun client enregistré.</p>";
        return;
    }

    container.innerHTML = customers.map((customer) => `
        <div class="customer-card">
            <h4>${escapeHTML(customer.name)}</h4>

            <p>
                Téléphone :
                ${escapeHTML(customer.phone || "Non renseigné")}
            </p>

            <p>
                Solde restant :
                ${formatMoney(customer.balance)}
            </p>
        </div>
    `).join("");
}


const customerForm = $("customer-form");

if (customerForm) {
    customerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = $("customer-name")?.value.trim();
        const phone = $("customer-phone")?.value.trim();

        if (!name) {
            alert("Le nom du client est obligatoire.");
            return;
        }

        try {
            await addCustomer({
                name,
                phone,
                balance: 0,
                createdBy: currentUser?.uid || null
            });

            customerForm.reset();

            await loadData();

            alert("Client enregistré avec succès.");

        } catch (error) {
            console.error(error);
            alert("Impossible d'enregistrer le client.");
        }
    });
}


/* =====================================
   GESTION DES MENUS PRINCIPAUX
===================================== */

document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
        const pageName = button.dataset.page;

        document.querySelectorAll(".page").forEach((page) => {
            page.classList.remove("active");
            page.hidden = true;
        });

        const target = $(pageName);

        if (target) {
            target.hidden = false;
            target.classList.add("active");
        }

        document.querySelectorAll("[data-page]").forEach((item) => {
            item.classList.remove("active");
        });

        button.classList.add("active");
    });
});


/* =====================================
   SOUS-MENUS DE GESTION
===================================== */

document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
        const sectionId = button.dataset.section;

        const section = $(sectionId);

        if (!section) return;

        section.hidden = !section.hidden;
    });
});


/* =====================================
   GESTION DES UTILISATEURS
===================================== */

async function renderUserRequests() {
    const container = $("users-list");

    if (!container || currentRole !== "admin") return;

    try {
        const snapshot = await getDocs(
            collection(db, "userRequests")
        );

        const requests = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
        }));

        const pending = requests.filter((item) => {
            return item.status === "pending";
        });

        if (pending.length === 0) {
            container.innerHTML = "<p>Aucune demande en attente.</p>";
            return;
        }

        container.innerHTML = pending.map((item) => `
            <div class="user-request-card">
                <h4>${escapeHTML(item.name || "Utilisateur")}</h4>

                <p>${escapeHTML(item.email || "")}</p>

                <button
                    type="button"
                    data-approve-user="${escapeHTML(item.uid)}">
                    Autoriser
                </button>

                <button
                    type="button"
                    data-deny-user="${escapeHTML(item.uid)}">
                    Refuser
                </button>
            </div>
        `).join("");

    } catch (error) {
        console.error(error);

        container.innerHTML = `
            <p>Impossible de charger les demandes d'accès.</p>
        `;
    }
}


const usersList = $("users-list");

if (usersList) {
    usersList.addEventListener("click", async (event) => {
        if (currentRole !== "admin") return;

        const approveButton = event.target.closest("[data-approve-user]");
        const denyButton = event.target.closest("[data-deny-user]");

        if (approveButton) {
            const uid = approveButton.dataset.approveUser;

            try {
                const requestRef = doc(db, "userRequests", uid);
                const requestSnapshot = await getDoc(requestRef);

                if (!requestSnapshot.exists()) {
                    alert("Cette demande n'existe plus.");
                    await renderUserRequests();
                    return;
                }

                const userData = requestSnapshot.data();

                await setDoc(doc(db, "authorizedUsers", uid), {
                    uid,
                    name: userData.name || "",
                    email: userData.email || "",
                    role: "operator",
                    status: "approved",
                    approvedBy: currentUser.uid,
                    approvedAt: serverTimestamp()
                });

                await deleteDoc(requestRef);

                alert("Utilisateur autorisé.");

                await renderUserRequests();

            } catch (error) {
                console.error(error);
                alert("Impossible d'autoriser cet utilisateur.");
            }
        }

        if (denyButton) {
            const uid = denyButton.dataset.denyUser;

            if (!confirm("Voulez-vous vraiment refuser cette demande ?")) {
                return;
            }

            try {
                await setDoc(
                    doc(db, "userRequests", uid),
                    {
                        status: "denied",
                        deniedAt: serverTimestamp()
                    },
                    { merge: true }
                );

                alert("Demande refusée.");

                await renderUserRequests();

            } catch (error) {
                console.error(error);
                alert("Impossible de refuser cette demande.");
            }
        }
    });
}


/* =====================================
   AFFICHAGE DU NOM ET DU RÔLE
===================================== */

function displayUserInformation(user) {
    const element = $("current-user");

    if (!element) return;

    const name = user.displayName || user.email || "Utilisateur";

    const role = currentRole === "admin"
        ? "Administrateur"
        : "Opérateur";

    element.textContent = `${name} — ${role}`;
}


/* =====================================
   AFFICHAGE DU MENU UTILISATEURS
===================================== */

function configureRoleInterface() {
    const usersButton = document.querySelector(
        '[data-section="users-section"]'
    );

    if (usersButton) {
        usersButton.hidden = currentRole !== "admin";
    }

    const usersSection = $("users-section");

    if (usersSection && currentRole !== "admin") {
        usersSection.hidden = true;
    }
}


/* =====================================
   ÉTAT DE LA CONNEXION INTERNET
===================================== */

function updateConnectionStatus(online) {
    const element = $("sync-status");

    if (!element) return;

    element.textContent = online
        ? "En ligne"
        : "Hors connexion";
}


/* =====================================
   INITIALISATION DE L'APPLICATION
===================================== */

async function initializeApplication(user) {
    currentUser = user;

    try {
        const authorized = await checkUserAccess(user);

        if (!authorized) {
            showPendingAccess();
            return;
        }

        showApplication();

        displayUserInformation(user);

        configureRoleInterface();

        await loadData();

        if (currentRole === "admin") {
            await renderUserRequests();
        }

    } catch (error) {
        console.error("Erreur d'autorisation :", error);

        showLogin();

        alert(
            "Impossible de vérifier les autorisations. Vérifiez les règles de sécurité Firestore."
        );
    }
}


/* =====================================
   SURVEILLANCE DE LA CONNEXION UTILISATEUR
===================================== */

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await initializeApplication(user);
    } else {
        currentUser = null;
        currentRole = null;

        showLogin();

        if ($("current-user")) {
            $("current-user").textContent = "";
        }
    }
});


/* =====================================
   INITIALISATION HORS LIGNE
===================================== */

async function initializeOfflineFeatures() {
    try {
        await openOfflineDB();

        const pending = await countPendingOperations();

        console.log(
            "Opérations en attente de synchronisation :",
            pending
        );

        listenToConnection((online) => {
            updateConnectionStatus(online);
        });

        updateConnectionStatus(isOnline());

    } catch (error) {
        console.error(
            "Initialisation hors ligne impossible :",
            error
        );
    }
}

initializeOfflineFeatures();


/* =====================================
   ENREGISTREMENT DU SERVICE WORKER
===================================== */

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./service-worker.js")
            .then(() => {
                console.log("Service Worker enregistré.");
            })
            .catch((error) => {
                console.error(
                    "Erreur Service Worker :",
                    error
                );
            });
    });
}
