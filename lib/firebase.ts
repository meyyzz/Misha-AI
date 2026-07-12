import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDcxEsfWjHMsU9-f_IrlOSZXhR-6UcbqJw",
  authDomain: "login-page-project-4eecb.firebaseapp.com",
  projectId: "login-page-project-4eecb",
  storageBucket: "login-page-project-4eecb.firebasestorage.app",
  messagingSenderId: "163573619186",
  appId: "1:163573619186:web:6cd65d2061afa700f6b36b",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

