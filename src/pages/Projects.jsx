import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest, projectApi } from "../api/projects";
import { diagramApi } from "../api/diagrams";
import "./Projects.css";

const roleLabel = {
  owner: "Propietario",
  editor: "Editor",
  viewer: "Solo lectura",
};
export function ProjectShell({ children }) {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  return (
    <div className="project-shell">
      <header className="project-header">
        <Link to="/projects" className="project-brand">
          drawDB <span>Projects</span>
        </Link>
        <div className="project-account">
          {user && (
            <>
              <span>{user.name || user.display_name || user.email}</span>
              <button
                onClick={() => logout().catch((e) => setError(e.message))}
              >
                Cerrar sesión
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
      <main className="project-main">{children}</main>
    </div>
  );
}
export function LoginRequired() {
  const { loading, error, refresh, loginEnabled } = useAuth();
  const params = new URLSearchParams(window.location.search);
  return (
    <ProjectShell>
      <section className="project-welcome">
        <div className="project-eyebrow">TU ESPACIO DE TRABAJO</div>
        <h1>Tus ideas, conectadas.</h1>
        <p>
          Organizá tus diagramas en proyectos, colaborá con tu equipo y
          encontralos desde cualquier dispositivo.
        </p>
        {loading ? (
          <p role="status">Cargando tu sesión…</p>
        ) : error ? (
          <>
            <p role="alert" className="project-error">
              {error}
            </p>
            <button onClick={refresh}>Reintentar</button>
          </>
        ) : (
          <>
            {(params.has("error") || params.has("authError")) && (
              <p role="alert" className="project-error">
                No se pudo completar el acceso. Intentá nuevamente con Google.
              </p>
            )}
            {loginEnabled ? (
              <a
                className="project-button primary"
                href={`/auth/google?returnTo=${encodeURIComponent(window.location.pathname.startsWith("/invitations/") ? "/projects" : window.location.pathname + window.location.search)}`}
              >
                Continuar con Google
              </a>
            ) : (
              <p role="status">
                El acceso con Google todavía no está configurado. Contactá al
                administrador.
              </p>
            )}
            <small>
              Los proyectos son privados. Solo se comparten cuando su
              propietario lo decide.
            </small>
          </>
        )}
      </section>
    </ProjectShell>
  );
}
function ErrorNotice({ message }) {
  return message ? (
    <p role="alert" className="project-error">
      {message}
    </p>
  ) : null;
}
export default function Projects() {
  const { user, loading } = useAuth();
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const load = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      const data = await projectApi.list();
      setProjects(data.projects);
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    if (user) load();
  }, [user, load]);
  if (loading || !user) return <LoginRequired />;
  const create = async (event) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await projectApi.create(name.trim());
      navigate(`/projects/${data.project?.id || data.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProjectShell>
      <div className="project-eyebrow">ESPACIO PERSONAL</div>
      <h1>Mis proyectos</h1>
      <p className="project-subtitle">
        Guardados en el servidor. Disponibles donde inicies sesión.
      </p>
      <form className="project-create" onSubmit={create}>
        <label htmlFor="new-project">Nuevo proyecto</label>
        <input
          id="new-project"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del proyecto"
        />
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? "Creando…" : "Crear proyecto"}
        </button>
      </form>
      <ErrorNotice message={error} />
      {error && <button onClick={load}>Reintentar</button>}
      {pending ? (
        <p role="status">Cargando proyectos…</p>
      ) : (
        [true, false].map((owned) => {
          const items = projects.filter((p) => (p.role === "owner") === owned);
          return (
            <section key={String(owned)} className="project-section">
              <h2>
                {owned ? "Creados por mí" : "Compartidos conmigo"}{" "}
                <span>{items.length}</span>
              </h2>
              {!items.length ? (
                <p className="project-empty">
                  {owned
                    ? "Creá tu primer proyecto para empezar."
                    : "Los proyectos a los que te inviten aparecerán aquí."}
                </p>
              ) : (
                <div className="project-grid">
                  {items.map((p) => (
                    <Link
                      className="project-card"
                      key={p.id}
                      to={`/projects/${p.id}`}
                    >
                      <span className="project-role">{roleLabel[p.role]}</span>
                      <h3>{p.name}</h3>
                      <p>
                        {p.owner_name
                          ? `Por ${p.owner_name}`
                          : "Proyecto privado"}
                      </p>
                      <span className="project-open">Abrir proyecto →</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </ProjectShell>
  );
}
export function ProjectDetail() {
  const { id, token } = useParams();
  const { user } = useAuth();
  // Route/account changes get independent state. Late responses from a previous
  // project cannot populate the new project's controls or generated links.
  return (
    <ProjectDetailContent
      key={`${id || "public"}:${token || "private"}:${user?.id || "guest"}`}
    />
  );
}

function ProjectDetailContent() {
  const { id, token } = useParams();
  const isPublic = Boolean(token);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const requestEpoch = useRef(0);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setPending(true);
    setError("");
    try {
      const next = isPublic
        ? await projectApi.public(token)
        : await projectApi.get(id);
      if (epoch !== requestEpoch.current) return;
      setData(next);
      setName(next.project.name);
      if (!isPublic && next.project.role === "owner") {
        const [m, i, s] = await Promise.all([
          projectApi.members(id),
          projectApi.invitations(id),
          projectApi.share(id),
        ]);
        if (epoch !== requestEpoch.current) return;
        setMembers(m.members || []);
        setInvitations(i.invitations || []);
        setShare((current) => (s.enabled ? { ...current, ...s } : s));
      }
    } catch (e) {
      if (epoch === requestEpoch.current) setError(e.message);
    } finally {
      if (epoch === requestEpoch.current) setPending(false);
    }
  }, [id, token, isPublic]);
  useEffect(() => {
    setData(null);
    setShare(null);
    setInviteUrl("");
    setMembers([]);
    setInvitations([]);
    setNotice("");
    if (isPublic || user) load();
  }, [isPublic, user, load]);
  const act = async (fn, success = "Cambios guardados.") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Enlace copiado.");
    } catch {
      setError("No se pudo copiar. Seleccioná y copiá el enlace manualmente.");
    }
  };
  if (!isPublic && (loading || !user)) return <LoginRequired />;
  const owner = !isPublic && data?.project.role === "owner";
  const canEdit = !isPublic && ["owner", "editor"].includes(data?.project.role);
  const shareUrl =
    share?.url ||
    (share?.token ? `${window.location.origin}/shared/${share.token}` : "");
  return (
    <ProjectShell>
      <Link className="project-back" to="/projects">
        ← Proyectos
      </Link>
      <ErrorNotice message={error} />
      {notice && (
        <p role="status" className="project-notice">
          {notice}
        </p>
      )}
      {pending && <p role="status">Cargando proyecto…</p>}
      {!pending && !data && <button onClick={load}>Reintentar</button>}
      {data && (
        <>
          <div className="project-title-row">
            <div>
              <span className="project-role">
                {isPublic
                  ? "Enlace público · Solo lectura"
                  : roleLabel[data.project.role]}
              </span>
              <h1>{data.project.name}</h1>
            </div>
            {canEdit && (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const diagram = await diagramApi.create({
                      name: "Nuevo diagrama",
                      projectId: id,
                      document: {
                        database: "generic",
                        tables: [],
                        references: [],
                        notes: [],
                        areas: [],
                        views: [],
                        pan: { x: 0, y: 0 },
                        zoom: 1,
                      },
                    });
                    navigate(`/diagrams/${diagram.id}`);
                  }, "Diagrama creado.")
                }
              >
                Nuevo diagrama
              </button>
            )}
          </div>
          <section className="project-section">
            <h2>
              Diagramas <span>{data.diagrams.length}</span>
            </h2>
            {!data.diagrams.length && (
              <p className="project-empty">
                Este proyecto todavía no tiene diagramas.
              </p>
            )}
            <div className="project-grid">
              {data.diagrams.map((d) => (
                <div className="project-card" key={d.id}>
                  <Link
                    to={`/diagrams/${d.id}${isPublic ? `?share=${encodeURIComponent(token)}` : ""}`}
                  >
                    <h3>{d.name}</h3>
                    <p>
                      {d.updated_at &&
                        `Actualizado ${new Date(d.updated_at).toLocaleString()}`}
                    </p>
                    <span className="project-open">
                      {canEdit ? "Editar diagrama" : "Ver diagrama"} →
                    </span>
                  </Link>
                  {owner && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Eliminar “${d.name}”? Esta acción no se puede deshacer.`,
                          )
                        )
                          act(() => diagramApi.delete(d.id));
                      }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          {owner && (
            <div className="project-settings">
              <section className="project-panel">
                <h2>Equipo</h2>
                <p>
                  Invitá por correo y compartí el enlace. La persona debe entrar
                  con esa misma cuenta de Google.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      const result = await projectApi.invite(id, email, role);
                      setInviteUrl(result.acceptUrl);
                      setEmail("");
                    }, "Invitación preparada. Copiá el enlace y envialo a esa persona.");
                  }}
                >
                  <label htmlFor="invite-email">Correo de Google</label>
                  <input
                    id="invite-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <label htmlFor="invite-role">Permiso</label>
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="viewer">Solo lectura</option>
                    <option value="editor">Edición</option>
                  </select>
                  <button disabled={busy}>Crear invitación</button>
                </form>
                {inviteUrl && (
                  <div className="project-link">
                    <input
                      aria-label="Enlace de invitación"
                      readOnly
                      value={inviteUrl}
                    />
                    <button onClick={() => copy(inviteUrl)}>
                      Copiar enlace
                    </button>
                  </div>
                )}
                <ul className="project-people">
                  {members.map((m) => (
                    <li key={m.user_id || m.id}>
                      <div>
                        <strong>{m.name || m.email}</strong>
                        <small>{m.email}</small>
                      </div>
                      {m.role === "owner" ? (
                        <span>Propietario</span>
                      ) : (
                        <>
                          <select
                            aria-label={`Permiso de ${m.name || m.email}`}
                            value={m.role}
                            disabled={busy}
                            onChange={(e) =>
                              act(() =>
                                projectApi.changeMember(
                                  id,
                                  m.user_id || m.id,
                                  e.target.value,
                                ),
                              )
                            }
                          >
                            <option value="viewer">Solo lectura</option>
                            <option value="editor">Edición</option>
                          </select>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(`¿Quitar acceso a ${m.email}?`)
                              )
                                act(() =>
                                  projectApi.removeMember(
                                    id,
                                    m.user_id || m.id,
                                  ),
                                );
                            }}
                          >
                            Quitar
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {invitations.length > 0 && (
                  <>
                    <h3>Invitaciones pendientes</h3>
                    <ul className="project-people">
                      {invitations.map((i) => (
                        <li key={i.id}>
                          <span>
                            {i.email} · {roleLabel[i.role]}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              act(() => projectApi.revokeInvitation(id, i.id))
                            }
                          >
                            Revocar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
              <section className="project-panel">
                <h2>Enlace público</h2>
                {share?.enabled && !shareUrl && (
                  <>
                    <p>
                      Hay un enlace activo. Por seguridad, solo se muestra al
                      crearlo.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => act(() => projectApi.share(id, "DELETE"))}
                    >
                      Desactivar enlace existente
                    </button>
                  </>
                )}
                <p>
                  Cualquier persona con este enlace podrá ver todos los
                  diagramas del proyecto, sin iniciar sesión. Nunca podrá
                  editarlos.
                </p>
                {shareUrl ? (
                  <>
                    <div className="project-link">
                      <input
                        readOnly
                        aria-label="Enlace público"
                        value={shareUrl}
                      />
                      <button onClick={() => copy(shareUrl)}>Copiar</button>
                    </div>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "¿Desactivar el enlace público? Las personas que lo tengan perderán acceso.",
                          )
                        )
                          act(() => projectApi.share(id, "DELETE"));
                      }}
                    >
                      Desactivar enlace
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "¿Habilitar lectura de todos los diagramas para cualquier persona que tenga el enlace?",
                        )
                      )
                        act(
                          async () =>
                            setShare(await projectApi.share(id, "POST")),
                          "Enlace público habilitado.",
                        );
                    }}
                  >
                    {share?.enabled
                      ? "Reemplazar enlace público"
                      : "Habilitar enlace de lectura"}
                  </button>
                )}
                <hr />
                <h2>Configuración</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(() => projectApi.rename(id, name.trim()));
                  }}
                >
                  <label htmlFor="project-name">Nombre</label>
                  <input
                    id="project-name"
                    maxLength={200}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button disabled={busy || !name.trim()}>
                    Guardar nombre
                  </button>
                </form>
                <p>Para eliminar un proyecto, primero debe estar vacío.</p>
                <button
                  className="danger"
                  disabled={busy || data.diagrams.length > 0}
                  onClick={() => {
                    if (
                      window.confirm(
                        "¿Eliminar este proyecto vacío y sus permisos?",
                      )
                    )
                      act(async () => {
                        await projectApi.remove(id);
                        navigate("/projects");
                      });
                  }}
                >
                  Eliminar proyecto vacío
                </button>
              </section>
            </div>
          )}
        </>
      )}
    </ProjectShell>
  );
}

export function InvitationPage() {
  const { token } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (loading || !user) return <LoginRequired />;
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest(
        `/api/invitations/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      navigate(`/projects/${result.projectId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProjectShell>
      <h1>Invitación a un proyecto</h1>
      <p>
        Entraste como {user.email}. La invitación debe estar dirigida a esta
        cuenta.
      </p>
      <ErrorNotice message={error} />
      <button className="primary" disabled={busy} onClick={accept}>
        {busy ? "Aceptando…" : "Aceptar invitación"}
      </button>
      <p>
        Si ya aceptaste o iniciaste sesión desde este enlace, revisá{" "}
        <Link to="/projects">tus proyectos compartidos</Link>.
      </p>
    </ProjectShell>
  );
}
