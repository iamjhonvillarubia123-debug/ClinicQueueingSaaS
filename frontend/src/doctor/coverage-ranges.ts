export type CoverageRange = { fromServiceDate: string; toServiceDate: string };
export function invitationRanges(invitation: { coverageRanges?: CoverageRange[]; fromServiceDate: string | null; toServiceDate: string | null }): CoverageRange[] {
  return invitation.coverageRanges ?? (invitation.fromServiceDate && invitation.toServiceDate ? [{ fromServiceDate: invitation.fromServiceDate.slice(0, 10), toServiceDate: invitation.toServiceDate.slice(0, 10) }] : []);
}
export function overlaps(ranges: CoverageRange[], selected: CoverageRange) {
  return Boolean(selected.fromServiceDate && selected.toServiceDate) && ranges.some((range) => range.fromServiceDate <= selected.toServiceDate && range.toServiceDate >= selected.fromServiceDate);
}
function shift(value: string, days: number) { return new Date(new Date(value).getTime() + days * 86400000).toISOString().slice(0, 10); }
export function subtractCoverage(ranges: CoverageRange[], selected: CoverageRange): CoverageRange[] {
  return ranges.flatMap((range) => {
    if (!overlaps([range], selected)) return [range];
    const result: CoverageRange[] = [];
    if (range.fromServiceDate < selected.fromServiceDate) result.push({ fromServiceDate: range.fromServiceDate, toServiceDate: shift(selected.fromServiceDate, -1) });
    if (range.toServiceDate > selected.toServiceDate) result.push({ fromServiceDate: shift(selected.toServiceDate, 1), toServiceDate: range.toServiceDate });
    return result;
  });
}
export function formatCoverage(ranges: CoverageRange[]) {
  return ranges.map((range) => range.fromServiceDate === range.toServiceDate ? range.fromServiceDate : `${range.fromServiceDate} – ${range.toServiceDate}`).join(', ') || 'No remaining dates';
}

export function mergeCoverage(ranges: CoverageRange[]): CoverageRange[] {
  const result: CoverageRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.fromServiceDate.localeCompare(b.fromServiceDate))) {
    const previous = result.at(-1);
    if (previous && new Date(range.fromServiceDate).getTime() <= new Date(previous.toServiceDate).getTime() + 86400000) previous.toServiceDate = previous.toServiceDate > range.toServiceDate ? previous.toServiceDate : range.toServiceDate;
    else result.push({ ...range });
  }
  return result;
}
