export function validateRuntimeConfig({
  cookieSecureMode,
  syncAdminPasswordOnStartup,
  nodeEnv,
  adminUsernameEnv,
  adminPasswordEnv,
  defaultAdminPassword,
} = {}) {
  if (!["off", "on", "auto"].includes(cookieSecureMode)) {
    throw new Error(
      `Unsupported COOKIE_SECURE_MODE "${cookieSecureMode}". Expected "off", "on", or "auto".`,
    );
  }

  if (!["0", "1", "true", "false"].includes(syncAdminPasswordOnStartup)) {
    throw new Error(
      `Unsupported SYNC_ADMIN_PASSWORD_ON_STARTUP "${syncAdminPasswordOnStartup}". Expected 0/1/true/false.`,
    );
  }

  const allowDefaultAdminCredentials = ["development", "dev", "local", "test"].includes(nodeEnv);
  if (!allowDefaultAdminCredentials) {
    if (!adminUsernameEnv) {
      throw new Error(
        "Refusing to start outside local/dev/test without ADMIN_USERNAME. Set explicit admin credentials.",
      );
    }
    if (!adminPasswordEnv) {
      throw new Error(
        "Refusing to start outside local/dev/test without ADMIN_PASSWORD. Set explicit admin credentials.",
      );
    }
  }

  if (!allowDefaultAdminCredentials && adminPasswordEnv === defaultAdminPassword) {
    throw new Error(
      "Refusing to start outside local/dev/test with the default admin password. Set ADMIN_PASSWORD.",
    );
  }
}
