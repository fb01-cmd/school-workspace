"use client";

import FreeTeacherViewer from "./FreeTeacherViewer";

interface FreeTeacherTabProps {
  periodsPerDay?: number;
}

export default function FreeTeacherTab({ periodsPerDay = 7 }: FreeTeacherTabProps) {
  return <FreeTeacherViewer periodsPerDay={periodsPerDay} />;
}
