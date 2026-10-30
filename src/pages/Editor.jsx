import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ProjectAccessContext } from "../context/ProjectAccessContext";
import { diagramApi } from "../api/diagrams";
import { projectApi } from "../api/projects";
import { LoginRequired, ProjectShell } from "./Projects";
import LayoutContextProvider from "../context/LayoutContext";
import TransformContextProvider from "../context/TransformContext";
import TablesContextProvider from "../context/DiagramContext";
import UndoRedoContextProvider from "../context/UndoRedoContext";
import SelectContextProvider from "../context/SelectContext";
import AreasContextProvider from "../context/AreasContext";
import NotesContextProvider from "../context/NotesContext";
import TypesContextProvider from "../context/TypesContext";
import SettingsContextProvider from "../context/SettingsContext";
import SaveStateContextProvider from "../context/SaveStateContext";
import EnumsContextProvider from "../context/EnumsContext";
import ViewsContextProvider from "../context/ViewsContext";
import WorkSpace from "../components/Workspace";
import { useThemedPage } from "../hooks";
import CollabContextProvider from "../context/CollabContext";

export default function Editor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const shareToken = search.get("share");
  const projectId = search.get("project");
  const { user, loading } = useAuth();
  const [access, setAccess] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setError("");
    if (!shareToken && !user) return;
    const existing = id && !window.location.pathname.includes("/templates/");
    const request = existing
      ? diagramApi.get(id, shareToken)
      : projectId
        ? projectApi
            .get(projectId)
            .then((d) => ({ role: d.project.role, project_id: d.project.id }))
        : Promise.reject(new Error("Abrí un proyecto para crear un diagrama."));
    request
      .then((d) => {
        if (!cancelled)
          setAccess({
            role: shareToken ? "viewer" : d.role,
            projectId: d.project_id,
            shareToken,
          });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, shareToken, projectId, user, retry]);
  useEffect(() => {
    const revoked = () => {
      setAccess(null);
      setError(
        "El acceso cambió o tu sesión terminó. Iniciá sesión nuevamente o pedí acceso al propietario.",
      );
    };
    const changed = () => {
      setAccess(null);
      setRetry((value) => value + 1);
    };
    window.addEventListener("drawdb-access-revoked", revoked);
    window.addEventListener("drawdb-access-changed", changed);
    return () => {
      window.removeEventListener("drawdb-access-revoked", revoked);
      window.removeEventListener("drawdb-access-changed", changed);
    };
  }, []);
  if (!shareToken && (loading || !user)) return <LoginRequired />;
  if (!access)
    return (
      <ProjectShell>
        {error ? (
          <>
            <h1>No se pudo abrir el diagrama</h1>
            <p role="alert" className="project-error">
              {error}
            </p>
            <button onClick={() => setRetry((n) => n + 1)}>Reintentar</button>{" "}
            <Link to="/projects">Volver a proyectos</Link>
          </>
        ) : (
          <p role="status">Verificando acceso…</p>
        )}
      </ProjectShell>
    );
  return (
    <ProjectAccessContext.Provider value={access}>
      <div className="project-editor-wrap">
        <div className="project-editor-bar">
          <Link
            to={
              shareToken
                ? `/shared/${shareToken}`
                : `/projects/${access.projectId}`
            }
          >
            ← {shareToken ? "Proyecto compartido" : "Volver al proyecto"}
          </Link>
          <span>
            {access.role === "viewer"
              ? "Solo lectura"
              : "Guardado en el servidor"}{" "}
            · {user?.name || "Visitante"}
          </span>
        </div>
        <div className="project-editor-body">
          <EditorWorkspace key={`${id || "new"}:${shareToken || "private"}`} />
        </div>
      </div>
    </ProjectAccessContext.Provider>
  );
}

function EditorWorkspace() {
  useThemedPage();

  return (
    <SettingsContextProvider>
      <CollabContextProvider>
        <LayoutContextProvider>
          <TransformContextProvider>
            <UndoRedoContextProvider>
              <SelectContextProvider>
                <AreasContextProvider>
                  <NotesContextProvider>
                    <TypesContextProvider>
                      <EnumsContextProvider>
                        <ViewsContextProvider>
                          <TablesContextProvider>
                            <SaveStateContextProvider>
                              <WorkSpace />
                            </SaveStateContextProvider>
                          </TablesContextProvider>
                        </ViewsContextProvider>
                      </EnumsContextProvider>
                    </TypesContextProvider>
                  </NotesContextProvider>
                </AreasContextProvider>
              </SelectContextProvider>
            </UndoRedoContextProvider>
          </TransformContextProvider>
        </LayoutContextProvider>
      </CollabContextProvider>
    </SettingsContextProvider>
  );
}
