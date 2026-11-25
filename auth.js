// ======================================================
// DÉPÔT SARAH V2
// AUTH.JS — AUTHENTIFICATION, AUTORISATIONS ET MODES DE COMPTE
// VERSION DÉFINITIVE (LEGACY + reconnaissance TENANT)
// ======================================================
//
// RÔLES DE CE FICHIER :
//   - Authentification Firebase (email, Google, inscription).
//   - Vérification des autorisations :
//       * LEGACY via la collection authorizedUsers ;
//       * TENANT via users/{uid} + tenants/{tid}/members/{uid}.
//   - Émission des événements sarah-auth-ready / sarah-auth-logged-out.
//   - Fixation du MODE DE COMPTE (legacy / tenant) via
//     setCurrentAccountMode(), appelée par app.js.
//
// CE QUE CE FICHIER NE FAIT PAS (APPROCHE A) :
//   - Il n'active JAMAIS le mode TENANT automatiquement.
//   - Il n'importe PAS tenant-context.js.
//   - setCurrentAccountMode N'EST PAS une preuve d'autorisation.
//     La sécurité réelle est portée par les règles Firestore.
//
// STRUCTURE FIRESTORE UTILISÉE :
//   authorizedUsers/{uid}                     → { status, approved, role }
//   userRequests/{uid}                        → { status }
//   users/{uid}                               → { activeTenantId }
//   tenants/{tenantId}/members/{uid}          → { role, status, permissions }
//   tenants/{tenantId}                        → { … infos dépôt }
//
// MODE DE COMPTE (currentAccountMode) :
//   null     : personne de connecté, ou accès non autorisé.
//   "legacy" : compte autorisé sur l'ancien dépôt.
//   "tenant" : compte TENANT, activé par app.js après
//              loadTenantContext() réussi + setCurrentAccountMode().
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

export const ACCOUNT_MODES = Object.freeze({
    LEGACY: "legacy",
    TENANT: "tenant"
});

export const ACCOUNT_ROLES = Object.freeze({
    ADMIN: "admin",
    OPERATOR: "operator",
    OWNER: "owner",
    EMPLOYEE: "employee"
});

const LEGACY_ROLES = [ACCOUNT_ROLES.ADMIN, ACCOUNT_ROLES.OPERATOR];
const TENANT_ROLES = [ACCOUNT_ROLES.OWNER, ACCOUNT_ROLES.EMPLOYEE];

export let currentAccessUser = null;
export let currentUserRole = null;
export let currentAccountMode = null;

let authInitialized = false;
let authRun = 0;

// ======================================================
// MODE DE COMPTE
// ======================================================

export function setCurrentAccountMode(mode, role = null) {

    const user = auth.currentUser;

    if (!user) {
        throw new Error(
            "Aucun compte connecté : le mode de compte ne peut pas être modifié."
        );
    }

    if (mode === ACCOUNT_MODES.TENANT) {

        if (!TENANT_ROLES.includes(role)) {
            throw new Error(
                "Un rôle de dépôt valide (owner ou employee) est requis " +
                "pour le mode tenant."
            );
        }

        currentAccessUser = user;
        currentUserRole = role;
        currentAccountMode = ACCOUNT_MODES.TENANT;

        return currentAccountMode;
    }

    if (mode === ACCOUNT_MODES.LEGACY) {

        const legacyRole = role || currentUserRole;

        if (!LEGACY_ROLES.includes(legacyRole)) {
            throw new Error(
                "Le mode legacy exige un compte déjà autorisé sur " +
                "l'ancien dépôt."
            );
        }

        currentAccessUser = user;
        currentUserRole = legacyRole;
        currentAccountMode = ACCOUNT_MODES.LEGACY;

        return currentAccountMode;
    }

    throw new Error("Mode de compte inconnu : " + mode);
}

function resetSessionState() {
    currentAccessUser = null;
    currentUserRole = null;
    currentAccountMode = null;
}

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
    return currentUserRole === ACCOUNT_ROLES.OPERATOR;
}

export function hasAdminAccess() {
    return currentUserRole === ACCOUNT_ROLES.ADMIN;
}

