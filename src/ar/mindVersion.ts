export const MIND_AR_PACKAGE_VERSION = "1.2.5";
export const MIND_AR_COMPILER_VERSION = `mind-ar@${MIND_AR_PACKAGE_VERSION}`;

export const hasCurrentMindTarget = (project: { mindTargetId?: string; mindTargetUrl?: string; mindCompilerVersion?: string }) =>
  Boolean((project.mindTargetId || project.mindTargetUrl) && project.mindCompilerVersion === MIND_AR_COMPILER_VERSION);

export const hasAnyMindTarget = (project: { mindTargetId?: string; mindTargetUrl?: string }) => Boolean(project.mindTargetId || project.mindTargetUrl);
