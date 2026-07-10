import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

/**
 * Server-side endpoint to check if a given email is a Super Admin
 * in the connected Google Workspace.
 *
 * In mock mode (no credentials), always returns isMock: true and isAdmin: false.
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const hasCredentials =
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;

  if (!hasCredentials) {
    // Mock mode: cannot determine admin status without real credentials
    return NextResponse.json({ isAdmin: false, isMock: true });
  }

  try {
    const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
      subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
    });

    const admin = google.admin({ version: "directory_v1", auth });

    const res = await admin.users.get({
      userKey: email,
      projection: "basic",
    });

    const isAdmin = res.data.isAdmin === true;

    return NextResponse.json({ isAdmin, isMock: false });
  } catch (error: any) {
    console.error("Failed to check admin status from Google Workspace:", error.message);
    // On API errors (e.g., user not in workspace), treat as non-admin
    return NextResponse.json({ isAdmin: false, isMock: false, error: error.message });
  }
}
