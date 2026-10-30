export async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
export const projectApi = {
  list: () => apiRequest("/api/projects"),
  get: (id) => apiRequest(`/api/projects/${encodeURIComponent(id)}`),
  create: (name) =>
    apiRequest("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  rename: (id, name) =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id) =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  members: (id) =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}/members`),
  changeMember: (id, userId, role) =>
    apiRequest(
      `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  removeMember: (id, userId) =>
    apiRequest(
      `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  invitations: (id) =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}/invitations`),
  invite: (id, email, role) =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  revokeInvitation: (id, invitationId) =>
    apiRequest(
      `/api/projects/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    ),
  share: (id, method = "GET") =>
    apiRequest(`/api/projects/${encodeURIComponent(id)}/share`, { method }),
  public: (token) => apiRequest(`/api/public/${encodeURIComponent(token)}`),
};
