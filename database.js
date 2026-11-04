// ======================================================
// DÉPÔT SARAH V2
// DATABASE.JS
// MOTEUR CENTRAL DE GESTION DES DONNÉES
// FIREBASE 10.14.1
// ======================================================

import { db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


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


function getStock(product) {
    if (product.totalBottles !== undefined) {
        return toNumber(product.totalBottles);
    }

    if (product.qty !== undefined) {
        return toNumber(product.qty);
    }

    return toNumber(product.quantity);
}


function normalizeRecord(id, data) {
    const stock = getStock(data);

    const units = toNumber(
        data.unitsPerCrate ?? data.units,
        12
    );

    const profit = toNumber(
        data.profit ?? data.estimatedProfit
    );

    return {
        id,
        ...data,

        // Stock toujours exprimé en bouteilles
        quantity: stock,
        qty: stock,
        totalBottles: stock,

        unitsPerCrate: units,
        units,

        profit,
        estimatedProfit: profit
    };
}


function validatePositive(value, message) {
    const number = toNumber(value);

    if (number <= 0) {
        throw new Error(message);
    }

    return number;
}


function createMovement(transaction, data) {
    const reference = doc(getCollection("stockMovements"));

    transaction.set(reference, {
        ...data,
        date: nowDate(),
        createdAt: serverTimestamp()
    });
}


// ======================================================
// 3. LECTURE GÉNÉRALE
// ======================================================

export async function getAll(name) {
    const snapshot = await getDocs(getCollection(name));

    return snapshot.docs.map(item =>
        normalizeRecord(item.id, item.data())
    );
}


export async function getById(name, id) {
    const snapshot = await getDoc(
        getDocument(name, id)
    );

    if (!snapshot.exists()) {
        return null;
    }

    return normalizeRecord(
        snapshot.id,
        snapshot.data()
    );
}


// ======================================================
// 4. CRÉATION GÉNÉRALE
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
        ...cleanData(data)
    };
}


// ======================================================
// 5. MODIFICATION GÉNÉRALE
// ======================================================

export async function updateRecord(name, id, data) {
    await updateDoc(
        getDocument(name, id),
        {
            ...cleanData(data),
            updatedAt: serverTimestamp()
        }
    );

    return await getById(name, id);
}


// ======================================================
// 6. SUPPRESSION GÉNÉRALE
// ======================================================

export async function removeRecord(name, id) {
    await deleteDoc(getDocument(name, id));

    return true;
}


// ======================================================
// 7. PRODUITS
// ======================================================

export async function addProduct(data) {
    const units = validatePositive(
        data.unitsPerCrate ?? data.units ?? 12,
        "Le nombre de bouteilles par casier doit être positif."
    );

    const stock = toNumber(
        data.totalBottles ?? data.qty ?? data.quantity
    );

    if (stock < 0) {
        throw new Error("Le stock initial est invalide.");
    }

    const product = {
        name: data.name || "Produit sans nom",
        brand: data.brand || "",
        format: data.format || "",

        unitsPerCrate: units,
        units,

        // Toutes les quantités sont en bouteilles.
        quantity: stock,
        qty: stock,
        totalBottles: stock,

        purchasePrice: toNumber(
            data.purchasePrice ??
            data.costPrice
        ),

        sellingPrice: toNumber(
            data.sellingPrice ??
            data.bottlePrice
        ),

        cratePrice: toNumber(data.cratePrice),

        lowStockThreshold: toNumber(
            data.lowStockThreshold ?? 12
        )
    };

    return await createRecord("products", product);
}


export async function getProducts() {
    return await getAll("products");
}


export async function updateProduct(id, data) {
    const updates = { ...data };

    if (
        updates.totalBottles !== undefined ||
        updates.qty !== undefined ||
        updates.quantity !== undefined
    ) {
        const stock = toNumber(
            updates.totalBottles ??
            updates.qty ??
            updates.quantity
        );

        if (stock < 0) {
            throw new Error("Stock invalide.");
        }

        updates.totalBottles = stock;
        updates.quantity = stock;
        updates.qty = stock;
    }

    return await updateRecord("products", id, updates);
}


export async function deleteProduct(id) {
    return await removeRecord("products", id);
}


// ======================================================
// 8. AJUSTEMENT DU STOCK
// ======================================================

