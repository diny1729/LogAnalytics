import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { formatIso } from "../../utils/formatUtils";

export interface GlassDateTimePickerProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export function GlassDateTimePicker({
  value,
  onChange,
  placeholder = "Select date & time"
}: GlassDateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const parsedDate = useMemo(() => {
    if (!value) return new Date();
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [value]);

  const [viewYear, setViewYear] = useState<number>(parsedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(parsedDate.getMonth());

  const [selectedHour, setSelectedHour] = useState<number>(parsedDate.getHours());
  const [selectedMinute, setSelectedMinute] = useState<number>(parsedDate.getMinutes());

  useEffect(() => {
    if (!value) return;
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setSelectedHour(d.getHours());
      setSelectedMinute(d.getMinutes());
    }
  }, [value, isOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const totalDaysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

    const days: Array<{ day: number; isCurrentMonth: boolean; monthOffset: number }> = [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isCurrentMonth: false, monthOffset: -1 });
    }

    for (let i = 1; i <= totalDaysInMonth; i++) {
      days.push({ day: i, isCurrentMonth: true, monthOffset: 0 });
    }

    const remainingCells = (42 - days.length) % 7 === 0 && days.length >= 35 ? 0 : 42 - days.length;
    for (let i = 1; i <= remainingCells; i++) {
      days.push({ day: i, isCurrentMonth: false, monthOffset: 1 });
    }

    return days;
  }, [viewYear, viewMonth]);

  const selectedDayNum = parsedDate.getFullYear() === viewYear && parsedDate.getMonth() === viewMonth ? parsedDate.getDate() : null;
  const today = new Date();
  const isTodayMonth = today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  function handleSelectDay(day: number, monthOffset: number) {
    let targetYear = viewYear;
    let targetMonth = viewMonth + monthOffset;
    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    } else if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }
    const isoStr = formatIso(targetYear, targetMonth, day, selectedHour, selectedMinute);
    onChange(isoStr);
  }

  function handleTimeChange(h: number, m: number) {
    setSelectedHour(h);
    setSelectedMinute(m);
    const day = selectedDayNum || parsedDate.getDate() || 1;
    const isoStr = formatIso(viewYear, viewMonth, day, h, m);
    onChange(isoStr);
  }

  function handleNow() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedHour(now.getHours());
    setSelectedMinute(now.getMinutes());
    const isoStr = formatIso(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    onChange(isoStr);
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const displayString = value ? value.replace("T", " ") : "";

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          background: "rgba(10, 24, 20, 0.82)",
          backdropFilter: "blur(12px)",
          border: isOpen ? "1px solid #0AB68B" : "1px solid var(--glass-border)",
          borderTop: isOpen ? "1px solid #92DE8B" : "1px solid var(--glass-border-luminous)",
          borderRadius: "8px",
          padding: "7px 12px",
          color: "#f8fafc",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: isOpen ? "0 0 0 3px rgba(10, 182, 139, 0.35), var(--glass-specular)" : "inset 0 1px 3px rgba(0,0,0,0.3)",
          transition: "all 0.2s ease"
        }}
      >
        <Calendar size={14} color="#92DE8B" />
        <span>{displayString || placeholder}</span>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        />
      </div>

      {isOpen && (
        <div
          className="glass-calendar-popover"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 100000,
            background: "rgba(8, 20, 16, 0.96)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(10, 182, 139, 0.22)",
            borderTop: "1px solid rgba(146, 222, 139, 0.35)",
            borderRadius: "14px",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            width: "330px",
            color: "#f8fafc",
            fontFamily: "var(--font-sans)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.2px" }}>
              {monthNames[viewMonth]} {viewYear}
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={prevMonth}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "6px",
                  color: "#92DE8B",
                  cursor: "pointer",
                  width: "28px",
                  height: "28px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px"
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={nextMonth}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "6px",
                  color: "#92DE8B",
                  cursor: "pointer",
                  width: "28px",
                  height: "28px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px"
                }}
              >
                ›
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", marginBottom: "6px" }}>
                {dayNames.map((d) => (
                  <div key={d} style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "#92DE8B", padding: "4px 0" }}>
                    {d}
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px" }}>
                {calendarDays.map(({ day, isCurrentMonth, monthOffset }, idx) => {
                  const isSelected = isCurrentMonth && day === selectedDayNum;
                  const isToday = isCurrentMonth && isTodayMonth && day === today.getDate();

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectDay(day, monthOffset)}
                      style={{
                        height: "32px",
                        width: "100%",
                        border: isSelected
                          ? "1px solid #FFE3B3"
                          : isToday
                          ? "1px solid rgba(146, 222, 139, 0.5)"
                          : "none",
                        borderRadius: "8px",
                        background: isSelected
                          ? "linear-gradient(135deg, #0AB68B 0%, #028174 100%)"
                          : isToday
                          ? "rgba(10, 182, 139, 0.22)"
                          : "transparent",
                        color: isSelected
                          ? "#ffffff"
                          : isCurrentMonth
                          ? "#f8fafc"
                          : "#475569",
                        fontSize: "12px",
                        fontWeight: isSelected || isToday ? 700 : 500,
                        cursor: isCurrentMonth ? "pointer" : "default",
                        boxShadow: isSelected ? "0 4px 14px rgba(10, 182, 139, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)" : "none",
                        transition: "all 0.15s ease"
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected && isCurrentMonth) {
                          e.currentTarget.style.background = "rgba(10, 182, 139, 0.25)";
                          e.currentTarget.style.color = "#92DE8B";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected && isCurrentMonth) {
                          e.currentTarget.style.background = isToday ? "rgba(10, 182, 139, 0.22)" : "transparent";
                          e.currentTarget.style.color = "#f8fafc";
                        }
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "80px", borderLeft: "1px solid var(--glass-border)", paddingLeft: "12px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#92DE8B" }}>Time</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "10px", color: "#94a3b8" }}>Hour</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={selectedHour}
                  onChange={(e) => handleTimeChange(Math.max(0, Math.min(23, Number(e.target.value))), selectedMinute)}
                  style={{
                    background: "rgba(6, 18, 14, 0.9)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "6px",
                    color: "#92DE8B",
                    padding: "4px 6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    textAlign: "center"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "10px", color: "#94a3b8" }}>Min</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={selectedMinute}
                  onChange={(e) => handleTimeChange(selectedHour, Math.max(0, Math.min(59, Number(e.target.value))))}
                  style={{
                    background: "rgba(6, 18, 14, 0.9)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "6px",
                    color: "#92DE8B",
                    padding: "4px 6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    textAlign: "center"
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid var(--glass-border)" }}>
            <button
              type="button"
              onClick={handleNow}
              style={{
                background: "rgba(10, 182, 139, 0.2)",
                border: "1px solid #0AB68B",
                borderRadius: "6px",
                color: "#92DE8B",
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 10px",
                cursor: "pointer"
              }}
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: "linear-gradient(135deg, #0AB68B 0%, #028174 100%)",
                border: "1px solid #FFE3B3",
                borderRadius: "6px",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 14px",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(10, 182, 139, 0.4)"
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
