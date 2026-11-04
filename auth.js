// ======================================================
// DÉPÔT SARAH V2
// AUTHENTIFICATION ET GESTION DES ACCÈS
// ======================================================

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
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ======================================================
// CONFIGURATION
// ======================================================

export const ADMIN_EMAIL = "christopheatangana2@gmail.com";

let initialized = false;

// ======================================================
// ÉLÉMENTS HTML
// ======================================================

const loginScreen = document.getElementById("login-screen");
const appContainer = document.getElementById("app-container");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

const authMessage = document.getElementById("auth-message");

const googleLogin = document.getElementById("google-login");
const showRegister = document.getElementById("show-register");

const logoutButton = document.getElementById("logout-button");

// ======================================================
// MESSAGES
// ======================================================

function showMessage(message, error = false) {
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.style.color = error ? "#dc2626" : "#166534";
}

// ======================================================
// ADMINISTRATEUR
// ======================================================

export function isAdmin(user = auth.currentUser) {
    return !!user &&
        user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// ======================================================
// CRÉATION D'UNE DEMANDE D'ACCÈS
// ======================================================

async function createAccessRequest(user, name = "") {

    if (isAdmin(user)) return;

    const requestRef = doc(db, "userRequests", user.uid);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {

        await setDoc(requestRef, {
            uid: user.uid,
            email: user.email || "",
            name: name || user.displayName || "",
            status: "pending",
            createdAt: serverTimestamp()
        });
    }
}

// ======================================================
// VÉRIFICATION DES AUTORISATIONS
// ======================================================

export async function checkUserAccess(user) {

    if (!user) return false;

    if (isAdmin(user)) return true;

    const userRef = doc(db, "authorizedUsers", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return false;

    const data = userSnap.data();

    return data.status === "approved" ||
        data.approved === true;
}

// ======================================================
// CONNEXION EMAIL
// ======================================================

if (loginForm) {

    loginForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;

        try {

            showMessage("Connexion en cours...");

            await signInWithEmailAndPassword(auth, email, password);

        } catch (error) {

            showMessage(
                "Erreur de connexion : " + error.message,
                true
            );
        }
    });
}

// ======================================================
// INSCRIPTION
// ======================================================

if (registerForm) {

    registerForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        const name = document.getElementById("register-name").value.trim();
        const email = document.getElementById("register-email").value.trim();
        const password = document.getElementById("register-password").value;

        try {

            showMessage("Création du compte...");

            const credential = await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

            await updateProfile(credential.user, {
                displayName: name
            });

            if (isAdmin(credential.user)) {

                await setDoc(
                    doc(db, "authorizedUsers", credential.user.uid),
                    {
                        uid: credential.user.uid,
                        email: email,
                        name: name,
                        status: "approved",
                        approved: true,
                        role: "admin",
                        createdAt: serverTimestamp()
                    }
                );

            } else {

                await createAccessRequest(credential.user, name);
            }

            showMessage(
                "Compte créé. Votre accès sera disponible après validation."
            );

        } catch (error) {

            showMessage(
                "Erreur d'inscription : " + error.message,
                true
            );
        }
    });
}

// ======================================================
// CONNEXION GOOGLE
// ======================================================

if (googleLogin) {

    googleLogin.addEventListener("click", async () => {

        try {

            showMessage("Connexion Google en cours...");

            const result = await signInWithPopup(
                auth,
                googleProvider
            );

            if (!isAdmin(result.user)) {
                await createAccessRequest(result.user);
            }

        } catch (error) {

            showMessage(
                "Erreur Google : " + error.message,
                true
            );
        }
    });
}

// ======================================================
// AFFICHER LE FORMULAIRE D'INSCRIPTION
// ======================================================

if (showRegister && registerForm && loginForm) {

    showRegister.addEventListener("click", () => {

        loginForm.style.display = "none";
        registerForm.style.display = "block";

        showMessage("Créer un nouveau compte.");
    });
}

// ======================================================
// DÉCONNEXION
// ======================================================

if (logoutButton) {

    logoutButton.addEventListener("click", async () => {

        try {
            await signOut(auth);
        } catch (error) {
            console.error("Erreur de déconnexion :", error);
        }
    });
}

// ======================================================
// SURVEILLANCE DE L'AUTHENTIFICATION
// ======================================================

export function initAuth() {

    if (initialized) return;

    initialized = true;

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            if (loginScreen) loginScreen.style.display = "block";
            if (appContainer) appContainer.style.display = "none";

            return;
        }

        try {

            const approved = await checkUserAccess(user);

            if (!approved) {

                if (loginScreen) loginScreen.style.display = "block";
                if (appContainer) appContainer.style.display = "none";

                showMessage(
                    "Votre compte est en attente d'approbation par l'administrateur.",
                    true
                );

                return;
            }

            if (loginScreen) loginScreen.style.display = "none";
            if (appContainer) appContainer.style.display = "block";

            const currentUser = document.getElementById("current-user");

            if (currentUser) {
                currentUser.textContent =
                    user.displayName || user.email;
            }

            window.dispatchEvent(
                new CustomEvent("sarah-auth-ready", {
                    detail: {
                        user: user,
                        isAdmin: isAdmin(user)
                    }
                })
            );

        } catch (error) {

            console.error("Erreur de vérification :", error);

            showMessage(
                "Impossible de vérifier les autorisations. Vérifiez votre connexion.",
                true
            );
        }
    });
}

// ======================================================
// INITIALISATION
// ======================================================

initAuth();