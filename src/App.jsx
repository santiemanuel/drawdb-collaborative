import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useLayoutEffect } from "react";
import Editor from "./pages/Editor";
import BugReport from "./pages/BugReport";
import Templates from "./pages/Templates";
import Projects, { ProjectDetail, InvitationPage } from "./pages/Projects";
import AuthContextProvider from "./context/AuthContext";
import SettingsContextProvider from "./context/SettingsContext";
import NotFound from "./pages/NotFound";
import MigrationBanner, { isLegacyHost } from "./components/MigrationBanner";

export default function App() {
  const routes = (
    <Routes>
      <Route path="/" element={<Projects />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:id" element={<ProjectDetail />} />
      <Route path="/shared/:token" element={<ProjectDetail />} />
      <Route path="/invitations/:token" element={<InvitationPage />} />
      <Route path="/editor" element={<Editor />} />
      <Route path="/editor/diagrams/:id" element={<Editor />} />
      <Route path="/diagrams/:id" element={<Editor />} />
      <Route path="/editor/templates/:id" element={<Editor />} />
      <Route path="/bug-report" element={<BugReport />} />
      <Route path="/templates" element={<Templates />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );

  return (
    <BrowserRouter>
      <AuthContextProvider>
        <SettingsContextProvider>
          <RestoreScroll />
          {isLegacyHost() ? (
            <div className="h-full flex flex-col">
              <MigrationBanner />
              <div className="flex-1 min-h-0">{routes}</div>
            </div>
          ) : (
            routes
          )}
        </SettingsContextProvider>
      </AuthContextProvider>
    </BrowserRouter>
  );
}

function RestoreScroll() {
  const location = useLocation();
  useLayoutEffect(() => {
    window.scroll(0, 0);
  }, [location.pathname]);
  return null;
}
