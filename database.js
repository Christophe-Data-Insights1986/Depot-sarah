// ============================================
// DÉPÔT SARAH V2
// MOTEUR DE BASE DE DONNÉES FIRESTORE
// ============================================

import { db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ============================================
// COLLECTIONS
// ============================================

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

// ============================================
// OUTILS GÉNÉRAUX
// ============================================

function collectionRef(name) {
    return collection(db, name);
}

function documentRef(name, id) {
    return doc(db, name, id);
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

    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(label + " invalide.");
    }

    return number;
}

function operationId() {
    return crypto.randomUUID();
}

// ============================================
// LECTURE DES DONNÉES
// ============================================

export async function getAll(collectionName) {
    const snapshot = await getDocs(collectionRef(collectionName));

    return snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));
}

export async function getById(collectionName, id) {
    const snapshot = await getDoc(
        documentRef(collectionName, id)
    );

    if (!snapshot.exists()) {
        return null;
    }

    return {
        id: snapshot.id,
        ...snapshot.data()
    };
}

// ============================================
// AJOUT D'UN DOCUMENT
// ============================================

export async function createRecord(collectionName, data) {
    const id = operationId();

    await setDoc(
        documentRef(collectionName, id),
        {
            ...data,
            createdAt: serverTimestamp()
        }
    );

    return id;
}

// ============================================
// MODIFICATION D'UN DOCUMENT
// ============================================

export async function updateRecord(collectionName, id, data) {
    await updateDoc(
        documentRef(collectionName, id),
        {
            ...data,
            updatedAt: serverTimestamp()
        }
    );
}

// ============================================
// SUPPRESSION D'UN DOCUMENT
// ============================================

export async function removeRecord(collectionName, id) {
    await deleteDoc(
        documentRef(collectionName, id)
    );
}

// ============================================
// PRODUITS
// ============================================

export async function addProduct(product) {
    const units = validateQuantity(product.units ?? 12, "Unités par casier");

    if (units < 1) {
        throw new Error("Un casier doit contenir au moins une bouteille.");
    }

    const data = {
        name: String(product.name || "").trim(),
        brand: String(product.brand || "").trim(),
        units,
        qty: validateQuantity(product.qty ?? 0),
        cost: validateAmount(product.cost ?? 0, "Prix d'achat"),
        price: validateAmount(product.price ?? 0, "Prix de vente"),
        threshold: validateQuantity(product.threshold ?? 12, "Seuil d'alerte"),
        active: true
    };

    if (!data.name) {
        throw new Error("Le nom du produit est obligatoire.");
    }

    return await createRecord(COLLECTIONS.products, data);
}

export async function getProducts() {
    return await getAll(COLLECTIONS.products);
}

// ============================================
// MOUVEMENTS DE STOCK
// ============================================

async function recordStockMovement(transaction, data) {
    const id = operationId();

    transaction.set(
        documentRef(COLLECTIONS.stockMovements, id),
        {
            ...data,
            createdAt: serverTimestamp()
        }
    );

    return id;
}

// ============================================
// AJOUT DE STOCK
// ============================================

