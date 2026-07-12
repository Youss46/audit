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
}

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

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET as string) as AuthTokenPayload;
}
