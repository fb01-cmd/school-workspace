import { google } from "googleapis";

// Check if Google Workspace credentials are provided in the environment
const hasCredentials =
  process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY &&
  process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;

export const isMock = !hasCredentials;

// Mock database to simulate Google Workspace in memory
let mockOUs = [
  { orgUnitId: "ou1", orgUnitPath: "/교직원", name: "교직원" },
  { orgUnitId: "ou2", orgUnitPath: "/학생", name: "학생" },
  { orgUnitId: "ou3", orgUnitPath: "/학생/1학년", name: "1학년" },
  { orgUnitId: "ou4", orgUnitPath: "/학생/2학년", name: "2학년" },
  { orgUnitId: "ou5", orgUnitPath: "/학생/3학년", name: "3학년" },
  { orgUnitId: "ou6", orgUnitPath: "/학생/4학년", name: "4학년" },
  { orgUnitId: "ou7", orgUnitPath: "/학생/5학년", name: "5학년" },
  { orgUnitId: "ou8", orgUnitPath: "/학생/6학년", name: "6학년" },
];

let mockUsers: {
  id: string;
  primaryEmail: string;
  name: { familyName: string; givenName: string };
  orgUnitPath: string;
  suspended: boolean;
  aliases?: string[];
}[] = [
  { id: "u1", primaryEmail: "teacher01@hmh.or.kr", name: { familyName: "김", givenName: "민수" }, orgUnitPath: "/교직원", suspended: false, aliases: [] },
  { id: "u2", primaryEmail: "teacher02@hmh.or.kr", name: { familyName: "이", givenName: "영희" }, orgUnitPath: "/교직원", suspended: false, aliases: [] },
  { id: "u3", primaryEmail: "25001@hmh.or.kr", name: { familyName: "박", givenName: "철수" }, orgUnitPath: "/학생/1학년", suspended: false, aliases: [] },
  { id: "u4", primaryEmail: "25002@hmh.or.kr", name: { familyName: "최", givenName: "지우" }, orgUnitPath: "/학생/1학년", suspended: false, aliases: [] },
  { id: "u5", primaryEmail: "24001@hmh.or.kr", name: { familyName: "한", givenName: "재민" }, orgUnitPath: "/학생/2학년", suspended: false, aliases: [] },
];

// Helper to get Google Admin Directory API Client
const getAdminClient = () => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/admin.directory.orgunit",
      "https://www.googleapis.com/auth/admin.directory.user",
      "https://www.googleapis.com/auth/admin.directory.group",
    ],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
  });

  return google.admin({ version: "directory_v1", auth });
};

// 1. Fetch OUs
export const listOrgunits = async () => {
  if (isMock) {
    return mockOUs;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.orgunits.list({
      customerId: "my_customer",
      type: "all",
    });
    return res.data.organizationUnits || [];
  } catch (error) {
    console.error("Error fetching OUs from Google Workspace", error);
    throw error;
  }
};

// 2. Create OU
export const createOrgunit = async (name: string, parentOrgUnitPath: string = "/") => {
  if (isMock) {
    const orgUnitPath = parentOrgUnitPath === "/" ? `/${name}` : `${parentOrgUnitPath}/${name}`;
    const newOU = {
      orgUnitId: `ou_${Math.random().toString(36).substr(2, 9)}`,
      orgUnitPath,
      name,
    };
    mockOUs.push(newOU);
    return newOU;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.orgunits.insert({
      customerId: "my_customer",
      requestBody: {
        name,
        parentOrgUnitPath,
      },
    });
    return res.data;
  } catch (error) {
    console.error("Error creating OU in Google Workspace", error);
    throw error;
  }
};

