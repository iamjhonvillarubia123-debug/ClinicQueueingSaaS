export type CoverageRange = { fromServiceDate: string; toServiceDate: string };

function shiftDate(value: string, days: number) {
  return new Date(
    new Date(`${value}T00:00:00.000Z`).getTime() + days * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}

export function subtractCoverage(
  ranges: CoverageRange[],
  removed: CoverageRange,
): CoverageRange[] {
  return ranges.flatMap((range) => {
    if (
      range.toServiceDate < removed.fromServiceDate ||
      range.fromServiceDate > removed.toServiceDate
    )
      return [range];
    const remaining: CoverageRange[] = [];
    if (range.fromServiceDate < removed.fromServiceDate)
      remaining.push({
        fromServiceDate: range.fromServiceDate,
        toServiceDate: shiftDate(removed.fromServiceDate, -1),
      });
    if (range.toServiceDate > removed.toServiceDate)
      remaining.push({
        fromServiceDate: shiftDate(removed.toServiceDate, 1),
        toServiceDate: range.toServiceDate,
      });
    return remaining;
  });
}

export function invitationCoverageRanges(invitation: {
  requestedFromServiceDate: Date | null;
  requestedToServiceDate: Date | null;
  coverageRevisions?: unknown;
  requestedCoverageRanges?: unknown;
}): CoverageRange[] {
  if (
    !invitation.requestedFromServiceDate ||
    !invitation.requestedToServiceDate
  )
    return [];
  let ranges = [
    {
      fromServiceDate: invitation.requestedFromServiceDate
        .toISOString()
        .slice(0, 10),
      toServiceDate: invitation.requestedToServiceDate
        .toISOString()
        .slice(0, 10),
    },
  ];
  if (
    Array.isArray(invitation.requestedCoverageRanges) &&
    invitation.requestedCoverageRanges.length
  ) {
    const supplied: unknown[] = invitation.requestedCoverageRanges;
    ranges = supplied.filter((range): range is CoverageRange =>
      Boolean(
        range &&
        typeof range === 'object' &&
        'fromServiceDate' in range &&
        typeof range.fromServiceDate === 'string' &&
        'toServiceDate' in range &&
        typeof range.toServiceDate === 'string',
      ),
    );
  }
  const revisions: unknown[] = Array.isArray(invitation.coverageRevisions)
    ? invitation.coverageRevisions
    : [];
  for (const revision of revisions) {
    if (
      revision &&
      typeof revision === 'object' &&
      'fromServiceDate' in revision &&
      'toServiceDate' in revision &&
      typeof revision.fromServiceDate === 'string' &&
      typeof revision.toServiceDate === 'string'
    )
      ranges = subtractCoverage(ranges, revision as CoverageRange);
  }
  return ranges;
}

export function coverageOverlaps(
  ranges: CoverageRange[],
  range: CoverageRange,
) {
  return ranges.some(
    (item) =>
      item.fromServiceDate <= range.toServiceDate &&
      item.toServiceDate >= range.fromServiceDate,
  );
}
