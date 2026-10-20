export class ActionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function safeError(error: unknown) {
  if (error instanceof ActionError) {
    return { body: { error: error.code, ...error.details }, status: error.status };
  }
  const allowed = [
    "reconnect_youtube",
    "consent_missing_permissions",
    "choose_one_youtube_channel",
    "disconnect_before_switching_channel",
    "revocation_failed",
    "upload_initiation_failed",
  ];
  const code = error instanceof Error && allowed.includes(error.message)
    ? error.message
    : "youtube_probe_failed";
  return { body: { error: code }, status: 502 };
}
