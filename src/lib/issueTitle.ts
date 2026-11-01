import type { ValidationIssue } from '@shared/contracts';
import { GTFS_SPEC } from '@shared/gtfs-spec';
import type { Translate } from '@/lib/i18n/translate';

/** The title of a validation issue; the checks generated from the specification name their file and field. */
export function issueTitle(t: Translate, issue: ValidationIssue): string {
  return t(`validation.${issue.code}`, {
    file: issue.table ? GTFS_SPEC[issue.table].file : '',
    field: issue.field ?? '',
  });
}

/** A key that tells two issues apart (several checks share a code). */
export const issueKey = (issue: ValidationIssue): string =>
  [issue.code, issue.table, issue.field].filter(Boolean).join(':');
