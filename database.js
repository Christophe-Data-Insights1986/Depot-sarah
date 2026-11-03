// ==================================================
// DÉPÔT SARAH V2
// MOTEUR DE DONNÉES FIRESTORE
// ==================================================

import { db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ==================================================
// COLLECTIONS FIRESTORE
// ==================================================

export const COLLECTIONS = {
    products: "products",
    suppliers: "suppliers",
    purchases: "purchases",
    sales: "sales",
    customers: "customers",
    payments: "payments",
    expenses: "expenses",
    losses: "losses",
    stockMovements: "stockMovements",
    cashClosures: "cashClosures",
    authorizedUsers: "authorizedUsers",
    userRequests: "userRequests"
};


// ==================================================
// OUTILS
// ==================================================

function createId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return Date.now().toString(36) +
        Math.random().toString(36).slice(2);
}

function ref(collectionName, id) {
    return doc(db, collectionName, id);
}

function validateAmount(value, label = "Montant") {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        throw new Error(label + " invalide.");
    }

    return number;
}

function validateQuantity(value, label = "Quantité") {
    const number = Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        throw new Error(label + " invalide.");
    }

    return number;
}

function validateText(value) {
    return String(value || "").trim();
}


// ==================================================
// LECTURE DES DONNÉES
// ==================================================

export async function getAll(collectionName) {
    const snapshot = await getDocs(
        collection(db, collectionName)
    );

    return snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));
}

export async function getById(collectionName, id) {
    const snapshot = await getDoc(
        ref(collectionName, id)
    );

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    };
}


// ==================================================
// CRÉATION ET MODIFICATION GÉNÉRIQUES
// ==================================================

export async function createRecord(collectionName, data) {
    const id = createId();

    await setDoc(
        ref(collectionName, id),
        {
            ...data,
            createdAt: serverTimestamp()
        }
    );

    return id;
}

export async function updateRecord(collectionName, id, data) {
    await updateDoc(
        ref(collectionName, id),
        {
            ...data,
            updatedAt: serverTimestamp()
        }
    );
}

export async function removeRecord(collectionName, id) {
    await deleteDoc(
        ref(collectionName, id)
    );
}


// ==================================================
// PRODUITS
// ==================================================

export async function addProduct(product) {

    const name = validateText(product.name);

    if (!name) {
        throw new Error("Le nom du produit est obligatoire.");
    }

    const units = validateQuantity(
        product.units ?? 12,
        "Unités par casier"
    );

    if (units < 1) {
        throw new Error("Le casier doit contenir au moins une bouteille.");
    }

    const data = {
        name,
        brand: validateText(product.brand),
        units,
        qty: validateQuantity(product.qty ?? 0),
        cost: validateAmount(product.cost ?? 0, "Prix d'achat"),
        price: validateAmount(product.price ?? 0, "Prix de vente"),
        threshold: validateQuantity(
            product.threshold ?? 12,
            "Seuil d'alerte"
        ),
        active: true
    };

    return await createRecord(
        COLLECTIONS.products,
        data
    );
}

export async function getProducts() {
    return await getAll(COLLECTIONS.products);
}


// ==================================================
// MOUVEMENTS DE STOCK
// ==================================================

function recordStockMovement(transaction, data) {

    const id = createId();

    transaction.set(
        ref(COLLECTIONS.stockMovements, id),
        {
            ...data,
            createdAt: serverTimestamp()
        }
    );

    return id;
}


// ==================================================
// APPROVISIONNEMENT SIMPLE
// ==================================================