// ======================================================
// VÉRIFICATION DES AUTORISATIONS
// ======================================================

// Retourne true si le document authorizedUsers indique un accès approuvé.
// Règle : un statut explicite prime TOUJOURS sur `approved`.
// Compatibilité : documents anciens sans `status` mais avec `approved: true`.
function isLegacyApproved(data) {
    if (!data || typeof data !== "object") return false;

    if (typeof data.status === "string" && data.status.trim()) {
        return data.status === "approved";
    }

    return data.approved === true;
}

async function checkTenantAccess(user) {

    let userSnap;
    try {
        userSnap = await getDoc(doc(db, "users", user.uid));
    } catch (error) {
        throw error;
    }

    if (!userSnap.exists()) return null;

    const userData = userSnap.data();
    const activeTenantId = userData?.activeTenantId;

    if (
        !activeTenantId ||
        typeof activeTenantId !== "string" ||
        !activeTenantId.trim()
    ) {
        return null;
    }

    let memberSnap;
    try {
        memberSnap = await getDoc(
            doc(db, "tenants", activeTenantId, "members", user.uid)
        );
    } catch (error) {
        throw error;
    }

    if (!memberSnap.exists()) return null;

    const memberData = memberSnap.data();

    if (memberData?.status !== "active") return null;

    const tenantRole = memberData?.role;

    if (!TENANT_ROLES.includes(tenantRole)) return null;

    return {
        approved: true,
        role: tenantRole,
        source: "tenant",
        tenantId: activeTenantId
    };
}

export async function checkUserAccess(user) {

    if (!user) {
        return { approved: false, role: null, source: null };
    }

    // Étape 1 : admin LEGACY
    if (isAdmin(user)) {

        if (typeof navigator === "undefined" || navigator.onLine !== false) {
            setDoc(
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
            ).catch(error => {
                console.warn(
                    "Profil administrateur non mis à jour :",
                    error
                );
            });
        }

        return {
            approved: true,
            role: ACCOUNT_ROLES.ADMIN,
            source: "admin-email"
        };
    }

    // Étape 2 : authorizedUsers (LEGACY)
    let legacySnap;
    try {
        legacySnap = await getDoc(doc(db, "authorizedUsers", user.uid));
    } catch (error) {
        throw error;
    }

    if (legacySnap.exists()) {
        const data = legacySnap.data();

        if (isLegacyApproved(data)) {
            return {
                approved: true,
                role: ACCOUNT_ROLES.OPERATOR,
                source: "legacy-approved"
            };
        }

        // Existe mais non approuvé → refus strict, sans chercher de tenant.
        return { approved: false, role: null, source: null };
    }

    // Étape 3 : tentative TENANT (uniquement si pas d'entrée LEGACY)
    const tenantResult = await checkTenantAccess(user);

    if (tenantResult) return tenantResult;

    // Étape 4 : refus
    return { approved: false, role: null, source: null };
}

// ======================================================
// DEMANDE D'ACCÈS
// ======================================================

async function createAccessRequest(user, name = "") {

    if (!user) return "pending";

    const requestRef = doc(db, "userRequests", user.uid);

    let requestSnap;
    try {
        requestSnap = await getDoc(requestRef);
    } catch (error) {
        console.warn("Lecture de la demande d'accès impossible :", error);
        return "pending";
    }

    if (requestSnap.exists()) {
        const data = requestSnap.data();
        if (data.status === "approved") return "approved";
        if (data.status === "rejected") return "rejected";
        return "pending";
    }

    try {
        await setDoc(requestRef, {
            uid: user.uid,
            email: user.email || "",
            name: name || user.displayName || "",
            status: "pending",
            createdAt: serverTimestamp()
        });
        return "created";
    } catch (error) {
        if (error && error.code === "permission-denied") {
            try {
                const again = await getDoc(requestRef);
                if (again.exists()) {
                    const data = again.data();
                    if (data.status === "approved") return "approved";
                    if (data.status === "rejected") return "rejected";
                    return "pending";
                }
            } catch (_) { /* noop */ }
        }
        console.warn("Création de la demande d'accès impossible :", error);
        return "pending";
    }
}