export async function addStock(productId, quantity, details = {}) {
    quantity = validateQuantity(quantity);

    if (quantity < 1) {
        throw new Error("La quantité doit être supérieure à zéro.");
    }

    return await runTransaction(db, async transaction => {
        const productRef = documentRef(
            COLLECTIONS.products,
            productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();
        const newQty = validateQuantity(product.qty) + quantity;

        transaction.update(productRef, {
            qty: newQty,
            updatedAt: serverTimestamp()
        });

        await recordStockMovement(transaction, {
            productId,
            productName: product.name,
            type: "ENTREE",
            quantity,
            previousQty: product.qty,
            newQty,
            reason: details.reason || "Approvisionnement",
            referenceId: details.referenceId || null,
            userId: details.userId || null
        });

        return newQty;
    });
}

// ============================================
// VENTE ET DÉDUCTION DE STOCK
// ============================================

export async function createSale(sale) {
    const productId = sale.productId;

    const crates = validateQuantity(sale.crates ?? 0, "Casiers");
    const bottles = validateQuantity(sale.bottles ?? 0, "Bouteilles");

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

    if (!productId) {
        throw new Error("Veuillez sélectionner une boisson.");
    }

    const saleId = operationId();

    return await runTransaction(db, async transaction => {

        const productRef = documentRef(
            COLLECTIONS.products,
            productId
        );

        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = productSnapshot.data();

        if (!product.active) {
            throw new Error("Ce produit est désactivé.");
        }

        const totalQuantity =
            crates * validateQuantity(product.units) + bottles;

        if (totalQuantity < 1) {
            throw new Error("La quantité vendue est invalide.");
        }

        const currentStock = validateQuantity(product.qty);

        if (currentStock < totalQuantity) {
            throw new Error("Stock insuffisant pour cette vente.");
        }

        const total =
            crates * cratePrice + bottles * bottlePrice;

        if (amountPaid > total) {
            throw new Error("Le montant payé dépasse le total de la vente.");
        }

        const remaining = total - amountPaid;

        const profit =
            total - totalQuantity * validateAmount(product.cost);

        const newStock = currentStock - totalQuantity;

        const paymentStatus =
            remaining === 0 ? "PAYE" :
            amountPaid === 0 ? "CREDIT" :
            "PARTIEL";

        transaction.update(productRef, {
            qty: newStock,
            updatedAt: serverTimestamp()
        });

        transaction.set(
            documentRef(COLLECTIONS.sales, saleId),
            {
                productId,
                productName: product.name,
                customerId: sale.customerId || null,
                crates,
                bottles,
                quantity: totalQuantity,
                cratePrice,
                bottlePrice,
                total,
                amountPaid,
                remaining,
                paymentStatus,
                paymentMethod: sale.paymentMethod || "cash",
                estimatedProfit: profit,
                createdAt: serverTimestamp(),
                operationId: saleId
            }
        );

        await recordStockMovement(transaction, {
            productId,
            productName: product.name,
            type: "VENTE",
            quantity: -totalQuantity,
            previousQty: currentStock,
            newQty: newStock,
            referenceId: saleId,
            reason: "Vente",
            userId: sale.userId || null
        });

        if (remaining > 0 && sale.customerId) {
            const customerRef = documentRef(
                COLLECTIONS.customers,
                sale.customerId
            );

            const customerSnapshot = await transaction.get(customerRef);

            if (!customerSnapshot.exists()) {
                throw new Error("Client introuvable.");
            }

            const customer = customerSnapshot.data();

            transaction.update(customerRef, {
                balance: validateAmount(customer.balance ?? 0) + remaining,
                updatedAt: serverTimestamp()
            });
        }

        if (amountPaid > 0) {
            const paymentId = operationId();

            transaction.set(
                documentRef(COLLECTIONS.payments, paymentId),
                {
                    saleId,
                    customerId: sale.customerId || null,
                    amount: amountPaid,
                    method: sale.paymentMethod || "cash",
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
            newStock,
            paymentStatus
        };
    });
}

// ============================================
// CLIENTS
// ============================================

export async function addCustomer(customer) {
    const name = String(customer.name || "").trim();

    if (!name) {
        throw new Error("Le nom du client est obligatoire.");
    }

    return await createRecord(COLLECTIONS.customers, {
        name,
        phone: String(customer.phone || "").trim(),
        balance: 0,
        active: true
    });
}

export async function getCustomers() {
    return await getAll(COLLECTIONS.customers);
}

// ============================================
// REMBOURSEMENT CLIENT
// ============================================

export async function recordCustomerPayment(data) {
    const amount = validateAmount(data.amount, "Montant du remboursement");

    if (amount <= 0 || !data.customerId) {
        throw new Error("Informations de remboursement invalides.");
    }

    const paymentId = operationId();

    return await runTransaction(db, async transaction => {

        const customerRef = documentRef(
            COLLECTIONS.customers,
            data.customerId
        );

        const snapshot = await transaction.get(customerRef);

        if (!snapshot.exists()) {
            throw new Error("Client introuvable.");
        }

        const customer = snapshot.data();
        const balance = validateAmount(customer.balance ?? 0);

        if (amount > balance) {
            throw new Error("Le remboursement dépasse la dette du client.");
        }

        transaction.update(customerRef, {
            balance: balance - amount,
            updatedAt: serverTimestamp()
        });

        transaction.set(
            documentRef(COLLECTIONS.payments, paymentId),
            {
                customerId: data.customerId,
                amount,
                method: data.method || "cash",
                type: "REMBOURSEMENT",
                createdAt: serverTimestamp()
            }
        );

        return {
            paymentId,
            remainingBalance: balance - amount
        };
    });
}

// ============================================
// FOURNISSEURS
// ============================================

export async function addSupplier(supplier) {
    const name = String(supplier.name || "").trim();

    if (!name) {
        throw new Error("Le nom du fournisseur est obligatoire.");
    }

    return await createRecord(COLLECTIONS.suppliers, {
        name,
        phone: String(supplier.phone || "").trim(),
        address: String(supplier.address || "").trim(),
        contact: String(supplier.contact || "").trim(),
        active: true
    });
}

// ============================================
// DÉPENSES
// ============================================

export async function addExpense(expense) {
    const amount = validateAmount(expense.amount, "Dépense");

    if (amount <= 0) {
        throw new Error("La dépense doit être supérieure à zéro.");
    }

    return await createRecord(COLLECTIONS.expenses, {
        category: expense.category || "Autre",
        description: String(expense.description || "").trim(),
        amount,
        method: expense.method || "cash",
        userId: expense.userId || null
    });
}

// ============================================
// PERTES ET BOUTEILLES CASSÉES
// ============================================

export async function recordLoss(data) {
    const quantity = validateQuantity(data.quantity, "Quantité perdue");

    if (!data.productId || quantity < 1) {
        throw new Error("Informations de perte invalides.");
    }

    const lossId = operationId();

    return await runTransaction(db, async transaction => {

        const productRef = documentRef(
            COLLECTIONS.products,
            data.productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();
        const currentStock = validateQuantity(product.qty);

        if (currentStock < quantity) {
            throw new Error("Stock insuffisant pour enregistrer cette perte.");
        }

        const newStock = currentStock - quantity;

        transaction.update(productRef, {
            qty: newStock,
            updatedAt: serverTimestamp()
        });

        transaction.set(
            documentRef(COLLECTIONS.losses, lossId),
            {
                productId: data.productId,
                productName: product.name,
                quantity,
                reason: data.reason || "Autre",
                financialValue: quantity * validateAmount(product.cost),
                createdAt: serverTimestamp()
            }
        );

        await recordStockMovement(transaction, {
            productId: data.productId,
            productName: product.name,
            type: "PERTE",
            quantity: -quantity,
            previousQty: currentStock,
            newQty,
            referenceId: lossId,
            reason: data.reason || "Perte"
        });

        return {
            lossId,
            newStock
        };
    });
}

// ============================================
// FIN DU MODULE DATABASE
// ============================================
