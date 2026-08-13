"use client";

/**
 * 소속 부서·직책 선택 UI — **단일 소재지**.
 *
 * 원래 이 마크업이 `MyProfileModal`(본인 신청)과 `ManualProfileEditor`(관리자 편집)에
 * 통째로 복붙돼 있었다. 두 화면 모두 부서 28개·직책 9개를 알약 버튼으로 깔아 놓아서
 * 화면 대부분을 차지했고, 원하는 항목을 눈으로 훑어 찾아야 했다(사용자 지적, 반복).
 * 드롭다운으로 바꾸면서 두 벌을 여기로 모았다 — 앞으로 선택 UI는 이 파일만 고친다.
 *
 * 부서는 복수 선택이라 드롭다운 하나로 끝나지 않는다. **고르면 아래 목록에 쌓이는** 방식을
 * 택했다: 부서장 지정 체크박스가 이미 "선택된 부서 목록" 형태로 있었으므로 그 자리에
 * 삭제 버튼만 얹으면 선택 결과와 역할 지정이 한 곳에서 보인다.
 */

interface Props {
  departments: string[];
  positions: string[];

  noDept: boolean;
  onNoDeptToggle: () => void;

  selectedDepts: string[];
  /** 추가·삭제 모두 이 핸들러를 쓴다(기존 toggleDept 그대로). */
  onToggleDept: (dept: string) => void;

  deptHeadMap: Record<string, boolean>;
  onDeptHeadChange: (dept: string, checked: boolean) => void;

  position: string;
  onPositionChange: (position: string) => void;

  /** 관리자 화면은 단계 번호를 붙인다("2. 소속 부서"). */
  deptLabel?: string;
  positionLabel?: string;
}

const SELECT_CLASS =
  "w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-400";

export default function DeptPositionPicker({
  departments,
  positions,
  noDept,
  onNoDeptToggle,
  selectedDepts,
  onToggleDept,
  deptHeadMap,
  onDeptHeadChange,
  position,
  onPositionChange,
  deptLabel = "소속 부서",
  positionLabel = "직책",
}: Props) {
  const available = departments.filter(d => !selectedDepts.includes(d));

  return (
    <>
      {/* ── 소속 부서 ── */}
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-2">
          {deptLabel} <span className="text-red-500">*</span>
          <span className="text-xs font-normal text-gray-400 ml-1">(복수 선택 가능)</span>
        </label>

        <label className="flex items-center gap-2 mb-2 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={noDept}
            onChange={onNoDeptToggle}
            className="w-4 h-4 rounded text-gray-600 focus:ring-gray-400"
          />
          <span className="text-xs font-medium text-gray-500">해당사항 없음 (소속 부서 없음)</span>
        </label>

        <select
          value=""
          disabled={noDept || available.length === 0}
          onChange={e => {
            if (e.target.value) onToggleDept(e.target.value);
          }}
          className={SELECT_CLASS}
        >
          <option value="">
            {available.length === 0 ? "모든 부서를 선택했습니다" : "＋ 부서를 선택하세요"}
          </option>
          {available.map(dept => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>

        {/* 선택된 부서 목록 + 부서별 부서장 지정 */}
        {!noDept && selectedDepts.length > 0 && (
          <div className="mt-3 space-y-2 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 max-w-md">
            <p className="text-xs font-semibold text-indigo-800 mb-1.5">
              선택한 부서 {selectedDepts.length}개 — 부서별 역할 지정
            </p>
            <div className="space-y-1.5">
              {selectedDepts.map(dept => (
                <div
                  key={dept}
                  className="flex items-center justify-between gap-2 bg-white px-3 py-1.5 rounded border border-indigo-100 text-xs"
                >
                  <span className="font-bold text-gray-800 truncate">{dept}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-600">
                      <input
                        type="checkbox"
                        checked={!!deptHeadMap[dept]}
                        onChange={e => onDeptHeadChange(dept, e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-400"
                      />
                      <span>부서장(부장)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => onToggleDept(dept)}
                      aria-label={`${dept} 선택 해제`}
                      title="선택 해제"
                      className="text-gray-400 hover:text-red-500 font-bold leading-none px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!noDept && selectedDepts.length === 0 && (
          <p className="mt-2 text-xs text-gray-400">아직 선택한 부서가 없습니다.</p>
        )}
      </div>

      {/* ── 직책 (해당사항 없을 시 미노출) ── */}
      {!noDept && (
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            {positionLabel} <span className="text-red-500">*</span>
          </label>
          <select
            value={position}
            onChange={e => onPositionChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">직책을 선택하세요</option>
            {positions.map(pos => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
