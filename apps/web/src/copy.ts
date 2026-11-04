/**
 * UI copy strings (GUD-007, TASK-077).
 *
 * All user-facing strings live here. Screens import from this module;
 * no hardcoded string literals appear in component JSX.
 */

export const copy = {
  app: {
    name: 'FakeNews Intervention Platform',
    tagline: 'Algorithmic Credibility & Verified Information Platform',
    nav: {
      home: 'Feed',
      explore: 'Explore',
      search: 'Search',
      notifications: 'Notifications',
      messages: 'Messages',
      score: 'My Credibility',
      appeals: 'My Appeals',
      profile: 'Profile',
      settings: 'Settings',
      admin: 'Governance & Admin',
      login: 'Sign In',
      register: 'Create Account',
      logout: 'Sign Out',
    },
  },

  feed: {
    globalTab: 'Global Feed',
    followingTab: 'Following',
    noGlobalPosts: 'No posts in the global feed yet.',
    noFollowingPosts: 'No posts from people you follow. Check out who to follow or browse global.',
    whoToFollow: 'Who to follow',
    verifiedAuthors: 'High credibility contributors',
    loadMore: 'Load more posts',
    allCaughtUp: "You're all caught up!",
  },

  composer: {
    placeholder: 'What verified news, insight, or analysis are you sharing? (Min 20 characters)',
    sourceUrlPlaceholder: 'Source URL (optional, e.g. https://reuters.com/...)',
    publish: 'Post',
    publishing: 'Posting…',
    edit: 'Edit Post',
    saving: 'Saving…',
    charCount: (len: number, max: number) => `${len} / ${max}`,
    lowTierWarning: 'Your credibility tier is currently Low. Your post will undergo review before becoming publicly visible.',
    attachImage: 'Attach image (max 4)',
    removeImage: 'Remove image',
  },

  post: {
    resharedBy: (username: string) => `Shared by @${username}`,
    originalPost: 'Original Post',
    edited: 'Edited',
    editWindowRemaining: (minutes: number) => `Edit available for ${minutes}m`,
    like: 'Like',
    unlike: 'Liked',
    reshare: 'Share',
    retractReshare: 'Retract Share',
    comment: 'Comment',
    report: 'Report',
    edit: 'Edit',
    delete: 'Delete',
    underAppeal: 'Under appeal',
    likesCount: (count: number) => `${count} like${count === 1 ? '' : 's'}`,
    commentsCount: (count: number) => `${count} comment${count === 1 ? '' : 's'}`,
    resharesCount: (count: number) => `${count} share${count === 1 ? '' : 's'}`,
    deleteConfirm: 'Are you sure you want to delete this post? If this is a reshare, retracting it will void any pending penalty.',
  },

  // Post labels (RUL-012, RUL-023)
  postLabel: {
    fact_checked_false: 'Fact-check: False',
    fact_checked_true: 'Fact-check: Verified',
    none: '',
    unverifiable: 'Unverifiable',
    auto_flagged: 'Automated check: may be misleading (not yet verified)',
  } as const,

  // Tier badges (RUL-011)
  tier: {
    trusted: 'Trusted Contributor',
    neutral: 'Neutral Contributor',
    low: 'Low Credibility (recent verified misinformation)',
  } as const,

  // Author-only detection status (Section 1.8)
  detectionStatus: {
    pending: 'Automated check pending',
    likely_real: 'Automated check: no concerns',
    uncertain: 'Automated check: inconclusive, sent for review',
    likely_fake: 'Automated check flagged this post, sent for review',
    failed: 'Automated check unavailable, sent for review',
  } as const,

  // Event kinds human-readable labels (v2.0)
  eventKind: {
    RESPONSIBLE_POST: 'Authored verified post (+1)',
    RESPONSIBLE_RESHARE: 'Shared verified post (+1)',
    VALID_REPORT: 'Reported false post (+1)',
    MISINFO_POST: 'Authored false post (-1)',
    MISINFO_RESHARE: 'Shared false post (-1)',
    MISINFO_LIKE: 'Liked false post (-1)',
    REVERSAL: 'Reversal adjustment (+1 / -1)',
  } as const,

  // Void reasons
  voidReason: {
    interaction_retracted: 'Voided (interaction retracted before wave finalization)',
    cap_exceeded: 'Voided (per-wave cap exceeded)',
    assessment_superseded: 'Voided (superseded by new assessment)',
  } as const,

  eventStatus: {
    eligible: 'Pending Count',
    held: 'Held Under Appeal',
    counted: 'Counted in Ledger',
    voided: 'Voided',
  } as const,

  reshareDialog: {
    title: 'Share Post',
    warningPrompt: 'This post was flagged or has been fact-checked as false. Sharing it may reduce your credibility score. Share anyway?',
    commentPlaceholder: 'Add an optional comment (up to 500 characters)…',
    confirmShare: 'Share Post',
    cancel: 'Cancel',
    sharing: 'Sharing…',
  },

  reportDialog: {
    title: 'Report Post for Moderator Review',
    description: 'If this post contains fabricated, misleading, or deceptive claims, reporting it alerts fact-checkers. Accurate reports award +1 credibility if validated.',
    reasonLabel: 'Reason for report',
    detailsPlaceholder: 'Provide supporting context or debunking links (optional, max 500 characters)…',
    submit: 'Submit Report',
    submitting: 'Submitting…',
    cancel: 'Cancel',
    success: 'Report submitted to the moderator review queue.',
    reasons: {
      false_information: 'False or fabricated information',
      misleading: 'Misleading or out of context',
      spam: 'Spam or automated manipulation',
      harassment: 'Harassment or hate speech',
      other: 'Other policy violation',
    },
  },

  appealDialog: {
    title: 'Appeal Credibility Penalty',
    description: 'You can appeal this negative event within the 7-day appeal window. Opening an appeal temporarily holds the penalty while an independent moderator evaluates your evidence.',
    reasonLabel: 'Appeal Statement & Evidence',
    reasonPlaceholder: 'Detail why this assessment was incorrect with citations or fact-checking sources (min 20, max 1000 characters)…',
    submit: 'Submit Appeal',
    submitting: 'Submitting…',
    cancel: 'Cancel',
  },

  comments: {
    title: 'Comments',
    placeholder: 'Write a constructive comment (1–300 characters)…',
    submit: 'Reply',
    empty: 'No comments yet. Start the conversation.',
    policyNote: 'Comments foster discussion and never create reputation score events (DEC-006).',
    deleteConfirm: 'Are you sure you want to delete this comment?',
  },

  score: {
    title: 'Credibility Reputation Score',
    subtitle: 'Transparent, wave-based reputation governed by mathematical proof.',
    qScoreLabel: 'Reputation Score (Q)',
    sigmaLabel: 'Responsiveness Rate (σ)',
    tierLabel: 'Credibility Tier',
    currentWaveTitle: 'Current Wave Projection',
    waveNumber: (num: number) => `Wave #${num}`,
    formulaNotice: 'Scores update only when waves finalize. Predictions from AI never penalize users without human review.',
    pendingBreakdown: 'Pending Interactions in Current Wave',
    nPos: 'Positive Actions (n+)',
    nNeg: 'Misinformation Penalties (n-)',
    nAdj: 'Adjustments (n_adj)',
    projectedDelta: 'Projected Delta (Δ)',
    explanationButton: 'View Mathematical Explanation',
    drawerTitle: 'How Your Score is Calculated',
    formulaDisplay: 'Q(w + 1) = Q(w) + σ × R(w)',
    formulaRDisplay: 'R(w) = n⁺(w) - n⁻(w) + adjustments',
    historyTitle: 'Ledger History',
    noHistory: 'No finalized wave history yet.',
    eventsTitle: 'Reputation Events',
    noEvents: 'No reputation events recorded for your account.',
    statusFilterAll: 'All Events',
    appealPenalty: 'Appeal Penalty',
    appealHeldNotice: 'Currently held under review. Penalty is frozen until resolved.',
  },

  appeals: {
    title: 'My Appeals',
    subtitle: 'Track the status and resolution of your contested penalties.',
    empty: 'You have no submitted appeals.',
    statusOpen: 'Open (Under Moderator Review)',
    statusUpheld: 'Upheld (Penalty Reinstated)',
    statusOverturned: 'Overturned (Penalty Annulled)',
    reasonLabel: 'Your Statement',
    resolutionNoteLabel: 'Moderator Resolution Note',
  },

  auth: {
    signInTitle: 'Welcome Back',
    signInSubtitle: 'Sign in to access your verified feed and credibility score',
    signUpTitle: 'Join the Platform',
    signUpSubtitle: 'Participate in transparent, accountable discourse',
    forgotPasswordTitle: 'Reset Password',
    forgotPasswordSubtitle: "Enter your email and we'll send a password reset link",
    resetPasswordTitle: 'Set New Password',
    verifyEmailTitle: 'Verifying Email',
    emailLabel: 'Email Address',
    usernameLabel: 'Username',
    displayNameLabel: 'Display Name',
    passwordLabel: 'Password',
    newPasswordLabel: 'New Password',
    currentPasswordLabel: 'Current Password',
    tokenLabel: 'Verification Token',
    signInBtn: 'Sign In',
    signUpBtn: 'Create Account',
    sendResetBtn: 'Send Reset Link',
    resetBtn: 'Update Password',
    haveAccount: 'Already have an account? Sign In',
    needAccount: "Don't have an account? Sign Up",
    forgotPasswordLink: 'Forgot your password?',
    signingIn: 'Signing in…',
    signingUp: 'Creating account…',
    sending: 'Sending…',
  },

  settings: {
    title: 'Account Settings',
    profileSection: 'Profile Information',
    bioLabel: 'Biography',
    avatarLabel: 'Profile Photo',
    updateProfileBtn: 'Save Profile',
    securitySection: 'Security & Password',
    changePasswordBtn: 'Update Password',
    sessionsSection: 'Active Sessions',
    revokeSession: 'Revoke',
    currentSessionBadge: 'Current Device',
    blocksSection: 'Blocked Accounts',
    unblockBtn: 'Unblock',
    noBlocks: 'You have not blocked any users.',
    exportSection: 'Data Portability (GDPR)',
    exportDescription: 'Download a complete JSON export of your profile, posts, comments, likes, events, and ledger history.',
    downloadExportBtn: 'Export My Data',
    dangerZone: 'Delete Account',
    deleteDescription: 'Permanently remove your account, anonymize public actions, and revoke all active sessions.',
    deleteAccountBtn: 'Delete Account',
    deleteConfirmPassword: 'Confirm Password to Delete',
  },

  admin: {
    title: 'Governance & Administration',
    overviewTab: 'Overview',
    queueTab: 'Review Queue',
    appealsTab: 'Appeals',
    wavesTab: 'Reputation Waves',
    usersTab: 'User Management',
    auditTab: 'Audit Log',
    verifyTab: 'Score Verifier',
    analyticsTab: 'Analytics & Exports',
    detectorStatusTab: 'Detector Health',

    overview: {
      statsTitle: 'Platform Pulse',
      totalUsers: 'Total Users',
      totalPosts: 'Total Posts',
      totalWaves: 'Waves Count',
      openQueueItems: 'Queue Pending',
      openAppealsCount: 'Open Appeals',
      detectionStatsTitle: 'RoBERTa Detection Pipeline Status',
    },

    queue: {
      title: 'Moderation Review Queue',
      empty: 'No items currently awaiting review.',
      priorityBadge: (p: number) => `Priority ${p}`,
      reportsCount: (count: number) => `${count} open report${count === 1 ? '' : 's'}`,
      reviewBtn: 'Open Review Workspace',
    },

    workspace: {
      title: 'Review Workspace',
      postContext: 'Infringing Post Context',
      modelOutput: 'RoBERTa Model Classification',
      pFakeLabel: 'p_fake Score',
      bandLabel: 'Detection Band',
      reportsSection: 'User Reports',
      decisionSection: 'Verdict & Impact Analysis',
      verdictLabel: 'Assessment Verdict',
      rationaleLabel: 'Public Fact-Checking Rationale (min 10 characters)',
      submitVerdict: 'Record Assessment Verdict',
      submitting: 'Processing verdict…',
      consequenceHeader: 'Binding Governance Consequences:',
      consequenceFake: (resharers: number, likers: number, reporters: number) =>
        `Will create -1 for author, -1 for ${resharers} resharers, -1 for ${likers} likers, and +1 for ${reporters} reporters.`,
      consequenceReal: (resharers: number) =>
        `Will create +1 for author and +1 for ${resharers} resharers.`,
      consequenceUnverifiable: 'Will resolve reports with zero scoring changes to author or interactors.',
      conflictError: 'Cannot assess this post: You have a conflict of interest as an author, resharer, liker, or reporter.',
    },

    appeals: {
      title: 'Appeals Resolution',
      empty: 'No open appeals pending adjudication.',
      decisionLabel: 'Resolution Decision',
      upholdOption: 'Uphold Assessment (retains penalty)',
      overturnOption: 'Overturn Assessment (nullifies penalty)',
      resolutionNotePlaceholder: 'Detailed moderator explanation of decision (min 10 characters)…',
      newVerdictLabel: 'New Corrected Verdict',
      submitResolution: 'Resolve Appeal',
    },

    waves: {
      title: 'Reputation Waves Management',
      currentWaveHeader: 'Active Open Wave',
      finalizeBtn: 'Finalize Open Wave & Commit Scores',
      finalizeConfirm: 'Finalizing will calculate scores for all active users, commit the immutable ledger rows, and open the subsequent wave. Proceed?',
      finalizing: 'Finalizing wave…',
      ledgerBtn: 'Inspect Ledger',
      historyTitle: 'Finalized Waves Archive',
    },

    users: {
      title: 'User Management',
      searchPlaceholder: 'Search by username or display name…',
      suspendBtn: 'Suspend',
      unsuspendBtn: 'Unsuspend',
      suspendReasonPrompt: 'Reason for user suspension (audited):',
      viewScoreHistory: 'View Reputation History',
    },

    verify: {
      title: 'Mathematical Score Invariants (I1–I6)',
      description: 'Audit database tables against the paper’s mathematical invariants: Sigma stability, single open wave, immutable ledger, and conservation of scores.',
      runBtn: 'Run Verification Audit',
      running: 'Auditing database…',
      passed: 'All mathematical scoring invariants verified successfully.',
      failed: (count: number) => `Verification detected ${count} invariant violation(s):`,
    },

    analytics: {
      title: 'Analytics & Research Exports',
      csvHeader: 'Download Datasets (RFC 4180 CSV)',
      downloadLedger: 'Download Ledger CSV',
      downloadEvents: 'Download Reputation Events CSV',
      downloadAssessments: 'Download Assessments CSV',
      spreadChartTitle: 'Information Spread Before & After Fact-Check Label (by Publisher Tier)',
      detectorChartTitle: 'Detection Bands Distribution',
      wavesChartTitle: 'Per-Wave Net Reputation Flow',
    },
  },

  legal: {
    termsTitle: 'Terms of Service',
    privacyTitle: 'Privacy Policy & GDPR Compliance',
    guidelinesTitle: 'Community & Credibility Guidelines',
    termsDescription: 'By participating in the platform, you agree to transparent reputation accounting and independent fact-checking review.',
    privacyDescription: 'We respect privacy and data minimization while providing cryptographically verifiable reputation accountability.',
    guidelinesDescription: 'Understand how verified claims, retractions, and fact-checking assessments govern platform visibility.',
  },

  // Generic
  loading: 'Loading…',
  error: 'Something went wrong. Please try again.',
  empty: 'Nothing here yet.',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  back: 'Back',
} as const;