export async function addStock(productId, quantity, details = {}) {

    quantity = validateQuantity(quantity);

    if (!productId || quantity < 1) {
        throw new Error("Informations d'approvisionnement invalides.");
    }

    return await runTransaction(db, async transaction => {

        const productRef = ref(
            COLLECTIONS.products,
            productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();

        const previousQty = validateQuantity(product.qty);

        const newQty = previousQty + quantity;

        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

        recordStockMovement(transaction, {
            productId,
            productName: product.name,
            type: "ENTREE",
            quantity,
            previousQty,
            newQty,
            reason: details.reason || "Approvisionnement",
            referenceId: details.referenceId || null,
            userId: details.userId || null
        });

        return newQty;
    });
}


// ==================================================
// ENREGISTREMENT D'UNE VENTE
// ==================================================

export async function createSale(sale) {

    const productId = sale.productId;
    const customerId = sale.customerId || null;

    if (!productId) {
        throw new Error("Veuillez sélectionner une boisson.");
    }

    const crates = validateQuantity(
        sale.crates ?? 0,
        "Nombre de casiers"
    );

    const bottles = validateQuantity(
        sale.bottles ?? 0,
        "Nombre de bouteilles"
    );

    const cratePrice = validateAmount(
        sale.cratePrice ?? 0,
        "Prix du casier"
    );

    const bottlePrice = validateAmount(
        sale.bottlePrice ?? 0,
        "Prix de la bouteille"
    );

    const amountPaid = validateAmount(
        sale.amountPaid ?? 0,
        "Montant payé"
    );

    const saleId = createId();

    return await runTransaction(db, async transaction => {

        // ------------------------------------------
        // 1. LIRE LES DOCUMENTS AVANT LES ÉCRITURES
        // ------------------------------------------

        const productRef = ref(
            COLLECTIONS.products,
            productId
        );

        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = productSnapshot.data();

        let customerRef = null;
        let customer = null;

        if (customerId) {

            customerRef = ref(
                COLLECTIONS.customers,
                customerId
            );

            const customerSnapshot = await transaction.get(
                customerRef
            );

            if (!customerSnapshot.exists()) {
                throw new Error("Client introuvable.");
            }

            customer = customerSnapshot.data();
        }

        // ------------------------------------------
        // 2. VÉRIFIER LES INFORMATIONS
        // ------------------------------------------

        if (product.active === false) {
            throw new Error("Ce produit est désactivé.");
        }

        const units = validateQuantity(
            product.units,
            "Unités par casier"
        );

        if (units < 1) {
            throw new Error("Format de casier invalide.");
        }

        const quantity = crates * units + bottles;

        if (quantity < 1) {
            throw new Error("La quantité vendue doit être positive.");
        }

        const previousQty = validateQuantity(product.qty);

        if (previousQty < quantity) {
            throw new Error("Stock insuffisant pour cette vente.");
        }

        // ------------------------------------------
        // 3. CALCULER LA VENTE
        // ------------------------------------------

        const total =
            crates * cratePrice +
            bottles * bottlePrice;

        if (total <= 0) {
            throw new Error("Le montant de la vente doit être positif.");
        }

        if (amountPaid > total) {
            throw new Error("Le paiement dépasse le montant de la vente.");
        }

        const remaining = total - amountPaid;

        if (remaining > 0 && !customerId) {
            throw new Error(
                "En cas de paiement partiel ou à crédit, sélectionnez un client."
            );
        }

        const cost = validateAmount(
            product.cost,
            "Prix d'achat"
        );

        const profit = total - quantity * cost;

        const newQty = previousQty - quantity;

        const paymentStatus =
            remaining === 0
                ? "PAYE"
                : amountPaid === 0
                    ? "CREDIT"
                    : "PARTIEL";

        const paymentMethod = sale.paymentMethod || "cash";

        // ------------------------------------------
        // 4. ENREGISTRER LA VENTE
        // ------------------------------------------

        transaction.set(
            ref(COLLECTIONS.sales, saleId),
            {
                productId,
                productName: product.name,
                customerId,
                crates,
                bottles,
                quantity,
                cratePrice,
                bottlePrice,
                total,
                amountPaid,
                remaining,
                paymentStatus,
                paymentMethod,
                estimatedProfit: profit,
                userId: sale.userId || null,
                operationId: saleId,
                createdAt: serverTimestamp()
            }
        );

        // ------------------------------------------
        // 5. DÉDUIRE LE STOCK
        // ------------------------------------------

        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

        // ------------------------------------------
        // 6. ENREGISTRER LE MOUVEMENT
        // ------------------------------------------

        recordStockMovement(transaction, {
            productId,
            productName: product.name,
            type: "VENTE",
            quantity: -quantity,
            previousQty,
            newQty,
            referenceId: saleId,
            reason: "Vente",
            userId: sale.userId || null
        });

        // ------------------------------------------
        // 7. METTRE À JOUR LA DETTE DU CLIENT
        // ------------------------------------------

        if (remaining > 0) {

            const oldBalance = validateAmount(
                customer.balance ?? 0,
                "Solde client"
            );

            transaction.update(customerRef, {
                balance: oldBalance + remaining,
                updatedAt: serverTimestamp()
            });
        }

        // ------------------------------------------
        // 8. ENREGISTRER LE PAIEMENT
        // ------------------------------------------

        if (amountPaid > 0) {

            const paymentId = createId();

            transaction.set(
                ref(COLLECTIONS.payments, paymentId),
                {
                    saleId,
                    customerId,
                    amount: amountPaid,
                    method: paymentMethod,
                    type: "PAIEMENT_VENTE",
                    createdAt: serverTimestamp()
                }
            );
        }

        return {
            saleId,
            total,
            amountPaid,
            remaining,
            profit,
            newQty,
            paymentStatus
        };
    });
}


// ==================================================
// CLIENTS
// ==================================================

export async function addCustomer(customer) {

    const name = validateText(customer.name);

    if (!name) {
        throw new Error("Le nom du client est obligatoire.");
    }

    return await createRecord(
        COLLECTIONS.customers,
        {
            name,
            phone: validateText(customer.phone),
            balance: 0,
            active: true
        }
    );
}

export async function getCustomers() {
    return await getAll(COLLECTIONS.customers);
}


// ==================================================
// REMBOURSEMENT D'UNE DETTE CLIENT
// ==================================================

export async function recordCustomerPayment(data) {

    const customerId = data.customerId;

    const amount = validateAmount(
        data.amount,
        "Montant du remboursement"
    );

    if (!customerId || amount <= 0) {
        throw new Error("Informations de remboursement invalides.");
    }

    const paymentId = createId();

    return await runTransaction(db, async transaction => {

        const customerRef = ref(
            COLLECTIONS.customers,
            customerId
        );

        const snapshot = await transaction.get(customerRef);

        if (!snapshot.exists()) {
            throw new Error("Client introuvable.");
        }

        const customer = snapshot.data();

        const balance = validateAmount(
            customer.balance ?? 0,
            "Dette du client"
        );

        if (balance <= 0) {
            throw new Error("Ce client n'a aucune dette.");
        }

        if (amount > balance) {
            throw new Error("Le remboursement dépasse la dette.");
        }

        const remainingBalance = balance - amount;

        transaction.update(customerRef, {
            balance: remainingBalance,
            updatedAt: serverTimestamp()
        });

        transaction.set(
            ref(COLLECTIONS.payments, paymentId),
            {
                customerId,
                amount,
                method: data.method || "cash",
                type: "REMBOURSEMENT",
                createdAt: serverTimestamp()
            }
        );

        return {
            paymentId,
            remainingBalance
        };
    });
}


// ==================================================
// FOURNISSEURS
// ==================================================

export async function addSupplier(supplier) {

    const name = validateText(supplier.name);

    if (!name) {
        throw new Error("Le nom du fournisseur est obligatoire.");
    }

    return await createRecord(
        COLLECTIONS.suppliers,
        {
            name,
            phone: validateText(supplier.phone),
            address: validateText(supplier.address),
            contact: validateText(supplier.contact),
            active: true
        }
    );
}


// ==================================================
// DÉPENSES
// ==================================================

export async function addExpense(expense) {

    const amount = validateAmount(
        expense.amount,
        "Montant de la dépense"
    );

    if (amount <= 0) {
        throw new Error("La dépense doit être positive.");
    }

    return await createRecord(
        COLLECTIONS.expenses,
        {
            category: expense.category || "Autre",
            description: validateText(expense.description),
            amount,
            method: expense.method || "cash",
            userId: expense.userId || null
        }
    );
}


// ==================================================
// PERTES ET BOUTEILLES CASSÉES
// ==================================================

export async function recordLoss(data) {

    const productId = data.productId;

    const quantity = validateQuantity(
        data.quantity,
        "Quantité perdue"
    );

    if (!productId || quantity < 1) {
        throw new Error("Informations de perte invalides.");
    }

    const lossId = createId();

    return await runTransaction(db, async transaction => {

        // Lecture du produit
        const productRef = ref(
            COLLECTIONS.products,
            productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();

        const previousQty = validateQuantity(product.qty);

        if (previousQty < quantity) {
            throw new Error("Stock insuffisant pour enregistrer cette perte.");
        }

        const newQty = previousQty - quantity;

        const cost = validateAmount(
            product.cost,
            "Prix d'achat"
        );

        // Mise à jour du stock
        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

        // Enregistrement de la perte
        transaction.set(
            ref(COLLECTIONS.losses, lossId),
            {
                productId,
                productName: product.name,
                quantity,
                reason: data.reason || "Autre",
                financialValue: quantity * cost,
                userId: data.userId || null,
                createdAt: serverTimestamp()
            }
        );

        // Historique du mouvement
        recordStockMovement(transaction, {
            productId,
            productName: product.name,
            type: "PERTE",
            quantity: -quantity,
            previousQty,
            newQty,
            referenceId: lossId,
            reason: data.reason || "Perte",
            userId: data.userId || null
        });

        return {
            lossId,
            previousQty,
            newQty
        };
    });
}


// ==================================================
// FIN DU MOTEUR DE DONNÉES
// ==================================================
