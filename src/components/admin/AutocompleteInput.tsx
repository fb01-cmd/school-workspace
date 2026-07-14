import { useEffect, useState, useRef } from "react";

interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type: "user" | "group";
  domain: string;
  onSelect: (email: string, name?: string) => void;
  className?: string;
}

export default function AutocompleteInput({
  value,
  onChange,
  placeholder = "",
  type,
  domain,
  onSelect,
  className = "",
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // 그룹 목록 캐시 (type === "group" 일 때 사용)
  const [allGroups, setAllGroups] = useState<any[]>([]);

  // 1. 그룹 목록 전체 가져오기 (마운트 시 1회)
  useEffect(() => {
    if (type === "group" && domain) {
      const fetchGroups = async () => {
        try {
          const res = await fetch("/api/workspace/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list", domain }),
          });
          if (res.ok) {
            const data = await res.json();
            setAllGroups(data.groups || []);
          }
        } catch (err) {
          console.error("Failed to fetch groups for autocomplete", err);
        }
      };
      fetchGroups();
    }
  }, [type, domain]);

  // 2. 디바운스 검색 (type === "user" 일 때 사용)
  useEffect(() => {
    if (type !== "user" || !value || !domain) {
      setSuggestions([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/workspace/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query: value }),
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.users || []);
        }
      } catch (err) {
        console.error("Failed to search users", err);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms 디바운스

    return () => clearTimeout(delayDebounce);
  }, [value, type, domain]);

  // 3. 그룹 자동완성 로컬 필터링 (type === "group" 일 때 사용)
  useEffect(() => {
    if (type !== "group" || !value) {
      setSuggestions([]);
      return;
    }
    const lower = value.toLowerCase();
    const filtered = allGroups
      .filter(
        (g) =>
          g.email.toLowerCase().includes(lower) ||
          (g.name || "").toLowerCase().includes(lower)
      )
      .slice(0, 10);
    setSuggestions(filtered);
  }, [value, type, allGroups]);

  // 4. 바깥 영역 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        handleSelectItem(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleSelectItem = (item: any) => {
    const email = item.primaryEmail || item.email;
    const name = item.name 
      ? typeof item.name === "object" 
        ? `${item.name.familyName || ""}${item.name.givenName || ""}` 
        : item.name 
      : "";
    onSelect(email, name);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div ref={dropdownRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={() => {
          // 클릭 이벤트를 먼저 수신할 수 있도록 딜레이를 두고 닫음
          setTimeout(() => setIsOpen(false), 200);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`${className} w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900`}
      />

      {isOpen && (value.trim() !== "") && (suggestions.length > 0 || loading) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-2 text-xs text-gray-500">검색 중...</div>
          ) : (
            suggestions.map((item, index) => {
              const email = item.primaryEmail || item.email;
              const name = item.name 
                ? typeof item.name === "object" 
                  ? `${item.name.familyName || ""}${item.name.givenName || ""}` 
                  : item.name 
                : "";
              const details = item.orgUnitPath || item.description || "";
              
              return (
                <div
                  key={email}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
                    index === activeIndex ? "bg-indigo-50 text-indigo-900" : "text-gray-700"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">
                      {name ? `${name} (${email})` : email}
                    </span>
                    {details && (
                      <span className="text-xs text-gray-400 truncate max-w-[150px]">
                        {details}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
