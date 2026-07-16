import { google } from "googleapis";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { listOrgunits, isMock } from "./workspace";

// Scope for managing Chrome policies
const CHROME_POLICY_SCOPE = "https://www.googleapis.com/auth/chrome.management.policy";

const getChromePolicyClient = () => {
  const privateKey = (process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey || undefined,
    scopes: [CHROME_POLICY_SCOPE],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL, // Impersonate super admin
  });

  return google.chromepolicy({ version: "v1", auth });
};

// Helper to find orgUnitId from orgUnitPath
const getOrgUnitIdFromPath = async (orgUnitPath: string): Promise<string> => {
  const cleanPath = orgUnitPath.trim();
  const orgUnits = await listOrgunits();
  
  // Try to find matching OU path
  const match = orgUnits.find((ou: any) => ou.orgUnitPath?.toLowerCase() === cleanPath.toLowerCase());
  if (!match) {
    throw new Error(`조직단위 경로 [${orgUnitPath}]를 구글 워크스페이스에서 찾을 수 없습니다.`);
  }
  return match.orgUnitId || "";
};

export interface BookmarkItem {
  name: string;
  url?: string;
  children?: BookmarkItem[];
}

export interface ManagedBookmarksConfig {
  toplevel_name: string;
  bookmarks: BookmarkItem[];
  isLocalFallback?: boolean;
  authWarning?: string;
}

export interface UpdateBookmarksResult {
  success: boolean;
  isLocalFallback?: boolean;
  error?: string;
}

// 1. Resolve Managed Bookmarks for an OU
export const getChromeManagedBookmarks = async (orgUnitPath: string): Promise<ManagedBookmarksConfig> => {
  const cleanPath = orgUnitPath.trim();

  // MOCK MODE: Fetch from Firestore mock collection
  if (isMock) {
    console.log(`[Mock] Resolving bookmarks for OU: ${cleanPath}`);
    const mockRef = doc(db, "chrome_bookmarks_mock", encodeURIComponent(cleanPath));
    const snap = await getDoc(mockRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        toplevel_name: data.toplevel_name || "북마크바",
        bookmarks: data.bookmarks || []
      };
    }
    return { toplevel_name: "북마크바", bookmarks: [] };
  }

  // REAL MODE: Fetch from Google Chrome Policy API
  try {
    const orgUnitId = await getOrgUnitIdFromPath(cleanPath);
    const client = getChromePolicyClient();
    
    const res = await client.customers.policies.resolve({
      customer: `customers/my_customer`,
      requestBody: {
        policySchemaFilter: "chrome.users.ManagedBookmarksSetting",
        policyTargetKey: {
          targetResource: `orgunits/${orgUnitId}`
        }
      }
    });

    const policies = res.data.resolvedPolicies || [];
    const matchPolicy = policies.find((p: any) => p.value?.policySchema === "chrome.users.ManagedBookmarksSetting");
    
    if (matchPolicy && matchPolicy.value?.value) {
      const rawValue = matchPolicy.value.value;
      return {
        toplevel_name: rawValue.toplevel_name || "북마크바",
        bookmarks: rawValue.bookmarks || []
      };
    }

    return { toplevel_name: "북마크바", bookmarks: [] };
  } catch (error: any) {
    console.warn(`[GWS Policy API] Failed to resolve from GWS. Falling back to local Firestore config. Reason: ${error.message}`);
    
    // FALLBACK TO FIRESTORE LOCAL CONFIG
    try {
      const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
      const snap = await getDoc(localRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          toplevel_name: data.toplevel_name || "북마크바",
          bookmarks: data.bookmarks || [],
          isLocalFallback: true,
          authWarning: error.message
        };
      }
    } catch (fsErr) {
      console.error("Firestore local fallback fetch failed:", fsErr);
    }

    return { 
      toplevel_name: "북마크바", 
      bookmarks: [], 
      isLocalFallback: true,
      authWarning: error.message 
    };
  }
};

// 2. Update/Save Managed Bookmarks for an OU
export const updateChromeManagedBookmarks = async (
  orgUnitPath: string,
  toplevel_name: string,
  bookmarks: BookmarkItem[]
): Promise<UpdateBookmarksResult> => {
  const cleanPath = orgUnitPath.trim();

  // MOCK MODE: Write to Firestore mock collection
  if (isMock) {
    console.log(`[Mock] Updating bookmarks for OU: ${cleanPath}`, { toplevel_name, bookmarks });
    const mockRef = doc(db, "chrome_bookmarks_mock", encodeURIComponent(cleanPath));
    await setDoc(mockRef, {
      toplevel_name,
      bookmarks,
      updatedAt: new Date()
    });
    return { success: true };
  }

  // REAL MODE: Push update to Google Chrome Policy API
  try {
    const orgUnitId = await getOrgUnitIdFromPath(cleanPath);
    const client = getChromePolicyClient();
    const policyValue = { toplevel_name, bookmarks };

    await client.customers.policies.orgunits.batchModify({
      customer: `customers/my_customer`,
      requestBody: {
        requests: [
          {
            policyTargetKey: {
              targetResource: `orgunits/${orgUnitId}`
            },
            policyValue: {
              policySchema: "chrome.users.ManagedBookmarksSetting",
              value: policyValue
            },
            updateMask: "value"
          }
        ]
      }
    });

    // Also mirror to local database so fallbacks will read it
    const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
    await setDoc(localRef, { toplevel_name, bookmarks, updatedAt: new Date() });

    return { success: true };
  } catch (error: any) {
    console.warn(`[GWS Policy API] Failed to update bookmarks on GWS. Mirroring to local Firestore only. Reason: ${error.message}`);
    
    try {
      const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
      await setDoc(localRef, {
        toplevel_name,
        bookmarks,
        updatedAt: new Date()
      });
      return {
        success: true,
        isLocalFallback: true,
        error: error.message
      };
    } catch (fsErr: any) {
      console.error("Firestore local fallback save failed:", fsErr);
      return {
        success: false,
        error: `로컬 DB 저장 실패: ${fsErr.message}`
      };
    }
  }
};
