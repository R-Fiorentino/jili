import React from "react";
import RoleSetup from "./RoleSetup";
import { useAuth } from "@/lib/AuthContext";
import { isKnownAppRole } from "@/utils";

/**
 * Wrap any page content. If the user doesn't have a known role,
 * shows RoleSetup as a full-screen overlay OVER everything.
 */
export default function RoleGate() {
  const { user, isAuthenticated, isLoadingAuth, checkAppState } = useAuth();

  if (isLoadingAuth || !isAuthenticated) return null;

  const role = user?.app_role || user?._app_role || user?.role || "user";
  const needsSetup = user && !isKnownAppRole(role);

  if (!needsSetup) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-50">
      <RoleSetup onDone={checkAppState} />
    </div>
  );
}
