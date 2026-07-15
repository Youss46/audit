import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserRole } from "@workspace/db";

// JWT signing secret. Reuses the platform-managed SESSION_SECRET so no
// additional secret needs to be provisioned for this app.
const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET must be set to sign authentication tokens.");
}

const JWT_EXPIRES_IN = "7d";

export interface AuthTokenPayload {
  id: number;
  firmId: number;
  role: UserRole;
  email: string;
  fullName: string;
  // Only present for "client_pme" accounts: scopes the Espace PME portal
  // session to a single client dossier (module P2).
  clientId?: number | null;
  // Module M29: only present for "client_staff" accounts. `permissions` is
  // resolved from the referenced role at login time and embedded in the
  // JWT (like `role`/`clientId` above) rather than re-fetched per request --
  // consistent with the existing session model, where role changes already
  // require a fresh login to take effect.
  roleId?: number | null;
  permissions?: string[];
  // Multi-station (P8): only present for POMPISTE and other site-restricted
  // staff. Null for client_pme owners and cabinet staff (full cross-station
  // access). Embedded at login time from users.stationId.
  stationId?: number | null;
  // Module M33 (Enforced Temporary Password Reset Flow): only present on a
  // restricted token issued by /auth/login when the account still has
  // requiresPasswordChange = true. requireAuth() rejects any token
  // carrying this scope on every route except POST /auth/reset-first-password.
  scope?: "password_reset_only";
}

const RESTRICTED_JWT_EXPIRES_IN = "15m";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: JWT_EXPIRES_IN });
}

// Module M33: issues a short-lived, scope-restricted token in place of a
// normal session when the account must change its temporary password
// before doing anything else. Deliberately short-lived (15m) since its
// only purpose is to survive the trip from the login response to the
// reset-first-password submission.
export function signRestrictedPasswordResetToken(
  payload: Pick<AuthTokenPayload, "id" | "firmId" | "role" | "email" | "fullName">,
): string {
  return jwt.sign(
    { ...payload, scope: "password_reset_only" },
    JWT_SECRET as string,
    { expiresIn: RESTRICTED_JWT_EXPIRES_IN },
  );
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET as string) as AuthTokenPayload;
}

// Module M33 password policy: at least 8 characters, one digit and one
// special (non-alphanumeric) character. Mirrored on the frontend
// (src/lib/password.ts) for instant feedback -- this is the authoritative
// server-side check.
export const PASSWORD_POLICY_REGEX = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

export function isStrongPassword(password: string): boolean {
  return PASSWORD_POLICY_REGEX.test(password);
}

// Module M33: generates a random temporary password for admin-created
// accounts (cabinet staff via POST /users, PME staff via POST /staff), e.g.
// "M15-Temp4821!". Always satisfies PASSWORD_POLICY_REGEX.
export function generateTemporaryPassword(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const specials = ["!", "#", "$", "%", "*", "?"];
  const special = specials[Math.floor(Math.random() * specials.length)];
  return `M15-Temp${digits}${special}`;
}
