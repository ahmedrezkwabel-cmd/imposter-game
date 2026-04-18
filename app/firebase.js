import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDdzu0PrbWu6jafUDKVJ5Z6_2hr_iA3NuM",
    authDomain: "imposter-game-32fb4.firebaseapp.com",
    projectId: "imposter-game-32fb4",
    storageBucket: "imposter-game-32fb4.firebasestorage.app",
    messagingSenderId: "966138830650",
    appId: "1:966138830650:web:e00922c75fb24b341efa03",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);