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
      };
    }
  }
}

export {};