// 3. Update (rename) OU
export const updateOrgunit = async (orgUnitPath: string, newName: string) => {
  if (isMock) {
    const idx = mockOUs.findIndex((o) => o.orgUnitPath === orgUnitPath);
    if (idx === -1) throw new Error("OU not found");
    const ou = mockOUs[idx];
    const parentPath = orgUnitPath.substring(0, orgUnitPath.lastIndexOf("/")) || "/";
    const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;
    // Update the OU and all children paths
    mockOUs = mockOUs.map((o) => {
      if (o.orgUnitPath === orgUnitPath) {
        return { ...o, name: newName, orgUnitPath: newPath };
      }
      if (o.orgUnitPath.startsWith(orgUnitPath + "/")) {
        return { ...o, orgUnitPath: newPath + o.orgUnitPath.slice(orgUnitPath.length) };
      }
      return o;
    });
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    // Google requires orgUnitPath encoded (without leading slash for the path param)
    const encodedPath = encodeURIComponent(orgUnitPath.replace(/^\//, ""));
    const res = await admin.orgunits.patch({
      customerId: "my_customer",
      orgUnitPath: encodedPath,
      requestBody: { name: newName },
    });
    return res.data;
  } catch (error) {
    console.error("Error updating OU in Google Workspace", error);
    throw error;
  }
};

// 4. Delete OU
export const deleteOrgunit = async (orgUnitPath: string) => {
  if (isMock) {
    const hasChildren = mockOUs.some((o) => o.orgUnitPath.startsWith(orgUnitPath + "/"));
    if (hasChildren) throw new Error("하위 조직단위가 있는 조직단위는 삭제할 수 없습니다. 먼저 하위 조직단위를 삭제해 주세요.");
    const hasUsers = mockUsers.some((u) => u.orgUnitPath === orgUnitPath);
    if (hasUsers) throw new Error("조직단위 내에 계정이 존재하여 삭제할 수 없습니다. 소속된 계정을 모두 삭제하거나 다른 조직으로 이동한 뒤 다시 시도해 주세요.");
    mockOUs = mockOUs.filter((o) => o.orgUnitPath !== orgUnitPath);
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const encodedPath = encodeURIComponent(orgUnitPath.replace(/^\//, ""));
    await admin.orgunits.delete({
      customerId: "my_customer",
      orgUnitPath: encodedPath,
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting OU in Google Workspace", error);
    throw error;
  }
};

// --- Server-side in-memory cache for user list API responses ---
// Drastically reduces perceived latency on filter switches and re-visits.
const USER_CACHE_TTL_MS = 60_000; // 60 seconds
const userCache = new Map<string, { data: any[]; timestamp: number }>();

const getCacheKey = (paths: string[]) => [...paths].sort().join("|");

/** Call this after any user mutation (create, update, delete) to force fresh data on next list. */
export const invalidateUserCache = () => {
  userCache.clear();
};

// 3. List Users in specific OUs
export const listUsersInOUs = async (orgUnitPaths: string[]) => {
  if (isMock) {
    // If no paths specified or contains 'all', return all users
    if (orgUnitPaths.length === 0 || orgUnitPaths.includes("all")) return mockUsers;
    return mockUsers.filter(user => orgUnitPaths.includes(user.orgUnitPath));
  }

  // Check cache first
  const cacheKey = getCacheKey(orgUnitPaths);
  const cached = userCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL_MS) {
    return cached.data;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    // If 'all' is requested or paths array is empty, fetch all users in the domain
    if (orgUnitPaths.length === 0 || orgUnitPaths.includes("all")) {
      let allUsers: any[] = [];
      let pageToken: string | undefined;
      do {
        const res = await (admin.users.list as any)({
          customer: "my_customer",
          orderBy: "email",
          maxResults: 500,
          projection: "basic",
          pageToken,
        });
        if (res.data.users) {
          allUsers = [...allUsers, ...res.data.users];
        }
        pageToken = res.data.nextPageToken || undefined;
      } while (pageToken);

      userCache.set(cacheKey, { data: allUsers, timestamp: Date.now() });
      return allUsers;
    }

    // Fetch all OU paths in parallel for faster loading
    const fetchUsersForOU = async (path: string) => {
      const users: any[] = [];
      let pageToken: string | undefined;
      do {
        const res = await (admin.users.list as any)({
          customer: "my_customer",
          query: `orgUnitPath='${path}'`,
          orderBy: "email",
          maxResults: 500,
          projection: "basic",
          pageToken,
        });
        if (res.data.users) {
          users.push(...res.data.users);
        }
        pageToken = res.data.nextPageToken || undefined;
      } while (pageToken);
      return users;
    };

    const results = await Promise.all(orgUnitPaths.map(fetchUsersForOU));
    const allUsers = results.flat();

    userCache.set(cacheKey, { data: allUsers, timestamp: Date.now() });
    return allUsers;
  } catch (error) {
    console.error("Error fetching users from Google Workspace", error);
    throw error;
  }
};

// 4. Create User
export const createUser = async (
  email: string,
  firstName: string,
  lastName: string,
  orgUnitPath: string,
  password: string,
  changePasswordAtNextLogin: boolean
) => {
  if (isMock) {
    const newUser = {
      id: `u_${Math.random().toString(36).substr(2, 9)}`,
      primaryEmail: email,
      name: { familyName: lastName, givenName: firstName },
      orgUnitPath,
      suspended: false,
    };
    mockUsers.push(newUser);
    return newUser;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.users.insert({
      requestBody: {
        primaryEmail: email,
        name: {
          givenName: firstName,
          familyName: lastName,
        },
        password,
        changePasswordAtNextLogin,
        orgUnitPath,
      },
    });
    return res.data;
  } catch (error) {
    console.error("Error creating user in Google Workspace", error);
    throw error;
  }
};

// 5. Delete User
export const deleteUser = async (email: string) => {
  if (isMock) {
    mockUsers = mockUsers.filter((user) => user.primaryEmail !== email);
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await admin.users.delete({
      userKey: email,
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting user in Google Workspace", error);
    throw error;
  }
};

// 6. Update User (Edit details, Suspend/Restore, Change Password)
export const updateUser = async (
  email: string,
  updates: {
    firstName?: string;
    lastName?: string;
    orgUnitPath?: string;
    password?: string;
    changePasswordAtNextLogin?: boolean;
    suspended?: boolean;
    primaryEmail?: string;
  }
) => {
  if (isMock) {
    const userIndex = mockUsers.findIndex((u) => u.primaryEmail === email);
    if (userIndex === -1) throw new Error("사용자를 찾을 수 없습니다.");
    const existing = mockUsers[userIndex];
    
    if (updates.firstName !== undefined || updates.lastName !== undefined) {
      existing.name = {
        familyName: updates.lastName !== undefined ? updates.lastName : existing.name.familyName,
        givenName: updates.firstName !== undefined ? updates.firstName : existing.name.givenName,
      };
    }
    if (updates.orgUnitPath !== undefined) {
      existing.orgUnitPath = updates.orgUnitPath;
    }
    if (updates.suspended !== undefined) {
      (existing as any).suspended = updates.suspended;
    }
    if (updates.primaryEmail !== undefined && updates.primaryEmail !== existing.primaryEmail) {
      if (!existing.aliases) {
        existing.aliases = [];
      }
      if (!existing.aliases.includes(existing.primaryEmail)) {
        existing.aliases.push(existing.primaryEmail);
      }
      existing.primaryEmail = updates.primaryEmail;
    }
    mockUsers[userIndex] = existing;
    return existing;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const requestBody: any = {};
    if (updates.firstName !== undefined || updates.lastName !== undefined) {
      requestBody.name = {};
      if (updates.firstName !== undefined) requestBody.name.givenName = updates.firstName;
      if (updates.lastName !== undefined) requestBody.name.familyName = updates.lastName;
    }
    if (updates.orgUnitPath !== undefined) requestBody.orgUnitPath = updates.orgUnitPath;
    if (updates.password !== undefined) requestBody.password = updates.password;
    if (updates.changePasswordAtNextLogin !== undefined) {
      requestBody.changePasswordAtNextLogin = updates.changePasswordAtNextLogin;
    }
    if (updates.suspended !== undefined) requestBody.suspended = updates.suspended;
    if (updates.primaryEmail !== undefined) requestBody.primaryEmail = updates.primaryEmail;

    const res = await admin.users.patch({
      userKey: email,
      requestBody,
    });
    return res.data;
  } catch (error) {
    console.error("Error updating user in Google Workspace", error);
    throw error;
  }
};

// 7. Add Email Alias
export const addAlias = async (email: string, alias: string) => {
  if (isMock) {
    const user = mockUsers.find((u) => u.primaryEmail === email);
    if (!user) throw new Error("사용자를 찾을 수 없습니다.");
    if (!user.aliases) {
      user.aliases = [];
    }
    if (user.aliases.includes(alias)) {
      throw new Error("이미 등록된 별칭입니다.");
    }
    user.aliases.push(alias);
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await admin.users.aliases.insert({
      userKey: email,
      requestBody: {
        alias,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Error adding alias in Google Workspace", error);
    throw error;
  }
};

// 8. Delete Email Alias
export const deleteAlias = async (email: string, alias: string) => {
  if (isMock) {
    const user = mockUsers.find((u) => u.primaryEmail === email);
    if (!user) throw new Error("사용자를 찾을 수 없습니다.");
    if (user.aliases) {
      user.aliases = user.aliases.filter((a) => a !== alias);
    }
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await admin.users.aliases.delete({
      userKey: email,
      alias,
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting alias in Google Workspace", error);
    throw error;
  }
};

// ============================================================
// GOOGLE GROUPS API
// Requires scope: https://www.googleapis.com/auth/admin.directory.group
// Add this scope to the service account's domain-wide delegation
// in Google Admin Console > Security > API Controls > Domain-wide Delegation
// ============================================================

// 9. List all Groups in domain
export const listGroups = async (domain: string) => {
  if (isMock) {
    return [];
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    let allGroups: any[] = [];
    let pageToken: string | undefined;
    do {
      const res = await (admin.groups.list as any)({
        domain,
        maxResults: 200,
        pageToken,
      });
      if (res.data.groups) {
        allGroups = [...allGroups, ...res.data.groups];
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return allGroups;
  } catch (error) {
    console.error("Error listing groups", error);
    throw error;
  }
};

// 10. Create a public Google Group
// groupEmail format: "101@hmh.or.kr" (학년+반)
export const createGroup = async (groupEmail: string, groupName: string, description = "") => {
  if (isMock) {
    return { email: groupEmail, name: groupName };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    // Create the group
    const res = await (admin.groups.insert as any)({
      requestBody: {
        email: groupEmail,
        name: groupName,
        description,
      },
    });

    // Set group to be publicly accessible (whoCanViewMembership, whoCanPostMessage etc.)
    // This requires the groupssettings API — handled separately via groupssettings
    return res.data;
  } catch (error) {
    console.error("Error creating group", error);
    throw error;
  }
};

// 11. Delete a Google Group
export const deleteGroup = async (groupEmail: string) => {
  if (isMock) {
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await (admin.groups.delete as any)({
      groupKey: groupEmail,
    });
    return { success: true };
  } catch (error: any) {
    // If group doesn't exist, treat as success
    if (error?.code === 404) return { success: true };
    console.error("Error deleting group", error);
    throw error;
  }
};

// 12. Add member to a group
export const addGroupMember = async (groupEmail: string, memberEmail: string) => {
  if (isMock) {
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await (admin.members.insert as any)({
      groupKey: groupEmail,
      requestBody: {
        email: memberEmail,
        role: "MEMBER",
      },
    });
    return { success: true };
  } catch (error: any) {
    // If already a member, treat as success
    if (error?.code === 409) return { success: true };
    console.error("Error adding group member", error);
    throw error;
  }
};

// 13. Remove member from a group
export const removeGroupMember = async (groupEmail: string, memberEmail: string) => {
  if (isMock) {
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await (admin.members.delete as any)({
      groupKey: groupEmail,
      memberKey: memberEmail,
    });
    return { success: true };
  } catch (error: any) {
    if (error?.code === 404) return { success: true };
    console.error("Error removing group member", error);
    throw error;
  }
};

// 14. Delete all class groups matching pattern {학년}{반2자리}@{domain}
// e.g. 101@hmh.or.kr through 310@hmh.or.kr
export const deleteAllClassGroups = async (domain: string) => {
  if (isMock) {
    return { deleted: 0, failed: 0 };
  }

  const groups = await listGroups(domain);
  // Match groups like 101, 102, ... 110, 201, ... 310
  const classGroupPattern = /^[123]\d{2}@/;
  const classGroups = groups.filter((g: any) => classGroupPattern.test(g.email || ""));

  const results = await Promise.allSettled(
    classGroups.map((g: any) => deleteGroup(g.email))
  );

  const deleted = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return { deleted, failed, total: classGroups.length };
};

// 15. Create all class groups from current student familyNames
// familyName format: {학년}{반2자리}{번호2자리} e.g. "10101"
// Creates groups like 101@domain, 102@domain, ...
export const createAllClassGroups = async (
  domain: string,
  students: { primaryEmail: string; familyName: string }[]
) => {
  if (isMock) {
    return { created: 0, membersAdded: 0, failed: 0 };
  }

  // Build map: groupEmail -> member emails
  const groupMap = new Map<string, string[]>();

  for (const student of students) {
    const fn = student.familyName?.trim();
    if (!fn || fn.length < 5) continue;

    const grade = fn[0];
    const classNum = fn.substring(1, 3); // 01~10
    const classNumInt = parseInt(classNum, 10);
    if (isNaN(classNumInt) || classNumInt < 1 || classNumInt > 10) continue;

    const groupEmail = `${grade}${classNum}@${domain}`;
    if (!groupMap.has(groupEmail)) {
      groupMap.set(groupEmail, []);
    }
    groupMap.get(groupEmail)!.push(student.primaryEmail);
  }

  let created = 0;
  let membersAdded = 0;
  let failed = 0;

  for (const [groupEmail, members] of groupMap.entries()) {
    try {
      const classNumStr = groupEmail.substring(1, groupEmail.indexOf("@"));
      const grade = groupEmail[0];
      const classNum = parseInt(classNumStr, 10);
      const groupName = `${grade}학년 ${classNum}반`;

      await createGroup(groupEmail, groupName, `효명고등학교 ${groupName} 학생 그룹`);
      created++;

      // Add all members in parallel
      const memberResults = await Promise.allSettled(
        members.map((email) => addGroupMember(groupEmail, email))
      );
      membersAdded += memberResults.filter((r) => r.status === "fulfilled").length;
    } catch (error) {
      console.error(`Failed to create group ${groupEmail}`, error);
      failed++;
    }
  }

  return { created, membersAdded, failed };
};