export async function updateStock(
    productId,
    bottleChange,
    reason = "Ajustement manuel"
) {
    const change = toNumber(bottleChange);

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

        const oldStock = getStock(product);
        const newStock = oldStock + change;

        if (newStock < 0) {
            throw new Error("Stock insuffisant.");
        }

        transaction.update(productRef, {
            totalBottles: newStock,
            quantity: newStock,
            qty: newStock,
            updatedAt: serverTimestamp()
        });

        createMovement(transaction, {
            productId,
            productName: product.name,
            quantity: change,
            previousStock: oldStock,
            newStock,
            reason
        });

        return newStock;
    });
}


// ======================================================
// 9. CLIENTS
// ======================================================

export async function addCustomer(data) {
    return await createRecord("customers", {
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        debt: toNumber(data.debt),
        totalPurchases: toNumber(data.totalPurchases)
    });
}


export async function getCustomers() {
    return await getAll("customers");
}


export async function updateCustomer(id, data) {
    return await updateRecord("customers", id, data);
}


// ======================================================
// 10. FOURNISSEURS
// ======================================================

export async function addSupplier(data) {
    return await createRecord("suppliers", {
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        debt: toNumber(data.debt)
    });
}


export async function getSuppliers() {
    return await getAll("suppliers");
}


// ======================================================
// 11. VENTES
// ======================================================

