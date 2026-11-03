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
    getAll,
    addSupplier,
    getSuppliers,
    updateRecord,
    removeRecord
} from "./database.js";

import {
    openOfflineDB,
    countPendingOperations,
    listenToConnection,
    isOnline
} from "./offline.js";

/* CONFIGURATION */

const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let currentUser = null;
let currentRole = null;

let products = [];
let customers = [];
let sales = [];
let expenses = [];
let losses = [];
let suppliers = [];

const $ = id => document.getElementById(id);

/* OUTILS */

function showMessage(id, message, type = "error") {
    const element = $(id);
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

    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
    ].join("-");
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

/* ÉCRANS */

let pendingPanel = null;

function resetLoginInterface() {
    if ($("login-form")) {
        $("login-form").hidden = false;
        $("login-form").reset();
    }

    if ($("register-form")) {
        $("register-form").hidden = true;
        $("register-form").reset();
    }

    if ($("show-register")) {
        $("show-register").hidden = false;
    }

    if ($("google-login")) {
        $("google-login").hidden = false;
    }

    showMessage("auth-message", "");
}

function createPendingPanel() {
    if (pendingPanel) return;

    pendingPanel = document.createElement("div");
    pendingPanel.id = "pending-access-screen";

    pendingPanel.innerHTML = `
        <div class="login-card">
            <h2>Demande d'accès envoyée</h2>
            <p>Votre compte a été créé.</p>
            <p>L'administrateur doit autoriser votre accès.</p>
            <button id="pending-logout">Se déconnecter</button>
        </div>
    `;

    document.body.appendChild(pendingPanel);

    $("pending-logout").addEventListener("click", async () => {
        await signOut(auth);
    });
}

function showPendingAccess() {
    $("login-screen").hidden = true;
    $("app-container").hidden = true;

    createPendingPanel();
    pendingPanel.hidden = false;
}

function hidePendingAccess() {
    if (pendingPanel) pendingPanel.hidden = true;
}

function showLogin() {
    hidePendingAccess();
    resetLoginInterface();

    $("login-screen").hidden = false;
    $("app-container").hidden = true;
}

function showApplication() {
    hidePendingAccess();

    $("login-screen").hidden = true;
    $("app-container").hidden = false;
}

/* CONNEXION */

const loginForm = $("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();

        const email = $("login-email").value.trim();
        const password = $("login-password").value;

        if (!email || !password) {
            showMessage("auth-message", "Remplissez tous les champs.");
            return;
        }

        try {
            showMessage("auth-message", "Connexion en cours...", "info");

            await signInWithEmailAndPassword(auth, email, password);

        } catch (error) {
            console.error(error);

            showMessage(
                "auth-message",
                "Connexion impossible. Vérifiez votre email et votre mot de passe."
            );
        }
    });
}

/* INSCRIPTION */

const registerForm = $("register-form");

if (registerForm) {
    registerForm.addEventListener("submit", async event => {
        event.preventDefault();

        const name = $("register-name").value.trim();
        const email = $("register-email").value.trim();
        const password = $("register-password").value;

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
                "Impossible de créer le compte. Vérifiez les autorisations Firebase."
            );
        }
    });
}

/* AFFICHER L'INSCRIPTION */

const showRegisterButton = $("show-register");

if (showRegisterButton) {
    showRegisterButton.addEventListener("click", () => {
        loginForm.hidden = true;
        registerForm.hidden = false;

        showRegisterButton.hidden = true;
        $("google-login").hidden = true;

        showMessage("auth-message", "");
    });
}

/* CONNEXION GOOGLE */

const googleButton = $("google-login");

if (googleButton) {
    googleButton.addEventListener("click", async () => {
        try {
            showMessage("auth-message", "Connexion Google...", "info");

            await signInWithPopup(auth, googleProvider);

        } catch (error) {
            console.error(error);
            showMessage("auth-message", "La connexion Google a échoué.");
        }
    });
}

/* DÉCONNEXION */

if ($("logout-button")) {
    $("logout-button").addEventListener("click", async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error(error);
            alert("Erreur pendant la déconnexion.");
        }
    });
}

/* AUTORISATIONS */

async function checkUserAccess(user) {
    const userRef = doc(db, "authorizedUsers", user.uid);
    const snapshot = await getDoc(userRef);

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

    if (snapshot.exists()) {
        const data = snapshot.data();

        if (
            data.status === "approved" &&
            ["admin", "operator"].includes(data.role)
        ) {
            currentRole = data.role;
            return true;
        }
    }

    await setDoc(doc(db, "userRequests", user.uid), {
        uid: user.uid,
        name: user.displayName || "",
        email: user.email || "",
        status: "pending",
        requestedAt: serverTimestamp()
    }, { merge: true });

    return false;
}

