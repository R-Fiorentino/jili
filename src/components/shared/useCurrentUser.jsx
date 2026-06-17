import { useAuth } from "@/lib/AuthContext";
import { hasTechSupervisorCapability, isDeveloperLikeRole } from "@/utils";

export function useCurrentUser() {
  const { user: authUser, isLoadingAuth, checkAppState } = useAuth();
  const role = authUser?.app_role || authUser?._app_role || authUser?.role;
  const user = authUser ? { ...authUser, role } : null;

  const isAnalyst = user?.role === "analyst" || user?.role === "admin";
  const isDeveloper = isDeveloperLikeRole(user?.role);
  const isTechSupervisor = hasTechSupervisorCapability(user);
  const isAdmin = user?.role === "admin";

  return { user, loading: isLoadingAuth, isAnalyst, isDeveloper, isTechSupervisor, isAdmin, refresh: checkAppState };
}
