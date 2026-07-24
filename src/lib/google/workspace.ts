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

export let mockUsers: {
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

let mockGroups: { id: string; email: string; name: string; description: string }[] = [
  { id: "g1", email: "teacher-all@hmh.or.kr", name: "전체 교직원", description: "교직원 전체 소통 그룹" },
  { id: "g2", email: "101@hmh.or.kr", name: "1학년 1반", description: "1학년 1반 학생 그룹" },
  { id: "g3", email: "102@hmh.or.kr", name: "1학년 2반", description: "1학년 2반 학생 그룹" },
];

let mockGroupMembers: Record<string, string[]> = {
  "teacher-all@hmh.or.kr": ["teacher01@hmh.or.kr", "teacher02@hmh.or.kr"],
  "101@hmh.or.kr": ["25001@hmh.or.kr", "25002@hmh.or.kr"],
  "102@hmh.or.kr": [],
};

let mockGroupSettings: Record<string, any> = {
  "teacher-all@hmh.or.kr": {
    whoCanJoin: "INVITED_CAN_JOIN",
    whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
    whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
    whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
  },
  "101@hmh.or.kr": {
    whoCanJoin: "INVITED_CAN_JOIN",
    whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
    whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
    whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
  },
  "102@hmh.or.kr": {
    whoCanJoin: "INVITED_CAN_JOIN",
    whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
    whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
    whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
  },
};

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

// Helper to get Google Groups Settings API Client
const getGroupsSettingsClient = () => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/apps.groups.settings",
    ],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
  });

  return google.groupssettings({ version: "v1", auth });
};

// Helper to get Gmail API Client (서비스 계정으로 발신자 계정 사칭)
// subject: 발신자로 사용할 워크스페이스 계정 이메일 (관리자 계정)
const getGmailClient = (senderEmail: string) => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: senderEmail, // 이 계정으로 가장(impersonate)하여 메일 발송
  });

  return google.gmail({ version: "v1", auth });
};

/**
 * 구글 워크스페이스 Gmail API로 메일 발송
 *
 * ⚠️ 발신자 규칙: `from`은 반드시 `process.env.GOOGLE_WORKSPACE_SENDER_EMAIL`
 * (= hmnotice@hmh.or.kr)을 사용할 것. admin@hmh.or.kr을 발신자로 쓰지 않는다.
 * 패턴: `process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL`
 *
 * @param from    발신자 이메일 — 반드시 GOOGLE_WORKSPACE_SENDER_EMAIL (도메인 위임 필요)
 * @param to      수신자 이메일 (학생/교직원 계정)
 * @param subject 메일 제목
 * @param body    메일 본문 (plain text)
 */
export const sendGmail = async (from: string, to: string, subject: string, body: string): Promise<void> => {
  if (isMock) {
    console.log(`[Gmail MOCK] From: ${from} → To: ${to}\nSubject: ${subject}\n${body}`);
    return;
  }

  const gmail = getGmailClient(from);
  if (!gmail) throw new Error("Gmail 클라이언트를 초기화할 수 없습니다.");

  // RFC 2822 형식의 메일 메시지 구성 (UTF-8 제목 인코딩 포함)
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `MIME-Version: 1.0`,
    ``,
    body,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
};

// Helper to get Google Chat API Client (앱 봇으로 동작)
const getChatClient = () => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");

  // Chat API spaces.setup은 사용자 인증이 필요하므로 관리자 계정으로 사칭(impersonate)
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/chat.spaces.create",
      "https://www.googleapis.com/auth/chat.messages.create",
      "https://www.googleapis.com/auth/chat.memberships",
    ],
    subject: process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL, // 발신자 계정으로 사칭
  });

  return google.chat({ version: "v1", auth });
};

/**
 * 구글 챗 DM 발송 (앱→학생 1:1 메시지)
 * @param studentEmail 수신 학생 계정 이메일
 * @param message      보낼 텍스트 메시지
 */
