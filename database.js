// ======================================================
// DÉPÔT SARAH V2
// DATABASE.JS
// MOTEUR CENTRAL DE GESTION DES DONNÉES
// ======================================================

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
    limit,
    serverTimestamp,
    runTransaction,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ======================================================
// 1. COLLECTIONS FIRESTORE
// ======================================================

export const COLLECTIONS = {

    products: "products",
    sales: "sales",
    customers: "customers",
    payments: "customerPayments",
    suppliers: "suppliers",
    purchases: "purchases",
    expenses: "expenses",
    losses: "losses",
    stockMovements: "stockMovements"

};


// ======================================================
// 2. OUTILS GÉNÉRAUX
// ======================================================

function getCollection(name) {

    const collectionName = COLLECTIONS[name] || name;

    if (!collectionName) {
        throw new Error("Collection non définie.");
    }

    return collection(db, collectionName);

}


function getDocument(name, id) {

    return doc(db, COLLECTIONS[name] || name, id);

}


function generateId() {

    return crypto.randomUUID();

}


function toNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;

}


function normalizeRecord(id, data) {

    const record = {
        id,
        ...data
    };

    const quantity = toNumber(
        data.quantity ?? data.qty ?? 0
    );

    const units = toNumber(
        data.unitsPerCrate ?? data.units ?? 12
    );

    const totalBottles = toNumber(
        data.totalBottles ?? quantity * units
    );

    const profit = toNumber(
        data.profit ?? data.estimatedProfit ?? 0
    );

    return {

        ...record,

        quantity,
        qty: quantity,

        unitsPerCrate: units,
        units,

        totalBottles,

        profit,
        estimatedProfit: profit

    };

}


function cleanData(data) {

    const result = { ...data };

    delete result.id;

    delete result.createdAt;

    delete result.updatedAt;

    return result;

}


function nowDate() {

    return new Date().toISOString();

}


// ======================================================
// 3. LECTURE GÉNÉRALE
// ======================================================

export async function getAll(name) {

    if (name) {

        const snapshot = await getDocs(
            getCollection(name)
        );

        return snapshot.docs.map(item =>
            normalizeRecord(item.id, item.data())
        );

    }

    const result = {};

    for (const key of Object.keys(COLLECTIONS)) {

        result[key] = await getAll(key);

    }

    return result;

}


// ======================================================
// 4. LECTURE PAR IDENTIFIANT
// ======================================================

export async function getById(name, id) {

    const reference = getDocument(name, id);

    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
        return null;
    }

    return normalizeRecord(
        snapshot.id,
        snapshot.data()
    );

}


// ======================================================
// 5. CRÉATION GÉNÉRALE
// ======================================================

export async function createRecord(name, data) {

    const payload = {

        ...cleanData(data),

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()

    };

    const reference = await addDoc(
        getCollection(name),
        payload
    );

    return {

        id: reference.id,
        ...payload

    };

}


// ======================================================
// 6. MODIFICATION GÉNÉRALE
// ======================================================

export async function updateRecord(name, id, data) {

    const reference = getDocument(name, id);

    await updateDoc(reference, {

        ...cleanData(data),

        updatedAt: serverTimestamp()

    });

    return await getById(name, id);

}


// ======================================================
// 7. SUPPRESSION GÉNÉRALE
// ======================================================

export async function removeRecord(name, id) {

    await deleteDoc(
        getDocument(name, id)
    );

    return true;

}


// ======================================================
// 8. PRODUITS
// ======================================================

export async function addProduct(data) {

    const units = toNumber(
        data.unitsPerCrate ?? data.units ?? 12
    );

    const quantity = toNumber(
        data.quantity ?? data.qty ?? 0
    );

    const product = {

        ...cleanData(data),

        name: data.name || "Produit sans nom",

        brand: data.brand || "",

        format: data.format || "",

        unitsPerCrate: units,
        units,

        quantity,
        qty: quantity,

        totalBottles: quantity * units,

        purchasePrice: toNumber(
            data.purchasePrice ?? data.costPrice
        ),

        sellingPrice: toNumber(
            data.sellingPrice ?? data.bottlePrice
        ),

        cratePrice: toNumber(data.cratePrice),

        lowStockThreshold: toNumber(
            data.lowStockThreshold ?? 12
        )

    };

    return await createRecord(
        "products",
        product
    );

}


export async function getProducts() {

    return await getAll("products");

}


