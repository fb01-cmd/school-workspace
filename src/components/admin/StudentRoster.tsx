"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { getClientCache } from "@/lib/cache/clientCache";

interface GoogleUser {
  id: string;
  primaryEmail: string;
  name: {
    familyName: string;
    givenName: string;
  };
  orgUnitPath: string;
  suspended: boolean;
}

interface ParsedStudent {
  id: string;
  email: string;
  name: string;
  familyName: string;
  givenName: string;
  grade: number;      // e.g. 1
  classNum: number;   // e.g. 1
  studentNum: number; // e.g. 1
  rawStudentId: string; // "10101"
  isParsed: boolean;
  suspended: boolean;
}

export default function StudentRoster() {
  const { userData, schoolSettings } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false); // Only render sheet after clicking "Search/View"
  const [students, setStudents] = useState<ParsedStudent[]>([]);
  
  // Roster view filters - Default to 1st Grade, 1st Class to prevent loading all
  const [selectedGrade, setSelectedGrade] = useState<string>("1");
  const [selectedClass, setSelectedClass] = useState<string>("1");

  // Toggle for showing Email Column
  const [showEmail, setShowEmail] = useState(false);

  // Dynamic Custom Columns (Defaulted with "비고" column)
  const [customColumns, setCustomColumns] = useState<{ id: string; title: string }[]>([
    { id: "note", title: "비고" }
  ]);
  
  // Custom Cell Data Store: { [studentId_columnId]: text }
  const [cellData, setCellData] = useState<{ [key: string]: string }>({});

  // Column widths state for ALL columns to allow full drag resizing
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: number }>({
    studentId: 70,
    name: 85,
    email: 160,
    note: 200,
  });

  const domain = userData?.domain || "";

  // Load students based on configuration in Firebase Firestore
  const loadStudents = async () => {
    if (!domain) return;
    setLoading(true);
    setHasSearched(true);
    try {
      let orgUnitPaths: string[] = ["/students"]; // Fallback default
      if (schoolSettings) {
        const studOUs = schoolSettings.ouMapping?.students || {};
        const paths = Object.values(studOUs) as string[];
        if (paths.length > 0) {
          orgUnitPaths = paths;
        }
      }

      // 캐시 우선 조회
      let rawUsers: GoogleUser[] = [];
      const cachedAllUsers = getClientCache("users:all");
      if (cachedAllUsers) {
        rawUsers = cachedAllUsers.filter((u: any) => orgUnitPaths.includes(u.orgUnitPath));
      } else {
        const res = await fetch("/api/workspace/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "list",
            orgUnitPaths: orgUnitPaths,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          rawUsers = data.users || [];
        }
      }

      // Parse student info from familyName
        const parsed: ParsedStudent[] = rawUsers.map((u) => {
          const familyName = u.name.familyName || "";
          const givenName = u.name.givenName || "";
          
          // Regex match: e.g. 10101 (5 digits) -> Grade 1, Class 01, Number 01
          const match = familyName.trim().match(/^(\d)(\d{2})(\d{2})$/);
          
          if (match) {
            return {
              id: u.id,
              email: u.primaryEmail,
              name: givenName.trim(), // Extracted givenName strictly so that familyName (student num) is not prefixed
              familyName,
              givenName,
              grade: parseInt(match[1]),
              classNum: parseInt(match[2]),
              studentNum: parseInt(match[3]),
              rawStudentId: familyName.trim(),
              isParsed: true,
              suspended: u.suspended,
            };
          } else {
            // Fallback for students with unformatted familyName
            return {
              id: u.id,
              email: u.primaryEmail,
              name: `${familyName}${givenName}`.trim(),
              familyName,
              givenName,
              grade: 0,
              classNum: 0,
              studentNum: 99,
              rawStudentId: familyName,
              isParsed: false,
              suspended: u.suspended,
            };
          }
        });

        setStudents(parsed);
    } catch (error: any) {
      console.error(error);
      alert(`명렬표 로드 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Compute list of available classes in local state (from settings config first, fallback to scanning)
  const availableClasses = useMemo(() => {
    const config = schoolSettings?.classCounts || {};
    // 1. If settings classCounts has configuration for selected grade, use it directly
    if (selectedGrade !== "all" && config[selectedGrade]) {
      const count = config[selectedGrade];
      return Array.from({ length: count }, (_, i) => i + 1);
    }

    // 2. If grade is "all", compute maximum class count across all configured grades, or default to 10
    if (selectedGrade === "all") {
      const counts = Object.values(config);
      const maxCount = counts.length > 0 ? Math.max(...counts) : 10;
      return Array.from({ length: maxCount }, (_, i) => i + 1);
    }

    // 3. Fallback scan if no settings are available
    if (students.length === 0) {
      return Array.from({ length: 10 }, (_, i) => i + 1); // Fallback to 10 classes
    }
    const targetStudents = selectedGrade === "all" 
      ? students 
      : students.filter((s) => s.grade === parseInt(selectedGrade));
    
    const classes = targetStudents
      .filter((s) => s.isParsed && s.classNum > 0)
      .map((s) => s.classNum);
    
    const uniqueClasses = Array.from(new Set(classes)).sort((a, b) => a - b);
    return uniqueClasses.length > 0 ? uniqueClasses : Array.from({ length: 10 }, (_, i) => i + 1);
  }, [students, selectedGrade, schoolSettings?.classCounts]);

  // Filter students based on selection controls
  const filteredStudents = useMemo(() => {
    if (!hasSearched) return [];
    
    let result = [...students];
    
    if (selectedGrade !== "all") {
      result = result.filter((s) => s.grade === parseInt(selectedGrade));
    }
    
    if (selectedClass !== "all") {
      result = result.filter((s) => s.classNum === parseInt(selectedClass));
    }

    // Sort by Grade asc, Class asc, Student Number asc
    return result.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.classNum !== b.classNum) return a.classNum - b.classNum;
      return a.studentNum - b.studentNum;
    });
  }, [students, selectedGrade, selectedClass, hasSearched]);

  // Group filtered students by Grade and Class dynamically
  const studentGroups = useMemo(() => {
    if (!hasSearched || filteredStudents.length === 0) return [];

    const groups: { [key: string]: ParsedStudent[] } = {};
    filteredStudents.forEach((student) => {
      // Create a unique key for each class e.g. "1-1", "1-2"
      const key = `${student.grade}-${student.classNum}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(student);
    });

    // Sort keys logically by grade then by classNum
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const [aGrade, aClass] = a.split("-").map(Number);
      const [bGrade, bClass] = b.split("-").map(Number);
      if (aGrade !== bGrade) return aGrade - bGrade;
      return aClass - bClass;
    });

    return sortedKeys.map((key) => {
      const [grade, classNum] = key.split("-").map(Number);
      return {
        key,
        grade,
        classNum,
        list: groups[key],
      };
    });
  }, [filteredStudents, hasSearched]);

  // Compute exact total table width in pixels to force hard lock layout
  const totalTableWidth = useMemo(() => {
    let width = columnWidths.studentId + columnWidths.name;
    if (showEmail) width += columnWidths.email;
    customColumns.forEach((col) => {
      width += columnWidths[col.id] || 120;
    });
    return width;
  }, [columnWidths, showEmail, customColumns]);

  // Add a new empty custom column
  const handleAddColumn = () => {
    const colName = prompt("추가할 명렬표 열의 이름을 입력해 주세요. (예: 1차 평가, 서명란, 과제제출)");
    if (!colName || !colName.trim()) return;

    // Check if adding this column (default 120px) exceeds A4 limit (710px)
    const currentTotal = totalTableWidth;
    if (currentTotal + 120 > 710) {
      alert("A4 인쇄 용지 폭 한계(710px)를 초과하여 더 이상 열을 추가할 수 없습니다. 기존 열 너비를 드래그해서 줄이거나 이메일 열을 감춰주세요.");
      return;
    }

    const newColId = `col_${Date.now()}`;
    setCustomColumns((prev) => [...prev, { id: newColId, title: colName.trim() }]);
    setColumnWidths((prev) => ({ ...prev, [newColId]: 120 }));
  };

  // Edit custom column title
  const handleEditColumnTitle = (colId: string, currentTitle: string) => {
    const newTitle = prompt("수정할 열 이름을 입력해 주세요:", currentTitle);
    if (!newTitle || !newTitle.trim()) return;

    setCustomColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, title: newTitle.trim() } : c))
    );
  };

  // Delete a custom column
  const handleDeleteColumn = (colId: string) => {
    if (confirm("이 열을 명렬표에서 삭제하시겠습니까? 셀에 작성된 내용도 사라집니다.")) {
      setCustomColumns((prev) => prev.filter((c) => c.id !== colId));
      
      // Cleanup cell data
      setCellData((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.endsWith(`_${colId}`)) {
            delete next[key];
          }
        });
        return next;
      });

      // Cleanup widths
      setColumnWidths((prev) => {
        const next = { ...prev };
        delete next[colId];
        return next;
      });
    }
  };

  // Handle value change inside custom cells
  const handleCellChange = (studentId: string, colId: string, value: string) => {
    setCellData((prev) => ({
      ...prev,
      [`${studentId}_${colId}`]: value,
    }));
  };

  // Handle Drag Resizing
  const activeResizeColId = useRef<string | null>(null);
  const activeNextResizeColId = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);
  const startWidthNext = useRef<number>(0);

  const handleMouseDown = (e: React.MouseEvent, colId: string) => {
    // Identify active columns array list to trace neighboring columns
    const activeCols = ["studentId", "name"];
    if (showEmail) activeCols.push("email");
    customColumns.forEach((c) => activeCols.push(c.id));

    const idx = activeCols.indexOf(colId);
    const nextColId = idx !== -1 && idx < activeCols.length - 1 ? activeCols[idx + 1] : null;

    activeResizeColId.current = colId;
    activeNextResizeColId.current = nextColId;
    startX.current = e.clientX;
    startWidth.current = columnWidths[colId] || 120;
    startWidthNext.current = nextColId ? (columnWidths[nextColId] || 120) : 0;
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!activeResizeColId.current) return;
    const deltaX = e.clientX - startX.current;
    const colA = activeResizeColId.current;
    const colB = activeNextResizeColId.current;

    const maxPrintableWidth = 710; // Hard ceiling for standard A4 printable area

    // Prepare temp clone of width dictionary to test total width bounds
    const nextWidths = { ...columnWidths };

    if (colB) {
      // 1. If neighbor B exists: Exchange widths between A and B to maintain overall sum constraint
      // Both columns must preserve a minimum width of 35px
      const maxDeltaX = startWidthNext.current - 35; // A can grow at most until B reaches 35px
      const minDeltaX = 35 - startWidth.current;     // A can shrink at most until A reaches 35px
      
      const constrainedDeltaX = Math.min(maxDeltaX, Math.max(minDeltaX, deltaX));
      
      nextWidths[colA] = startWidth.current + constrainedDeltaX;
      nextWidths[colB] = startWidthNext.current - constrainedDeltaX;
    } else {
      // 2. If A is the last custom column: Expand table width up to A4 printable ceiling (710px)
      let otherColsWidth = 0;
      const activeColsList = ["studentId", "name"];
      if (showEmail) activeColsList.push("email");
      customColumns.forEach((c) => {
        if (c.id !== colA) {
          otherColsWidth += columnWidths[c.id] || 120;
        }
      });
      
      const maxAllowedWidth = maxPrintableWidth - otherColsWidth;
      const nextWidth = Math.min(
        maxAllowedWidth,
        Math.max(35, startWidth.current + deltaX)
      );
      
      nextWidths[colA] = nextWidth;
    }

    // Double check: Calculate the temporary new total width
    let tempTotalWidth = nextWidths.studentId + nextWidths.name;
    if (showEmail) tempTotalWidth += nextWidths.email;
    customColumns.forEach((col) => {
      tempTotalWidth += nextWidths[col.id] || 120;
    });

    // Guard: Only commit state changes if the resulting table sum remains inside the A4 paper width limit
    if (tempTotalWidth <= maxPrintableWidth) {
      setColumnWidths(nextWidths);
    }
  };

  const handleMouseUp = () => {
    activeResizeColId.current = null;
    activeNextResizeColId.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // Trigger Print Dialog
  const handlePrint = () => {
    window.print();
  };

  // Export to Excel / CSV with UTF-8 BOM
  const handleExportToExcel = () => {
    if (!hasSearched || filteredStudents.length === 0) {
      alert("조회된 명단 데이터가 없습니다. 먼저 [명렬표 조회] 버튼을 눌러주세요.");
      return;
    }

    // Prepare CSV headers
    const headers = ["학번", "성명"];
    if (showEmail) headers.push("이메일");
    customColumns.forEach((col) => headers.push(col.title));

    // Prepare CSV rows
    const rows = filteredStudents.map((student) => {
      const rowData = [
        student.isParsed ? student.rawStudentId : "-",
        student.name
      ];
      if (showEmail) rowData.push(student.email);
      customColumns.forEach((col) => {
        const cellKey = `${student.id}_${col.id}`;
        rowData.push(cellData[cellKey] || "");
      });
      // Escape commas & wrap values in double quotes
      return rowData.map(val => `"${val.replace(/"/g, '""')}"`).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    
    // Add UTF-8 BOM (\uFEFF) to prevent Korean letters from getting scrambled in Excel
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    // File name formatting
    const gradeText = selectedGrade !== "all" ? `${selectedGrade}학년_` : "전체학년_";
    const classText = selectedClass !== "all" ? (selectedClass === "0" ? "학번미지정_" : `${selectedClass}반_`) : "";
    
    link.setAttribute("href", url);
    link.setAttribute("download", `명렬표_${gradeText}${classText}${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Settings Panel: Hides completely during print */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">📋 학급 명렬표 인쇄 & 관리</h2>
            <p className="text-slate-500 text-xs mt-1">
              학년과 학반을 선택하고 명렬표 조회 버튼을 클릭하여 학생 목록을 로드할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleAddColumn}
              disabled={loading || !hasSearched}
              className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md transition-colors disabled:opacity-50"
            >
              ➕ 열 추가
            </button>
            <button
              onClick={handleExportToExcel}
              disabled={loading || !hasSearched || filteredStudents.length === 0}
              className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2 rounded-md transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              title="구글 스프레드시트 및 엑셀에서 바로 쓸 수 있는 CSV 다운로드 (BOM포함)"
            >
              🟢 엑셀(CSV) 다운로드
            </button>
            <button
              onClick={handlePrint}
              disabled={loading || !hasSearched || filteredStudents.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-md transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              🖨️ 명렬표 바로 프린트
            </button>
          </div>
        </div>

        {/* Filter & Trigger Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">학년</label>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="all">전체 학년</option>
              {Array.from({ length: schoolSettings?.gradesCount || 3 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}학년
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">학반 (학급)</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="all">전체 학반</option>
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}반
                </option>
              ))}
              {students.some((s) => !s.isParsed) && (
                <option value="0">학번 미지정 학생</option>
              )}
            </select>
          </div>

          {/* Email View Option Toggler */}
          <div className="flex items-center gap-2 pb-2.5 justify-center sm:justify-start">
            <input
              type="checkbox"
              id="showEmailCheckbox"
              checked={showEmail}
              onChange={(e) => setShowEmail(e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            />
            <label htmlFor="showEmailCheckbox" className="text-xs text-slate-700 font-semibold cursor-pointer select-none">
              구글 이메일 열 표시하기
            </label>
          </div>

          {/* Search Trigger Button */}
          <div>
            <button
              onClick={loadStudents}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2.5 px-4 rounded-md transition-colors shadow-sm flex items-center justify-center gap-1.5"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>조회 중...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>명렬표 조회</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Roster Sheet Preview Container */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-8 print-container">
        {!hasSearched ? (
          <div className="py-24 text-center text-slate-400">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm font-semibold text-slate-500">출력할 학년과 학급을 선택한 후 [명렬표 조회] 버튼을 눌러주세요.</p>
            <p className="text-xs text-slate-400 mt-1">대량 조회를 방지하여 로딩 성능을 최적화합니다.</p>
          </div>
        ) : studentGroups.length === 0 ? (
          <div className="py-24 text-center text-slate-400">
            조회된 학생 데이터가 없습니다.
          </div>
        ) : (
          <>
            {/* Premium Guide Tip Banner for Column Edits and Resizing (Hides in print) */}
            <div className="no-print mb-6 bg-indigo-50 border border-indigo-100 rounded-lg p-3.5 flex items-start gap-2.5 animate-fade-in">
              <span className="text-lg leading-none mt-0.5">💡</span>
              <div className="text-xs text-indigo-950 leading-relaxed">
                <p className="font-bold">스마트 명렬표 편집 팁</p>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-indigo-800">
                  <li><strong>열 너비 조정:</strong> 헤더 경계선에 마우스를 올리면 나타나는 파란색 구분선을 드래그(<span className="font-mono">↔</span>)하여 간격을 조정합니다.</li>
                  <li><strong>비고/열 이름 수정:</strong> 열 이름(예: 비고 ✏️)을 <strong>더블클릭</strong>하면 원하는 한글 제목으로 변경할 수 있습니다.</li>
                  <li><strong>학반별 페이지 분할 인쇄:</strong> 여러 학반을 한 번에 인쇄할 때, **각 반별로 페이지가 자동으로 나뉘어 깔끔하게 인쇄**됩니다.</li>
                </ul>
              </div>
            </div>

            {/* Loop through each student group (segmented by Grade & ClassNum) */}
            {studentGroups.map((group, groupIdx) => (
              <div 
                key={group.key}
                className={`print-section ${groupIdx > 0 ? "page-break" : ""}`}
              >
                {/* Printable Header - Unique for each grade/class section */}
                <div className="text-center mb-6 print-header group-header animate-fade-in">
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                    {group.grade}학년 {group.classNum === 0 ? "학번 미지정" : `${group.classNum}반`} 학생 명렬표
                  </h1>
                  <p className="text-slate-400 text-[10px] mt-1 print-date font-mono">
                    출력일: {new Date().toLocaleDateString("ko-KR")} | 총원: {group.list.length}명
                  </p>
                </div>

                {/* Printable Grid Table */}
                <div className="overflow-x-auto custom-print-scroll-container mb-12 print-mb-0">
                  <table 
                    style={{ width: `${totalTableWidth}px` }}
                    className="text-xs print-table table-layout-fixed-custom"
                  >
                    {/* Colgroup element to strictly lock down exact pixel widths */}
                    <colgroup>
                      <col style={{ width: `${columnWidths.studentId}px` }} />
                      <col style={{ width: `${columnWidths.name}px` }} />
                      {showEmail && <col style={{ width: `${columnWidths.email}px` }} />}
                      {customColumns.map((col) => (
                        <col key={col.id} style={{ width: `${columnWidths[col.id] || 120}px` }} />
                      ))}
                    </colgroup>

                    <thead className="text-slate-900 font-bold border border-slate-300">
                      <tr className="print-border-t">
                        {/* ID Header */}
                        <th 
                          style={{
                            width: `${columnWidths.studentId}px`,
                            minWidth: `${columnWidths.studentId}px`,
                            maxWidth: `${columnWidths.studentId}px`,
                          }}
                          className="px-2 py-2 text-center bg-slate-100 border border-slate-300 relative col-studentId font-bold group"
                        >
                          학번
                          <div className="no-print absolute right-0 top-1/4 h-1/2 w-[1px] bg-slate-300 group-hover:bg-indigo-300 transition-colors"></div>
                          <div
                            onMouseDown={(e) => handleMouseDown(e, "studentId")}
                            className="no-print absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-600/50 transition-colors z-10"
                            title="드래그하여 학번 열 너비 조절"
                          />
                        </th>

                        {/* Name Header */}
                        <th 
                          style={{
                            width: `${columnWidths.name}px`,
                            minWidth: `${columnWidths.name}px`,
                            maxWidth: `${columnWidths.name}px`,
                          }}
                          className="px-2 py-2 text-center bg-slate-100 border border-slate-300 relative col-name font-bold group"
                        >
                          성명
                          <div className="no-print absolute right-0 top-1/4 h-1/2 w-[1px] bg-slate-300 group-hover:bg-indigo-300 transition-colors"></div>
                          <div
                            onMouseDown={(e) => handleMouseDown(e, "name")}
                            className="no-print absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-600/50 transition-colors z-10"
                            title="드래그하여 성명 열 너비 조절"
                          />
                        </th>
                        
                        {/* Email Column if toggled */}
                        {showEmail && (
                          <th 
                            style={{
                              width: `${columnWidths.email}px`,
                              minWidth: `${columnWidths.email}px`,
                              maxWidth: `${columnWidths.email}px`,
                            }}
                            className="px-2 py-2 text-center bg-slate-100 border border-slate-300 relative col-email font-bold group"
                          >
                            이메일
                            <div className="no-print absolute right-0 top-1/4 h-1/2 w-[1px] bg-slate-300 group-hover:bg-indigo-300 transition-colors"></div>
                            <div
                              onMouseDown={(e) => handleMouseDown(e, "email")}
                              className="no-print absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-600/50 transition-colors z-10"
                              title="드래그하여 이메일 열 너비 조절"
                            />
                          </th>
                        )}
                        
                        {/* Custom column headers */}
                        {customColumns.map((col) => (
                          <th
                            key={col.id}
                            style={{
                              width: `${columnWidths[col.id] || 120}px`,
                              minWidth: `${columnWidths[col.id] || 120}px`,
                              maxWidth: `${columnWidths[col.id] || 120}px`,
                            }}
                            className="px-2 py-2 text-center bg-slate-100 border border-slate-300 relative group font-bold"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span
                                onDoubleClick={() => handleEditColumnTitle(col.id, col.title)}
                                className="cursor-pointer hover:underline title-editable"
                                title="더블클릭하여 제목 수정 가능"
                              >
                                {col.title}
                              </span>
                              <span 
                                className="no-print text-slate-400 text-[10px] select-none cursor-pointer" 
                                title="더블클릭하여 수정" 
                                onClick={() => handleEditColumnTitle(col.id, col.title)}
                              >
                                ✏️
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteColumn(col.id)}
                              className="no-print absolute top-1 right-1 text-slate-300 hover:text-rose-600 hidden group-hover:block transition-colors"
                              title="열 삭제"
                            >
                              ✕
                            </button>
                            <div className="no-print absolute right-0 top-1/4 h-1/2 w-[1px] bg-slate-300 group-hover:bg-indigo-300 transition-colors"></div>
                            <div
                              onMouseDown={(e) => handleMouseDown(e, col.id)}
                              className="no-print absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-600/50 transition-colors z-10"
                              title="드래그하여 열 너비 조절"
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {group.list.map((student) => {
                        return (
                          <tr
                            key={student.id}
                            className={`hover:bg-slate-50/50 ${
                              student.suspended ? "bg-rose-50/40 text-slate-400 line-through print-suspended" : "text-slate-800"
                            }`}
                          >
                            {/* Raw Student ID (e.g. 10101) */}
                            <td 
                              style={{
                                width: `${columnWidths.studentId}px`,
                                minWidth: `${columnWidths.studentId}px`,
                                maxWidth: `${columnWidths.studentId}px`,
                              }}
                              className="px-2 py-1.5 text-center border border-slate-300 font-mono text-slate-700 col-studentId"
                            >
                              {student.isParsed ? student.rawStudentId : "-"}
                            </td>

                            {/* Student Name */}
                            <td 
                              style={{
                                width: `${columnWidths.name}px`,
                                minWidth: `${columnWidths.name}px`,
                                maxWidth: `${columnWidths.name}px`,
                              }}
                              className="px-2 py-1.5 text-center border border-slate-300 font-semibold text-slate-900 col-name"
                            >
                              {student.name}
                              {student.suspended && <span className="text-[9px] text-rose-500 ml-1 no-print">(정지)</span>}
                            </td>

                            {/* Optional Student Email */}
                            {showEmail && (
                              <td 
                                style={{
                                  width: `${columnWidths.email}px`,
                                  minWidth: `${columnWidths.email}px`,
                                  maxWidth: `${columnWidths.email}px`,
                                }}
                                className="px-2 py-1.5 text-center border border-slate-300 font-mono text-slate-500 col-email"
                              >
                                {student.email}
                              </td>
                            )}

                            {/* Custom column input cells */}
                            {customColumns.map((col) => {
                              const cellKey = `${student.id}_${col.id}`;
                              return (
                                <td
                                  key={col.id}
                                  style={{
                                    width: `${columnWidths[col.id] || 120}px`,
                                    minWidth: `${columnWidths[col.id] || 120}px`,
                                    maxWidth: `${columnWidths[col.id] || 120}px`,
                                  }}
                                  className="px-1 py-1 border border-slate-300 text-center"
                                >
                                  <input
                                    type="text"
                                    value={cellData[cellKey] || ""}
                                    onChange={(e) => handleCellChange(student.id, col.id, e.target.value)}
                                    placeholder="입력..."
                                    className="w-full text-center bg-transparent border-0 outline-none p-1 text-xs focus:bg-indigo-50/50 rounded transition-colors placeholder-slate-200 no-print"
                                  />
                                  {/* Static print representation of user input value */}
                                  <span className="print-only text-center block w-full font-mono text-xs">
                                    {cellData[cellKey] || ""}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Global CSS style block to ensure print behavior looks premium and works perfectly */}
      <style jsx global>{`
        /* Table Layout Styling */
        .table-layout-fixed-custom {
          table-layout: fixed !important;
          border-collapse: collapse !important;
        }

        /* Screen View explicit border rendering */
        .print-table {
          border-collapse: collapse !important;
          border: 1px solid #cbd5e1 !important;
        }
        
        .print-table th,
        .print-table td {
          border: 1px solid #cbd5e1 !important;
        }

        @media print {
          /* Hide sidebar, topnav and filters */
          .no-print,
          aside,
          header,
          nav,
          button,
          .no-print-toolbar,
          input#showEmailCheckbox,
          label[for="showEmailCheckbox"] {
            display: none !important;
          }
          
          /* Full page print layout adjustments */
          body, html, main {
            background: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }

          .max-w-6xl {
            max-w-full !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Force page break before each class group section */
          .page-break {
            break-before: page !important;
            page-break-before: always !important;
          }

          .print-section {
            /* REMOVED: page-break-inside: avoid; to prevent clipping/truncation of multi-page classes (e.g. 9th & 10th grade boundaries) */
          }

          .group-header {
            margin-top: 10mm !important;
          }

          .print-mb-0 {
            margin-bottom: 0 !important;
          }

          /* Hide ALL scrollbars strictly during print rendering */
          .custom-print-scroll-container {
            overflow: visible !important;
            overflow-x: visible !important;
            overflow-y: visible !important;
          }

          .overflow-x-auto {
            overflow: visible !important;
            overflow-x: visible !important;
            overflow-y: visible !important;
          }

          ::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
          }

          /* Printable container styling: Restores top/bottom/left/right page margins beautifully */
          .print-container {
            border: none !important;
            box-shadow: none !important;
            padding: 10mm 15mm 15mm 15mm !important; /* Retain A4 standard print margin (15mm left/right) */
            margin: 0 auto !important;
            overflow: visible !important;
          }

          .print-header {
            margin-top: 5mm;
            margin-bottom: 5mm;
          }

          /* Force exact print width for Student ID & Name to save maximum space */
          .col-studentId {
            width: 60px !important;
            min-width: 60px !important;
            max-width: 60px !important;
          }
          .col-name {
            width: 75px !important;
            min-width: 75px !important;
            max-width: 75px !important;
          }
          .col-email {
            width: 150px !important;
            min-width: 150px !important;
            max-width: 150px !important;
          }

          /* Ensure table prints beautifully with standard border lines */
          .print-table {
            border-collapse: collapse !important;
            border: 1px solid #000 !important;
            border-top: 2.0px solid #000 !important;
            overflow: visible !important;
            margin: 0 auto !important; /* Centered layout for smaller table configurations */
          }

          .print-table th, 
          .print-table td {
            border: 1px solid #000 !important;
            padding: 4px 6px !important;
            color: #000 !important;
            background-color: transparent !important; /* Prevent Chrome background fills from erasing borders */
          }
          
          /* Force bold print borders strictly on headers including top lines and cell spacing */
          .print-table thead th {
            border: 1px solid #000 !important;
            border-top: 2.0px solid #000 !important;
            border-bottom: 1.5px solid #000 !important;
            background-color: transparent !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-hidden {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          .print-suspended {
            text-decoration: line-through !important;
            color: #777 !important;
            opacity: 0.7;
          }

          input.no-print {
            display: none !important;
          }
        }

        /* Non-print view values helper */
        .print-only {
          display: none;
        }
      `}</style>
    </div>
  );
}
