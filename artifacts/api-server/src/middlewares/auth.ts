import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/auth";
import type { UserRole } from "@workspace/db";

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

// Module P2 (Espace PME) scoping: a client_pme account is bound to exactly
// one client dossier (req.user.clientId) and must never be able to read or
// write another client's data within the same firm. Cabinet staff (any
// other role) are unrestricted -- firmId scoping alone applies to them.
export function canAccessClient(
  req: Request,
  clientId: number,
): boolean {
  if (req.user!.role !== "client_pme") return true;
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