export async function updateProduct(id, data) {

    return await updateRecord(
        "products",
        id,
        data
    );

}


export async function deleteProduct(id) {

    return await removeRecord(
        "products",
        id
    );

}


// ======================================================
// 9. AJUSTEMENT DU STOCK
// ======================================================

export async function updateStock(
    productId,
    bottleChange,
    reason = "Ajustement"
) {

    return await runTransaction(db, async transaction => {

        const productRef = getDocument(
            "products",
            productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();

        const units = toNumber(
            product.unitsPerCrate ?? product.units ?? 12
        );

        const oldQuantity = toNumber(
            product.totalBottles ??
            toNumber(product.quantity ?? product.qty) * units
        );

        const newQuantity =
            oldQuantity + toNumber(bottleChange);

        if (newQuantity < 0) {
            throw new Error("Stock insuffisant.");
        }

        transaction.update(productRef, {

            totalBottles: newQuantity,

            quantity: Math.floor(newQuantity / units),

            qty: Math.floor(newQuantity / units),

            updatedAt: serverTimestamp()

        });

        const movementRef = doc(
            getCollection("stockMovements")
        );

        transaction.set(movementRef, {

            productId,

            productName: product.name,

            quantity: toNumber(bottleChange),

            reason,

            date: nowDate(),

            createdAt: serverTimestamp()

        });

        return newQuantity;

    });

}


// ======================================================
// 10. CLIENTS
// ======================================================

export async function addCustomer(data) {

    return await createRecord(
        "customers",
        {

            ...cleanData(data),

            name: data.name || "",

            phone: data.phone || "",

            address: data.address || "",

            debt: toNumber(data.debt),

            totalPurchases: toNumber(
                data.totalPurchases
            )

        }
    );

}


export async function getCustomers() {

    return await getAll("customers");

}


export async function updateCustomer(id, data) {

    return await updateRecord(
        "customers",
        id,
        data
    );

}


// ======================================================
// 11. FOURNISSEURS
// ======================================================

export async function addSupplier(data) {

    return await createRecord(
        "suppliers",
        {

            ...cleanData(data),

            name: data.name || "",

            phone: data.phone || "",

            address: data.address || ""

        }
    );

}


export async function getSuppliers() {

    return await getAll("suppliers");

}


// ======================================================
// 12. VENTES
// ======================================================

export async function createSale(data) {

    const items = data.items || [

        {
            productId: data.productId,

            crates: data.crates ?? data.casiers ?? 0,

            extraBottles:
                data.extraBottles ??
                data.bottles ??
                0,

            cratePrice: data.cratePrice ?? data.prixCasier,

            bottlePrice:
                data.bottlePrice ??
                data.prixBouteille

        }

    ];

    if (!items.length) {
        throw new Error("Aucun produit dans la vente.");
    }

    const customerId = data.customerId || null;

    const payment = toNumber(
        data.amountPaid ?? data.paidAmount ?? data.total
    );

    return await runTransaction(db, async transaction => {

        const preparedItems = [];

        let total = 0;

        let totalCost = 0;

        for (const item of items) {

            const productRef = getDocument(
                "products",
                item.productId
            );

            const snapshot = await transaction.get(
                productRef
            );

            if (!snapshot.exists()) {
                throw new Error("Produit introuvable.");
            }

            const product = snapshot.data();

            const units = toNumber(
                product.unitsPerCrate ??
                product.units ??
                12
            );

            const crates = toNumber(item.crates);

            const extraBottles = toNumber(
                item.extraBottles
            );

            const quantity =
                crates * units + extraBottles;

            if (quantity <= 0) {
                throw new Error("Quantité de vente invalide.");
            }

            const stock = toNumber(
                product.totalBottles ??
                toNumber(product.quantity ?? product.qty) * units
            );

            if (stock < quantity) {
                throw new Error(
                    `Stock insuffisant pour ${product.name}.`
                );
            }

            const cratePrice = toNumber(
                item.cratePrice ?? product.cratePrice
            );

            const bottlePrice = toNumber(
                item.bottlePrice ?? product.sellingPrice
            );

            const costPrice = toNumber(
                product.purchasePrice ?? product.costPrice
            );

            const lineTotal =
                crates * cratePrice +
                extraBottles * bottlePrice;

            const lineCost =
                quantity * costPrice;

            const newStock = stock - quantity;

            total += lineTotal;

            totalCost += lineCost;

            preparedItems.push({

                productId: item.productId,

                productName: product.name,

                crates,

                extraBottles,

                quantity,

                cratePrice,

                bottlePrice,

                total: lineTotal,

                cost: lineCost,

                stockAfter: newStock,

                productRef

            });

        }

        if (payment < 0 || payment > total) {
            throw new Error("Montant payé invalide.");
        }

        const debt = total - payment;

        let customerRef = null;

        let customerSnapshot = null;

        if (customerId) {

            customerRef = getDocument(
                "customers",
                customerId
            );

            customerSnapshot = await transaction.get(
                customerRef
            );

            if (!customerSnapshot.exists()) {
                throw new Error("Client introuvable.");
            }

        }

        // Mise à jour des stocks

        for (const item of preparedItems) {

            const units = toNumber(
                items.find(
                    x => x.productId === item.productId
                )?.unitsPerCrate ?? 12
            );

            transaction.update(item.productRef, {

                totalBottles: item.stockAfter,

                quantity: Math.floor(
                    item.stockAfter / units
                ),

                qty: Math.floor(
                    item.stockAfter / units
                ),

                updatedAt: serverTimestamp()

            });

        }

        // Enregistrement de la vente

        const saleRef = doc(
            getCollection("sales")
        );

        transaction.set(saleRef, {

            items: preparedItems.map(item => {

                const copy = { ...item };

                delete copy.productRef;

                return copy;

            }),

            customerId,

            customerName:
                data.customerName ||
                customerSnapshot?.data()?.name ||
                "Client comptant",

            total,

            totalCost,

            profit: total - totalCost,

            estimatedProfit: total - totalCost,

            amountPaid: payment,

            debt,

            paymentStatus:
                debt === 0 ? "paid" : "partial",

            date: nowDate(),

            createdAt: serverTimestamp()

        });

        // Mise à jour de la dette du client

        if (customerRef && debt > 0) {

            const customer = customerSnapshot.data();

            transaction.update(customerRef, {

                debt:
                    toNumber(customer.debt) + debt,

                totalPurchases:
                    toNumber(customer.totalPurchases) + total,

                updatedAt: serverTimestamp()

            });

        } else if (customerRef) {

            const customer = customerSnapshot.data();

            transaction.update(customerRef, {

                totalPurchases:
                    toNumber(customer.totalPurchases) + total,

                updatedAt: serverTimestamp()

            });

        }

        return {

            id: saleRef.id,

            total,

            totalCost,

            profit: total - totalCost,

            amountPaid: payment,

            debt

        };

    });

}


export async function getSales() {

    return await getAll("sales");

}


// ======================================================
// 13. PAIEMENTS DES CLIENTS
// ======================================================

export async function recordCustomerPayment(data) {

    const amount = toNumber(data.amount);

    if (amount <= 0) {
        throw new Error("Montant de paiement invalide.");
    }

    return await runTransaction(db, async transaction => {

        const customerRef = getDocument(
            "customers",
            data.customerId
        );

        const customerSnapshot = await transaction.get(
            customerRef
        );

        if (!customerSnapshot.exists()) {
            throw new Error("Client introuvable.");
        }

        const customer = customerSnapshot.data();

        const currentDebt = toNumber(customer.debt);

        if (amount > currentDebt) {
            throw new Error(
                "Le paiement dépasse la dette du client."
            );
        }

        transaction.update(customerRef, {

            debt: currentDebt - amount,

            updatedAt: serverTimestamp()

        });

        const paymentRef = doc(
            getCollection("payments")
        );

        transaction.set(paymentRef, {

            customerId: data.customerId,

            customerName: customer.name || "",

            amount,

            method: data.method || "Espèces",

            note: data.note || "",

            date: nowDate(),

            createdAt: serverTimestamp()

        });

        return {

            id: paymentRef.id,

            remainingDebt: currentDebt - amount

        };

    });

}


// ======================================================
// 14. ACHATS ET APPROVISIONNEMENTS
// ======================================================

export async function createPurchase(data) {

    const items = data.items || [];

    if (!items.length) {
        throw new Error("Aucun produit dans l'achat.");
    }

    return await runTransaction(db, async transaction => {

        const prepared = [];

        let total = 0;

        for (const item of items) {

            const productRef = getDocument(
                "products",
                item.productId
            );

            const snapshot = await transaction.get(
                productRef
            );

            if (!snapshot.exists()) {
                throw new Error("Produit introuvable.");
            }

            const product = snapshot.data();

            const units = toNumber(
                product.unitsPerCrate ??
                product.units ??
                12
            );

            const quantity =
                toNumber(item.crates ?? item.quantity) * units +
                toNumber(item.extraBottles);

            if (quantity <= 0) {
                throw new Error("Quantité d'achat invalide.");
            }

            const cost = toNumber(
                item.purchasePrice ??
                item.costPrice ??
                product.purchasePrice
            );

            const oldStock = toNumber(
                product.totalBottles ??
                toNumber(product.quantity ?? product.qty) * units
            );

            prepared.push({

                productRef,

                productId: item.productId,

                productName: product.name,

                quantity,

                oldStock,

                newStock: oldStock + quantity,

                purchasePrice: cost,

                total: quantity * cost,

                units

            });

            total += quantity * cost;

        }

        for (const item of prepared) {

            transaction.update(item.productRef, {

                totalBottles: item.newStock,

                quantity: Math.floor(
                    item.newStock / item.units
                ),

                qty: Math.floor(
                    item.newStock / item.units
                ),

                purchasePrice: item.purchasePrice,

                updatedAt: serverTimestamp()

            });

        }

        const purchaseRef = doc(
            getCollection("purchases")
        );

        transaction.set(purchaseRef, {

            items: prepared.map(item => ({

                productId: item.productId,

                productName: item.productName,

                quantity: item.quantity,

                purchasePrice: item.purchasePrice,

                total: item.total

            })),

            supplierId: data.supplierId || null,

            supplierName: data.supplierName || "",

            total,

            amountPaid: toNumber(data.amountPaid ?? total),

            date: nowDate(),

            createdAt: serverTimestamp()

        });

        return {

            id: purchaseRef.id,

            total

        };

    });

}


export async function getPurchases() {

    return await getAll("purchases");

}


// ======================================================
// 15. DÉPENSES
// ======================================================

export async function addExpense(data) {

    const amount = toNumber(data.amount);

    if (amount <= 0) {
        throw new Error("Montant de dépense invalide.");
    }

    return await createRecord(
        "expenses",
        {

            ...cleanData(data),

            title: data.title || data.name || "Dépense",

            category: data.category || "Autre",

            amount,

            description: data.description || "",

            date: nowDate()

        }
    );

}


export async function getExpenses() {

    return await getAll("expenses");

}


// ======================================================
// 16. PERTES ET BOUTEILLES CASSÉES
// ======================================================

export async function recordLoss(data) {

    const quantity = toNumber(data.quantity);

    if (quantity <= 0) {
        throw new Error("Quantité de perte invalide.");
    }

    return await runTransaction(db, async transaction => {

        const productRef = getDocument(
            "products",
            data.productId
        );

        const snapshot = await transaction.get(
            productRef
        );

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();

        const units = toNumber(
            product.unitsPerCrate ??
            product.units ??
            12
        );

        const oldStock = toNumber(
            product.totalBottles ??
            toNumber(product.quantity ?? product.qty) * units
        );

        if (quantity > oldStock) {
            throw new Error("Stock insuffisant.");
        }

        const newStock = oldStock - quantity;

        transaction.update(productRef, {

            totalBottles: newStock,

            quantity: Math.floor(newStock / units),

            qty: Math.floor(newStock / units),

            updatedAt: serverTimestamp()

        });

        const lossRef = doc(
            getCollection("losses")
        );

        const cost = toNumber(
            product.purchasePrice
        );

        transaction.set(lossRef, {

            productId: data.productId,

            productName: product.name,

            quantity,

            reason: data.reason || "Casse",

            description: data.description || "",

            estimatedValue: quantity * cost,

            date: nowDate(),

            createdAt: serverTimestamp()

        });

        return {

            id: lossRef.id,

            remainingStock: newStock,

            estimatedValue: quantity * cost

        };

    });

}


export async function getLosses() {

    return await getAll("losses");

}


// ======================================================
// 17. HISTORIQUE DES MOUVEMENTS DE STOCK
// ======================================================

export async function getStockMovements() {

    return await getAll("stockMovements");

}


// ======================================================
// 18. HISTORIQUE DES PAIEMENTS
// ======================================================

export async function getCustomerPayments() {

    return await getAll("payments");

}


// ======================================================
// 19. RECHERCHE DES VENTES PAR CLIENT
// ======================================================

export async function getCustomerSales(customerId) {

    const sales = await getSales();

    return sales.filter(
        sale => sale.customerId === customerId
    );

}


// ======================================================
// 20. RÉSUMÉ FINANCIER
// ======================================================

export async function getFinancialSummary() {

    const [

        sales,
        expenses,
        losses,
        purchases

    ] = await Promise.all([

        getSales(),

        getExpenses(),

        getLosses(),

        getPurchases()

    ]);

    const today = new Date().toDateString();

    const todaySales = sales.filter(sale => {

        const date = sale.date?.toDate
            ? sale.date.toDate()
            : new Date(sale.date);

        return date.toDateString() === today;

    });

    const todayExpenses = expenses.filter(item => {

        const date = item.date?.toDate
            ? item.date.toDate()
            : new Date(item.date);

        return date.toDateString() === today;

    });

    const totalSales = sales.reduce(
        (sum, item) => sum + toNumber(item.total),
        0
    );

    const totalProfit = sales.reduce(
        (sum, item) => sum + toNumber(
            item.profit ?? item.estimatedProfit
        ),
        0
    );

    const totalExpenses = expenses.reduce(
        (sum, item) => sum + toNumber(item.amount),
        0
    );

    const totalPurchases = purchases.reduce(
        (sum, item) => sum + toNumber(item.total),
        0
    );

    const totalLosses = losses.reduce(
        (sum, item) => sum + toNumber(item.estimatedValue),
        0
    );

    const dailySales = todaySales.reduce(
        (sum, item) => sum + toNumber(item.total),
        0
    );

    const dailyProfit = todaySales.reduce(
        (sum, item) => sum + toNumber(item.profit),
        0
    );

    const dailyExpenses = todayExpenses.reduce(
        (sum, item) => sum + toNumber(item.amount),
        0
    );

    return {

        totalSales,

        totalProfit,

        totalExpenses,

        totalPurchases,

        totalLosses,

        dailySales,

        dailyProfit,

        dailyExpenses,

        dailyNetResult:
            dailyProfit - dailyExpenses,

        estimatedNetResult:
            totalProfit - totalExpenses - totalLosses

    };

}


// ======================================================
// 21. SUPPRESSION D'UNE VENTE
// ======================================================

export async function deleteSale(saleId) {

    return await runTransaction(db, async transaction => {

        const saleRef = getDocument(
            "sales",
            saleId
        );

        const saleSnapshot = await transaction.get(
            saleRef
        );

        if (!saleSnapshot.exists()) {
            throw new Error("Vente introuvable.");
        }

        const sale = saleSnapshot.data();

        const items = sale.items || [];

        const products = [];

        for (const item of items) {

            const productRef = getDocument(
                "products",
                item.productId
            );

            const snapshot = await transaction.get(
                productRef
            );

            if (!snapshot.exists()) {
                throw new Error(
                    `Produit introuvable : ${item.productName}`
                );
            }

            products.push({

                ref: productRef,

                data: snapshot.data(),

                quantity: toNumber(item.quantity),

                units: toNumber(
                    snapshot.data().unitsPerCrate ??
                    snapshot.data().units ??
                    12
                )

            });

        }

        let customerRef = null;

        let customerData = null;

        if (sale.customerId) {

            customerRef = getDocument(
                "customers",
                sale.customerId
            );

            const snapshot = await transaction.get(
                customerRef
            );

            if (snapshot.exists()) {
                customerData = snapshot.data();
            }

        }

        for (const item of products) {

            const currentStock = toNumber(
                item.data.totalBottles ??
                toNumber(item.data.quantity ?? item.data.qty) * item.units
            );

            const newStock = currentStock + item.quantity;

            transaction.update(item.ref, {

                totalBottles: newStock,

                quantity: Math.floor(newStock / item.units),

                qty: Math.floor(newStock / item.units),

                updatedAt: serverTimestamp()

            });

        }

        if (customerRef && customerData) {

            transaction.update(customerRef, {

                debt: Math.max(
                    0,
                    toNumber(customerData.debt) -
                    toNumber(sale.debt)
                ),

                totalPurchases: Math.max(
                    0,
                    toNumber(customerData.totalPurchases) -
                    toNumber(sale.total)
                ),

                updatedAt: serverTimestamp()

            });

        }

        transaction.delete(saleRef);

        return true;

    });

}


// ======================================================
// FIN DU MODULE DATABASE.JS
// DÉPÔT SARAH V2
// ======================================================