export const sendGoogleChat = async (studentEmail: string, message: string): Promise<void> => {
  if (isMock) {
    console.log(`[Chat MOCK] → ${studentEmail}\n${message}`);
    return;
  }

  const chat = getChatClient();
  if (!chat) throw new Error("Chat 클라이언트를 초기화할 수 없습니다.");

  // 1. 학생과의 DM 스페이스 생성 (이미 존재하면 기존 스페이스 반환)
  const spaceRes = await (chat as any).spaces.setup({
    requestBody: {
      space: { spaceType: "DIRECT_MESSAGE" },
      memberships: [
        {
          member: {
            name: `users/${studentEmail}`,
            type: "HUMAN",
          },
        },
      ],
    },
  });

  const spaceName = spaceRes.data.name; // e.g. "spaces/XXXXXX"

  // 2. DM 스페이스에 메시지 전송
  await (chat as any).spaces.messages.create({
    parent: spaceName,
    requestBody: { text: message },
  });
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
    // Also update users whose orgUnitPath is under the renamed OU
    mockUsers = mockUsers.map((u) => {
      if (u.orgUnitPath === orgUnitPath) {
        return { ...u, orgUnitPath: newPath };
      }
      if (u.orgUnitPath.startsWith(orgUnitPath + "/")) {
        return { ...u, orgUnitPath: newPath + u.orgUnitPath.slice(orgUnitPath.length) };
      }
      return u;
    });
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    // Resolve orgUnitPath to orgUnitId to bypass Google API URL-routing slash-parsing bugs
    const listRes = await admin.orgunits.list({ customerId: "my_customer", type: "all" });
    const ous = listRes.data.organizationUnits || [];
    const targetOU = ous.find((o) => o.orgUnitPath === orgUnitPath);
    const pathOrId = (targetOU && targetOU.orgUnitId) ? targetOU.orgUnitId : orgUnitPath.replace(/^\//, "");

    const res = await admin.orgunits.patch({
      customerId: "my_customer",
      orgUnitPath: pathOrId,
      requestBody: { name: newName },
    });
    // OU rename changes users' orgUnitPath — invalidate cache so next listing is fresh
    invalidateUserCache();
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
    // Resolve orgUnitPath to orgUnitId to bypass Google API URL-routing slash-parsing bugs
    const listRes = await admin.orgunits.list({ customerId: "my_customer", type: "all" });
    const ous = listRes.data.organizationUnits || [];
    const targetOU = ous.find((o) => o.orgUnitPath === orgUnitPath);
    const pathOrId = (targetOU && targetOU.orgUnitId) ? targetOU.orgUnitId : orgUnitPath.replace(/^\//, "");

    await admin.orgunits.delete({
      customerId: "my_customer",
      orgUnitPath: pathOrId,
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

    // Fetch all users in the domain and filter locally in JavaScript
    // This bypasses Google's search query indexing lag (query: "orgUnitPath='...'")
    // ensuring newly created or moved users are immediately visible.
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

    // Filter by requested OUs
    const filteredUsers = allUsers.filter((u: any) => orgUnitPaths.includes(u.orgUnitPath));

    userCache.set(cacheKey, { data: filteredUsers, timestamp: Date.now() });
    return filteredUsers;
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
    const exists = mockUsers.some((u) => u.primaryEmail.toLowerCase() === email.toLowerCase());
    if (exists) {
      const err = new Error(`Entity already exists: ${email}`);
      (err as any).code = 409;
      throw err;
    }
    const newUser = {
      id: `u_${Math.random().toString(36).substr(2, 9)}`,
      primaryEmail: email,
      name: { familyName: lastName, givenName: firstName },
      orgUnitPath,
      suspended: false,
    };
    mockUsers.push(newUser);
    invalidateUserCache();
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
    invalidateUserCache();
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
    invalidateUserCache();
    return { success: true };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await admin.users.delete({
      userKey: email,
    });
    invalidateUserCache();
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
    invalidateUserCache();
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
    invalidateUserCache();
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
    return mockGroups.map((g) => ({
      ...g,
      directMembersCount: String(mockGroupMembers[g.email]?.length || 0),
    }));
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

// 9.2. List all Groups a user belongs to
export const listGroupsForUser = async (userEmail: string) => {
  if (isMock) {
    const matchedGroups = [];
    for (const [groupEmail, members] of Object.entries(mockGroupMembers)) {
      if (members.includes(userEmail)) {
        const grp = mockGroups.find((g) => g.email === groupEmail);
        if (grp) {
          matchedGroups.push(grp);
        } else {
          matchedGroups.push({ email: groupEmail, name: groupEmail });
        }
      }
    }
    return matchedGroups;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.groups.list({
      userKey: userEmail,
    });
    return res.data.groups || [];
  } catch (error) {
    console.error(`Error listing groups for user ${userEmail}`, error);
    throw error;
  }
};

// 10. Create a public Google Group
// groupEmail format: "101@hmh.or.kr" (학년+반)
export const createGroup = async (groupEmail: string, groupName: string, description = "") => {
  if (isMock) {
    const newGroup = { id: `g_${Math.random().toString(36).substr(2, 9)}`, email: groupEmail, name: groupName, description };
    mockGroups.push(newGroup);
    mockGroupMembers[groupEmail] = [];
    mockGroupSettings[groupEmail] = {
      whoCanJoin: "CAN_REQUEST_TO_JOIN",
      whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
      whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
      whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
    };
    return newGroup;
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

    // Make it a public group by default (all in domain can view and post)
    try {
      await updateGroupSettings(groupEmail, {
        whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
        whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanJoin: "CAN_REQUEST_TO_JOIN",
      });
    } catch (settingsErr) {
      console.warn("Failed to set default group settings on creation", settingsErr);
    }

    return res.data;
  } catch (error) {
    console.error("Error creating group", error);
    throw error;
  }
};

// 11. Delete a Google Group
export const deleteGroup = async (groupEmail: string) => {
  if (isMock) {
    mockGroups = mockGroups.filter((g) => g.email !== groupEmail);
    delete mockGroupMembers[groupEmail];
    delete mockGroupSettings[groupEmail];
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
    if (!mockGroupMembers[groupEmail]) {
      mockGroupMembers[groupEmail] = [];
    }
    if (!mockGroupMembers[groupEmail].includes(memberEmail)) {
      mockGroupMembers[groupEmail].push(memberEmail);
    }
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
    if (mockGroupMembers[groupEmail]) {
      mockGroupMembers[groupEmail] = mockGroupMembers[groupEmail].filter((m) => m !== memberEmail);
    }
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

// 13a. List members of a group
export const listGroupMembers = async (groupEmail: string) => {
  if (isMock) {
    const emails = mockGroupMembers[groupEmail] || [];
    return emails.map((email, idx) => ({
      id: `m_${idx}`,
      email,
      role: "MEMBER",
      type: "USER",
    }));
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    let allMembers: any[] = [];
    let pageToken: string | undefined;
    do {
      const res = await (admin.members.list as any)({
        groupKey: groupEmail,
        maxResults: 200,
        pageToken,
      });
      if (res.data.members) {
        allMembers = [...allMembers, ...res.data.members];
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
    return allMembers;
  } catch (error) {
    console.error(`Error listing members for group ${groupEmail}`, error);
    throw error;
  }
};

// 13b. Get group settings
export const getGroupSettings = async (groupEmail: string) => {
  if (isMock) {
    return mockGroupSettings[groupEmail] || {
      whoCanJoin: "CAN_REQUEST_TO_JOIN",
      whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
      whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
      whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
    };
  }

  const groupsSettings = getGroupsSettingsClient();
  if (!groupsSettings) throw new Error("Groups Settings client is not initialized.");

  try {
    const res = await (groupsSettings.groups.get as any)({
      groupUniqueId: groupEmail,
      alt: "json",
    });
    const raw = res.data || {};

    // Normalize: the API may return fields as camelCase, snake_case, or nested
    // Build a flattened version checking all known key patterns
    const normalize = (camel: string, snake: string) => {
      return raw[camel] || raw[snake] || undefined;
    };

    const settings = {
      ...raw,
      whoCanPostMessage: normalize("whoCanPostMessage", "who_can_post_message"),
      whoCanJoin: normalize("whoCanJoin", "who_can_join"),
      whoCanViewGroup: normalize("whoCanViewGroup", "who_can_view_group"),
      whoCanViewMembership: normalize("whoCanViewMembership", "who_can_view_membership"),
    };

    return settings;
  } catch (error) {
    console.warn(`Error getting settings for group ${groupEmail}`, error);
    throw error;
  }
};

// 13c. Update group settings
export const updateGroupSettings = async (groupEmail: string, settings: any) => {
  if (isMock) {
    mockGroupSettings[groupEmail] = {
      ...(mockGroupSettings[groupEmail] || {}),
      ...settings,
    };
    return mockGroupSettings[groupEmail];
  }

  const groupsSettings = getGroupsSettingsClient();
  if (!groupsSettings) throw new Error("Groups Settings client is not initialized.");

  try {
    const res = await groupsSettings.groups.patch({
      groupUniqueId: groupEmail,
      requestBody: settings,
    });
    return res.data;
  } catch (error) {
    console.error(`Error updating settings for group ${groupEmail}`, error);
    throw error;
  }
};

// 14. Delete all class groups matching pattern {학년}{반2자리}@{domain}
// e.g. 101@hmh.or.kr through 310@hmh.or.kr
export const deleteAllClassGroups = async (domain: string, testPrefix: string = "") => {
  if (isMock) {
    const patternStr = testPrefix ? `^${testPrefix}[123]\\d{2}@` : `^[123]\\d{2}@`;
    const classGroupPattern = new RegExp(patternStr);
    const emailsToDelete = Object.keys(mockGroupSettings).filter((email) => classGroupPattern.test(email));
    
    emailsToDelete.forEach((email) => {
      delete mockGroupSettings[email];
      delete mockGroupMembers[email];
    });
    
    mockGroups = mockGroups.filter((g) => !emailsToDelete.includes(g.email));

    return { 
      deleted: emailsToDelete.length, 
      failed: 0, 
      total: emailsToDelete.length,
      succeededList: emailsToDelete,
      failedList: []
    };
  }

  const groups = await listGroups(domain);
  // Match groups like 101, 102, ... 110, 201, ... 310 (with optional test prefix)
  const patternStr = testPrefix 
    ? `^${testPrefix}[123]\\d{2}@` 
    : `^[123]\\d{2}@`;
  const classGroupPattern = new RegExp(patternStr);
  const classGroups = groups.filter((g: any) => classGroupPattern.test(g.email || ""));

  const succeededList: string[] = [];
  const failedList: any[] = [];

  const results = await Promise.allSettled(
    classGroups.map(async (g: any) => {
      try {
        await deleteGroup(g.email);
        succeededList.push(g.email);
      } catch (err: any) {
        failedList.push({ email: g.email, reason: err.message || "삭제 실패" });
        throw err;
      }
    })
  );

  const deleted = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return { deleted, failed, total: classGroups.length, succeededList, failedList };
};

// 15. Create all class groups from current student familyNames
// familyName format: {학년}{반2자리}{번호2자리} e.g. "10101"
// Creates groups like 101@domain, 102@domain, ...
export const createAllClassGroups = async (
  domain: string,
  students: { primaryEmail: string; familyName: string }[],
  testPrefix: string = ""
) => {
  if (isMock) {
    const succeededList: any[] = [];
    const failedList: any[] = [];
    let createdCount = 0;
    let membersAddedCount = 0;

    const groupMap = new Map<string, string[]>();
    for (const student of students) {
      const fn = student.familyName?.trim();
      if (!fn || fn.length < 5) continue;
      const grade = fn[0];
      const classNum = fn.substring(1, 3);
      const classNumInt = parseInt(classNum, 10);
      if (isNaN(classNumInt) || classNumInt < 1 || classNumInt > 10) continue;
      const groupEmail = `${testPrefix}${grade}${classNum}@${domain}`;
      if (!groupMap.has(groupEmail)) {
        groupMap.set(groupEmail, []);
      }
      groupMap.get(groupEmail)!.push(student.primaryEmail);
    }

    for (const [groupEmail, members] of groupMap.entries()) {
      try {
        const pureEmail = testPrefix && groupEmail.startsWith(testPrefix) 
          ? groupEmail.substring(testPrefix.length) 
          : groupEmail;
        const classNumStr = pureEmail.substring(1, pureEmail.indexOf("@"));
        const grade = pureEmail[0];
        const classNum = parseInt(classNumStr, 10);
        const groupName = `${testPrefix ? "[테스트] " : ""}${grade}학년 ${classNum}반`;

        const exists = mockGroups.some((g) => g.email.toLowerCase() === groupEmail.toLowerCase());
        if (!exists) {
          mockGroups.push({
            id: `g_${Math.random().toString(36).substr(2, 9)}`,
            email: groupEmail,
            name: groupName,
            description: `효명고등학교 ${groupName} 학생 그룹`,
          });
          createdCount++;
        }

        mockGroupMembers[groupEmail] = members;
        membersAddedCount += members.length;
        succeededList.push({
          email: groupEmail,
          name: groupName,
          membersCount: members.length,
          status: exists ? "synced" : "created"
        });
      } catch (err: any) {
        failedList.push({
          email: groupEmail,
          reason: err.message
        });
      }
    }

    return {
      created: createdCount,
      membersAdded: membersAddedCount,
      failed: failedList.length,
      succeededList,
      failedList
    };
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

    const groupEmail = `${testPrefix}${grade}${classNum}@${domain}`;
    if (!groupMap.has(groupEmail)) {
      groupMap.set(groupEmail, []);
    }
    groupMap.get(groupEmail)!.push(student.primaryEmail);
  }

  let created = 0;
  let membersAdded = 0;
  let failed = 0;
  const succeededList: any[] = [];
  const failedList: any[] = [];

  // Google Directory API eventual consistency helper
  const addGroupMemberWithRetry = async (groupEmail: string, email: string, retries = 3, delayMs = 1500) => {
    for (let i = 0; i < retries; i++) {
      try {
        await addGroupMember(groupEmail, email);
        return;
      } catch (error: any) {
        const isNotFound = error?.code === 404 || error?.message?.includes("NotFound") || error?.message?.includes("groupKey");
        if (isNotFound && i < retries - 1) {
          console.warn(`Group ${groupEmail} not found yet when adding ${email}. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }
  };

  for (const [groupEmail, members] of groupMap.entries()) {
    try {
      const pureEmail = testPrefix && groupEmail.startsWith(testPrefix) 
        ? groupEmail.substring(testPrefix.length) 
        : groupEmail;
      const classNumStr = pureEmail.substring(1, pureEmail.indexOf("@"));
      const grade = pureEmail[0];
      const classNum = parseInt(classNumStr, 10);
      const groupName = `${testPrefix ? "[테스트] " : ""}${grade}학년 ${classNum}반`;

      let isNew = false;
      try {
        await createGroup(groupEmail, groupName, `효명고등학교 ${groupName} 학생 그룹`);
        created++;
        isNew = true;
        // Give Google a tiny headstart to propagate the new group
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (createErr: any) {
        if (createErr?.code === 409) {
          console.log(`Group ${groupEmail} already exists. Syncing members.`);
        } else {
          throw createErr;
        }
      }

      // Add all members in parallel with retry support
      const memberResults = await Promise.allSettled(
        members.map((email) => addGroupMemberWithRetry(groupEmail, email))
      );
      membersAdded += memberResults.filter((r) => r.status === "fulfilled").length;

      succeededList.push({
        email: groupEmail,
        name: groupName,
        membersCount: members.length,
        status: isNew ? "created" : "synced"
      });
    } catch (error: any) {
      console.error(`Failed to manage group ${groupEmail}`, error);
      failed++;
      failedList.push({
        email: groupEmail,
        reason: error.message || "생성 실패"
      });
    }
  }

  return { created, membersAdded, failed, succeededList, failedList };
};

// ─────────────────────────────────────────
// 12. Check if a Group is a GWS Security Group
// ─────────────────────────────────────────
export const checkIsSecurityGroup = async (groupEmail: string): Promise<boolean> => {
  const lower = groupEmail.toLowerCase();
  // 1. 이메일 패턴 기반 1차 판별 (ts@, tc@로 시작하거나 security가 포함된 경우)
  if (lower.startsWith("ts@") || lower.startsWith("tc@") || lower.includes("security")) {
    return true;
  }

  if (isMock) {
    return false;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.groups.get({
      groupKey: groupEmail,
    });
    // 2. API 응답에 labels가 존재하는 경우 대비
    const labels = (res.data as any).labels || [];
    if (labels.includes("system/groups/security")) {
      return true;
    }
    
    // 3. Name 또는 Description에 보안그룹 관련 명시가 있는 경우
    const name = (res.data.name || "").toLowerCase();
    const description = (res.data.description || "").toLowerCase();
    if (
      name.includes("보안그룹") || 
      description.includes("보안그룹") || 
      name.includes("security group") || 
      description.includes("security group")
    ) {
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error checking security status for group ${groupEmail}:`, error);
    return false;
  }
};

// ─────────────────────────────────────────
// 13. Deleted Users List & Restore
// ─────────────────────────────────────────

// Mock deleted users for test environments
const mockDeletedUsers = [
  {
    id: "deleted_1",
    primaryEmail: "del_testuser1@hmh.or.kr",
    name: { familyName: "홍", givenName: "길동" },
    orgUnitPath: "/학생/3학년",
    deletionTime: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "deleted_2",
    primaryEmail: "del_testuser2@hmh.or.kr",
    name: { familyName: "김", givenName: "영희" },
    orgUnitPath: "/교사",
    deletionTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  }
];

export const listDeletedUsers = async (domain: string) => {
  if (isMock) {
    return mockDeletedUsers.filter(u => u.primaryEmail.endsWith(`@${domain}`));
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await (admin.users.list as any)({
      customer: "my_customer",
      showDeleted: true,
      orderBy: "email",
      maxResults: 100,
    });
    
    const users = res.data.users || [];
    return users.filter((u: any) => u.primaryEmail?.endsWith(`@${domain}`));
  } catch (error) {
    console.error("Error fetching deleted users from Google Workspace", error);
    throw error;
  }
};

export const restoreDeletedUser = async (userKey: string, orgUnitPath: string) => {
  if (isMock) {
    console.log(`[Mock] Restored user: ${userKey} to ${orgUnitPath}`);
    return true;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    await admin.users.undelete({
      userKey: userKey,
      requestBody: {
        orgUnitPath: orgUnitPath,
      },
    });
    return true;
  } catch (error) {
    console.error(`Error restoring user ${userKey} from Google Workspace`, error);
    throw error;
  }
};

// ─────────────────────────────────────────
// 14. Google Classroom Course & Roster API
// ─────────────────────────────────────────

// Mock data for classroom simulation
let mockCourses: { id: string; name: string; section: string; ownerId: string; courseState?: string; creationTime?: string }[] = [
  { id: "course_1", name: "1학년 1학기 수학", section: "1반", ownerId: "teacher01@hmh.or.kr", courseState: "ACTIVE", creationTime: "2025-03-02T01:00:00.000Z" },
  { id: "course_2", name: "1학년 1학기 국어", section: "2반", ownerId: "teacher01@hmh.or.kr", courseState: "ACTIVE", creationTime: "2025-03-02T01:00:00.000Z" },
  { id: "course_3", name: "2학년 1학기 물리", section: "기초", ownerId: "teacher02@hmh.or.kr", courseState: "ACTIVE", creationTime: "2025-03-02T01:00:00.000Z" }
];

let mockCourseStudents: Record<string, string[]> = {
  "course_1": ["25001@hmh.or.kr"],
  "course_2": [],
  "course_3": ["24001@hmh.or.kr"]
};

// Helper to get Google Classroom API Client with Impersonation
export const getClassroomClient = (impersonatedEmail: string) => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses",
      "https://www.googleapis.com/auth/classroom.rosters"
    ],
    subject: impersonatedEmail // Impersonate the teacher
  });

  return google.classroom({ version: "v1", auth });
};

// Get the numeric Classroom user id for an email.
// Classroom API가 courses.list의 ownerId를 이메일이 아닌 숫자 ID로 반환하므로,
// 소유자 판정 시 이메일과 직접 비교하면 항상 불일치한다. 이 헬퍼로 숫자 ID를 얻어 비교할 것.
export const getClassroomUserId = async (email: string): Promise<string | null> => {
  if (isMock) return email;

  const classroom = getClassroomClient(email);
  if (!classroom) return null;

  try {
    const res = await classroom.userProfiles.get({ userId: "me" });
    return res.data.id || null;
  } catch (error) {
    console.error(`Error fetching classroom user profile for ${email}:`, error);
    return null;
  }
};

// List Courses owned by a specific teacher
export const listClassroomCourses = async (teacherEmail: string) => {
  if (isMock) {
    return mockCourses.filter(c => c.ownerId === teacherEmail);
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  try {
    const res = await classroom.courses.list({
      teacherId: teacherEmail,
      courseStates: ["ACTIVE"]
    });
    return res.data.courses || [];
  } catch (error) {
    console.error(`Error listing classroom courses for ${teacherEmail}:`, error);
    throw error;
  }
};

// Create a new Classroom Course
export const createClassroomCourse = async (courseName: string, sectionName: string, teacherEmail: string) => {
  if (isMock) {
    const newId = `course_${Math.random().toString(36).substr(2, 9)}`;
    const newCourse = { id: newId, name: courseName, section: sectionName, ownerId: teacherEmail };
    mockCourses.push(newCourse);
    mockCourseStudents[newId] = [];
    return newCourse;
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  try {
    const res = await classroom.courses.create({
      requestBody: {
        name: courseName,
        section: sectionName,
        ownerId: teacherEmail,
        courseState: "ACTIVE"
      }
    });
    return res.data;
  } catch (error) {
    console.error(`Error creating classroom course for ${teacherEmail}:`, error);
    throw error;
  }
};

// Add a student directly to Classroom Course Roster
// NOTE: Direct student enrollment (without enrollment code) requires a domain admin.
// Regular teacher impersonation results in 403 "The caller does not have permission".
// We impersonate the admin account so Google grants the direct-add privilege.
export const addStudentToClassroom = async (courseId: string, studentEmail: string, teacherEmail: string) => {
  if (isMock) {
    if (!mockCourseStudents[courseId]) {
      mockCourseStudents[courseId] = [];
    }
    if (!mockCourseStudents[courseId].includes(studentEmail)) {
      mockCourseStudents[courseId].push(studentEmail);
    }
    return true;
  }

  // Use admin email for impersonation — domain admins can directly add students to any course
  const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || teacherEmail;
  const classroom = getClassroomClient(adminEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  try {
    await classroom.courses.students.create({
      courseId: courseId,
      requestBody: {
        userId: studentEmail
      }
    });
    return true;
  } catch (error: any) {
    console.error(`Error adding student ${studentEmail} to course ${courseId}:`, error);
    throw error;
  }
};

// Remove a student from Classroom Course Roster
// Same admin impersonation rule applies as addStudentToClassroom
export const removeStudentFromClassroom = async (courseId: string, studentEmail: string, teacherEmail: string) => {
  if (isMock) {
    if (mockCourseStudents[courseId]) {
      mockCourseStudents[courseId] = mockCourseStudents[courseId].filter(email => email !== studentEmail);
    }
    return true;
  }

  // Use admin email for impersonation — domain admins can directly remove students from any course
  const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || teacherEmail;
  const classroom = getClassroomClient(adminEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  try {
    await classroom.courses.students.delete({
      courseId: courseId,
      userId: studentEmail
    });
    return true;
  } catch (error) {
    console.error(`Error removing student ${studentEmail} from course ${courseId}:`, error);
    throw error;
  }
};

// List students registered in a Classroom Course
export const listClassroomStudents = async (courseId: string, teacherEmail: string) => {
  if (isMock) {
    const studentEmails = mockCourseStudents[courseId] || [];
    // In mock mode, return minimal stub objects — clientCache is not accessible server-side
    return studentEmails.map(email => ({
      profile: {
        id: `mock_${email}`,
        name: {
          familyName: "학",
          givenName: "생"
        },
        emailAddress: email
      }
    }));
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  try {
    const res = await classroom.courses.students.list({
      courseId: courseId
    });
    return res.data.students || [];
  } catch (error) {
    console.error(`Error listing students for course ${courseId}:`, error);
    throw error;
  }
};


// Reset student password to the fixed temporary password.
// changePasswordAtNextLogin is set to true so the student must update immediately.
export const resetStudentPassword = async (email: string): Promise<{ tempPassword: string }> => {
  const TEMP_PASSWORD = "1234abcd!!!!";

  if (isMock) {
    // Mock mode: just return success
    return { tempPassword: TEMP_PASSWORD };
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  await admin.users.patch({
    userKey: email,
    requestBody: {
      password: TEMP_PASSWORD,
      changePasswordAtNextLogin: true,
    },
  });

  return { tempPassword: TEMP_PASSWORD };
};

// Retrieve user details from Google Workspace or mock list
export const getUser = async (email: string): Promise<any | null> => {
  if (isMock) {
    const u = mockUsers.find((x: any) => x.primaryEmail?.toLowerCase() === email.toLowerCase());
    return u || null;
  }

  const admin = getAdminClient();
  if (!admin) throw new Error("Admin client is not initialized.");

  try {
    const res = await admin.users.get({ userKey: email });
    return res.data;
  } catch (error) {
    console.error(`Error getting user ${email} from Google Workspace`, error);
    throw error;
  }
};

// ==========================================
// Phase 5.8: 학기말 클래스룸·캘린더·드라이브 일괄 정리 유틸 & 헬퍼
// ==========================================

/**
 * creationTime (ISO String) 기반 학년도(School Year) 계산 유틸
 * - M(월, KST 기준): 3~12월 -> Y학년도
 * - M: 1월 -> Y-1 학년도 (아직 진행 중인 학년도)
 * - M: 2월 -> Y 학년도 (다음 학년도 신학기 사전 준비 코스로 당겨서 간주)
 */
export const getSchoolYearFromCreationTime = (creationTime: string): number => {
  const date = new Date(creationTime);
  // Convert to KST (UTC + 9 hours)
  const kstMs = date.getTime() + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  const Y = kstDate.getUTCFullYear();
  const M = kstDate.getUTCMonth() + 1; // 1-12

  if (M >= 3 && M <= 12) {
    return Y;
  } else if (M === 1) {
    return Y - 1;
  } else {
    // M === 2
    return Y;
  }
};

/**
 * 현재 학사력 기준 현재 학년도 반환
 * - 3월~12월: 해당 연도(Y) 학년도
 * - 1월~2월: 직전 연도(Y-1) 학년도 (새 학기 3월 개학 전)
 */
export const getCurrentSchoolYear = (refDate: Date = new Date()): number => {
  const kstMs = refDate.getTime() + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  const Y = kstDate.getUTCFullYear();
  const M = kstDate.getUTCMonth() + 1;

  if (M >= 3 && M <= 12) {
    return Y;
  }
  return Y - 1;
};

/**
 * 특정 클래스룸 코스가 현재 기준 "정리 대상(과거 학년도 미보관 코스)"인지 판별
 */
export const isCleanupTargetCourse = (
  course: { creationTime?: string | null; courseState?: string | null },
  refDate: Date = new Date()
): boolean => {
  if (!course || course.courseState !== "ACTIVE" || !course.creationTime) {
    return false;
  }
  const courseSchoolYear = getSchoolYearFromCreationTime(course.creationTime);
  const currentSchoolYear = getCurrentSchoolYear(refDate);

  return courseSchoolYear < currentSchoolYear;
};

/**
 * Google Calendar API Client 생성 (도메인 위임 및 교사 사칭)
 */
export const getCalendarClient = (impersonatedEmail: string) => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject: impersonatedEmail,
  });

  return google.calendar({ version: "v3", auth });
};

/**
 * Google Drive API Client 생성 (도메인 위임 및 교사 사칭)
 */
export const getDriveClient = (impersonatedEmail: string) => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: impersonatedEmail,
  });

  return google.drive({ version: "v3", auth });
};

/**
 * 1단계 파이프라인: 클래스룸 이름 변경 (연도 접두어 추가 등)
 */
export const renameClassroomCourse = async (
  teacherEmail: string,
  courseId: string,
  newName: string
) => {
  if (isMock) {
    const c = mockCourses.find(x => x.id === courseId);
    if (c) c.name = newName;
    return { id: courseId, name: newName };
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  const res = await classroom.courses.patch({
    id: courseId,
    updateMask: "name",
    requestBody: { name: newName },
  });
  return res.data;
};

/**
 * 2단계 파이프라인: 클래스룸 보관 처리 (ARCHIVED)
 */
export const archiveClassroomCourse = async (
  teacherEmail: string,
  courseId: string
) => {
  if (isMock) {
    const c = mockCourses.find(x => x.id === courseId);
    if (c) c.courseState = "ARCHIVED";
    return { id: courseId, courseState: "ARCHIVED" };
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  const res = await classroom.courses.patch({
    id: courseId,
    updateMask: "courseState",
    requestBody: { courseState: "ARCHIVED" },
  });
  return res.data;
};

/**
 * 3단계 파이프라인: 교사 캘린더 목록에서 클래스룸 캘린더 구독 취소(삭제)
 */
export const unsubscribeClassroomCalendar = async (
  teacherEmail: string,
  calendarId: string
) => {
  if (isMock) {
    return { success: true, calendarId };
  }

  const calendar = getCalendarClient(teacherEmail);
  if (!calendar) throw new Error("Calendar client not initialized.");

  try {
    await calendar.calendarList.delete({ calendarId });
    return { success: true, calendarId };
  } catch (error: any) {
    // 이미 삭제되었거나 존재하지 않는 경우 404/410은 성공으로 취급 (idempotent)
    if (error?.code === 404 || error?.code === 410) {
      return { success: true, calendarId, alreadyUnsubscribed: true };
    }
    // 코스 소유 교사는 클래스룸 캘린더의 데이터 소유자라 Google이 구독 취소를 403으로 거부함
    // ("The data owner of a calendar cannot remove such a calendar from their calendar list.")
    // — 이 경우 숨김 처리로 폴백해 목록에서 보이지 않게 한다(복원 시 hidden: false로 되돌릴 수 있음).
    if (error?.code === 403) {
      await calendar.calendarList.patch({
        calendarId,
        requestBody: { hidden: true, selected: false },
      });
      return { success: true, calendarId, hiddenInsteadOfUnsubscribed: true };
    }
    console.error(`Error unsubscribing calendar ${calendarId} for ${teacherEmail}:`, error);
    throw error;
  }
};

/**
 * 클래스룸 원복(Restore) 시 캘린더 되돌리기:
 * - 숨김(hidden: true) 처리되었던 소유자 캘린더는 hidden: false, selected: true로 패치
 * - 구독 취소(delete)되었던 공동교사 캘린더는 calendarList.insert로 다시 추가
 */
export const restoreClassroomCalendar = async (
  teacherEmail: string,
  calendarId: string,
  hiddenInsteadOfUnsubscribed?: boolean
) => {
  if (isMock) {
    return { success: true, calendarId };
  }

  const calendar = getCalendarClient(teacherEmail);
  if (!calendar) throw new Error("Calendar client not initialized.");

  try {
    if (hiddenInsteadOfUnsubscribed) {
      await calendar.calendarList.patch({
        calendarId,
        requestBody: { hidden: false, selected: true },
      });
      return { success: true, calendarId, action: "unhidden" };
    } else {
      try {
        await calendar.calendarList.insert({
          requestBody: { id: calendarId },
        });
        return { success: true, calendarId, action: "reinserted" };
      } catch (insertErr: any) {
        // 이미 목록에 남아있는 경우 패치로 숨김해제 시도
        await calendar.calendarList.patch({
          calendarId,
          requestBody: { hidden: false, selected: true },
        });
        return { success: true, calendarId, action: "unhidden_fallback" };
      }
    }
  } catch (error: any) {
    console.error(`Error restoring calendar ${calendarId} for ${teacherEmail}:`, error);
    throw error;
  }
};

/**
 * 4단계 파이프라인: 드라이브 내 클래스룸 폴더를 아카이브(이전년도) 상위 폴더로 이동
 */
export const moveDriveFolderToArchive = async (
  teacherEmail: string,
  fileId: string,
  targetParentFolderId: string
) => {
  if (isMock) {
    return { id: fileId, parents: [targetParentFolderId], originalParentFolderId: null, alreadyMoved: false };
  }

  const drive = getDriveClient(teacherEmail);
  if (!drive) throw new Error("Drive client not initialized.");

  // 현재 parents 조회
  const fileRes = await drive.files.get({
    fileId,
    fields: "id, parents",
  });
  const existingParents = fileRes.data.parents || [];

  // idempotent 재실행 방어: 이미 목표 폴더로 이동 완료된 상태라면 재이동 시도를 건너뛴다.
  // addParents와 removeParents에 동일 ID를 동시에 넣으면 Drive API 동작이 보장되지 않아
  // 최악의 경우 폴더가 부모 없이 고아 상태가 될 수 있다.
  if (existingParents.length === 1 && existingParents[0] === targetParentFolderId) {
    return { id: fileId, parents: existingParents, originalParentFolderId: null, alreadyMoved: true };
  }

  // 원래 부모(복원 시 되돌아갈 곳)를 보존하되, 목표 폴더가 이미 부모 중 하나라면 제거 대상에서 제외한다.
  const parentsToRemove = existingParents.filter((p) => p !== targetParentFolderId);
  const originalParentFolderId = existingParents[0] || null;

  // 폴더 이동 (removeParents & addParents)
  const res = await drive.files.update({
    fileId,
    addParents: targetParentFolderId,
    removeParents: parentsToRemove.join(","),
    fields: "id, parents",
  });

  return { ...res.data, originalParentFolderId, alreadyMoved: false };
};

/**
 * 보관 처리 원복(Restore) 헬퍼: ARCHIVED -> ACTIVE 변경 및 이름 복원
 */
export const restoreClassroomCourse = async (
  teacherEmail: string,
  courseId: string,
  originalName?: string
) => {
  if (isMock) {
    const c = mockCourses.find(x => x.id === courseId);
    if (c) {
      c.courseState = "ACTIVE";
      if (originalName) c.name = originalName;
    }
    return { id: courseId, courseState: "ACTIVE", name: originalName };
  }

  const classroom = getClassroomClient(teacherEmail);
  if (!classroom) throw new Error("Classroom client not initialized.");

  const requestBody: any = { courseState: "ACTIVE" };
  let updateMask = "courseState";

  if (originalName) {
    requestBody.name = originalName;
    updateMask += ",name";
  }

  const res = await classroom.courses.patch({
    id: courseId,
    updateMask,
    requestBody,
  });

  return res.data;
};

/**
 * 드라이브 상위 아카이브 폴더("이전년도 클래스룸/<schoolYear>학년도") 자동 찾기 및 생성 헬퍼
 */
export const findOrCreateArchiveFolder = async (
  teacherEmail: string,
  schoolYear: number
): Promise<string> => {
  if (isMock) {
    return `mock_archive_folder_${schoolYear}`;
  }

  const drive = getDriveClient(teacherEmail);
  if (!drive) throw new Error("Drive client not initialized.");

  // 1. "이전년도 클래스룸" 루트 폴더 찾기/생성
  const rootFolderName = "이전년도 클래스룸";
  const rootRes = await drive.files.list({
    q: `name = '${rootFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
  });

  let rootFolderId: string;
  if (rootRes.data.files && rootRes.data.files.length > 0) {
    rootFolderId = rootRes.data.files[0].id!;
  } else {
    const createRootRes = await drive.files.create({
      requestBody: {
        name: rootFolderName,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    rootFolderId = createRootRes.data.id!;
  }

  // 2. "이전년도 클래스룸/<schoolYear>학년도" 하위 폴더 찾기/생성
  const subFolderName = `${schoolYear}학년도`;
  const subRes = await drive.files.list({
    q: `'${rootFolderId}' in parents and name = '${subFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
  });

  let subFolderId: string;
  if (subRes.data.files && subRes.data.files.length > 0) {
    subFolderId = subRes.data.files[0].id!;
  } else {
    const createSubRes = await drive.files.create({
      requestBody: {
        name: subFolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolderId],
      },
      fields: "id",
    });
    subFolderId = createSubRes.data.id!;
  }

  return subFolderId;
};

