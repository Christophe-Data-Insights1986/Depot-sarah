// ======================================================
// 4. CHARGEMENT DES DONNÉES — VERSION CORRIGÉE
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
            getLosses()
        ]);

        const setters = [
            value => products = value,
            value => customers = value,
            value => sales = value,
            value => suppliers = value,
            value => purchases = value,
            value => expenses = value,
            value => losses = value
        ];

        const names = [
            "Produits",
            "Clients",
            "Ventes",
            "Fournisseurs",
            "Approvisionnements",
            "Dépenses",
            "Pertes"
        ];

        let errors = [];

        results.forEach((result, index) => {

            if (result.status === "fulfilled") {

                setters[index](result.value || []);

            } else {

                errors.push(names[index]);

                console.error(
                    "Erreur de chargement : " + names[index],
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

            console.warn(
                "Collections non chargées :",
                errors.join(", ")
            );

        }

    } catch (error) {

        console.error("Erreur générale de chargement :", error);

        showSyncStatus("Erreur de chargement des données");

    } finally {

        loading = false;

    }

}