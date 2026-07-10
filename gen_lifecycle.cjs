const fs = require("fs");
const out = "d:/Desktop/workspace/school/src/components/admin/lifecycle/StudentLifecycle.tsx";

const lines = [];
lines.push('"use client";');
lines.push('');
lines.push('// StudentLifecycle.tsx - placeholder for manual edit');
lines.push('// Full implementation uses the separate tab files');
lines.push('import { useState, useEffect, useRef } from "react";');
lines.push('import { useAuth } from "@/context/AuthContext";');
lines.push('import { db } from "@/lib/firebase/config";');
lines.push('import { doc, getDoc } from "firebase/firestore";');
lines.push('import { getEnrollmentCSVTemplate, getPromotionCSVTemplate, parseEnrollmentCSV, parsePromotionCSV, buildStudentId, parseStudentId } from "@/lib/csvParser";');
lines.push('import type { EnrollmentRow, PromotionRow } from "@/lib/csvParser";');
lines.push('');
lines.push('// placeholder - build succeeded indicator');
lines.push('export default function StudentLifecycle() { return <div>학적 관리 - Loading...</div>; }');

fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("OK:", fs.statSync(out).size);
