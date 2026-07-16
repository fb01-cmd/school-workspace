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
  
  const match = orgUnits.find((ou: any) => ou.orgUnitPath?.toLowerCase() === cleanPath.toLowerCase());
  if (!match) {
    throw new Error(`조직단위 경로 [${orgUnitPath}]를 구글 워크스페이스에서 찾을 수 없습니다.`);
  }
  // Admin Directory API returns orgUnitId as "id:xxxxxxxx".
  // Chrome Policy API targetResource requires the raw ID without "id:" prefix.
  const rawId: string = match.orgUnitId || "";
  return rawId.startsWith("id:") ? rawId.slice(3) : rawId;
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

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

// ─── Format Converters ────────────────────────────────────────────────────────
// GWS Chrome Policy API format  ↔  internal BookmarkItem format
//
// GWS format  : { link: { name, url } }  |  { folder: { name, entries: [...] } }
// Internal fmt: { name, url? }           |  { name, children: [...] }

function gwsToInternal(gwsItems: any[]): BookmarkItem[] {
  if (!Array.isArray(gwsItems)) return [];
  return gwsItems.map((item) => {
    if (item.link) {
      return { name: item.link.name || "", url: item.link.url || "" };
    } else if (item.folder) {
      return {
        name: item.folder.name || "",
        children: gwsToInternal(item.folder.entries || [])
      };
    }
    return { name: "알 수 없음" };
  });
}

function internalToGws(bookmarks: BookmarkItem[]): any[] {
  return bookmarks.map((item) => {
    if (item.children !== undefined) {
      return {
        folder: {
          name: item.name,
          entries: internalToGws(item.children)
        }
      };
    } else {
      return {
        link: {
          name: item.name,
          url: item.url || ""
        }
      };
    }
  });
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────

// Dump raw Chrome policies for an OU (wildcard filter - shows everything)
export const rawDebugChromePolicies = async (orgUnitPath: string) => {
  try {
    const orgUnits = await listOrgunits();
    const match = orgUnits.find((ou: any) => ou.orgUnitPath?.toLowerCase() === orgUnitPath.trim().toLowerCase());
    if (!match) {
      return { error: `OU not found: ${orgUnitPath}`, availableOUs: orgUnits.map((o: any) => o.orgUnitPath) };
    }
    const rawId: string = match.orgUnitId || "";
    const orgUnitId = rawId.startsWith("id:") ? rawId.slice(3) : rawId;

    const client = getChromePolicyClient();
    const res = await client.customers.policies.resolve({
      customer: "customers/my_customer",
      requestBody: {
        policySchemaFilter: "chrome.users.*",
        policyTargetKey: {
          targetResource: `orgunits/${orgUnitId}`
        },
        pageSize: 100
      }
    });

    return {
      orgUnitPath,
      orgUnitId,
      targetResource: `orgunits/${orgUnitId}`,
      resolvedPolicies: res.data.resolvedPolicies || [],
      total: (res.data.resolvedPolicies || []).length,
      nextPageToken: res.data.nextPageToken
    };
  } catch (err: any) {
    return { error: err.message, stack: err.stack };
  }
};

// ─── 1. Resolve Managed Bookmarks for an OU ───────────────────────────────────

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
        toplevel_name: data.toplevel_name || "효명고등학교",
        bookmarks: data.bookmarks || []
      };
    }
    return { toplevel_name: "효명고등학교", bookmarks: [] };
  }

  // REAL MODE: Fetch from Google Chrome Policy API
  try {
    const orgUnitId = await getOrgUnitIdFromPath(cleanPath);
    console.log(`[ChromePolicy] Resolving bookmarks for OU: ${cleanPath}, orgUnitId: ${orgUnitId}`);
    const client = getChromePolicyClient();
    
    const res = await client.customers.policies.resolve({
      customer: `customers/my_customer`,
      requestBody: {
        // Correct schema name confirmed from API debug response
        policySchemaFilter: "chrome.users.ManagedBookmarksSetting",
        policyTargetKey: {
          targetResource: `orgunits/${orgUnitId}`
        }
      }
    });

    const policies = res.data.resolvedPolicies || [];
    const matchPolicy = policies.find((p: any) =>
      p.value?.policySchema === "chrome.users.ManagedBookmarksSetting"
    );

    // Actual GWS response structure (confirmed by debug):
    // value.value.managedBookmarks.bookmarks[] + value.value.managedBookmarks.toplevelName
    if (matchPolicy?.value?.value?.managedBookmarks) {
      const mb = matchPolicy.value.value.managedBookmarks;
      const toplevelName: string = mb.toplevelName || mb.toplevel_name || "효명고등학교";
      const gwsBookmarks: any[] = mb.bookmarks || [];
      console.log(`[ChromePolicy] Found ${gwsBookmarks.length} bookmarks for OU ${cleanPath}, toplevel: "${toplevelName}"`);
      return {
        toplevel_name: toplevelName,
        bookmarks: gwsToInternal(gwsBookmarks)
      };
    }

    console.log(`[ChromePolicy] No ManagedBookmarksSetting found for OU: ${cleanPath}`);
    return { toplevel_name: "효명고등학교", bookmarks: [] };
  } catch (error: any) {
    console.warn(`[GWS Policy API] Failed to resolve from GWS. Falling back to local Firestore. Reason: ${error.message}`);
    
    try {
      const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
      const snap = await getDoc(localRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          toplevel_name: data.toplevel_name || "효명고등학교",
          bookmarks: data.bookmarks || [],
          isLocalFallback: true,
          authWarning: error.message
        };
      }
    } catch (fsErr) {
      console.error("Firestore local fallback fetch failed:", fsErr);
    }

    return {
      toplevel_name: "효명고등학교",
      bookmarks: [],
      isLocalFallback: true,
      authWarning: error.message
    };
  }
};

// ─── 2. Update/Save Managed Bookmarks for an OU ───────────────────────────────

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
    await setDoc(mockRef, { toplevel_name, bookmarks, updatedAt: new Date() });
    return { success: true };
  }

  // REAL MODE: Push update to Google Chrome Policy API
  try {
    const orgUnitId = await getOrgUnitIdFromPath(cleanPath);
    const client = getChromePolicyClient();

    // Convert internal BookmarkItem[] → GWS {link/folder} format before sending
    const gwsBookmarks = internalToGws(bookmarks);

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
              value: {
                managedBookmarks: {
                  toplevelName: toplevel_name,
                  bookmarks: gwsBookmarks
                }
              }
            },
            updateMask: "managedBookmarks"
          }
        ]
      }
    });
    console.log(`[ChromePolicy] batchModify success for OU: ${cleanPath}, ${bookmarks.length} bookmarks`);

    // Mirror to local Firestore for fast fallback reads
    const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
    await setDoc(localRef, { toplevel_name, bookmarks, updatedAt: new Date() });

    return { success: true };
  } catch (error: any) {
    console.warn(`[GWS Policy API] Failed to update bookmarks on GWS. Saving to local Firestore only. Reason: ${error.message}`);
    
    try {
      const localRef = doc(db, "chrome_bookmarks_local", encodeURIComponent(cleanPath));
      await setDoc(localRef, { toplevel_name, bookmarks, updatedAt: new Date() });
      return { success: true, isLocalFallback: true, error: error.message };
    } catch (fsErr: any) {
      console.error("Firestore local fallback save failed:", fsErr);
      return { success: false, error: `로컬 DB 저장 실패: ${fsErr.message}` };
    }
  }
};
