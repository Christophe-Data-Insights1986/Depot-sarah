// ======================================================
// DÉPÔT SARAH V2
// AUTH.JS — VERSION CORRIGÉE ET HARMONISÉE
// ======================================================

// FIREBASE
import { auth, db, googleProvider } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// ======================================================
// 1. CONFIGURATION
// ======================================================

export const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let authInitialized = false;
let currentAccessUser = null;


// ======================================================
// 2. VÉRIFICATION ADMINISTRATEUR
// ======================================================

export function isAdmin(user = auth.currentUser) {

    return Boolean(
        user &&
        user.email &&
        user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    );

}


// ======================================================
// 3. MESSAGES D'AUTHENTIFICATION
// ======================================================

function showAuthMessage(message, type = "error") {

    const element = document.getElementById("auth-message");

    if (!element) return;

    element.textContent = message;
    element.className = `auth-message ${type}`;

}


// ======================================================
// 4. CRÉATION D'UNE DEMANDE D'ACCÈS
// ======================================================

export async function createAccessRequest(user, name = "") {

    if (!user) {
        throw new Error("Utilisateur non connecté.");
    }

    if (isAdmin(user)) {
        return true;
    }

    const requestRef = doc(db, "userRequests", user.uid);

    const requestSnap = await getDoc(requestRef);

    if (requestSnap.exists()) {

        const existing = requestSnap.data();

        if (existing.status === "approved") {
            return true;
        }

        if (existing.status === "pending") {
            return false;
        }

    }

    await setDoc(requestRef, {

        uid: user.uid,
        email: user.email || "",
        name: name || user.displayName || "",
        status: "pending",
        createdAt: serverTimestamp()

    });

    return false;

}


// ======================================================
// 5. VÉRIFICATION DES AUTORISATIONS
// ======================================================

export async function checkUserAccess(user) {

    if (!user) return false;

    // L'administrateur principal est toujours autorisé.
    if (isAdmin(user)) return true;

    const userRef = doc(db, "authorizedUsers", user.uid);

    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        return false;
    }

    const data = userSnap.data();

    return (
        data.status === "approved" ||
        data.approved === true
    );

}


// ======================================================
// 6. INSCRIPTION PAR EMAIL
// ======================================================

export async function registerWithEmail(name, email, password) {

    try {

        name = name.trim();
        email = email.trim();

        if (!name || !email || !password) {
            throw new Error("Tous les champs sont obligatoires.");
        }

        if (password.length < 6) {
            throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
        }

        const result = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        await updateProfile(result.user, {
            displayName: name
        });

        // Administrateur principal
        if (isAdmin(result.user)) {

            await setDoc(
                doc(db, "authorizedUsers", result.user.uid),
                {

                    uid: result.user.uid,
                    email: result.user.email,
                    name,
                    status: "approved",
                    approved: true,
                    role: "admin",
                    createdAt: serverTimestamp()

                },
                { merge: true }
            );

            showAuthMessage(
                "Compte administrateur créé avec succès.",
                "success"
            );

            return result.user;

        }

        // Utilisateur normal : demande d'autorisation
        await createAccessRequest(result.user, name);

        showAuthMessage(
            "Compte créé. Votre demande attend l'approbation de l'administrateur.",
            "success"
        );

        return result.user;

    } catch (error) {

        console.error("Erreur inscription :", error);

        showAuthMessage(getFriendlyError(error));

        throw error;

    }

}


// ======================================================
// 7. CONNEXION PAR EMAIL
// ======================================================

export async function loginWithEmail(email, password) {

    try {

        email = email.trim();

        const result = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        return result.user;

    } catch (error) {

        console.error("Erreur connexion :", error);

        showAuthMessage(getFriendlyError(error));

        throw error;

    }

}


// ======================================================
// 8. CONNEXION GOOGLE
// ======================================================

export async function loginWithGoogle() {

    try {

        const result = await signInWithPopup(
            auth,
            googleProvider
        );

        const user = result.user;

        if (!isAdmin(user)) {

            await createAccessRequest(user);

        }

        return user;

    } catch (error) {

        console.error("Erreur Google :", error);

        showAuthMessage(getFriendlyError(error));

        throw error;

    }

}


// ======================================================
// 9. DÉCONNEXION
// ======================================================

export async function logoutUser() {

    try {

        await signOut(auth);

        currentAccessUser = null;

        showLoginScreen();

    } catch (error) {

        console.error("Erreur de déconnexion :", error);

        throw error;

    }

}


// ======================================================
// 10. TRADUCTION DES ERREURS
// ======================================================

