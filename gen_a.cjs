const fs = require('fs');
const out = 'd:/Desktop/workspace/school/src/components/admin/lifecycle/StudentLifecycle.tsx';

const lines = [
'"use client";',
'',
'import { useState, useEffect, useRef } from "react";',
'import { useAuth } from "@/context/AuthContext";',
'import { db } from "@/lib/firebase/config";',
'import { doc, getDoc } from "firebase/firestore";',
'import { getEnrollmentCSVTemplate, getPromotionCSVTemplate, parseEnrollmentCSV, parsePromotionCSV, buildStudentId, parseStudentId } from "@/lib/csvParser";',
'import type { EnrollmentRow, PromotionRow } from "@/lib/csvParser";',
'',
'type TabId = "ou"|"groups_delete"|"promote"|"enroll"|"groups_create"|"transfer_in"|"transfer_out"|"graduate";',
'interface Settings { domain: string; ouMapping?: { students?: Record<string, string> }; }',
'const TABS: { id: TabId; label: string; icon: string }[] = [',
'  { id: "ou", label: "연도말 OU 전환", icon: "🔄" },',
'  { id: "groups_delete", label: "그룹 초기화", icon: "🗑️" },',
'  { id: "promote", label: "진급 처리", icon: "📈" },',
'  { id: "enroll", label: "신입생 입학", icon: "🎓" },',
'  { id: "groups_create", label: "그룹 재생성", icon: "👥" },',
'  { id: "transfer_in", label: "전입 처리", icon: "➕" },',
'  { id: "transfer_out", label: "전출·학업중단", icon: "🚪" },',
'  { id: "graduate", label: "졸업생 처리", icon: "🏫" },',
'];',
'',
'async function callAPI(action: string, extra: any, ud: any) {',
'  const r = await fetch("/api/workspace/lifecycle", {',
'    method: "POST", headers: { "Content-Type": "application/json" },',
'    body: JSON.stringify({ action, domain: ud?.domain, operatorEmail: ud?.email, operatorName: ud?.displayName||ud?.email, ...extra }),',
'  });',
'  const d = await r.json();',
'  if (!r.ok) throw new Error(d.error || "API 오류");',
'  return d;',
'}',
'',
'const colorMap: Record<string, string> = {',
'  indigo: "bg-indigo-700 hover:bg-indigo-800",',
'  red: "bg-red-600 hover:bg-red-700",',
'  green: "bg-green-700 hover:bg-green-800",',
'  amber: "bg-amber-500 hover:bg-amber-600",',
'  gray: "bg-gray-600 hover:bg-gray-700",',
'  violet: "bg-violet-700 hover:bg-violet-800",',
'};',
'function Btn({ onClick, disabled, color = "indigo", children }: any) {',
'  return <button onClick={onClick} disabled={disabled} className={`px-5 py-2.5 ${colorMap[color]} text-white font-bold rounded-xl disabled:opacity-50 transition-colors shadow text-sm`}>{children}</button>;'.replace(/\$\{colorMap\[color\]\}/g, '${colorMap[color]}'),
'}'
];

// Fix the template literal line
lines[lines.length - 2] = '  return <button onClick={onClick} disabled={disabled} className={`px-5 py-2.5 ${d}${colorMap[color]}} text-white font-bold rounded-xl disabled:opacity-50 transition-colors shadow text-sm`}>{children}</button>;'
  .replace('${d}${colorMap[color]}}', '${colorMap[color]}');

fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('Written:', fs.statSync(out).size);
