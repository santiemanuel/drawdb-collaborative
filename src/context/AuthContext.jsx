import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiRequest } from "../api/projects";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function AuthContextProvider({ children }) {
  const [state, setState] = useState({
    user: null,
    loading: true,
    loginEnabled: false,
    error: "",
  });
  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest("/api/auth/me");
      setState({ ...data, loading: false, error: "" });
      return data;
    } catch (error) {
      setState({
        user: null,
        loading: false,
        loginEnabled: false,
        error: error.message,
      });
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const logout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    window.location.assign("/projects");
  };
  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
