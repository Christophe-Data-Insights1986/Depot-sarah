// ======================================================
// DÉPÔT SARAH V2
// AUTH.JS — AUTHENTIFICATION ET AUTORISATIONS
// ======================================================

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
// CONFIGURATION
// ======================================================

export const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let currentAccessUser = null;
let authInitialized = false;

// ======================================================
// VÉRIFICATION ADMINISTRATEUR
// ======================================================

export function isAdmin(user = auth.currentUser) {
    return Boolean(
        user &&
        user.email &&
        user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    );
}

// ======================================================
// MESSAGE D'AUTHENTIFICATION
// ======================================================

function showAuthMessage(message, type = "error") {
    const element = document.getElementById("auth-message");

    if (!element) return;

    element.textContent = message;
    element.className = `auth-message ${type}`;
}

// ======================================================
// DEMANDE D'ACCÈS
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
// VÉRIFICATION DES AUTORISATIONS
// ======================================================

export async function checkUserAccess(user) {

    if (!user) return false;

    if (isAdmin(user)) return true;

    const userRef = doc(db, "authorizedUsers", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        return false;
    }

    const data = userSnap.data();

    return data.status === "approved" || data.approved === true;
}

// ======================================================
// INSCRIPTION
// ======================================================

export async function registerWithEmail(name, email, password) {

    try {

        const result = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password
        );

        await updateProfile(result.user, {
            displayName: name.trim()
        });

        if (isAdmin(result.user)) {

            await setDoc(
                doc(db, "authorizedUsers", result.user.uid),
                {
                    uid: result.user.uid,
                    email: result.user.email,
                    name: name.trim(),
                    status: "approved",
                    approved: true,
                    role: "admin",
                    createdAt: serverTimestamp()
                }
            );

            showAuthMessage("Compte administrateur créé.", "success");

            return result.user;
        }

        await createAccessRequest(result.user, name);

        showAuthMessage(
            "Compte créé. Votre demande attend l'approbation de l'administrateur.",
            "success"
        );

        return result.user;

    } catch (error) {

        showAuthMessage(getFriendlyError(error));

        throw error;
    }
}

// ======================================================
// CONNEXION EMAIL
// ======================================================

export async function loginWithEmail(email, password) {

    try {

        const result = await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password
        );

        return result.user;

    } catch (error) {

        showAuthMessage(getFriendlyError(error));

        throw error;
    }
}

// ======================================================
// CONNEXION GOOGLE
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

        showAuthMessage(getFriendlyError(error));

        throw error;
    }
}

// ======================================================
// DÉCONNEXION
// ======================================================

export async function logoutUser() {

    try {
        await signOut(auth);
        currentAccessUser = null;
    } catch (error) {
        console.error("Erreur de déconnexion :", error);
        throw error;
    }
}

// ======================================================
// ERREURS EXPLICITES
// ======================================================

function getFriendlyError(error) {

    const errors = {
        "auth/invalid-email": "Adresse e-mail invalide.",
        "auth/user-not-found": "Aucun compte ne correspond à cette adresse.",
        "auth/wrong-password": "Mot de passe incorrect.",
        "auth/invalid-credential": "Identifiants incorrects.",
        "auth/email-already-in-use": "Cette adresse possède déjà un compte.",
        "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
        "auth/popup-closed-by-user": "Connexion Google annulée.",
        "auth/network-request-failed": "Problème de connexion Internet.",
        "auth/too-many-requests": "Trop de tentatives. Réessayez plus tard."
    };

    return errors[error.code] || error.message || "Une erreur est survenue.";
}

// ======================================================
// INTERFACE DE CONNEXION
// ======================================================

function showLoginScreen() {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    if (login) login.hidden = false;
    if (app) app.hidden = true;
}

// ======================================================
// INTERFACE DE L'APPLICATION
// ======================================================

function showApplicationScreen(user, admin) {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    if (login) login.hidden = true;
    if (app) app.hidden = false;

    const userElement = document.getElementById("current-user");

    if (userElement) {
        userElement.textContent =
            `${user.displayName || user.email}${admin ? " (Administrateur)" : ""}`;
    }

    document.dispatchEvent(
        new CustomEvent("sarah-auth-ready", {
            detail: {
                user,
                isAdmin: admin
            }
        })
    );
}

// ======================================================
// ÉCRAN D'ATTENTE
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
// INITIALISATION
// ======================================================

export function initAuth() {

    if (authInitialized) return;

    authInitialized = true;

    onAuthStateChanged(auth, async user => {

        if (!user) {

            currentAccessUser = null;
            showLoginScreen();

            document.dispatchEvent(
                new CustomEvent("sarah-auth-logged-out")
            );

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

            console.error("Erreur de vérification d'accès :", error);

            currentAccessUser = null;
            showLoginScreen();

            showAuthMessage(
                "Impossible de vérifier vos autorisations. Vérifiez votre connexion Internet."
            );
        }
    });

    // Formulaire de connexion
    const loginForm = document.getElementById("login-form");

    if (loginForm) {

        loginForm.addEventListener("submit", async event => {

            event.preventDefault();

            const email = document.getElementById("login-email").value;
            const password = document.getElementById("login-password").value;

            try {
                await loginWithEmail(email, password);
            } catch (error) {
                console.error(error);
            }
        });
    }

    // Formulaire d'inscription
    const registerForm = document.getElementById("register-form");

    if (registerForm) {

        registerForm.addEventListener("submit", async event => {

            event.preventDefault();

            const name = document.getElementById("register-name").value;
            const email = document.getElementById("register-email").value;
            const password = document.getElementById("register-password").value;

            try {
                await registerWithEmail(name, email, password);
            } catch (error) {
                console.error(error);
            }
        });
    }

    // Connexion Google
    const googleButton = document.getElementById("google-login");

    if (googleButton) {

        googleButton.addEventListener("click", async () => {

            try {
                await loginWithGoogle();
            } catch (error) {
                console.error(error);
            }
        });
    }

    // Déconnexion
    const logoutButton = document.getElementById("logout-button");

    if (logoutButton) {
        logoutButton.addEventListener("click", logoutUser);
    }
}

// ======================================================
// LANCEMENT
// ======================================================

initAuth();