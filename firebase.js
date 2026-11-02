// ========================================
// DÉPÔT SARAH V2
// Configuration Firebase
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Configuration du projet Firebase existant
const firebaseConfig = {
    apiKey: "AIzaSyAyZtYrG_8_0ENiAEvTYWzsu6TQWw79E9k",
    authDomain: "sarah-stock.firebaseapp.com",
    projectId: "sarah-stock",
    storageBucket: "sarah-stock.firebasestorage.app",
    messagingSenderId: "843791178724",
    appId: "1:843791178724:web:db99c5af27c5766e5a85f1",
    measurementId: "G-EZ76LH825D"
};

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);

// Authentification
export const auth = getAuth(app);

// Connexion Google
export const googleProvider = new GoogleAuthProvider();

// Base de données Firestore
export const db = getFirestore(app);

// Application Firebase
export default app;
