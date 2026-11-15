// Build-time feature flags. NEXT_PUBLIC_* values are inlined by Next, so they must be read as
// literal `process.env.NAME` expressions. Defaults are the safe production values; local dev
// turns demo mode on in apps/web/.env.development.

/** Demo-only controls: demo accounts on login, "Simulate critical report", "Reset demo data". */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** Photo attachments on the public form. Off until the presigned upload endpoint exists. */
export const PHOTO_UPLOAD = process.env.NEXT_PUBLIC_PHOTO_UPLOAD === "true";

/** Emergency number shown to reporters. */
export const EMERGENCY_NUMBER = process.env.NEXT_PUBLIC_EMERGENCY_NUMBER || "123";