/* CHARGEMENT DES DONNÉES */

async function loadData() {
    try {
        products = await getProducts();
        customers = await getCustomers();
        sales = await getAll("sales");
        expenses = await getAll("expenses");
        losses = await getAll("losses");
        suppliers = await getSuppliers();

        renderDashboard();
        renderProducts();
        renderCustomers();
        renderSales();
        renderSuppliers();

        updateSaleProductOptions();
        updateSaleCustomerOptions();

    } catch (error) {
        console.error(error);

        alert(
            "Impossible de charger les données. Vérifiez Firestore et votre connexion."
        );
    }
}

/* TABLEAU DE BORD */

function renderDashboard() {
    const today = localDate();

    const todaySales = sales.filter(sale =>
        String(sale.createdAt || "").slice(0, 10) === today
    );

    const todayExpenses = expenses.filter(expense =>
        String(expense.createdAt || "").slice(0, 10) === today
    );

    const totalStock = products.reduce(
        (sum, product) => sum + Number(product.quantity || 0), 0
    );

    const stockCost = products.reduce(
        (sum, product) =>
            sum + Number(product.quantity || 0) * Number(product.cost || 0),
        0
    );

    const revenue = todaySales.reduce(
        (sum, sale) => sum + Number(sale.total || 0), 0
    );

    const profit = todaySales.reduce(
        (sum, sale) => sum + Number(sale.profit || 0), 0
    );

    const expenseTotal = todayExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0), 0
    );

    const debts = customers.reduce(
        (sum, customer) => sum + Number(customer.balance || 0), 0
    );

    if ($("stat-products")) {
        $("stat-products").textContent = products.length;
    }

    if ($("stat-stock")) {
        $("stat-stock").textContent = totalStock;
    }

    if ($("stat-stock-cost")) {
        $("stat-stock-cost").textContent = formatMoney(stockCost);
    }

    if ($("stat-sales")) {
        $("stat-sales").textContent = formatMoney(revenue);
    }

    if ($("stat-profit")) {
        $("stat-profit").textContent = formatMoney(profit - expenseTotal);
    }

    if ($("stat-expenses")) {
        $("stat-expenses").textContent = formatMoney(expenseTotal);
    }

    if ($("stat-debts")) {
        $("stat-debts").textContent = formatMoney(debts);
    }

    renderLowStockAlerts();
}

/* ALERTES */

function renderLowStockAlerts() {
    const container = $("low-stock-alerts");
    if (!container) return;

    const lowStock = products.filter(product =>
        Number(product.quantity || 0) <= Number(product.threshold || 12)
    );

    if (!lowStock.length) {
        container.innerHTML = "<p>Aucune alerte de stock.</p>";
        return;
    }

    container.innerHTML = lowStock.map(product => `
        <div class="alert-item">
            ⚠️ ${escapeHTML(product.name)} :
            ${Number(product.quantity || 0)} bouteilles restantes
        </div>
    `).join("");
}

/* PRODUITS */

function renderProducts() {
    const table = $("products-table");
    if (!table) return;

    if (!products.length) {
        table.innerHTML = `
            <tr><td colspan="5">Aucun produit enregistré.</td></tr>
        `;
        return;
    }

    table.innerHTML = products.map(product => `
        <tr>
            <td>${escapeHTML(product.name)}</td>
            <td>${Number(product.quantity || 0)}</td>
            <td>${formatMoney(product.cost)}</td>
            <td>${formatMoney(product.price)}</td>
            <td>${Number(product.unitsPerCrate || 12)} / casier</td>
        </tr>
    `).join("");
}

if ($("product-form")) {
    $("product-form").addEventListener("submit", async event => {
        event.preventDefault();

        if (!currentUser) return;

        const product = {
            name: $("product-name").value.trim(),
            brand: $("product-brand").value.trim(),
            unitsPerCrate: Number($("product-units").value || 12),
            quantity: Number($("product-quantity").value || 0),
            cost: Number($("product-cost").value || 0),
            price: Number($("product-price").value || 0),
            threshold: Number($("product-threshold").value || 12),
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

            $("product-form").reset();

            await loadData();

            alert("Produit enregistré avec succès.");

        } catch (error) {
            console.error(error);
            alert("Impossible d'enregistrer le produit.");
        }
    });
}

/* LISTE DES BOISSONS */

