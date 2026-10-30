export function invitationErrorCode(message: string) {
  if (message.includes("SUBSCRIPTION_USER_LIMIT")) return "invite_seats";
  if (message.includes("SUBSCRIPTION_READ_ONLY")) return "invite_readonly";
  if (message.includes("EMAIL_MISMATCH")) return "invite_email";
  return "invite_invalid";
}
