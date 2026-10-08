import { useEffect, useState } from "react";
import {
  getCurrentUser,
  signInWithRedirect,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

import Dashboard from "./pages/Dashboard";
import Services from "./pages/Services";
import CostDrivers from "./pages/CostDrivers";

import DashboardLayout from "./components/layout/DashboardLayout";

function LoginScreen() {
  const handleGoogleLogin = async () => {
    try {
      await signInWithRedirect({
        provider: "Google",
      });
    } catch (error) {
      console.error("Google login failed:", error);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "40px",
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            marginBottom: "10px",
            fontSize: "28px",
          }}
        >
          AWS Cost Intelligence
        </h1>

        <p
          style={{
            marginBottom: "30px",
            color: "#64748b",
          }}
        >
          Sign in to view your AWS cost dashboard
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          style={{
            width: "100%",
            padding: "12px 20px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            background: "#ffffff",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: 600,
          }}
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}

function App() {
  const [activeItem, setActiveItem] = useState("dashboard");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        await getCurrentUser();

        setIsAuthenticated(true);
      } catch (error) {
        console.log("No authenticated user:", error);

        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuthentication();

    const unsubscribe = Hub.listen(
      "auth",
      ({ payload }) => {
        switch (payload.event) {
          case "signedIn":
            setIsAuthenticated(true);
            break;

          case "signedOut":
            setIsAuthenticated(false);
            break;

          default:
            break;
        }
      },
    );

    return unsubscribe;
  }, []);

  if (isCheckingAuth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#475569",
          fontSize: "16px",
        }}
      >
        Checking authentication...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const renderPage = () => {
    switch (activeItem) {
      case "services":
        return <Services />;

      case "cost-drivers":
        return <CostDrivers />;

      case "dashboard":
      default:
        return <Dashboard />;
    }
  };

  return (
    <DashboardLayout
      activeItem={activeItem}
      onNavigate={setActiveItem}
    >
      {renderPage()}
    </DashboardLayout>
  );
}

export default App;