// ======================================================
// APPROUVER UN UTILISATEUR (LEGACY)
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

    try {
        await updateProfile(user, { displayName: name });
    } catch (error) {
        console.warn("Nom non enregistré dans le profil :", error);
    }

    try {
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
    } catch (error) {
        console.warn("Enregistrement initial incomplet :", error);
    }

    await handleAuthUser(user);

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

    resetSessionState();

    await signOut(auth);
}

// ======================================================
// AFFICHAGE DES ÉCRANS — uniformisé
// ======================================================

// Uniformise l'affichage : attribut hidden ET style.display.
// `style.display = ""` laisse le CSS reprendre la main (plus
// propre que forcer "block").
function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.style.display = visible ? "" : "none";
}

function showLoginScreen() {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    setVisible(login, true);
    setVisible(app, false);
}

function showPendingScreen(message) {

    showLoginScreen();

    const element =
        document.getElementById("login-message") ||
        document.getElementById("auth-message");

    if (element) {
        element.textContent = message ||
            "Votre demande d'accès est en attente de validation " +
            "par l'administrateur.";
    }
}

function showApplicationScreen(user, role) {

    const login = document.getElementById("login-screen");
    const app = document.getElementById("app-container");

    setVisible(login, false);
    setVisible(app, true);

    const currentUserElement =
        document.getElementById("current-user");

    if (currentUserElement) {

        const name = user.displayName || user.email || "Utilisateur";

        let roleLabel = "Utilisateur";
        if (role === ACCOUNT_ROLES.ADMIN) roleLabel = "Administrateur";
        else if (role === ACCOUNT_ROLES.OPERATOR) roleLabel = "Opérateur";
        else if (role === ACCOUNT_ROLES.OWNER) roleLabel = "Propriétaire";
        else if (role === ACCOUNT_ROLES.EMPLOYEE) roleLabel = "Employé";

        currentUserElement.textContent = `${name} (${roleLabel})`;
    }

    // On émet accountMode "legacy" par défaut, MÊME pour un
    // rôle owner/employee. C'est app.js qui, après
    // loadTenantContext() réussi, appellera
    // setCurrentAccountMode("tenant", role) pour activer le mode tenant.
    const accountModeAtEmit =
        currentAccountMode === ACCOUNT_MODES.TENANT
            ? ACCOUNT_MODES.TENANT
            : ACCOUNT_MODES.LEGACY;

    window.dispatchEvent(
        new CustomEvent("sarah-auth-ready", {
            detail: {
                user,
                isAdmin: role === ACCOUNT_ROLES.ADMIN,
                role,
                accountMode: accountModeAtEmit
            }
        })
    );
}

// ======================================================
// MESSAGES D'ERREUR
// ======================================================

const AUTH_ERROR_MESSAGES = {
    "auth/invalid-email": "Adresse e-mail invalide.",
    "auth/user-not-found": "Aucun compte correspondant.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Identifiants incorrects.",
    "auth/email-already-in-use": "Cette adresse e-mail est déjà utilisée.",
    "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
    "auth/popup-closed-by-user": "Connexion Google annulée.",
    "auth/cancelled-popup-request": "Connexion Google annulée.",
    "auth/popup-blocked":
        "Le navigateur a bloqué la fenêtre Google. Autorisez-la puis réessayez.",
    "auth/network-request-failed": "Connexion Internet indisponible.",
    "auth/too-many-requests": "Trop de tentatives. Patientez quelques minutes.",
    "auth/user-disabled": "Ce compte a été désactivé.",
    "auth/operation-not-allowed": "Cette méthode de connexion n'est pas activée.",
    "auth/unauthorized-domain":
        "Ce site n'est pas autorisé pour la connexion Firebase.",
    "auth/account-exists-with-different-credential":
        "Un compte existe déjà avec cette adresse, avec un autre mode de connexion.",
    "permission-denied": "Accès refusé par le serveur.",
    "unavailable": "Service momentanément indisponible. Réessayez.",
    "deadline-exceeded": "Le serveur met trop de temps à répondre. Réessayez."
};

