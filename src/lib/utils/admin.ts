const DEV_DEFAULT_PASSWORD = "research-admin";

function getAdminPassword(): string | null {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  // Never fall back to the public default in production.
  return process.env.NODE_ENV === "production" ? null : DEV_DEFAULT_PASSWORD;
}

export function isAdminRequest(request: Request): boolean {
  const adminPassword = getAdminPassword();
  if (!adminPassword) return false;
  const password =
    request.headers.get("x-admin-password") ??
    new URL(request.url).searchParams.get("password");
  return password === adminPassword;
}
