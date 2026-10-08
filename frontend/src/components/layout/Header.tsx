import { useEffect, useState } from "react";
import {
  fetchAuthSession,
  signOut,
} from "aws-amplify/auth";

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

interface UserInfo {
  name: string;
  email: string;
  initials: string;
}

function createUserInfo(
  name?: string,
  email?: string,
  givenName?: string,
  familyName?: string,
): UserInfo {
  const cleanEmail = email ?? "";

  let displayName = name ?? "";

  // Use given name + family name if available.
  if (!displayName && (givenName || familyName)) {
    displayName = [givenName, familyName]
      .filter(Boolean)
      .join(" ");
  }

  // If no name is available, derive a readable name
  // from the email address.
  if (!displayName && cleanEmail) {
    const emailName = cleanEmail.split("@")[0];

    displayName = emailName
      .replace(/[._-]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map(
        (part) =>
          part.charAt(0).toUpperCase() +
          part.slice(1),
      )
      .join(" ");
  }

  if (!displayName) {
    displayName = "User";
  }

  const nameParts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let initials = "U";

  if (nameParts.length >= 2) {
    initials =
      nameParts[0].charAt(0) +
      nameParts[nameParts.length - 1].charAt(0);
  } else if (nameParts.length === 1) {
    initials = nameParts[0].substring(0, 2);
  }

  return {
    name: displayName,
    email: cleanEmail,
    initials: initials.toUpperCase(),
  };
}

export default function Header({
  title = "AWS Cost Intelligence",
  subtitle = "Cloud Cost Overview",
}: HeaderProps) {
  const [user, setUser] = useState<UserInfo>({
    name: "User",
    email: "",
    initials: "U",
  });

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const loadAuthenticatedUser = async () => {
      try {
        const session = await fetchAuthSession();

        const idToken = session.tokens?.idToken;

        if (!idToken) {
          console.warn("No Cognito ID token found.");
          return;
        }

        const claims = idToken.payload;

        console.log("Cognito ID token claims:", claims);

        const email =
          typeof claims.email === "string"
            ? claims.email
            : undefined;

        const name =
          typeof claims.name === "string"
            ? claims.name
            : undefined;

        const givenName =
          typeof claims.given_name === "string"
            ? claims.given_name
            : undefined;

        const familyName =
          typeof claims.family_name === "string"
            ? claims.family_name
            : undefined;

        const userInfo = createUserInfo(
          name,
          email,
          givenName,
          familyName,
        );

        setUser(userInfo);
      } catch (error) {
        console.error(
          "Unable to load authenticated user:",
          error,
        );
      }
    };

    loadAuthenticatedUser();
  }, []);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);

      await signOut();
    } catch (error) {
      console.error("Logout failed:", error);
      setIsLoggingOut(false);
    }
  };

  return (
    <header className="app-header">
      <div className="app-header-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="app-header-actions">
        <div className="data-status">
          <span className="data-status-indicator" />
          <span>Cost data available</span>
        </div>

        <button
          type="button"
          className="refresh-button"
          aria-label="Refresh cost data"
        >
          ↻
        </button>

        <div className="user-profile">
          <div className="user-avatar">
            {user.initials}
          </div>

          <div className="user-info">
            <strong>{user.name}</strong>

            <span>
              {user.email || "Google Account"}
            </span>
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </div>
    </header>
  );
}