export async function createSale(data) {
    const items = data.items || [{
        productId: data.productId,
        crates: data.crates ?? data.casiers ?? 0,
        extraBottles: data.extraBottles ?? data.bottles ?? 0,
        cratePrice: data.cratePrice ?? data.prixCasier,
        bottlePrice: data.bottlePrice ?? data.prixBouteille
    }];

    if (!items.length) {
        throw new Error("Aucun produit dans la vente.");
    }

    // Identifiant stable pour éviter les ventes en double.
    const saleId = data.operationId || generateId();
    const saleRef = getDocument("sales", saleId);

    return await runTransaction(db, async transaction => {

        const existingSale = await transaction.get(saleRef);

        if (existingSale.exists()) {
            return {
                id: saleId,
                ...existingSale.data(),
                alreadyProcessed: true
            };
        }

        const grouped = new Map();

        for (const item of items) {
            if (!item.productId) {
                throw new Error("Produit non identifié.");
            }

            const crates = toNumber(item.crates);
            const extra = toNumber(item.extraBottles);

            if (crates < 0 || extra < 0) {
                throw new Error("Quantité invalide.");
            }

            if (crates === 0 && extra === 0) {
                continue;
            }

            const key = item.productId;

            if (!grouped.has(key)) {
                grouped.set(key, {
                    productId: key,
                    crates: 0,
                    extraBottles: 0,
                    cratePrice: toNumber(item.cratePrice),
                    bottlePrice: toNumber(item.bottlePrice)
                });
            }

            const group = grouped.get(key);

            group.crates += crates;
            group.extraBottles += extra;

            if (item.cratePrice !== undefined) {
                group.cratePrice = toNumber(item.cratePrice);
            }

            if (item.bottlePrice !== undefined) {
                group.bottlePrice = toNumber(item.bottlePrice);
            }
        }

        const prepared = [];
        const productSnapshots = [];

        let total = 0;
        let totalCost = 0;

        // Toutes les lectures de produits.
        for (const item of grouped.values()) {
            const productRef = getDocument(
                "products",
                item.productId
            );

            const snapshot = await transaction.get(productRef);

            if (!snapshot.exists()) {
                throw new Error("Produit introuvable.");
            }

            const product = snapshot.data();

            const units = toNumber(
                product.unitsPerCrate ?? product.units,
                12
            );

            const quantity =
                item.crates * units +
                item.extraBottles;

            const stock = getStock(product);

            if (stock < quantity) {
                throw new Error(
                    `Stock insuffisant pour ${product.name}.`
                );
            }

            const cratePrice =
                item.cratePrice ||
                toNumber(product.cratePrice);

            const bottlePrice =
                item.bottlePrice ||
                toNumber(product.sellingPrice);

            const costPrice = toNumber(
                product.purchasePrice ??
                product.costPrice
            );

            const lineTotal =
                item.crates * cratePrice +
                item.extraBottles * bottlePrice;

            const lineCost = quantity * costPrice;

            const newStock = stock - quantity;

            total += lineTotal;
            totalCost += lineCost;

            prepared.push({
                productId: item.productId,
                productName: product.name,
                crates: item.crates,
                extraBottles: item.extraBottles,
                unitsPerCrate: units,
                quantity,
                cratePrice,
                bottlePrice,
                total: lineTotal,
                cost: lineCost,
                stockBefore: stock,
                stockAfter: newStock
            });

            productSnapshots.push({
                productRef,
                product,
                newStock,
                quantity
            });
        }

        if (!prepared.length || total <= 0) {
            throw new Error("Montant de vente invalide.");
        }

        const paymentMode = data.paymentMode || data.paymentType || "";

        let amountPaid;

        if (paymentMode === "credit") {
            amountPaid = 0;
        } else if (paymentMode === "partial") {
            amountPaid = toNumber(
                data.amountPaid ?? data.paidAmount
            );
        } else {
            amountPaid = toNumber(
                data.amountPaid ?? data.paidAmount ?? total
            );
        }

        if (amountPaid < 0 || amountPaid > total) {
            throw new Error("Montant payé invalide.");
        }

        const debt = total - amountPaid;

        const customerId = data.customerId || null;

        if (debt > 0 && !customerId) {
            throw new Error(
                "Un client doit être sélectionné pour enregistrer une dette."
            );
        }

        let customerRef = null;
        let customer = null;

        if (customerId) {
            customerRef = getDocument(
                "customers",
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

        // ÉCRITURES : stocks.
        for (const item of productSnapshots) {
            transaction.update(item.productRef, {
                totalBottles: item.newStock,
                quantity: item.newStock,
                qty: item.newStock,
                updatedAt: serverTimestamp()
            });

            createMovement(transaction, {
                productId: item.productRef.id,
                productName: item.product.name,
                quantity: -item.quantity,
                previousStock: getStock(item.product),
                newStock: item.newStock,
                reason: "Vente",
                saleId
            });
        }

        const profit = total - totalCost;

        const sale = {
            items: prepared,

            customerId,

            customerName:
                data.customerName ||
                customer?.name ||
                "Client comptant",

            total,
            totalCost,
            profit,
            estimatedProfit: profit,

            amountPaid,
            debt,

            paymentMethod:
                data.paymentMethod ||
                (paymentMode === "credit" ? "Crédit" : "Espèces"),

            paymentStatus:
                debt === 0 ? "paid" : "partial",

            date: nowDate(),
            createdAt: serverTimestamp()
        };

        transaction.set(saleRef, sale);

        if (customerRef && customer) {
            transaction.update(customerRef, {
                debt: toNumber(customer.debt) + debt,
                totalPurchases:
                    toNumber(customer.totalPurchases) + total,
                updatedAt: serverTimestamp()
            });
        }

        return {
            id: saleId,
            total,
            totalCost,
            profit,
            amountPaid,
            debt
        };
    });
}


export async function getSales() {
    return await getAll("sales");
}


// ======================================================
// 12. PAIEMENTS DES CLIENTS
// ======================================================

export async function recordCustomerPayment(data) {
    const amount = validatePositive(
        data.amount,
        "Montant de paiement invalide."
    );

    return await runTransaction(db, async transaction => {

        const customerRef = getDocument(
            "customers",
            data.customerId
        );

        const snapshot = await transaction.get(customerRef);

        if (!snapshot.exists()) {
            throw new Error("Client introuvable.");
        }

        const customer = snapshot.data();
        const currentDebt = toNumber(customer.debt);

        if (amount > currentDebt) {
            throw new Error(
                "Le paiement dépasse la dette du client."
            );
        }

        const paymentRef = doc(getCollection("payments"));

        transaction.update(customerRef, {
            debt: currentDebt - amount,
            updatedAt: serverTimestamp()
        });

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


export async function getCustomerPayments() {
    return await getAll("payments");
}


// ======================================================
// 13. ACHATS ET APPROVISIONNEMENTS
// ======================================================

export async function createPurchase(data) {
    if (!data.items?.length) {
        throw new Error("Aucun produit dans l'achat.");
    }

    const purchaseId = data.operationId || generateId();

    const purchaseRef = getDocument(
        "purchases",
        purchaseId
    );

    return await runTransaction(db, async transaction => {

        const existing = await transaction.get(purchaseRef);

        if (existing.exists()) {
            return {
                id: purchaseId,
                ...existing.data(),
                alreadyProcessed: true
            };
        }

        const grouped = new Map();

        for (const item of data.items) {
            const id = item.productId;

            if (!id) {
                throw new Error("Produit non identifié.");
            }

            const group = grouped.get(id) || {
                productId: id,
                quantity: 0,
                purchasePrice: toNumber(
                    item.purchasePrice ?? item.costPrice
                )
            };

            group.quantity +=
                toNumber(item.crates ?? item.quantity) *
                toNumber(item.unitsPerCrate, 12) +
                toNumber(item.extraBottles);

            grouped.set(id, group);
        }

        const prepared = [];

        let total = 0;

        for (const item of grouped.values()) {
            const productRef = getDocument(
                "products",
                item.productId
            );

            const snapshot = await transaction.get(productRef);

            if (!snapshot.exists()) {
                throw new Error("Produit introuvable.");
            }

            const product = snapshot.data();

            const units = toNumber(
                product.unitsPerCrate ?? product.units,
                12
            );

            if (item.quantity <= 0) {
                throw new Error("Quantité d'achat invalide.");
            }

            const cost =
                item.purchasePrice ||
                toNumber(product.purchasePrice);

            const oldStock = getStock(product);
            const newStock = oldStock + item.quantity;

            const lineTotal = item.quantity * cost;

            total += lineTotal;

            prepared.push({
                productRef,
                product,
                productId: item.productId,
                productName: product.name,
                quantity: item.quantity,
                units,
                oldStock,
                newStock,
                purchasePrice: cost,
                total: lineTotal
            });
        }

        const amountPaid = toNumber(
            data.amountPaid ?? total
        );

        if (amountPaid < 0 || amountPaid > total) {
            throw new Error("Montant payé invalide.");
        }

        const supplierId = data.supplierId || null;

        let supplierRef = null;
        let supplier = null;

        if (supplierId) {
            supplierRef = getDocument(
                "suppliers",
                supplierId
            );

            const supplierSnapshot = await transaction.get(
                supplierRef
            );

            if (!supplierSnapshot.exists()) {
                throw new Error("Fournisseur introuvable.");
            }

            supplier = supplierSnapshot.data();
        }

        for (const item of prepared) {
            transaction.update(item.productRef, {
                totalBottles: item.newStock,
                quantity: item.newStock,
                qty: item.newStock,
                purchasePrice: item.purchasePrice,
                updatedAt: serverTimestamp()
            });

            createMovement(transaction, {
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                previousStock: item.oldStock,
                newStock: item.newStock,
                reason: "Approvisionnement",
                purchaseId
            });
        }

        const debt = total - amountPaid;

        if (supplierRef && supplier) {
            transaction.update(supplierRef, {
                debt: toNumber(supplier.debt) + debt,
                updatedAt: serverTimestamp()
            });
        }

        transaction.set(purchaseRef, {
            items: prepared.map(item => ({
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                purchasePrice: item.purchasePrice,
                total: item.total
            })),

            supplierId,
            supplierName:
                data.supplierName ||
                supplier?.name ||
                "",

            total,
            amountPaid,
            debt,

            paymentStatus:
                debt === 0 ? "paid" : "partial",

            date: nowDate(),
            createdAt: serverTimestamp()
        });

        return {
            id: purchaseId,
            total,
            amountPaid,
            debt
        };
    });
}


export async function getPurchases() {
    return await getAll("purchases");
}


// ======================================================
// 14. DÉPENSES
// ======================================================

export async function addExpense(data) {
    const amount = validatePositive(
        data.amount,
        "Montant de dépense invalide."
    );

    return await createRecord("expenses", {
        title: data.title || data.name || "Dépense",
        category: data.category || "Autre",
        amount,
        description: data.description || "",
        date: nowDate()
    });
}


export async function getExpenses() {
    return await getAll("expenses");
}


// ======================================================
// 15. PERTES ET BOUTEILLES CASSÉES
// ======================================================

export async function recordLoss(data) {
    const quantity = validatePositive(
        data.quantity,
        "Quantité de perte invalide."
    );

    return await runTransaction(db, async transaction => {

        const productRef = getDocument(
            "products",
            data.productId
        );

        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
            throw new Error("Produit introuvable.");
        }

        const product = snapshot.data();

        const oldStock = getStock(product);

        if (quantity > oldStock) {
            throw new Error("Stock insuffisant.");
        }

        const newStock = oldStock - quantity;

        const cost = toNumber(
            product.purchasePrice
        );

        const lossRef = doc(getCollection("losses"));

        transaction.update(productRef, {
            totalBottles: newStock,
            quantity: newStock,
            qty: newStock,
            updatedAt: serverTimestamp()
        });

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

        createMovement(transaction, {
            productId: data.productId,
            productName: product.name,
            quantity: -quantity,
            previousStock: oldStock,
            newStock,
            reason: data.reason || "Perte"
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
// 16. MOUVEMENTS DE STOCK
// ======================================================

export async function getStockMovements() {
    return await getAll("stockMovements");
}


// ======================================================
// 17. VENTES PAR CLIENT
// ======================================================

export async function getCustomerSales(customerId) {
    const sales = await getSales();

    return sales.filter(
        sale => sale.customerId === customerId
    );
}


// ======================================================
// 18. RÉSUMÉ FINANCIER
// ======================================================

export async function getFinancialSummary() {

    const [
        sales,
        expenses,
        losses,
        purchases,
        products,
        customers,
        suppliers
    ] = await Promise.all([

        getSales(),
        getExpenses(),
        getLosses(),
        getPurchases(),
        getProducts(),
        getCustomers(),
        getSuppliers()

    ]);

    const today = new Date().toDateString();

    function isToday(item) {
        const date = item.date?.toDate
            ? item.date.toDate()
            : new Date(item.date);

        return !isNaN(date.getTime()) &&
            date.toDateString() === today;
    }

    const todaySales = sales.filter(isToday);
    const todayExpenses = expenses.filter(isToday);
    const todayLosses = losses.filter(isToday);

    const totalSales = sales.reduce(
        (sum, item) => sum + toNumber(item.total),
        0
    );

    const totalProfit = sales.reduce(
        (sum, item) => sum + toNumber(item.profit),
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

    const dailyLosses = todayLosses.reduce(
        (sum, item) => sum + toNumber(item.estimatedValue),
        0
    );

    const totalCustomerDebt = customers.reduce(
        (sum, item) => sum + toNumber(item.debt),
        0
    );

    const totalSupplierDebt = suppliers.reduce(
        (sum, item) => sum + toNumber(item.debt),
        0
    );

    const stockValue = products.reduce(
        (sum, item) =>
            sum +
            getStock(item) *
            toNumber(item.purchasePrice),
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
        dailyLosses,

        dailyNetResult:
            dailyProfit - dailyExpenses - dailyLosses,

        estimatedNetResult:
            totalProfit - totalExpenses - totalLosses,

        totalCustomerDebt,
        totalSupplierDebt,

        stockValue,

        productCount: products.length,

        totalStockBottles: products.reduce(
            (sum, item) => sum + getStock(item),
            0
        )
    };
}


// ======================================================
// 19. ANNULATION SÉCURISÉE D'UNE VENTE
// ======================================================

export async function deleteSale(saleId) {

    return await runTransaction(db, async transaction => {

        const saleRef = getDocument("sales", saleId);

        const saleSnapshot = await transaction.get(saleRef);

        if (!saleSnapshot.exists()) {
            throw new Error("Vente introuvable.");
        }

        const sale = saleSnapshot.data();

        // Une vente déjà payée ne peut pas être supprimée
        // automatiquement : il faut gérer son remboursement.
        if (toNumber(sale.amountPaid) > 0) {
            throw new Error(
                "Cette vente comporte déjà un paiement. " +
                "Une procédure de remboursement est nécessaire."
            );
        }

        const items = sale.items || [];

        const grouped = new Map();

        for (const item of items) {
            const id = item.productId;

            const current = grouped.get(id) || {
                quantity: 0
            };

            current.quantity += toNumber(item.quantity);

            grouped.set(id, current);
        }

        const products = [];

        // Toutes les lectures avant les écritures.
        for (const [productId, item] of grouped) {

            const productRef = getDocument(
                "products",
                productId
            );

            const snapshot = await transaction.get(productRef);

            if (!snapshot.exists()) {
                throw new Error(
                    "Un produit de cette vente est introuvable."
                );
            }

            products.push({
                productRef,
                product: snapshot.data(),
                quantity: item.quantity
            });
        }

        let customerRef = null;
        let customer = null;

        if (sale.customerId) {

            customerRef = getDocument(
                "customers",
                sale.customerId
            );

            const snapshot = await transaction.get(customerRef);

            if (snapshot.exists()) {
                customer = snapshot.data();
            }
        }

        if (
            customer &&
            toNumber(customer.debt) < toNumber(sale.debt)
        ) {
            throw new Error(
                "Cette dette a été modifiée ou partiellement réglée. " +
                "Annulation automatique impossible."
            );
        }

        for (const item of products) {

            const oldStock = getStock(item.product);

            const newStock = oldStock + item.quantity;

            transaction.update(item.productRef, {
                totalBottles: newStock,
                quantity: newStock,
                qty: newStock,
                updatedAt: serverTimestamp()
            });

            createMovement(transaction, {
                productId: item.productRef.id,
                productName: item.product.name,
                quantity: item.quantity,
                previousStock: oldStock,
                newStock,
                reason: "Annulation de vente",
                saleId
            });
        }

        if (customerRef && customer) {
            transaction.update(customerRef, {
                debt:
                    toNumber(customer.debt) -
                    toNumber(sale.debt),

                totalPurchases: Math.max(
                    0,
                    toNumber(customer.totalPurchases) -
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