function showAuthError(error) {

    console.error("Erreur authentification :", error);

    const element =
        document.getElementById("login-message") ||
        document.getElementById("auth-message");

    if (!element) return;

    element.textContent =
        AUTH_ERROR_MESSAGES[error?.code] ||
        error?.message ||
        "Une erreur est survenue.";
}

// ======================================================
// TRAITEMENT D'UN UTILISATEUR CONNECTÉ OU DÉCONNECTÉ
// ======================================================

async function handleAuthUser(user) {

    const run = ++authRun;

    if (!user) {

        resetSessionState();
        showLoginScreen();

        window.dispatchEvent(
            new CustomEvent("sarah-auth-logged-out")
        );

        return;
    }

    if (
        currentAccessUser &&
        currentAccessUser.uid !== user.uid
    ) {
        resetSessionState();

        window.dispatchEvent(
            new CustomEvent("sarah-auth-logged-out")
        );
    }

    try {

        const access = await checkUserAccess(user);

        if (run !== authRun) return;

        if (!access.approved) {

            resetSessionState();

            const status = await createAccessRequest(user);

            if (run !== authRun) return;

            if (status === "rejected") {
                showPendingScreen(
                    "Votre demande d'accès a été refusée par l'administrateur."
                );
            } else if (status === "approved") {
                await handleAuthUser(user);
                return;
            } else {
                showPendingScreen(
                    "Votre demande d'accès est en attente de validation " +
                    "par l'administrateur."
                );
            }

            return;
        }

        currentAccessUser = user;
        currentUserRole = access.role;

        // Ne PAS écraser un mode TENANT déjà actif.
        if (currentAccountMode !== ACCOUNT_MODES.TENANT) {
            currentAccountMode = ACCOUNT_MODES.LEGACY;
        }

        showApplicationScreen(user, access.role);

    } catch (error) {

        if (run !== authRun) return;

        console.error("Erreur de vérification des accès :", error);

        resetSessionState();
        showLoginScreen();
        showAuthError(error);
    }
}

// ======================================================
// INITIALISATION DE L'AUTHENTIFICATION
// ======================================================

export function initAuth() {

    if (authInitialized) return;

    authInitialized = true;

    onAuthStateChanged(auth, async (user) => {
        await handleAuthUser(user);
    });
}

// ======================================================
// FORMULAIRES ET BOUTONS
// ======================================================

const busyActions = {
    login: false,
    register: false,
    google: false,
    logout: false
};

async function runExclusive(key, button, action) {

    if (busyActions[key]) return;

    busyActions[key] = true;

    if (button) button.disabled = true;

    try {
        await action();
    } catch (error) {
        showAuthError(error);
    } finally {
        busyActions[key] = false;
        if (button) button.disabled = false;
    }
}

function initializeAuthForms() {

    const loginForm = document.getElementById("login-form");

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const email =
                document.getElementById("login-email")?.value.trim();
            const password =
                document.getElementById("login-password")?.value;

            await runExclusive(
                "login",
                loginForm.querySelector('button[type="submit"]'),
                () => loginWithEmail(email, password)
            );
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

            await runExclusive(
                "register",
                registerForm.querySelector('button[type="submit"]'),
                () => registerWithEmail(name, email, password)
            );
        });
    }

    const googleButton = document.getElementById("google-login");

    if (googleButton) {
        googleButton.addEventListener("click", async () => {
            await runExclusive(
                "google",
                googleButton,
                () => loginWithGoogle()
            );
        });
    }

    const logoutButton = document.getElementById("logout-button");

    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            await runExclusive(
                "logout",
                logoutButton,
                () => logoutUser()
            );
        });
    }

    const showRegisterButton = document.getElementById("show-register");

    if (showRegisterButton) {
        showRegisterButton.addEventListener("click", () => {
            const loginForm = document.getElementById("login-form");
            const registerForm = document.getElementById("register-form");

            if (!loginForm || !registerForm) return;

            // Si le formulaire d'inscription est actuellement caché,
            // on le montre (et on cache le login), et inversement.
            const registerHidden = registerForm.hidden;

            setVisible(registerForm, registerHidden);
            setVisible(loginForm, !registerHidden);
        });
    }
}

// ======================================================
// DÉMARRAGE
// ======================================================

initializeAuthForms();
initAuth();