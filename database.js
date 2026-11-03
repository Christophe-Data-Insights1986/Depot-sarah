// ======================================================
// DÉPÔT SARAH V2 — MOTEUR DE DONNÉES
// ======================================================

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


// ======================================================
// COLLECTIONS
// ======================================================

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


// ======================================================
// OUTILS
// ======================================================

function createId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return Date.now().toString(36) +
        Math.random().toString(36).slice(2);
}

function ref(collectionName, id) {
    return doc(db, collectionName, id);
}

function validateAmount(value, label = "Montant") {
    const result = Number(value);

    if (!Number.isFinite(result) || result < 0) {
        throw new Error(label + " invalide.");
    }

    return result;
}

function validateQuantity(value, label = "Quantité") {
    const result = Number(value);

    if (
        !Number.isSafeInteger(result) ||
        result < 0
    ) {
        throw new Error(label + " invalide.");
    }

    return result;
}

function validateText(value) {
    return String(value ?? "").trim();
}

function normalizeDate(value) {
    if (!value) return new Date().toISOString();

    if (typeof value === "string") return value;

    if (value.toDate) {
        return value.toDate().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return new Date().toISOString();
}

function normalizeRecord(snapshot) {
    const data = snapshot.data();

    const record = {
        id: snapshot.id,
        ...data
    };

    record.createdAt = normalizeDate(data.createdAt);

    if (data.updatedAt) {
        record.updatedAt = normalizeDate(data.updatedAt);
    }

    // Compatibilité avec app.js
    if (data.qty !== undefined) {
        record.quantity = data.qty;
    }

    if (data.units !== undefined) {
        record.unitsPerCrate = data.units;
    }

    if (data.quantity !== undefined) {
        record.totalBottles = data.quantity;
    }

    if (data.estimatedProfit !== undefined) {
        record.profit = data.estimatedProfit;
    }

    return record;
}


// ======================================================
// LECTURE
// ======================================================

export async function getAll(collectionName) {
    const snapshot = await getDocs(
        collection(db, collectionName)
    );

    return snapshot.docs.map(normalizeRecord);
}

export async function getById(collectionName, id) {
    const snapshot = await getDoc(
        ref(collectionName, id)
    );

    if (!snapshot.exists()) return null;

    return normalizeRecord(snapshot);
}


// ======================================================
// CRÉATION ET MODIFICATION
// ======================================================

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


// ======================================================
// PRODUITS
// ======================================================

export async function addProduct(product) {
    const name = validateText(product.name);

    if (!name) {
        throw new Error("Le nom du produit est obligatoire.");
    }

    const units = validateQuantity(
        product.units ?? product.unitsPerCrate ?? 12,
        "Unités par casier"
    );

    if (units < 1) {
        throw new Error("Le casier doit contenir au moins une bouteille.");
    }

    const qty = validateQuantity(
        product.qty ?? product.quantity ?? 0
    );

    const data = {
        name,
        brand: validateText(product.brand),
        units,
        qty,
        cost: validateAmount(product.cost ?? 0, "Prix d'achat"),
        price: validateAmount(product.price ?? 0, "Prix de vente"),
        threshold: validateQuantity(
            product.threshold ?? 12,
            "Seuil d'alerte"
        ),
        active: true
    };

    const id = await createRecord(
        COLLECTIONS.products,
        data
    );

    // Enregistrer le stock initial dans l'historique
    if (qty > 0) {
        await createRecord(
            COLLECTIONS.stockMovements,
            {
                productId: id,
                productName: name,
                type: "STOCK_INITIAL",
                quantity: qty,
                previousQty: 0,
                newQty: qty,
                reason: "Création du produit"
            }
        );
    }

    return id;
}

export async function getProducts() {
    return await getAll(COLLECTIONS.products);
}


// ======================================================
// MOUVEMENTS DE STOCK
// ======================================================

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


// ======================================================
// ENTRÉE DE STOCK
// ======================================================

export async function addStock(productId, quantity, details = {}) {
    quantity = validateQuantity(quantity);

    if (!productId || quantity < 1) {
        throw new Error("Approvisionnement invalide.");
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


// ======================================================
// VENTES
// ======================================================

export async function createSale(sale) {
    const productId = sale.productId;
    const customerId = sale.customerId || null;

    if (!productId) {
        throw new Error("Veuillez sélectionner une boisson.");
    }

    const crates = validateQuantity(sale.crates ?? 0);
    const bottles = validateQuantity(sale.bottles ?? 0);

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
        // LECTURES
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

        // VÉRIFICATIONS
        if (product.active === false) {
            throw new Error("Produit désactivé.");
        }

        const units = validateQuantity(product.units);

        if (units < 1) {
            throw new Error("Format de casier invalide.");
        }

        const quantity = crates * units + bottles;

        if (quantity < 1) {
            throw new Error("Quantité vendue invalide.");
        }

        const previousQty = validateQuantity(product.qty);

        if (quantity > previousQty) {
            throw new Error("Stock insuffisant.");
        }

        const total =
            crates * cratePrice +
            bottles * bottlePrice;

        if (total <= 0) {
            throw new Error("Montant de vente invalide.");
        }

        if (amountPaid > total) {
            throw new Error("Le paiement dépasse le montant de la vente.");
        }

        const remaining = total - amountPaid;

        if (remaining > 0 && !customerId) {
            throw new Error(
                "Sélectionnez un client pour enregistrer un crédit."
            );
        }

        const cost = validateAmount(product.cost);
        const estimatedProfit = total - quantity * cost;

        const newQty = previousQty - quantity;

        const paymentStatus =
            remaining === 0
                ? "PAYE"
                : amountPaid === 0
                    ? "CREDIT"
                    : "PARTIEL";

        const paymentMethod = sale.paymentMethod || "cash";

        // ÉCRITURE DE LA VENTE
        transaction.set(
            ref(COLLECTIONS.sales, saleId),
            {
                productId,
                productName: product.name,
                customerId,
                customerName: sale.customerName ||
                    customer?.name ||
                    "Client de passage",
                crates,
                bottles,
                quantity,
                totalBottles: quantity,
                cratePrice,
                bottlePrice,
                total,
                amountPaid,
                remaining,
                paymentStatus,
                paymentMethod,
                estimatedProfit,
                profit: estimatedProfit,
                userId: sale.userId || null,
                operationId: sale.operationId || saleId,
                createdAt: serverTimestamp()
            }
        );

        // DÉDUCTION DU STOCK
        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

        // HISTORIQUE DU STOCK
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

        // DETTE CLIENT
        if (remaining > 0) {
            const oldBalance = validateAmount(
                customer.balance ?? 0
            );

            transaction.update(customerRef, {
                balance: oldBalance + remaining,
                updatedAt: serverTimestamp()
            });
        }

        // PAIEMENT INITIAL
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
            profit: estimatedProfit,
            newQty,
            paymentStatus
        };
    });
}


// ======================================================
// CLIENTS
// ======================================================

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


// ======================================================
// REMBOURSEMENTS CLIENTS
// ======================================================

export async function recordCustomerPayment(data) {
    const customerId = data.customerId;

    const amount = validateAmount(
        data.amount,
        "Montant du remboursement"
    );

    if (!customerId || amount <= 0) {
        throw new Error("Remboursement invalide.");
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
            customer.balance ?? 0
        );

        if (balance <= 0 || amount > balance) {
            throw new Error("Montant supérieur à la dette.");
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


// ======================================================
// FOURNISSEURS
// ======================================================

export async function addSupplier(supplier) {
    const name = validateText(supplier.name);

    if (!name) {
        throw new Error("Nom du fournisseur obligatoire.");
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

export async function getSuppliers() {
    return await getAll(COLLECTIONS.suppliers);
}


// ======================================================
// DÉPENSES
// ======================================================

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


// ======================================================
// PERTES
// ======================================================

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

        if (quantity > previousQty) {
            throw new Error("Stock insuffisant.");
        }

        const newQty = previousQty - quantity;

        const cost = validateAmount(product.cost);

        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

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


// ======================================================
// FIN DU MOTEUR
// ======================================================
