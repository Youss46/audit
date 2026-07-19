// Module M33 (Réinitialisation Forcée du Mot de Passe Temporaire).
//
// Mirrors PASSWORD_POLICY_REGEX in artifacts/api-server/src/lib/auth.ts --
// this is only for instant client-side feedback; the server re-validates
// authoritatively.
export const PASSWORD_POLICY_REGEX = /^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

export function isStrongPassword(password: string): boolean {
  return PASSWORD_POLICY_REGEX.test(password);
}

export const PASSWORD_POLICY_HINT =
  "Au moins 8 caractères, avec un chiffre et un caractère spécial."