function updateSaleProductOptions() {
    const select = $("sale-product");
    if (!select) return;

    select.innerHTML = '<option value="">Choisir une boisson</option>';

    products.forEach(product => {
        const option = document.createElement("option");

        option.value = product.id;
        option.textContent =
            `${product.name} (${product.quantity || 0} bouteilles)`;

        select.appendChild(option);
    });
}

/* LISTE DES CLIENTS */

function updateSaleCustomerOptions() {
    const select = $("sale-customer");
    if (!select) return;

    select.innerHTML = '<option value="">Client de passage</option>';

    customers.forEach(customer => {
        const option = document.createElement("option");

        option.value = customer.id;
        option.textContent = customer.name;

        select.appendChild(option);
    });
}

/* PRÉREMPLISSAGE DES PRIX */

if ($("sale-product")) {
    $("sale-product").addEventListener("change", () => {
        const product = products.find(item =>
            item.id === $("sale-product").value
        );

        if (!product) return;

        $("sale-crate-price").value =
            Number(product.price || 0) *
            Number(product.unitsPerCrate || 12);

        $("sale-bottle-price").value = Number(product.price || 0);
    });
}

/* ENREGISTREMENT DES VENTES */

if ($("sale-form")) {
    $("sale-form").addEventListener("submit", async event => {
        event.preventDefault();

        if (!currentUser) return;

        const productId = $("sale-product").value;

        const product = products.find(item => item.id === productId);

        if (!product) {
            alert("Choisissez une boisson.");
            return;
        }

        const crates = Number($("sale-crates").value || 0);
        const bottles = Number($("sale-bottles").value || 0);
        const units = Number(product.unitsPerCrate || 12);

        const totalBottles = crates * units + bottles;

        if (totalBottles <= 0) {
            alert("Indiquez une quantité à vendre.");
            return;
        }

        if (totalBottles > Number(product.quantity || 0)) {
            alert("Stock insuffisant.");
            return;
        }

        const cratePrice = Number(
            $("sale-crate-price").value ||
            Number(product.price || 0) * units
        );

        const bottlePrice = Number(
            $("sale-bottle-price").value || product.price || 0
        );

        const total = crates * cratePrice + bottles * bottlePrice;

        const paymentMethod = $("sale-payment").value;

        const enteredAmount = Number(
            $("sale-amount-paid").value || 0
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

        const customerId = $("sale-customer").value || null;

        const customer = customers.find(item =>
            item.id === customerId
        );

        if (amountPaid < total && !customerId) {
            alert("Sélectionnez un client pour une vente à crédit ou partielle.");
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

            $("sale-form").reset();

            await loadData();

            alert("Vente enregistrée avec succès.");

        } catch (error) {
            console.error(error);
            alert(error.message || "Impossible d'enregistrer la vente.");
        }
    });
}

/* HISTORIQUE DES VENTES */

function renderSales() {
    const container = $("sales-history");
    if (!container) return;

    if (!sales.length) {
        container.innerHTML = "<p>Aucune vente enregistrée.</p>";
        return;
    }

    const sorted = [...sales].sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );

    container.innerHTML = sorted.map(sale => `
        <div class="sale-card">
            <h4>${escapeHTML(sale.productName || "Boisson")}</h4>
            <p>Client : ${escapeHTML(sale.customerName || "Client de passage")}</p>
            <p>Quantité : ${Number(sale.totalBottles || sale.quantity || 0)} bouteilles</p>
            <p>Total : ${formatMoney(sale.total)}</p>
            <p>Payé : ${formatMoney(sale.amountPaid)}</p>
            <p>Reste : ${formatMoney(sale.remaining)}</p>
            <p>Date : ${escapeHTML(String(sale.createdAt || "").slice(0, 16))}</p>
        </div>
    `).join("");
}

/* CLIENTS */

function renderCustomers() {
    const container = $("customers-list");
    if (!container) return;

    if (!customers.length) {
        container.innerHTML = "<p>Aucun client enregistré.</p>";
        return;
    }

    container.innerHTML = customers.map(customer => `
        <div class="customer-card">
            <h4>${escapeHTML(customer.name)}</h4>
            <p>Téléphone : ${escapeHTML(customer.phone || "Non renseigné")}</p>
            <p>Solde restant : ${formatMoney(customer.balance)}</p>
        </div>
    `).join("");
}

if ($("customer-form")) {
    $("customer-form").addEventListener("submit", async event => {
        event.preventDefault();

        const name = $("customer-name").value.trim();
        const phone = $("customer-phone").value.trim();

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

            $("customer-form").reset();

            await loadData();

            alert("Client enregistré avec succès.");

        } catch (error) {
            console.error(error);
            alert("Impossible d'enregistrer le client.");
        }
    });
}

