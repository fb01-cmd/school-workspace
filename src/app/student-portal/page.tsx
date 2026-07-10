"use client";

import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";

export default function StudentPortal() {
  const { userData } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logOut();
    router.push("/login");
  };

  return (
    <RouteGuard allowedRoles={["student"]}>
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6 flex justify-between items-center mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">학생 포털</h1>
              <p className="text-gray-600 mt-1">환영합니다, {userData?.email} 학생!</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md transition-colors"
            >
              로그아웃
            </button>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">학생 서비스</h2>
            <p className="text-gray-600">이곳에서 교육과정 선택 결과 조회 등 학생 전용 서비스를 이용할 수 있습니다.</p>
            {/* Future features go here */}
          </div>
        </div>
      </div>
    </RouteGuard>
  );
}
