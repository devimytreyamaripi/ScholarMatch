
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAw0vzkuEXZ0Bvv4oj9clnNzGP2ns1gwp4",
  authDomain: "scholarmatch-34cd3.firebaseapp.com",
  projectId: "scholarmatch-34cd3",
  storageBucket: "scholarmatch-34cd3.firebasestorage.app",
  messagingSenderId: "956512316932",
  appId: "1:956512316932:web:5424c16c85066069ab4f51",
  measurementId: "G-04NDG52BPE"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
