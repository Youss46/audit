import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/auth";
import { isPortalRole, isSuperAdmin, type UserRole } from "@workspace/db";

// Verifies the Bearer JWT and attaches the authenticated principal to
// `req.user`. All routes except /auth/register and /auth/login require this.
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentification requise." });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    // Module M33: a restricted password-reset token must never grant
    // access to anything besides POST /auth/reset-first-password, which
    // uses requirePasswordResetAuth (below) instead of this middleware.
    if (payload.scope === "password_reset_only") {
      res.status(403).json({
        error: "Vous devez d'abord réinitialiser votre mot de passe avant de continuer.",
        status: "FORCE_PASSWORD_CHANGE",
      });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Jeton invalide ou expiré." });
  }
}

// Module M33: the mirror image of requireAuth's restriction above. Gates
// POST /auth/reset-first-password -- only a token carrying scope ===
// "password_reset_only" is accepted; a normal full-session token is
// rejected (that account has nothing to reset through this endpoint).
export function requirePasswordResetAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentification requise." });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    if (payload.scope !== "password_reset_only") {
      res.status(403).json({ error: "Ce jeton ne permet pas cette action." });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Jeton invalide ou expiré." });
  }
}

// RBAC gate (module M9): restricts a route to a set of roles.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentification requise." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Accès refusé pour ce rôle." });
      return;
    }
    next();
  };
}

// Super Admin gate: ONLY allows requests from accounts with role "super_admin".
// Must be composed AFTER requireAuth. Blocks every cabinet and PME role.
// Used exclusively on /api/admin/* routes.
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentification requise." });
    return;
  }
  if (!isSuperAdmin(req.user.role)) {
    res.status(403).json({
      error: "Accès réservé aux administrateurs système.",
    });
    return;
  }
  next();
}

// Module P2 (Espace PME) scoping: a client_pme account (and, since module
// M29, its client_staff accounts) is bound to exactly one client dossier
// (req.user.clientId) and must never be able to read or write another
// client's data within the same firm. Cabinet staff (any other role) are
// unrestricted -- firmId scoping alone applies to them.
export function canAccessClient(
  req: Request,
  clientId: number,
): boolean {
  if (!isPortalRole(req.user!.role)) return true;
  return req.user!.clientId === clientId;
}

// Returns false (and writes the 403 response) if the caller may not access
// the given client. Callers should `return` immediately when this is false.
export function requireOwnClient(req: Request, res: Response, clientId: number): boolean {
  if (!canAccessClient(req, clientId)) {
    res.status(403).json({ error: "Accès refusé à ce dossier client." });
    return false;
  }
  return true;
}

// Module M29 (RBAC & Gestion du Personnel PME): restricts a route to
// accounts holding at least one of the given permission keys. Only
// "client_staff" accounts are ever restricted -- every other role
// (cabinet staff, and the "client_pme" owner itself) bypasses this check
// unchanged, so existing behavior for those roles never regresses.
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentification requise." });
      return;
    }
    if (req.user.role !== "client_staff") {
      next();
      return;
    }
    const granted = req.user.permissions ?? [];
    if (!permissions.some((p) => granted.includes(p))) {
      res.status(403).json({
        error: "Accès refusé : votre rôle ne dispose pas de cette autorisation.",
      });
      return;
    }
    next();
  };
}
