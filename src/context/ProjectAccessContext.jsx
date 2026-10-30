import { createContext, useContext } from "react";
export const ProjectAccessContext = createContext({
  role: "viewer",
  projectId: null,
  shareToken: null,
});
export const useProjectAccess = () => useContext(ProjectAccessContext);
