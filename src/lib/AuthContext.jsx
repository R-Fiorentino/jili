import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/api/firebaseClient";
import { appClient } from "@/api/appClient";

const AuthContext = createContext();

const resolveRole = (userLike) =>
  userLike?.app_role || userLike?._app_role || userLike?.role || "user";

const normalizeUser = (userLike) => {
  if (!userLike) return null;
  const rawRole = userLike.raw_role || userLike.secondary_role || userLike.role;
  const role = resolveRole(userLike);
  return {
    ...userLike,
    raw_role: rawRole,
    secondary_role: userLike.secondary_role || rawRole,
    role,
    app_role: userLike.app_role || role,
  };
};

const buildFallbackUser = (firebaseUser) =>
  normalizeUser({
    id: firebaseUser.uid,
    email: firebaseUser.email || "",
    full_name: firebaseUser.displayName || firebaseUser.email || "User",
    role: "user",
    raw_role: "user",
    app_role: "user",
  });

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const checkAppState = async () => {
    setIsLoadingPublicSettings(false);
    setIsLoadingAuth(true);

    try {
      const currentUser = normalizeUser(await appClient.auth.me());
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (error) {
      const firebaseUser = auth.currentUser;

      if (firebaseUser) {
        setUser(buildFallbackUser(firebaseUser));
        setIsAuthenticated(true);
        setAuthError(null);
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: "auth_required",
          message: error?.message || "Authentication required",
        });
      }
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    setIsLoadingPublicSettings(false);
    setAppPublicSettings({ mode: "firebase" });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({
          type: "auth_required",
          message: "Authentication required",
        });
        setIsLoadingAuth(false);
        return;
      }

      setIsLoadingAuth(true);

      try {
        const currentUser = normalizeUser(await appClient.auth.me());
        setUser(currentUser);
        setIsAuthenticated(true);
        setAuthError(null);
      } catch (error) {
        setUser(buildFallbackUser(firebaseUser));
        setIsAuthenticated(true);
        setAuthError(null);
      } finally {
        setIsLoadingAuth(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await appClient.auth.logout();
  };

  const navigateToLogin = () => {
    setAuthError({ type: "auth_required", message: "Authentication required" });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
