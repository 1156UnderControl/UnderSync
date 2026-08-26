import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

function requiredText(value: unknown, label: string, minimum: number, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  }
  return text;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => {
        const flow = typeof params.flow === "string" ? params.flow : "";
        if (flow === "signIn") {
          return {
            email: requiredText(params.email, "Email", 5, 200).toLowerCase(),
            name: "UnderSync user",
            appUsername: "user",
            displayName: "UnderSync user",
            teamRole: "Team member",
            appRole: "MEMBER" as const,
            status: "ACTIVE" as const,
          };
        }

        const email = requiredText(params.email, "Email", 5, 200).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
        const username = requiredText(params.username, "Name", 2, 80).toLowerCase();
        if (!/^[a-z0-9._-]+$/.test(username)) {
          throw new Error("Name may contain letters, numbers, dots, underscores and hyphens.");
        }
        const displayName = requiredText(params.displayName, "Display name", 2, 100);
        const teamRole = requiredText(params.teamRole, "Team role", 2, 100);
        return {
          email,
          name: displayName,
          appUsername: username,
          displayName,
          teamRole,
          appRole: "MEMBER" as const,
          status: "ACTIVE" as const,
        };
      },
      validatePasswordRequirements(password) {
        if (password.length < 8 || password.length > 128) {
          throw new Error("Password must contain 8 to 128 characters.");
        }
      },
    }),
  ],
});