function getFriendlyError(error) {

    const errors = {

        "auth/invalid-email":
            "Adresse e-mail invalide.",

        "auth/user-not-found":
            "Aucun compte ne correspond à cette adresse.",

        "auth/wrong-password":
            "Mot de passe incorrect.",

        "auth/invalid-credential":
            "Identifiants incorrects.",

        "auth/email-already-in-use":
            "Cette adresse possède déjà un compte.",

        "auth/weak-password":
            "Le mot de passe doit contenir au moins 6 caractères.",

        "auth/popup-closed-by-user":
            "Connexion Google annulée.",

        "auth/network-request-failed":
            "Problème de connexion Internet.",

        "auth/too-many-requests":
            "Trop de tentatives. Réessayez plus tard.",

        "auth/operation-not-allowed":
            "Cette méthode de connexion n'est pas activée dans Firebase."

    };

    return (
        errors[error.code] ||
        error.message ||
        "Une erreur est survenue."
    );

}


// ======================================================
// 11. AFFICHAGE DE L'ÉCRAN DE CONNEXION
// ======================================================

function showLoginScreen() {

    const login = document.getElementById("login-screen");

    const app = document.getElementById("app-container");

    if (login) login.hidden = false;

    if (app) app.hidden = true;

}


// ======================================================
// 12. AFFICHAGE DE L'APPLICATION
// ======================================================

function showApplicationScreen(user, admin) {

    const login = document.getElementById("login-screen");

    const app = document.getElementById("app-container");

    if (login) login.hidden = true;

    if (app) app.hidden = false;

    const userElement = document.getElementById("current-user");

    if (userElement) {

        userElement.textContent =
            `${user.displayName || user.email}` +
            (admin ? " (Administrateur)" : "");

    }

    // IMPORTANT :
    // app.js écoute également cet événement sur window.

    window.dispatchEvent(
        new CustomEvent("sarah-auth-ready", {

            detail: {
                user,
                isAdmin: admin
            }

        })
    );

}


// ======================================================
// 13. ÉCRAN D'ATTENTE D'AUTORISATION
// ======================================================

function showPendingScreen() {

    const login = document.getElementById("login-screen");

    const app = document.getElementById("app-container");

    if (login) login.hidden = false;

    if (app) app.hidden = true;

    showAuthMessage(
        "Votre compte est enregistré. En attente de l'approbation de l'administrateur.",
        "warning"
    );

}


// ======================================================
// 14. SURVEILLANCE DE L'AUTHENTIFICATION
// ======================================================

export function initAuth() {

    if (authInitialized) return;

    authInitialized = true;

    onAuthStateChanged(auth, async user => {

        if (!user) {

            currentAccessUser = null;

            showLoginScreen();

            window.dispatchEvent(
                new CustomEvent("sarah-auth-logged-out")
            );

            return;

        }

        // Éviter de réinitialiser inutilement le même utilisateur.
        if (currentAccessUser === user.uid) {
            return;
        }

        try {

            const admin = isAdmin(user);

            const approved = await checkUserAccess(user);

            if (!approved) {

                await createAccessRequest(user);

                currentAccessUser = null;

                showPendingScreen();

                return;

            }

            currentAccessUser = user.uid;

            showApplicationScreen(user, admin);

        } catch (error) {

            console.error(
                "Erreur de vérification des autorisations :",
                error
            );

            currentAccessUser = null;

            showLoginScreen();

            showAuthMessage(
                "Impossible de vérifier vos autorisations. Vérifiez votre connexion Internet et les règles Firebase."
            );

        }

    });


    // ==================================================
    // FORMULAIRE DE CONNEXION
    // ==================================================

    const loginForm = document.getElementById("login-form");

    if (loginForm) {

        loginForm.addEventListener("submit", async event => {

            event.preventDefault();

            const email =
                document.getElementById("login-email").value;

            const password =
                document.getElementById("login-password").value;

            try {

                await loginWithEmail(email, password);

            } catch (error) {

                console.error(error);

            }

        });

    }


    // ==================================================
    // FORMULAIRE D'INSCRIPTION
    // ==================================================

    const registerForm = document.getElementById("register-form");

    if (registerForm) {

        registerForm.addEventListener("submit", async event => {

            event.preventDefault();

            const name =
                document.getElementById("register-name").value;

            const email =
                document.getElementById("register-email").value;

            const password =
                document.getElementById("register-password").value;

            try {

                await registerWithEmail(
                    name,
                    email,
                    password
                );

            } catch (error) {

                console.error(error);

            }

        });

    }


    // ==================================================
    // CONNEXION GOOGLE
    // ==================================================

    const googleButton =
        document.getElementById("google-login");

    if (googleButton) {

        googleButton.addEventListener("click", async () => {

            try {

                await loginWithGoogle();

            } catch (error) {

                console.error(error);

            }

        });

    }


    // ==================================================
    // DÉCONNEXION
    // ==================================================

    const logoutButton =
        document.getElementById("logout-button");

    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            logoutUser
        );

    }

}


// ======================================================
// 15. LANCEMENT AUTOMATIQUE
// ======================================================

initAuth();


// ======================================================
// FIN AUTH.JS — DÉPÔT SARAH V2
// ======================================================