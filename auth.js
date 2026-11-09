// ======================================================
// DÉPÔT SARAH V2
// AUTH.JS — AUTHENTIFICATION ET GESTION DES RÔLES
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

export let currentAccessUser = null;
export let currentUserRole = null;

let authInitialized = false;

// ======================================================
// IDENTIFICATION DES RÔLES
// ======================================================

export function isAdmin(user = auth.currentUser) {
    return Boolean(
        user &&
        user.email &&
        user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    );
}

export function isOperator() {
    return currentUserRole === "operator";
}

export function hasAdminAccess() {
    return currentUserRole === "admin";
}

// ======================================================
// VÉRIFICATION DES AUTORISATIONS
// ======================================================

export async function checkUserAccess(user) {

    if (!user) {
        return {
            approved: false,
            role: null
        };
    }

    if (isAdmin(user)) {

        await setDoc(
            doc(db, "authorizedUsers", user.uid),
            {
                uid: user.uid,
                email: user.email,
                name: user.displayName || "Administrateur",
                status: "approved",
                approved: true,
                role: "admin",
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        return {
            approved: true,
            role: "admin"
        };
    }

    const userRef = doc(db, "authorizedUsers", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        return {
            approved: false,
            role: null
        };
    }

    const data = userSnap.data();

    const approved =
        data.status === "approved" ||
        data.approved === true;

    if (!approved) {
        return {
            approved: false,
            role: null
        };
    }

    // Tous les utilisateurs approuvés non administrateurs
    // deviennent des opérateurs.
    return {
        approved: true,
        role: "operator"
    };
}

// ======================================================
// DEMANDE D'ACCÈS
// ======================================================

async function createAccessRequest(user, name = "") {

    if (!user) return false;

    const requestRef = doc(db, "userRequests", user.uid);
    const requestSnap = await getDoc(requestRef);

    if (requestSnap.exists()) {
        const data = requestSnap.data();

        if (data.status === "approved") return true;
        if (data.status === "pending") return false;
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
// APPROUVER UN UTILISATEUR
// Réservé à l'administrateur
// ======================================================

export async function approveUser(uid, email, name = "") {

    if (!isAdmin()) {
        throw new Error("Action réservée à l'administrateur.");
    }

    await setDoc(
        doc(db, "authorizedUsers", uid),
        {
            uid,
            email,
            name,
            status: "approved",
            approved: true,
            role: "operator",
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );

    await setDoc(
        doc(db, "userRequests", uid),
        {
            status: "approved",
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );

    return true;
}

// ======================================================
// REFUSER UNE DEMANDE
// ======================================================

export async function rejectUser(uid) {

    if (!isAdmin()) {
        throw new Error("Action réservée à l'administrateur.");
    }

    await setDoc(
        doc(db, "userRequests", uid),
        {
            status: "rejected",
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );

    return true;
}

// ======================================================
// INSCRIPTION
// ======================================================

export async function registerWithEmail(name, email, password) {

    const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
    );

    const user = credential.user;

    await updateProfile(user, {
        displayName: name
    });

    if (isAdmin(user)) {

        await setDoc(
            doc(db, "authorizedUsers", user.uid),
            {
                uid: user.uid,
                email: user.email,
                name,
                status: "approved",
                approved: true,
                role: "admin",
                createdAt: serverTimestamp()
            },
            { merge: true }
        );

    } else {

        await createAccessRequest(user, name);
    }

    return user;
}

// ======================================================
// CONNEXION PAR E-MAIL
// ======================================================

export async function loginWithEmail(email, password) {

    const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password
    );

    return credential.user;
}

// ======================================================
// CONNEXION GOOGLE
// ======================================================

export async function loginWithGoogle() {

    const credential = await signInWithPopup(
        auth,
        googleProvider
    );

    return credential.user;
}

// ======================================================
// DÉCONNEXION
// ======================================================

export async function logoutUser() {

    currentAccessUser = null;
    currentUserRole = null;

    await signOut(auth);

    showLoginScreen();
}

// ======================================================
// AFFICHAGE DES ÉCRANS
// ======================================================

function showLoginScreen() {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    if (login) login.style.display = "block";
    if (app) app.style.display = "none";
}

function showPendingScreen() {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    if (login) login.style.display = "block";
    if (app) app.style.display = "none";

    const message =
        document.getElementById("login-message") ||
        document.getElementById("auth-message");

    if (message) {
        message.textContent =
            "Votre demande d'accès est en attente de validation par l'administrateur.";
    }
}

function showApplicationScreen(user, role) {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    if (login) login.style.display = "none";
    if (app) app.style.display = "block";

    const currentUserElement =
        document.getElementById("current-user");

    if (currentUserElement) {

        const name = user.displayName || user.email || "Utilisateur";

        currentUserElement.textContent =
            role === "admin"
                ? `${name} (Administrateur)`
                : `${name} (Opérateur)`;
    }

    window.dispatchEvent(
        new CustomEvent("sarah-auth-ready", {
            detail: {
                user,
                isAdmin: role === "admin",
                role
            }
        })
    );
}

// ======================================================
// MESSAGES D'ERREUR
// ======================================================

function showAuthError(error) {

    console.error("Erreur authentification :", error);

    const message =
        document.getElementById("login-message") ||
        document.getElementById("auth-message");

    if (!message) return;

    const messages = {
        "auth/invalid-email": "Adresse e-mail invalide.",
        "auth/user-not-found": "Aucun compte correspondant.",
        "auth/wrong-password": "Mot de passe incorrect.",
        "auth/invalid-credential": "Identifiants incorrects.",
        "auth/email-already-in-use": "Cette adresse e-mail est déjà utilisée.",
        "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
        "auth/popup-closed-by-user": "Connexion Google annulée."
    };

    message.textContent =
        messages[error.code] ||
        error.message ||
        "Une erreur est survenue.";
}

// ======================================================
// INITIALISATION DE L'AUTHENTIFICATION
// ======================================================

export function initAuth() {

    if (authInitialized) return;

    authInitialized = true;

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            currentAccessUser = null;
            currentUserRole = null;

            showLoginScreen();

            window.dispatchEvent(
                new CustomEvent("sarah-auth-logged-out")
            );

            return;
        }

        try {

            const access = await checkUserAccess(user);

            if (!access.approved) {

                currentAccessUser = null;
                currentUserRole = null;

                await createAccessRequest(user);

                showPendingScreen();

                return;
            }

            currentAccessUser = user;
            currentUserRole = access.role;

            showApplicationScreen(user, access.role);

        } catch (error) {

            console.error(
                "Erreur de vérification des accès :",
                error
            );

            showLoginScreen();
            showAuthError(error);
        }
    });
}

// ======================================================
// FORMULAIRES ET BOUTONS
// ======================================================

function initializeAuthForms() {

    const loginForm = document.getElementById("login-form");

    if (loginForm) {

        loginForm.addEventListener("submit", async (event) => {

            event.preventDefault();

            const email =
                document.getElementById("login-email")?.value.trim();

            const password =
                document.getElementById("login-password")?.value;

            try {

                await loginWithEmail(email, password);

            } catch (error) {

                showAuthError(error);
            }
        });
    }

    const registerForm = document.getElementById("register-form");

    if (registerForm) {

        registerForm.addEventListener("submit", async (event) => {

            event.preventDefault();

            const name =
                document.getElementById("register-name")?.value.trim();

            const email =
                document.getElementById("register-email")?.value.trim();

            const password =
                document.getElementById("register-password")?.value;

            try {

                await registerWithEmail(name, email, password);

            } catch (error) {

                showAuthError(error);
            }
        });
    }

    const googleButton =
        document.getElementById("google-login");

    if (googleButton) {

        googleButton.addEventListener("click", async () => {

            try {

                await loginWithGoogle();

            } catch (error) {

                showAuthError(error);
            }
        });
    }

    const logoutButton =
        document.getElementById("logout-button");

    if (logoutButton) {

        logoutButton.addEventListener("click", async () => {

            try {

                await logoutUser();

            } catch (error) {

                showAuthError(error);
            }
        });
    }

    const showRegisterButton =
        document.getElementById("show-register");

    if (showRegisterButton) {

        showRegisterButton.addEventListener("click", () => {

            const loginForm =
                document.getElementById("login-form");

            const registerForm =
                document.getElementById("register-form");

            if (loginForm) loginForm.style.display = "none";
            if (registerForm) registerForm.style.display = "block";
        });
    }
}

// ======================================================
// DÉMARRAGE
// ======================================================

initializeAuthForms();
initAuth();