"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function RouteGuard({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: Array<"student" | "teacher" | "super_admin">;
}) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user || !userData) {
        router.replace("/login");
      } else if (!allowedRoles.includes(userData.role)) {
        // Redirect to appropriate portal based on actual role
        if (userData.role === "student") {
          router.replace("/student-portal");
        } else {
          router.replace("/admin");
        }
      }
    }
  }, [user, userData, loading, allowedRoles, router]);

  if (loading || !user || !userData || !allowedRoles.includes(userData.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">인증 확인 중...</p>
      </div>
    );
  }

  return <>{children}</>;
}
