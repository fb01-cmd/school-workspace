import { signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, User } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "./config";

export interface UserData {
  email: string;
  domain: string;
  role: "student" | "teacher" | "super_admin";
  isApproved: boolean;
  isSecurityGroupJoined?: boolean;
  orgUnitPath?: string;
  createdAt?: any;
}

const STUDENT_EMAIL_REGEX = /^\d{5}@hmh\.or\.kr$/;

/**
 * Calls the server-side API to check if the user is a
 * Google Workspace Super Admin. Falls back gracefully to false in mock mode.
 */
const checkIsWorkspaceAdmin = async (email: string): Promise<boolean> => {
  try {
    const res = await fetch("/api/workspace/check-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.isAdmin === true;
  } catch {
    return false;
  }
};

export const signInWithGoogle = async () => {
  try {
    // 기존 세션을 무조건 종료 후 새 계정으로 로그인
    await signOut(auth);
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await handleUserRoles(user);
    return user;
  } catch (error: any) {
    console.error("Google Sign-In Error", error);
    throw error;
  }
};




export const handleUserRoles = async (user: User) => {
  if (!user.email) throw new Error("No email found for user.");

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  const emailParts = user.email.split("@");
  const domain = emailParts.length > 1 ? emailParts[1] : "";
  const isStudent = STUDENT_EMAIL_REGEX.test(user.email);

  if (isStudent) {
    // Always write student record (idempotent)
    await setDoc(userRef, {
      email: user.email,
      domain,
      role: "student",
      isApproved: true,
      createdAt: userSnap.exists() ? userSnap.data().createdAt : serverTimestamp(),
    });
    return;
  }

  // --- Teacher path ---
  // Check Google Workspace admin status on EVERY login to keep in sync
  const isWorkspaceAdmin = await checkIsWorkspaceAdmin(user.email);

  if (userSnap.exists()) {
    // User exists: update role dynamically based on current workspace status
    await updateDoc(userRef, {
      role: isWorkspaceAdmin ? "super_admin" : "teacher",
      isApproved: isWorkspaceAdmin,
    });
  } else {
    // New user: create the document
    await setDoc(userRef, {
      email: user.email,
      domain,
      role: isWorkspaceAdmin ? "super_admin" : "teacher",
      isApproved: isWorkspaceAdmin,
      createdAt: serverTimestamp(),
    });
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign Out Error", error);
    throw error;
  }
};

