import { initializeApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  getIdToken as firebaseGetIdToken,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";

const AUTH_MODES = new Set(["legacy", "firebase_optional", "firebase_required"]);
const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

function readEnv(name) {
  const value = import.meta.env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAuthMode(value) {
  const mode = typeof value === "string" ? value.trim() : "";
  return AUTH_MODES.has(mode) ? mode : "firebase_optional";
}

export function getAuthMode() {
  return normalizeAuthMode(readEnv("VITE_AUTH_MODE"));
}

export function getFirebaseClientConfig() {
  const config = {
    apiKey: readEnv("VITE_FIREBASE_API_KEY"),
    authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
    appId: readEnv("VITE_FIREBASE_APP_ID"),
    messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    measurementId: readEnv("VITE_FIREBASE_MEASUREMENT_ID"),
  };

  const hasRequiredConfig = REQUIRED_CONFIG_KEYS.every((key) => Boolean(config[key]));
  if (!hasRequiredConfig) {
    return null;
  }

  return Object.fromEntries(Object.entries(config).filter(([, value]) => Boolean(value)));
}

export function getFirebaseAuthAvailability() {
  const authMode = getAuthMode();
  const configured = Boolean(getFirebaseClientConfig());
  const required = authMode === "firebase_required";
  const enabled = authMode !== "legacy" && configured;

  let reason = "enabled";
  if (authMode === "legacy") {
    reason = "auth mode is legacy";
  } else if (!configured) {
    reason = "firebase client config is incomplete";
  }

  return {
    authMode,
    configured,
    enabled,
    required,
    reason,
  };
}

export function isFirebaseAuthConfigured() {
  return getFirebaseAuthAvailability().enabled;
}

function ensureFirebaseAuth() {
  const config = getFirebaseClientConfig();
  const availability = getFirebaseAuthAvailability();

  if (!availability.enabled || !config) {
    throw new Error(`Firebase Auth is not available: ${availability.reason}`);
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
  return getAuth(app);
}

export function getCurrentFirebaseUser() {
  if (!isFirebaseAuthConfigured()) {
    return null;
  }

  return ensureFirebaseAuth().currentUser;
}

export function subscribeToFirebaseAuth(callback) {
  if (!isFirebaseAuthConfigured()) {
    callback(null);
    return () => {};
  }

  return firebaseOnAuthStateChanged(ensureFirebaseAuth(), callback);
}

export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(ensureFirebaseAuth(), provider);
}

export async function signOutFirebaseUser() {
  if (!isFirebaseAuthConfigured()) {
    return;
  }

  await firebaseSignOut(ensureFirebaseAuth());
}

export async function getCurrentFirebaseIdToken(forceRefresh = false) {
  const user = getCurrentFirebaseUser();
  if (!user) {
    return null;
  }

  return firebaseGetIdToken(user, forceRefresh);
}

export const getCurrentUser = getCurrentFirebaseUser;
export const onAuthStateChanged = subscribeToFirebaseAuth;
export const signInWithGoogle = signInWithGooglePopup;
export const signOut = signOutFirebaseUser;
export const getIdToken = getCurrentFirebaseIdToken;
