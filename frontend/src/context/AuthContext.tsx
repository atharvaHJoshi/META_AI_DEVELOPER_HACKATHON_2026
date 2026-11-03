import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthResponse, AuthUser, Organization, Workspace } from "@miraiwerk/schemas";
import {
  AUTH_EVENT,
  api,
  ApiError,
  getAccessToken,
  setAccessToken,
} from "../lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  organizations: Organization[];
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    organizationName?: string;
  }) => Promise<void>;
  demoLogin: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (input: {
    name?: string;
    title?: string;
    avatarColor?: string;
    timezone?: string;
  }) => Promise<void>;
  retry: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyAuthResponse(
  response: AuthResponse,
  setters: {
    setUser: (user: AuthUser) => void;
    setOrganizations: (items: Organization[]) => void;
    setWorkspaces: (items: Workspace[]) => void;
  },
) {
  setAccessToken(response.accessToken);
  setters.setUser(response.user);
  setters.setOrganizations(response.organizations);
  setters.setWorkspaces(response.workspaces);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = getAccessToken();
    try {
      if (token) {
        try {
          const me = await api.auth.me();
          setUser(me.user);
          setOrganizations(me.organizations);
          setWorkspaces(me.workspaces);
          return;
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
        }
      }
      const refreshed = await api.auth.refresh();
      if (refreshed) {
        setUser(refreshed.user);
        setOrganizations(refreshed.organizations);
        setWorkspaces(refreshed.workspaces);
      } else {
        setAccessToken(null);
        setUser(null);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The session could not be restored.");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onUnauthenticated = () => {
      setUser(null);
      setOrganizations([]);
      setWorkspaces([]);
    };
    window.addEventListener(AUTH_EVENT, onUnauthenticated);
    return () => window.removeEventListener(AUTH_EVENT, onUnauthenticated);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.auth.login(email.trim(), password);
    applyAuthResponse(response, { setUser, setOrganizations, setWorkspaces });
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string; organizationName?: string }) => {
      const response = await api.auth.register(input);
      applyAuthResponse(response, { setUser, setOrganizations, setWorkspaces });
    },
    [],
  );

  const demoLogin = useCallback(async (email: string) => {
    const response = await api.auth.demo(email);
    applyAuthResponse(response, { setUser, setOrganizations, setWorkspaces });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setOrganizations([]);
      setWorkspaces([]);
    }
  }, []);

  const updateProfile = useCallback(
    async (input: { name?: string; title?: string; avatarColor?: string; timezone?: string }) => {
      const me = await api.auth.profile(input);
      setUser(me.user);
      setOrganizations(me.organizations);
      setWorkspaces(me.workspaces);
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organizations,
      workspaces,
      loading,
      error,
      login,
      register,
      demoLogin,
      logout,
      updateProfile,
      retry: hydrate,
    }),
    [
      user,
      organizations,
      workspaces,
      loading,
      error,
      login,
      register,
      demoLogin,
      logout,
      updateProfile,
      hydrate,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
