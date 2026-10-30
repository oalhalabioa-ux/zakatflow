import { it, expect } from "vitest";
import { invitationErrorCode } from "./invitation-error";
it("distinguishes unavailable subscription seats from invalid invitation links", () => {
  expect(invitationErrorCode("SUBSCRIPTION_USER_LIMIT")).toBe("invite_seats");
  expect(invitationErrorCode("SUBSCRIPTION_READ_ONLY")).toBe("invite_readonly");
  expect(invitationErrorCode("INVITATION_EMAIL_MISMATCH")).toBe("invite_email");
  expect(invitationErrorCode("expired")).toBe("invite_invalid");
});