/* ==================================
   GESTION DES FOURNISSEURS
================================== */

function renderSuppliers() {
    const container = $("suppliers-list");
    if (!container) return;

    if (!suppliers.length) {
        container.innerHTML = `
            <p>Aucun fournisseur enregistré.</p>
        `;
    } else {
        container.innerHTML = suppliers.map(supplier => `
            <div class="supplier-card">
                <h4>${escapeHTML(supplier.name)}</h4>

                <p>
                    Téléphone :
                    ${escapeHTML(supplier.phone || "Non renseigné")}
                </p>

                <p>
                    Adresse :
                    ${escapeHTML(supplier.address || "Non renseignée")}
                </p>

                <p>
                    Contact :
                    ${escapeHTML(supplier.contact || "Non renseigné")}
                </p>

                <button
                    type="button"
                    data-edit-supplier="${escapeHTML(supplier.id)}">
                    Modifier
                </button>

                <button
                    type="button"
                    data-delete-supplier="${escapeHTML(supplier.id)}">
                    Supprimer
                </button>
            </div>
        `).join("");
    }

    addSupplierFormIfNeeded();
}

/* CRÉATION DU FORMULAIRE FOURNISSEUR */

function addSupplierFormIfNeeded() {
    const section = $("suppliers-section");

    if (!section || $("supplier-form")) return;

    const formContainer = document.createElement("div");

    formContainer.id = "supplier-form-container";

    formContainer.innerHTML = `
        <div class="content-card">
            <h3>Ajouter un fournisseur</h3>

            <form id="supplier-form">

                <label for="supplier-name">Nom du fournisseur</label>
                <input
                    type="text"
                    id="supplier-name"
                    placeholder="Nom du fournisseur"
                    required
                >

                <label for="supplier-phone">Téléphone</label>
                <input
                    type="tel"
                    id="supplier-phone"
                    placeholder="Numéro de téléphone"
                >

                <label for="supplier-address">Adresse</label>
                <input
                    type="text"
                    id="supplier-address"
                    placeholder="Adresse du fournisseur"
                >

                <label for="supplier-contact">Personne à contacter</label>
                <input
                    type="text"
                    id="supplier-contact"
                    placeholder="Nom du contact"
                >

                <button type="submit">
                    Enregistrer le fournisseur
                </button>

            </form>
        </div>
    `;

    section.insertBefore(formContainer, $("suppliers-list"));

    $("supplier-form").addEventListener("submit", async event => {
        event.preventDefault();

        if (!currentUser) return;

        const supplier = {
            name: $("supplier-name").value.trim(),
            phone: $("supplier-phone").value.trim(),
            address: $("supplier-address").value.trim(),
            contact: $("supplier-contact").value.trim(),
            active: true,
            createdBy: currentUser.uid
        };

        if (!supplier.name) {
            alert("Le nom du fournisseur est obligatoire.");
            return;
        }

        try {
            await addSupplier(supplier);

            $("supplier-form").reset();

            await loadData();

            alert("Fournisseur enregistré avec succès.");

        } catch (error) {
            console.error(error);
            alert("Impossible d'enregistrer le fournisseur.");
        }
    });
}

/* ACTIONS SUR LES FOURNISSEURS */

if ($("suppliers-list")) {
    $("suppliers-list").addEventListener("click", async event => {

        const editButton = event.target.closest("[data-edit-supplier]");
        const deleteButton = event.target.closest("[data-delete-supplier]");

        if (editButton) {
            const supplierId = editButton.dataset.editSupplier;

            const supplier = suppliers.find(item =>
                item.id === supplierId
            );

            if (!supplier) {
                alert("Fournisseur introuvable.");
                return;
            }

            const name = prompt(
                "Nom du fournisseur :",
                supplier.name || ""
            );

            if (name === null) return;

            if (!name.trim()) {
                alert("Le nom est obligatoire.");
                return;
            }

            const phone = prompt(
                "Téléphone :",
                supplier.phone || ""
            );

            if (phone === null) return;

            const address = prompt(
                "Adresse :",
                supplier.address || ""
            );

            if (address === null) return;

            const contact = prompt(
                "Personne à contacter :",
                supplier.contact || ""
            );

            if (contact === null) return;

            try {
                await updateRecord("suppliers", supplierId, {
                    name: name.trim(),
                    phone: phone.trim(),
                    address: address.trim(),
                    contact: contact.trim()
                });

                await loadData();

                alert("Fournisseur modifié avec succès.");

            } catch (error) {
                console.error(error);
                alert("Impossible de modifier ce fournisseur.");
            }
        }

        if (deleteButton) {
            const supplierId = deleteButton.dataset.deleteSupplier;

            const supplier = suppliers.find(item =>
                item.id === supplierId
            );

            if (!supplier) return;

            if (!confirm(
                `Voulez-vous vraiment supprimer le fournisseur ${supplier.name} ?`
            )) {
                return;
            }

            try {
                await removeRecord("suppliers", supplierId);

                await loadData();

                alert("Fournisseur supprimé.");

            } catch (error) {
                console.error(error);
                alert("Impossible de supprimer ce fournisseur.");
            }
        }
    });
}

