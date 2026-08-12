import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const firebaseAdminApp =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
  });

export const firebaseAdminAuth = getAuth(firebaseAdminApp);
export const firebaseAdminFirestore = getFirestore(firebaseAdminApp);