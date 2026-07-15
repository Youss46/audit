import type { UserRole } from "@workspace/db";

// Augments Express' Request with the authenticated principal attached by the
// `requireAuth` middleware.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        firmId: number;
        role: UserRole;
        email: string;
        fullName: string;
        clientId?: number | null;
        // Module M29: only present for "client_staff" accounts.
        roleId?: number | null;
        permissions?: string[];
        // Multi-station (P8): only present for POMPISTE and other
        // site-restricted staff. Null/absent for client_pme owners and
        // cabinet staff (full cross-station access).
        stationId?: number | null;
        // Module M33 (Enforced Temporary Password Reset Flow): only present
        // on a restricted token; requireAuth() rejects such tokens on every
        // route besides POST /auth/reset-first-password.
        scope?: "password_reset_only";
      };
    }
  }
}

export {};
