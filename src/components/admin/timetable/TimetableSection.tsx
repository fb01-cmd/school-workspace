"use client";

import TimetableOperationSection from "./TimetableOperationSection";

/**
 * @deprecated TimetableSection was split into TimetableOperationSection and TimetableCreationSection.
 * Spec: docs/timetable_ia_split_spec.md
 */
export default function TimetableSection() {
  return <TimetableOperationSection />;
}
