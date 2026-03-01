import { REPORT_EXCLUDED_SLACK_USER_IDS } from '../config';

export const isReportExcludedSlackUser = (slackUserId?: string): boolean => {
  if (!slackUserId) return false;
  return REPORT_EXCLUDED_SLACK_USER_IDS.includes(slackUserId);
};

export const isIncludedInReports = (slackUserId?: string): boolean => {
  return !isReportExcludedSlackUser(slackUserId);
};

export const getReportUserExclusionFilter = (fieldName = 'slackUserId') => {
  if (REPORT_EXCLUDED_SLACK_USER_IDS.length === 0) {
    return {};
  }

  return {
    [fieldName]: {
      $nin: REPORT_EXCLUDED_SLACK_USER_IDS
    }
  };
};

export const appendReportUserExclusion = (
  query: Record<string, any>,
  fieldName = 'slackUserId'
): Record<string, any> => {
  if (REPORT_EXCLUDED_SLACK_USER_IDS.length === 0) {
    return query;
  }

  const exclusion = getReportUserExclusionFilter(fieldName);

  if (Array.isArray(query.$and)) {
    query.$and.push(exclusion);
    return query;
  }

  query.$and = [exclusion];
  return query;
};