/* NAVIGATION PRINCIPALE */

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
        const pageName = button.dataset.page;

        document.querySelectorAll(".page").forEach(page => {
            page.classList.remove("active");
            page.hidden = true;
        });

        const target = $(pageName);

        if (target) {
            target.hidden = false;
            target.classList.add("active");
        }

        document.querySelectorAll("[data-page]").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");
    });
});

/* SOUS-MENUS */

document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => {
        const section = $(button.dataset.section);

        if (section) {
            section.hidden = !section.hidden;
        }
    });
});

/* DEMANDES D'ACCÈS */

async function renderUserRequests() {
    const container = $("users-list");

    if (!container || currentRole !== "admin") return;

    try {
        const snapshot = await getDocs(collection(db, "userRequests"));

        const requests = snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        }));

        const pending = requests.filter(item =>
            item.status === "pending"
        );

        if (!pending.length) {
            container.innerHTML = "<p>Aucune demande en attente.</p>";
            return;
        }

        container.innerHTML = pending.map(item => `
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
        container.innerHTML = "<p>Impossible de charger les demandes.</p>";
    }
}

/* ACTIONS ADMINISTRATEUR */

if ($("users-list")) {
    $("users-list").addEventListener("click", async event => {
        if (currentRole !== "admin") return;

        const approve = event.target.closest("[data-approve-user]");
        const deny = event.target.closest("[data-deny-user]");

        if (approve) {
            const uid = approve.dataset.approveUser;

            try {
                const requestRef = doc(db, "userRequests", uid);
                const snapshot = await getDoc(requestRef);

                if (!snapshot.exists()) {
                    alert("Cette demande n'existe plus.");
                    await renderUserRequests();
                    return;
                }

                const data = snapshot.data();

                await setDoc(doc(db, "authorizedUsers", uid), {
                    uid,
                    name: data.name || "",
                    email: data.email || "",
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

        if (deny) {
            const uid = deny.dataset.denyUser;

            if (!confirm("Voulez-vous refuser cette demande ?")) return;

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
                alert("Impossible de refuser cet utilisateur.");
            }
        }
    });
}

/* INFORMATIONS UTILISATEUR */

function displayUserInformation(user) {
    const element = $("current-user");
    if (!element) return;

    const name = user.displayName || user.email || "Utilisateur";

    const role = currentRole === "admin"
        ? "Administrateur"
        : "Opérateur";

    element.textContent = `${name} — ${role}`;
}

/* INTERFACE SELON LE RÔLE */

function configureRoleInterface() {
    const button = document.querySelector(
        '[data-section="users-section"]'
    );

    if (button) {
        button.hidden = currentRole !== "admin";
    }

    if ($("users-section") && currentRole !== "admin") {
        $("users-section").hidden = true;
    }
}

/* CONNEXION INTERNET */

function updateConnectionStatus(online) {
    const element = $("sync-status");
    if (!element) return;

    element.textContent = online ? "En ligne" : "Hors connexion";
}

/* INITIALISATION */

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
        console.error(error);

        showLogin();

        alert(
            "Impossible de vérifier les autorisations. Vérifiez les règles Firestore."
        );
    }
}

/* SURVEILLANCE DE L'AUTHENTIFICATION */

onAuthStateChanged(auth, async user => {
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

/* INITIALISATION HORS LIGNE */

async function initializeOfflineFeatures() {
    try {
        await openOfflineDB();

        const pending = await countPendingOperations();

        console.log(
            "Opérations en attente :",
            pending
        );

        listenToConnection(updateConnectionStatus);

        updateConnectionStatus(isOnline());

    } catch (error) {
        console.error("Erreur hors ligne :", error);
    }
}

initializeOfflineFeatures();

/* SERVICE WORKER */

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./service-worker.js")
            .then(() => {
                console.log("Service Worker enregistré.");
            })
            .catch(error => {
                console.error("Erreur Service Worker :", error);
            });
    });
}