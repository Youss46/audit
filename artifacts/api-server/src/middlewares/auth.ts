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
      res.status(401).json({ message: "Authentification requise." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Accès refusé pour ce rôle." });
      return;
    }
    next();
  };
}
